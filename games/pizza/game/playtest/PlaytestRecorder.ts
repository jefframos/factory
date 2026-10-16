// PlaytestRecorder.ts
//
// Records one play session — the bot's or a human's — as plain data that PlaytestAnalysis.ts turns
// into findings and PlaytestReport.ts into a page. Three sources:
//
//   - every GameAnalytics event (the module object's methods are wrapped in place, so nothing in
//     the game changes — calls still go through to PlatformHandler.measure()), stamped with game
//     time; every notification shown (UpgradeNotificationManager.show() wrapped the same way);
//   - a SAMPLE every SAMPLE_SEC of game time: money, store level/progress, clients by state and
//     mood, stock vs demand per item, garbage, workers, what the player carries;
//   - every client tracked from arrival to exit, every fixed step: what it wanted, how long it
//     waited on an empty shelf (per item) or at an unattended cashier, and how it ended (paid with
//     which mood, or walked out and why — matched to the clientLeft event of the same step).
//
// The bot also logs its own activities (beginActivity()/endActivity()) and problems it ran into
// (logIssue() — stuck, unreachable, can't gather, ...). Game time = the sum of fixed-step deltas,
// so it already includes the speed-up and stops while the world is paused.

import { GameAnalytics } from '../analytics/GameAnalytics';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import { BackpackStorage } from '../data/BackpackStorage';
import { StorageInventory } from '../data/StorageInventory';
import { ResourceType } from '../actions/ResourceTypes';
import { StoreProgressStorage } from '../store/StoreProgressStorage';
import { StoreWorkerStorage } from '../store/StoreWorkerStorage';
import { getNextStoreLevel, getStoreConfig } from '../store/StoreTypes';
import type Store from '../store/Store';
import type StoreClient from '../store/StoreClient';
import type { ClientState } from '../store/StoreClient';

const SAMPLE_SEC = 1;
/** States in which a client is stuck on its current item while that item's shelves are empty. */
const SHELF_WAIT_STATES: ReadonlySet<ClientState> = new Set<ClientState>(['queuing', 'browsing', 'picking', 'wandering', 'toShelf']);

export interface PlaytestEvent {
    t: number;
    name: string;
    args: unknown[];
}

export interface PlaytestNotification {
    t: number;
    title: string;
    subtitle: string;
}

export interface PlaytestSample {
    t: number;
    money: number;
    stores: Record<string, StoreSample>;
    carrying: Partial<Record<ResourceType, number>>;
    activity?: string;
    frozen: boolean;
}

export interface StoreSample {
    level: number;
    progress: number;
    progressTarget?: number;
    clients: number;
    byState: Partial<Record<ClientState, number>>;
    byMood: Record<string, number>;
    /** Units on the store's shelves per item. */
    stock: Partial<Record<ResourceType, number>>;
    /** Units clients inside still want per item. */
    demand: Partial<Record<ResourceType, number>>;
    /** Clients standing on an item whose shelves are empty right now. */
    waitingOnEmpty: Partial<Record<ResourceType, number>>;
    garbage: number;
    maxGarbage: number;
    tooDirty: boolean;
    moneyPile: number;
    workers: Record<string, number>;
    readyToPayUnattended: number;
}

export type ClientOutcome = 'paid' | 'out-of-patience' | 'angry' | 'angry-dumped' | 'nothing-to-buy' | 'unknown';

export interface PlaytestClient {
    id: number;
    storeId: string;
    arrivedAt: number;
    endedAt?: number;
    wants: { type: ResourceType; amount: number }[];
    outcome?: ClientOutcome;
    /** Mood when it paid / walked out. */
    mood?: string;
    /** Seconds spent on an item while its shelves were empty, per item. */
    waitedOnEmpty: Partial<Record<ResourceType, number>>;
    /** Seconds at the front of the cashier line with nobody serving. */
    waitedAtCashier: number;
    /** Units it had picked when it ended (dumped as garbage on 'angry-dumped'). */
    held: number;
}

export interface PlaytestActivity {
    kind: string;
    detail: string;
    start: number;
    end?: number;
    outcome?: string;
}

export interface PlaytestIssue {
    t: number;
    kind: string;
    detail: string;
    x?: number;
    z?: number;
}

/** One entry of the bot's for-sale list — see PlaytestBot.logForSale(). */
export interface ForSaleItem {
    key: string;
    label: string;
    money: number;
    resources: { type: ResourceType; amount: number }[];
    /** What's still short ("40 money + 12 wood"), empty when affordable. */
    missing: string;
}

export interface PlaytestData {
    version: 1;
    startedAtIso: string;
    mode: 'bot' | 'human';
    botStyle?: string;
    speed: number;
    durationSec: number;
    endReason: string;
    events: PlaytestEvent[];
    notifications: PlaytestNotification[];
    samples: PlaytestSample[];
    clients: PlaytestClient[];
    activities: PlaytestActivity[];
    issues: PlaytestIssue[];
    /** The bot's for-sale list every 15 s (bot runs only). */
    forSale: { t: number; items: ForSaleItem[] }[];
    /** Farm items picked up while walking somewhere else (bot runs only) — item -> units. */
    strayPickups: Record<string, number>;
    /** Store id -> level config: what each level needs and enables (for pacing context). */
    storeLevels: Record<string, { level: number; requirementType: string; amount: number; enables: string[] }[]>;
    /** Total money that landed on each store's money pile. */
    income: Record<string, number>;
    /** Game seconds the player couldn't move (camera trips, reveals, popups). */
    frozenSec: number;
    /** Real milliseconds the world sat paused behind tap-to-continue notifications. */
    notificationPauseRealMs: number;
}

interface TrackedClient {
    record: PlaytestClient;
    lastState: ClientState;
    wasReadyToPay: boolean;
}

type AnalyticsFn = (...args: unknown[]) => void;

export default class PlaytestRecorder {
    private readonly data: PlaytestData;
    private timeSec = 0;
    private sampleTimerSec = 0;
    private nextClientId = 1;
    private readonly tracked = new Map<StoreClient, TrackedClient>();
    /** clientLeft reasons fired since the last client step — matched to the clients that just started leaving. */
    private readonly pendingLeaveReasons: string[] = [];
    private readonly pendingPaidMoods: string[] = [];
    private readonly originals = new Map<string, AnalyticsFn>();
    private originalNotify?: UpgradeNotificationManager['show'];
    private readonly lastPile = new Map<string, number>();
    private openActivity?: PlaytestActivity;
    private pauseStartedRealMs?: number;
    private stopped = false;

    public constructor(
        private readonly getStores: () => readonly Store[],
        private readonly isPlayerFrozen: () => boolean,
        mode: 'bot' | 'human',
        speed: number,
        botStyle?: string,
    ) {
        this.data = {
            version: 1,
            startedAtIso: new Date().toISOString(),
            mode,
            botStyle,
            speed,
            durationSec: 0,
            endReason: 'running',
            events: [],
            notifications: [],
            samples: [],
            clients: [],
            activities: [],
            issues: [],
            forSale: [],
            strayPickups: {},
            storeLevels: {},
            income: {},
            frozenSec: 0,
            notificationPauseRealMs: 0,
        };
        this.hookAnalytics();
        this.hookNotifications();
    }

    public get gameTimeSec(): number {
        return this.timeSec;
    }

    /** Every fixed step — game time, client tracking, periodic samples. */
    public fixedUpdate(delta: number): void {
        if (this.stopped) {
            return;
        }
        this.timeSec += delta;
        if (this.isPlayerFrozen()) {
            this.data.frozenSec += delta;
        }
        this.trackClients(delta);
        this.sampleTimerSec += delta;
        if (this.sampleTimerSec >= SAMPLE_SEC) {
            this.sampleTimerSec = 0;
            this.takeSample();
        }
    }

    /** Every render frame (runs while paused too) — real time spent behind notifications. */
    public update(): void {
        const paused = UpgradeNotificationManager.instance.isAwaitingTap();
        if (paused && this.pauseStartedRealMs === undefined) {
            this.pauseStartedRealMs = performance.now();
        } else if (!paused && this.pauseStartedRealMs !== undefined) {
            this.data.notificationPauseRealMs += performance.now() - this.pauseStartedRealMs;
            this.pauseStartedRealMs = undefined;
        }
    }

    public beginActivity(kind: string, detail: string): void {
        this.endActivity('switched');
        this.openActivity = { kind, detail, start: this.timeSec };
        this.data.activities.push(this.openActivity);
    }

    public endActivity(outcome: string): void {
        if (this.openActivity) {
            this.openActivity.end = this.timeSec;
            this.openActivity.outcome = outcome;
            this.openActivity = undefined;
        }
    }

    public getActivityLabel(): string | undefined {
        return this.openActivity ? `${this.openActivity.kind}: ${this.openActivity.detail}` : undefined;
    }

    public logIssue(kind: string, detail: string, x?: number, z?: number): void {
        this.data.issues.push({ t: this.timeSec, kind, detail, x, z });
    }

    public logStrayPickup(type: ResourceType, amount: number): void {
        this.data.strayPickups[type] = (this.data.strayPickups[type] ?? 0) + amount;
    }

    public logForSale(items: ForSaleItem[]): void {
        this.data.forSale.push({ t: this.timeSec, items });
    }

    /** Last time any analytics event fired — the bot's "is anything still happening" check. */
    public lastEventTime(): number {
        return this.data.events.length > 0 ? this.data.events[this.data.events.length - 1].t : 0;
    }

    public hasEvent(name: string): boolean {
        return this.data.events.some(event => event.name === name);
    }

    /** Ends recording (unhooks everything) and returns the data. Safe to call more than once. */
    public finish(endReason: string): PlaytestData {
        if (!this.stopped) {
            this.stopped = true;
            this.endActivity(endReason);
            this.takeSample();
            for (const tracked of this.tracked.values()) {
                tracked.record.outcome ??= 'unknown';
            }
            this.data.durationSec = this.timeSec;
            this.data.endReason = endReason;
            this.data.storeLevels = this.collectStoreLevels();
            this.unhook();
        }
        return this.data;
    }

    /** The data so far, without stopping. */
    public snapshot(): PlaytestData {
        return { ...this.data, durationSec: this.timeSec, storeLevels: this.collectStoreLevels() };
    }

    // ---- Hooks

    private hookAnalytics(): void {
        const target = GameAnalytics as unknown as Record<string, AnalyticsFn>;
        for (const name of Object.keys(target)) {
            const original = target[name];
            if (typeof original !== 'function') {
                continue;
            }
            this.originals.set(name, original);
            target[name] = (...args: unknown[]): void => {
                this.data.events.push({ t: this.timeSec, name, args });
                if (name === 'clientLeft') {
                    this.pendingLeaveReasons.push(String(args[0]));
                } else if (name === 'clientPaid') {
                    this.pendingPaidMoods.push(String(args[0]));
                }
                original.apply(GameAnalytics, args);
            };
        }
    }

    private hookNotifications(): void {
        const manager = UpgradeNotificationManager.instance;
        const original = manager.show;
        this.originalNotify = original;
        manager.show = (options): void => {
            this.data.notifications.push({ t: this.timeSec, title: options.title ?? '', subtitle: options.subtitle ?? '' });
            original.call(manager, options);
        };
    }

    private unhook(): void {
        const target = GameAnalytics as unknown as Record<string, AnalyticsFn>;
        for (const [name, original] of this.originals) {
            target[name] = original;
        }
        this.originals.clear();
        if (this.originalNotify) {
            // Drop the instance override so the prototype method is used again.
            delete (UpgradeNotificationManager.instance as Partial<UpgradeNotificationManager>).show;
            this.originalNotify = undefined;
        }
    }

    // ---- Clients

    private trackClients(delta: number): void {
        const seen = new Set<StoreClient>();
        for (const store of this.getStores()) {
            const snapshot = store.getPlaytestSnapshot();
            if (!snapshot.open) {
                continue;
            }
            const stock = this.stockOf(snapshot.storages.map(storage => storage.id));
            for (const client of snapshot.clients) {
                seen.add(client);
                let tracked = this.tracked.get(client);
                if (!tracked) {
                    tracked = {
                        record: {
                            id: this.nextClientId++,
                            storeId: snapshot.id,
                            arrivedAt: this.timeSec,
                            wants: client.getWants().map(want => ({ type: want.type, amount: want.remaining + want.bought })),
                            waitedOnEmpty: {},
                            waitedAtCashier: 0,
                            held: 0,
                        },
                        lastState: client.getState(),
                        wasReadyToPay: false,
                    };
                    this.tracked.set(client, tracked);
                    this.data.clients.push(tracked.record);
                }
                this.stepClient(tracked, client, stock, snapshot.cashierUnattended, delta);
            }
        }
        // Gone without us seeing it leave (removed the same step it finished) — close it out.
        for (const [client, tracked] of this.tracked) {
            if (!seen.has(client)) {
                tracked.record.endedAt ??= this.timeSec;
                tracked.record.outcome ??= 'unknown';
                this.tracked.delete(client);
            }
        }
        this.pendingLeaveReasons.length = 0;
        this.pendingPaidMoods.length = 0;
    }

    private stepClient(tracked: TrackedClient, client: StoreClient, stock: Map<ResourceType, number>, cashierUnattended: boolean, delta: number): void {
        const record = tracked.record;
        const state = client.getState();
        if (record.outcome === undefined) {
            const current = client.getCurrentWantType();
            if (current !== undefined && SHELF_WAIT_STATES.has(state) && (stock.get(current) ?? 0) <= 0) {
                record.waitedOnEmpty[current] = (record.waitedOnEmpty[current] ?? 0) + delta;
            }
            if (state === 'readyToPay' && cashierUnattended) {
                record.waitedAtCashier += delta;
            }
        }
        if (state === 'readyToPay') {
            tracked.wasReadyToPay = true;
        }
        const ending = (state === 'leaving' || state === 'dumping' || state === 'done') && tracked.lastState !== state && record.outcome === undefined;
        if (ending) {
            record.endedAt = this.timeSec;
            record.mood = client.getMood();
            record.held = client.getWants().reduce((sum, want) => sum + want.bought, 0);
            if (tracked.wasReadyToPay && state === 'leaving') {
                record.outcome = 'paid';
                const mood = this.pendingPaidMoods.shift();
                if (mood) {
                    record.mood = mood;
                }
            } else {
                record.outcome = (this.pendingLeaveReasons.shift() as ClientOutcome | undefined) ?? (state === 'dumping' ? 'angry-dumped' : 'unknown');
            }
        }
        tracked.lastState = state;
    }

    private stockOf(storageIds: string[]): Map<ResourceType, number> {
        const stock = new Map<ResourceType, number>();
        for (const id of storageIds) {
            for (const [type, count] of StorageInventory.getAll(id)) {
                stock.set(type, (stock.get(type) ?? 0) + count);
            }
        }
        return stock;
    }

    // ---- Samples

    private takeSample(): void {
        const stores: Record<string, StoreSample> = {};
        for (const store of this.getStores()) {
            const snapshot = store.getPlaytestSnapshot();
            const id = snapshot.id;
            const pile = snapshot.moneyPile;
            const lastPile = this.lastPile.get(id) ?? pile;
            if (pile > lastPile) {
                this.data.income[id] = (this.data.income[id] ?? 0) + (pile - lastPile);
            }
            this.lastPile.set(id, pile);
            if (!snapshot.open) {
                continue;
            }
            const level = StoreProgressStorage.getLevel(id);
            const config = getStoreConfig(id);
            const next = getNextStoreLevel(config, level);
            const stock = this.stockOf(snapshot.storages.map(storage => storage.id));
            const sample: StoreSample = {
                level,
                progress: next?.requirementType === 'sales' ? StoreProgressStorage.getSales(id) : StoreProgressStorage.getMoney(id),
                progressTarget: next?.amount,
                clients: snapshot.clients.length,
                byState: {},
                byMood: {},
                stock: Object.fromEntries(stock),
                demand: {},
                waitingOnEmpty: {},
                garbage: snapshot.garbage.length,
                maxGarbage: snapshot.maxGarbage,
                tooDirty: snapshot.tooDirty,
                moneyPile: pile,
                workers: {},
                readyToPayUnattended: 0,
            };
            for (const client of snapshot.clients) {
                const state = client.getState();
                sample.byState[state] = (sample.byState[state] ?? 0) + 1;
                const mood = client.getMood();
                sample.byMood[mood] = (sample.byMood[mood] ?? 0) + 1;
                for (const want of client.getWants()) {
                    sample.demand[want.type] = (sample.demand[want.type] ?? 0) + want.remaining;
                }
                const current = client.getCurrentWantType();
                if (current !== undefined && SHELF_WAIT_STATES.has(state) && (stock.get(current) ?? 0) <= 0) {
                    sample.waitingOnEmpty[current] = (sample.waitingOnEmpty[current] ?? 0) + 1;
                }
                if (state === 'readyToPay' && snapshot.cashierUnattended) {
                    sample.readyToPayUnattended++;
                }
            }
            for (const worker of StoreWorkerStorage.getRoster(id) ?? []) {
                sample.workers[worker.role] = (sample.workers[worker.role] ?? 0) + 1;
            }
            stores[id] = sample;
        }
        this.data.samples.push({
            t: this.timeSec,
            money: EconomyStorage.getBalance(CurrencyType.Money),
            stores,
            carrying: Object.fromEntries([...BackpackStorage.getAll()].filter(([, count]) => count > 0)),
            activity: this.getActivityLabel(),
            frozen: this.isPlayerFrozen(),
        });
    }

    private collectStoreLevels(): PlaytestData['storeLevels'] {
        const result: PlaytestData['storeLevels'] = {};
        for (const store of this.getStores()) {
            const config = getStoreConfig(store.getId());
            result[store.getId()] = (config.levels ?? []).map(level => ({
                level: level.level,
                requirementType: level.requirementType,
                amount: level.amount,
                enables: (level.enables ?? []).map(entry => entry.entityId),
            }));
        }
        return result;
    }
}
