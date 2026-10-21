// PlaytestBot.ts
//
// Plays the game through the same means a player has — it only ever moves the player (scripted
// input on PlayerMovementController) and stands in trigger zones, so every farm, shelf, cashier,
// purchase and build reacts exactly as it would to a human. The two tap-only things are done the
// way the UI would do them: the continue tap on a notification, and the hire desk's Hire button
// (hireStoreWorker(), the popup's own code path) once standing at the desk.
//
// Every THINK interval it scores what's worth doing (BotGoal candidates, highest priority wins)
// and keeps the current goal unless something is clearly more urgent (PREEMPT_MARGIN):
//
//   80  serve a client waiting at an unattended cashier
//   70+ carry garbage to the trash / clean a store too dirty to get clients
//   64  collect the money pile when it's what a purchase is waiting on
//   60  the tutorial step the arrow points at (mapped onto the goals below)
//   55  buy the cheapest affordable thing for sale (storage, farm, building level, station)
//   52  hire staff at the hire desk (cashier -> restocker -> cleaner)
//   46+ deliver what a shelf is short of; 47 anything else a shelf takes (56 once the stack is full)
//   50  upgrade staff / farms / animals with spare money, cheapest first (25 when a purchase needs the money)
//   40+ gather resources (wood, stone) the next purchase needs — +5 per minute it waits, max 58
//   42+ harvest/collect what clients are waiting for (34: just topping up the shelf buffer)
//   43  make at a mix station whose product is short
//    1  idle at the cashier ("saving for X")
//
// Goals walk the whole map on WorldNavGrid; one that makes no progress (stuck against something,
// unreachable, a tree it can't chop) is abandoned, blacklisted for a while, and logged as an issue
// on the recorder — those are often real findings too (an object the player can't reach).
//
// 'casual' style plays like a distracted human: thinks slower, keeps less on the shelves, doesn't
// drop everything for the cashier, and now and then just stands around.

import * as THREE from 'three';
import type World from '../ecs/World';
import type Entity from '../ecs/Entity';
import type MainPlayer from '../player/MainPlayer';
import type Store from '../store/Store';
import type { StorePlaytestSnapshot } from '../store/Store';
import type WorldObjectRegistry from '../world/WorldObjectRegistry';
import type ZoneVisibilityManager from '../world/ZoneVisibilityManager';
import type { ZoneTutorialStep } from '../tutorial/ZoneTutorialTypes';
import type PlaytestRecorder from './PlaytestRecorder';
import WorldNavGrid from './WorldNavGrid';
import RigidBody from '../physics/RigidBody';
import StorageZone from '../world/StorageZone';
import StoragePurchaseZone from '../store/StoragePurchaseZone';
import FarmZone from '../world/FarmZone';
import BuildingZone from '../player/BuildingZone';
import HireDeskZone from '../store/HireDeskZone';
import FarmDeskZone from '../world/FarmDeskZone';
import { cheapestFarmUpgrade, upgradeFarm } from '../ui/popups/FarmUpgradesPopup';
import { cheapestAnimalUpgrade, upgradeAnimalStall } from '../ui/popups/AnimalUpgradesPopup';
import MixStation from '../world/MixStation';
import ShopZone from '../shop/ShopZone';
import { UpgradeMenu } from '../shop/UpgradeMenu';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import FarmPlotTile from '../world/FarmPlotTile';
import ResourceNode from '../player/ResourceNode';
import ResourceNodeRegistry, { type GatherTarget } from '../player/ResourceNodeRegistry';
import { CarryStack } from '../player/CarryStack';
import FacingComponent from '../components/FacingComponent';
import PlayerActionController from '../components/PlayerActionController';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';
import { BackpackStorage } from '../data/BackpackStorage';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import { StorageInventory } from '../data/StorageInventory';
import { BuildingStorage } from '../data/BuildingStorage';
import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { TriggerStorage } from '../data/TriggerStorage';
import { getStorageConfig } from '../data/StorageTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { getCraftConfig } from '../crafting/CraftTypes';
import { GATE_CONFIG } from '../data/GateTypes';
import { StoreProgressStorage } from '../store/StoreProgressStorage';
import { StoreWorkerStorage } from '../store/StoreWorkerStorage';
import { StorageOwnershipStorage } from '../store/StorageOwnershipStorage';
import { getStoreConfig, getStoreHireRoles, getHireMaxCount, getNextWorkerUpgrade, StoreHireRoleConfig, StoreWorkerRole } from '../store/StoreTypes';
import { hireStoreWorker, upgradeStoreWorker } from '../ui/popups/HireWorkersPopup';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { PopupManager } from '../ui/popups/PopupManager';
import type TileMap from '../world/TileMap';

export type BotStyle = 'efficient' | 'casual';

export interface PlaytestHost {
    readonly world: World;
    /** For the ?botnav overlay (NavDebugOverlay.ts). */
    readonly scene: THREE.Scene;
    readonly player: MainPlayer;
    readonly worldObjects: WorldObjectRegistry;
    readonly tileMap: TileMap;
    readonly zoneVisibility: ZoneVisibilityManager;
    getStores(): readonly Store[];
    getActiveTutorialStep(): { zoneNumber: number; index: number; step: ZoneTutorialStep } | undefined;
    isPlayerFrozen(): boolean;
    /** Revealed zone numbers, joined — changes whenever a zone opens. */
    getRevealKey(): string;
    /** The debug fly camera (DebugFlyCameraController) — the session panel's Free cam button. */
    isFreeCamera(): boolean;
    /** keepPlayerMovement while the bot is driving — see PizzaScene.setFlyCamera(). */
    setFreeCamera(enabled: boolean, keepPlayerMovement: boolean): void;
}

interface BotGoal {
    /** Identity — the same target keeps the same key (blacklisting, "is this the same goal"). */
    key: string;
    kind: string;
    detail: string;
    priority: number;
    point: THREE.Vector3;
    /** Close enough to count as standing on it. */
    radius: number;
    timeoutSec: number;
    isDone(): boolean;
    /** Keep standing there after arriving until isDone() (else done on arrival). */
    stay: boolean;
    /** Any number that changes while the goal makes progress — unchanged for stallSec after arriving = abandoned. */
    progress?(): number;
    stallSec?: number;
    /** Once, on arrival (e.g. press Hire). */
    onArrive?(): void;
    /** Every step while standing on the spot (e.g. keep facing a tree). */
    whileArrived?(): void;
    /** When the goal ends, however it ends. */
    onEnd?(): void;
}

interface StylePreset {
    thinkSec: number;
    /** Units over current demand the bot keeps on each shelf. */
    shelfBuffer: number;
    servePriority: number;
    /** Chance per think to wander off for a bit. */
    distractChance: number;
    /** Movement input magnitude. */
    pace: number;
    /** Route around fields it isn't harvesting (WorldNavGrid.findPath()); a person walks straight. */
    avoidFields: boolean;
}

const STYLES: Record<BotStyle, StylePreset> = {
    efficient: { thinkSec: 0.4, shelfBuffer: 4, servePriority: 80, distractChance: 0, pace: 1, avoidFields: true },
    casual: { thinkSec: 1.5, shelfBuffer: 2, servePriority: 58, distractChance: 0.012, pace: 0.85, avoidFields: false },
};

/** A new goal must beat the current one by this much to interrupt it. */
const PREEMPT_MARGIN = 10;
/** A staff upgrade bought with spare money — above gathering (40+) and shelf top-ups, below buying (55) and urgent restocks. */
const UPGRADE_SPARE_PRIORITY = 50;
const WAYPOINT_REACHED = 0.4;
const REPLAN_SEC = 3;
const STUCK_CHECK_SEC = 1.5;
const STUCK_MIN_MOVE = 0.15;
const STUCK_LIMIT = 4;
const BLACKLIST_SEC = 25;
/** A target with no path to it is skipped this long — the map won't change much sooner (a zone opening, a building rising). */
const NO_PATH_BLACKLIST_SEC = 60;
/** When stuck against something, step sideways this long before re-planning. */
const SIDESTEP_SEC = 0.5;
/** watchStandingStill(): moved less than this (world units) for this long (game s) = standing still. */
const STILL_MOVE = 0.5;
const STILL_LOG_SEC = 10;
/** How often the for-sale list goes to the recorder. */
const FOR_SALE_LOG_SEC = 15;
/** Stand this close to a tree/rock — well inside PlayerConfig.resourceDetectionRadius (3). */
const GATHER_RANGE = 1.9;
/** Real ms a notification shows before the bot taps through — just past MIN_SHOW_SEC (0.8 s), taps earlier are ignored. */
const NOTIFICATION_TAP_DELAY_MS = 850;
/** Max of each role the efficient bot hires. */
const HIRE_PLAN: { role: StoreWorkerRole; max: number }[] = [
    { role: 'cashier', max: 1 },
    { role: 'restocker', max: 2 },
    { role: 'cleaner', max: 1 },
    { role: 'baker', max: 1 },
];

interface Scan {
    storageZones: StorageZone[];
    purchaseZones: StoragePurchaseZone[];
    farmZones: FarmZone[];
    buildingZones: BuildingZone[];
    hireDesks: HireDeskZone[];
    mixStations: MixStation[];
    farmDesks: FarmDeskZone[];
    shops: ShopZone[];
}

interface Purchase {
    key: string;
    label: string;
    money: number;
    resources: { type: ResourceType; amount: number }[];
    point: THREE.Vector3;
    radius: number;
    remaining(): number;
    /** Bought from a menu, not by standing somewhere — done on the spot, no walking (the upgrades menu). */
    buyNow?(): boolean;
}

export default class PlaytestBot {
    private readonly nav: WorldNavGrid;
    private readonly style: StylePreset;
    private goal?: BotGoal;
    private goalElapsedSec = 0;
    private arrived = false;
    /** Pushed up against whatever it walks to (a tree's collider) close enough to count as there — see followPath(). */
    private blockedNearGoal = false;
    /** Seconds left of a sidestep after getting stuck, and which side (+1/-1) — see followPath(). */
    private sidestepSec = 0;
    private sidestepSign = 1;
    private stallTimerSec = 0;
    private lastProgress = NaN;
    private readonly path: THREE.Vector3[] = [];
    private pathIndex = 0;
    private replanTimerSec = 0;
    private stuckTimerSec = 0;
    private stuckCount = 0;
    private readonly lastPosition = new THREE.Vector3();
    private thinkTimerSec = 0;
    private readonly blacklist = new Map<string, number>();
    private timeSec = 0;
    private notificationSinceMs?: number;
    private popupSinceMs?: number;
    private distractedUntilSec = 0;
    private scan: Scan = { storageZones: [], purchaseZones: [], farmZones: [], buildingZones: [], hireDesks: [], mixStations: [], farmDesks: [], shops: [] };
    /** Issue kinds already logged per target — so a tree the bot keeps failing on logs once, not every retry. */
    private readonly loggedIssues = new Set<string>();
    private readonly scratch = new THREE.Vector3();
    /** What the bot would buy next if it had the money — shown while idle. */
    private savingFor?: string;
    /** Purchase key -> game time it was first seen for sale (resourceForPurchaseGoal()'s urgency, the report's timeline). */
    private readonly firstSeenForSale = new Map<string, number>();
    private lastForSaleLogSec = -Infinity;
    /** Crate contents last step — see trackStrayPickups(). */
    private readonly lastCarried = new Map<ResourceType, number>();
    /** watchStandingStill(): where the player last moved from, how long it's been, and whether this stretch is logged. */
    private readonly stillAnchor = new THREE.Vector3();
    private stillSec = 0;
    private stillLogged = false;
    /** For the status panel — see logForSale(). */
    private nextUnlockLabel = '';

    public constructor(
        private readonly host: PlaytestHost,
        private readonly recorder: PlaytestRecorder,
        styleName: BotStyle,
        /** A popup the bot closed — the session decides whether that ends the run (e.g. the demo-end popup). */
        private readonly onPopupClosed: (popupName: string) => void,
    ) {
        this.style = STYLES[styleName];
        this.nav = new WorldNavGrid(host.world, host.tileMap, () => host.getRevealKey());
    }

    public getGoalLabel(): string {
        return this.goal ? `${this.goal.kind}: ${this.goal.detail}` : 'thinking';
    }

    public getNextUnlockLabel(): string {
        return this.nextUnlockLabel;
    }

    /** Hands the player back to the keyboard/joystick. */
    public stop(): void {
        this.host.player.movementController.clearScriptedInput();
        this.finishGoal('stopped');
    }

    /** Every render frame — runs while the world is paused too (that's when notifications need tapping). */
    public update(): void {
        this.tapThroughNotifications();
        this.closePopups();
    }

    public fixedUpdate(delta: number): void {
        this.timeSec += delta;
        this.nav.update(delta);
        this.thinkTimerSec -= delta;
        if (this.thinkTimerSec <= 0) {
            this.thinkTimerSec = this.style.thinkSec;
            this.think();
        }
        this.runGoal(delta);
        this.trackStrayPickups();
        this.watchStandingStill(delta);
    }

    /**
     * Diagnostics: the player hasn't moved for STILL_LOG_SEC while some client waits on an EMPTY
     * shelf — logs what the bot was doing then (once per stretch), so a report shows exactly what
     * kept it from restocking. Pauses (frozen movement, notifications) don't count.
     */
    private watchStandingStill(delta: number): void {
        const pos = this.host.player.transform.position;
        if (this.host.isPlayerFrozen() || Math.hypot(pos.x - this.stillAnchor.x, pos.z - this.stillAnchor.z) > STILL_MOVE) {
            this.stillAnchor.copy(pos);
            this.stillSec = 0;
            this.stillLogged = false;
            return;
        }
        this.stillSec += delta;
        if (this.stillLogged || this.stillSec < STILL_LOG_SEC) {
            return;
        }
        const empty = new Set<string>();
        for (const store of this.host.getStores()) {
            const snapshot = store.getPlaytestSnapshot();
            for (const client of snapshot.clients) {
                const want = client.getCurrentWantType();
                if (want !== undefined && snapshot.storages.filter(s => s.resourceType === want).every(s => StorageInventory.getCount(s.id, want) <= 0)) {
                    empty.add(want);
                }
            }
        }
        if (empty.size === 0) {
            return;
        }
        this.stillLogged = true;
        this.recorder.logIssue('idle-while-short', `stood still ${Math.round(this.stillSec)}+ s doing "${this.getGoalLabel()}" while clients waited on empty ${[...empty].join(', ')}`, pos.x, pos.z);
    }

    /**
     * A farm item landing in the crate while the bot wasn't harvesting that item = picked up by
     * walking over a ripe cell on the way somewhere else. Reported per item (the layout finding).
     */
    private trackStrayPickups(): void {
        const goal = this.goal;
        const harvesting = goal?.kind === 'harvest' || goal?.kind === 'tutorial' ? goal.detail : '';
        for (const [type, count] of BackpackStorage.getAll()) {
            const before = this.lastCarried.get(type) ?? 0;
            if (count > before && RESOURCE_CONFIG[type]?.category === 'farm' && type !== ResourceType.Garbage && !harvesting.includes(type)) {
                this.recorder.logStrayPickup(type, count - before);
            }
            this.lastCarried.set(type, count);
        }
        for (const type of this.lastCarried.keys()) {
            if (BackpackStorage.getCount(type) === 0) {
                this.lastCarried.set(type, 0);
            }
        }
    }

    // ---- UI the player would tap through

    private tapThroughNotifications(): void {
        const manager = UpgradeNotificationManager.instance;
        if (!manager.isAwaitingTap()) {
            this.notificationSinceMs = undefined;
            return;
        }
        this.notificationSinceMs ??= performance.now();
        if (performance.now() - this.notificationSinceMs >= NOTIFICATION_TAP_DELAY_MS) {
            manager.tapToContinue();
            this.notificationSinceMs = undefined;
        }
    }

    private closePopups(): void {
        const manager = PopupManager.instance;
        const popup = manager.getCurrent();
        if (!popup) {
            this.popupSinceMs = undefined;
            return;
        }
        this.popupSinceMs ??= performance.now();
        if (performance.now() - this.popupSinceMs >= NOTIFICATION_TAP_DELAY_MS) {
            const name = popup.constructor?.name ?? 'Popup';
            manager.close(popup);
            this.popupSinceMs = undefined;
            this.onPopupClosed(name);
        }
    }

    // ---- Thinking

    private think(): void {
        this.scanWorld();
        if (this.goal && this.goal.isDone()) {
            this.finishGoal('done');
        }
        const candidate = this.pickGoal();
        if (!candidate) {
            return;
        }
        if (!this.goal) {
            this.startGoal(candidate);
            return;
        }
        if (candidate.key !== this.goal.key && candidate.priority >= this.goal.priority + PREEMPT_MARGIN) {
            this.finishGoal(`interrupted by ${candidate.kind}`);
            this.startGoal(candidate);
        }
    }

    private pickGoal(): BotGoal | undefined {
        // Casual: every now and then the player just stands around for a bit.
        if (this.timeSec < this.distractedUntilSec) {
            return this.goal;
        }
        if (this.style.distractChance > 0 && Math.random() < this.style.distractChance && this.goal?.kind !== 'distracted') {
            const until = this.timeSec + 3 + Math.random() * 4;
            this.distractedUntilSec = until;
            const here = this.playerPosition().clone();
            return { key: `distracted:${until}`, kind: 'distracted', detail: 'looking around', priority: 100, point: here, radius: 99, timeoutSec: 20, stay: true, isDone: () => this.timeSec >= until };
        }

        const candidates: BotGoal[] = [];
        const add = (goal: BotGoal | undefined): void => {
            if (goal && !this.isBlacklisted(goal.key)) {
                candidates.push(goal);
            }
        };
        const stores = this.host.getStores().map(store => ({ store, snapshot: store.getPlaytestSnapshot() })).filter(entry => entry.snapshot.open);

        add(this.trashGoal());
        for (const { snapshot } of stores) {
            add(this.cleanGoal(snapshot));
            add(this.serveGoal(snapshot));
        }
        const purchases = this.listPurchases();
        this.logForSale(purchases);
        const affordable = purchases.filter(p => this.canAfford(p));
        add(this.moneyPileGoal(stores.map(entry => entry.snapshot), purchases));
        add(this.tutorialGoal(stores.map(entry => entry.snapshot)));
        if (affordable.length > 0) {
            const cheapest = affordable.reduce((best, p) => (p.money < best.money ? p : best));
            add(this.purchaseGoal(cheapest, 55));
        }
        for (const { store, snapshot } of stores) {
            add(this.hireGoal(store, snapshot));
        }
        for (const goal of this.restockGoals(stores.map(entry => entry.snapshot))) {
            add(goal);
        }
        add(this.resourceForPurchaseGoal(purchases));
        add(this.upgradeGoal(stores.map(entry => entry.store), purchases));
        add(this.idleGoal(stores.map(entry => entry.snapshot), purchases));

        if (candidates.length === 0) {
            return undefined;
        }
        return candidates.reduce((best, goal) => (goal.priority > best.priority ? goal : best));
    }

    // ---- Goal builders

    private trashGoal(): BotGoal | undefined {
        if (BackpackStorage.getCount(ResourceType.Garbage) <= 0) {
            return undefined;
        }
        const trash = this.nearestZone(this.scan.storageZones.filter(zone => zone.getConfig().trash));
        if (!trash) {
            return undefined;
        }
        const target = this.zoneTarget(trash);
        return {
            key: `trash:${trash.getStorageId()}`, kind: 'trash', detail: 'carry garbage to the bin', priority: 72,
            point: target.point, radius: target.radius, timeoutSec: 60, stay: true,
            isDone: () => BackpackStorage.getCount(ResourceType.Garbage) <= 0,
            progress: () => BackpackStorage.getCount(ResourceType.Garbage), stallSec: 8,
        };
    }

    private cleanGoal(snapshot: StorePlaytestSnapshot): BotGoal | undefined {
        if (snapshot.garbage.length === 0 || !CarryStack.hasRoomFor(1)) {
            return undefined;
        }
        const hasCleaner = (StoreWorkerStorage.getRoster(snapshot.id) ?? []).some(worker => worker.role === 'cleaner');
        if (hasCleaner && !snapshot.tooDirty) {
            return undefined;
        }
        const here = this.playerPosition();
        const piece = snapshot.garbage.reduce((best, p) => (p.distanceToSquared(here) < best.distanceToSquared(here) ? p : best));
        const priority = snapshot.tooDirty ? 75 : 30 + Math.min(20, snapshot.garbage.length * 5);
        const store = this.host.getStores().find(s => s.getId() === snapshot.id);
        return {
            key: `garbage:${piece.x.toFixed(1)},${piece.z.toFixed(1)}`, kind: 'clean', detail: `pick up garbage (${snapshot.garbage.length} on the floor)`, priority,
            point: new THREE.Vector3(piece.x, 0, piece.z), radius: 0.5, timeoutSec: 40, stay: true,
            isDone: () => !store || !store.getPlaytestSnapshot().garbage.includes(piece) || !CarryStack.hasRoomFor(1),
            stallSec: 6, progress: () => 0,
        };
    }

    private serveGoal(snapshot: StorePlaytestSnapshot): BotGoal | undefined {
        if (!snapshot.cashierShown || snapshot.hasCashierWorker) {
            return undefined;
        }
        const ready = snapshot.clients.filter(client => client.getState() === 'readyToPay').length;
        const coming = snapshot.clients.filter(client => client.getState() === 'cashierQueue' || client.getState() === 'toCashier').length;
        if (ready === 0 && coming === 0) {
            return undefined;
        }
        const store = this.host.getStores().find(s => s.getId() === snapshot.id)!;
        const center = new THREE.Vector3(snapshot.cashier.x, 0, snapshot.cashier.z);
        return {
            key: `serve:${snapshot.id}`, kind: 'serve', detail: `serve at ${snapshot.id} cashier (${ready} ready, ${coming} coming)`,
            priority: ready > 0 ? this.style.servePriority : 45,
            point: center, radius: Math.max(0.25, Math.min(snapshot.cashier.width, snapshot.cashier.depth) * 0.3), timeoutSec: 120, stay: true,
            isDone: () => !store.getPlaytestSnapshot().clients.some(client => ['readyToPay', 'cashierQueue', 'toCashier'].includes(client.getState())),
            progress: () => StoreProgressStorage.getTotalSales(snapshot.id), stallSec: 30,
        };
    }

    private moneyPileGoal(snapshots: StorePlaytestSnapshot[], purchases: Purchase[]): BotGoal | undefined {
        const piles = snapshots.filter(s => s.cashierShown && s.moneyPile > 0);
        if (piles.length === 0) {
            return undefined;
        }
        const pile = piles.reduce((best, s) => (s.moneyPile > best.moneyPile ? s : best));
        const wallet = EconomyStorage.getBalance(CurrencyType.Money);
        const unlocksPurchase = purchases.some(p => p.money > wallet && p.money <= wallet + pile.moneyPile);
        const tutorialWantsIt = this.host.getActiveTutorialStep()?.step.kind === 'collectMoney';
        if (!unlocksPurchase && !tutorialWantsIt && pile.moneyPile < 25) {
            return undefined;
        }
        const store = this.host.getStores().find(s => s.getId() === pile.id)!;
        return {
            key: `money:${pile.id}`, kind: 'collect money', detail: `${pile.moneyPile} on the pile at ${pile.id}`,
            priority: unlocksPurchase || tutorialWantsIt ? 64 : 30,
            point: new THREE.Vector3(pile.moneyDrop.x, 0, pile.moneyDrop.z), radius: Math.max(0.25, Math.min(pile.moneyDrop.width, pile.moneyDrop.depth) * 0.3),
            timeoutSec: 60, stay: true,
            isDone: () => store.getPlaytestSnapshot().moneyPile <= 0,
            progress: () => store.getPlaytestSnapshot().moneyPile, stallSec: 6,
        };
    }

    /** The tutorial step the arrow points at, as one of the ordinary goals. */
    private tutorialGoal(snapshots: StorePlaytestSnapshot[]): BotGoal | undefined {
        const active = this.host.getActiveTutorialStep();
        if (!active) {
            return undefined;
        }
        const { step, zoneNumber, index } = active;
        const stepKey = `${zoneNumber}:${index}`;
        const stillCurrent = (): boolean => {
            const now = this.host.getActiveTutorialStep();
            return now !== undefined && `${now.zoneNumber}:${now.index}` === stepKey;
        };
        const label = `tutorial ${zoneNumber}.${index} ${step.kind}`;
        const withTutorial = (goal: BotGoal | undefined): BotGoal | undefined => goal && {
            ...goal,
            key: `tutorial:${stepKey}:${goal.key}`,
            kind: 'tutorial',
            detail: `${label} -> ${goal.kind}: ${goal.detail}`,
            priority: 60,
            isDone: () => goal.isDone() || !stillCurrent(),
        };

        // A "just look at it" step: done on getting close.
        if (step.doneOnReach) {
            const point = this.tutorialDeliverPoint(step);
            return point && withTutorial(this.gotoGoal(`reach`, `walk up to it`, point, step.doneOnReach * 0.6, () => !stillCurrent()));
        }

        switch (step.kind) {
            case 'trigger': {
                const placement = this.host.worldObjects.get('trigger', step.triggerId);
                return placement && withTutorial(this.gotoGoal('walk', step.triggerId, new THREE.Vector3(placement.x, 0, placement.z), 0.4, () => TriggerStorage.isActivated(step.triggerId)));
            }
            case 'harvest':
                return withTutorial(this.harvestGoal(step.resourceType, step.amount ?? 1, 60, step.farmId));
            case 'storage': {
                const type = getStorageConfig(step.storageId).resourceType;
                if (!type) {
                    return undefined;
                }
                const missing = (step.amount ?? 1) - StorageInventory.getCount(step.storageId, type);
                if (BackpackStorage.getCount(type) >= missing) {
                    const zone = this.scan.storageZones.find(z => z.getStorageId() === step.storageId);
                    return zone && withTutorial(this.deliverGoal(zone, type, 60));
                }
                return withTutorial(this.harvestGoal(type, missing, 60, step.farmId));
            }
            case 'sale': {
                const snapshot = snapshots.find(s => s.id === step.storeId);
                if (!snapshot?.cashierShown) {
                    return undefined;
                }
                const center = new THREE.Vector3(snapshot.cashier.x, 0, snapshot.cashier.z);
                return withTutorial(this.gotoGoal('serve', `first sale at ${step.storeId}`, center, Math.max(0.25, Math.min(snapshot.cashier.width, snapshot.cashier.depth) * 0.3),
                    () => StoreProgressStorage.getTotalSales(step.storeId) >= (step.amount ?? 1), true));
            }
            case 'collectMoney': {
                const snapshot = snapshots.find(s => s.id === step.storeId);
                if (!snapshot) {
                    return undefined;
                }
                return withTutorial(this.gotoGoal('collect money', step.storeId, new THREE.Vector3(snapshot.moneyDrop.x, 0, snapshot.moneyDrop.z), 0.3, () => false, true));
            }
            case 'build': {
                const purchase = this.listPurchases().find(p => p.key === `building:${step.buildingId}`);
                return purchase && this.canAfford(purchase) ? withTutorial(this.purchaseGoal(purchase, 60)) : undefined;
            }
            case 'buyStorage': {
                const purchase = this.listPurchases().find(p => p.key === `storage:${step.storageId}`);
                if (!purchase) {
                    return undefined;
                }
                const missing = purchase.resources.find(cost => BackpackStorage.getCount(cost.type) < cost.amount);
                if (missing) {
                    return withTutorial(this.gatherGoal(missing.type, missing.amount, 60, step.gatherZone));
                }
                return EconomyStorage.getBalance(CurrencyType.Money) >= purchase.money ? withTutorial(this.purchaseGoal(purchase, 60)) : undefined;
            }
            case 'craft': {
                const recipe = getCraftConfig(step.craftId)?.recipes[0];
                const entry = recipe ? (Object.entries(recipe.cost) as [ResourceType, number][])[0] : undefined;
                const placement = this.host.worldObjects.get('craft', step.craftId);
                if (!entry || !placement) {
                    return undefined;
                }
                const [type, amount] = entry;
                if (BackpackStorage.getCount(type) < amount) {
                    return withTutorial(this.gatherGoal(type, amount, 60, step.gatherZone));
                }
                return withTutorial(this.gotoGoal('craft', step.craftId, new THREE.Vector3(placement.x, 0, placement.z), 0.6, () => false, true));
            }
            case 'gate': {
                const requirement = GATE_CONFIG[step.gateId]?.requirement;
                const placement = this.host.worldObjects.get('gate', step.gateId);
                if (!placement || requirement?.type !== 'resource') {
                    return undefined;
                }
                if (BackpackStorage.getCount(requirement.resourceType) < requirement.amount) {
                    return withTutorial(this.gatherGoal(requirement.resourceType, requirement.amount, 60));
                }
                return withTutorial(this.gotoGoal('gate', step.gateId, new THREE.Vector3(placement.x, 0, placement.z), 0.6, () => false, true));
            }
        }
        return undefined;
    }

    /** Where a step's arrow points when delivering — same lookup as ZoneTutorialController.resolveDeliverPosition(). */
    private tutorialDeliverPoint(step: ZoneTutorialStep): THREE.Vector3 | undefined {
        const objects = this.host.worldObjects;
        const [type, id] = step.kind === 'craft' ? ['craft', step.craftId]
            : step.kind === 'gate' ? ['gate', step.gateId]
            : step.kind === 'trigger' ? ['trigger', step.triggerId]
            : step.kind === 'storage' || step.kind === 'buyStorage' ? ['storage', step.storageId]
            : step.kind === 'build' ? ['building', step.buildingId]
            : ['', ''];
        if (!type) {
            return undefined;
        }
        const dropper = type === 'storage' || type === 'building' ? objects.getDropperFor(id) : undefined;
        const placement = dropper ?? objects.get(type, id) ?? (type === 'storage' ? objects.get('mixStation', id) : undefined);
        return placement ? new THREE.Vector3(placement.x, 0, placement.z) : undefined;
    }

    private purchaseGoal(purchase: Purchase, priority: number): BotGoal {
        if (purchase.buyNow) {
            // A menu purchase: open the menu wherever the player stands and tap Buy.
            let bought = false;
            return {
                key: purchase.key, kind: 'upgrade', detail: `${purchase.label} (${purchase.money} money${purchase.resources.map(r => ` + ${r.amount} ${r.type}`).join('')})`,
                priority, point: this.playerPosition().clone(), radius: 99, timeoutSec: 10, stay: true,
                isDone: () => bought,
                onArrive: () => {
                    bought = purchase.buyNow!();
                    if (!bought) {
                        this.logOnce('upgrade-failed', purchase.key, `couldn't buy ${purchase.label} from the upgrades menu`);
                    }
                },
                progress: () => 0, stallSec: 3,
            };
        }
        return {
            key: purchase.key, kind: 'buy', detail: `${purchase.label} (${purchase.money} money${purchase.resources.map(r => ` + ${r.amount} ${r.type}`).join('')})`,
            priority, point: purchase.point, radius: purchase.radius, timeoutSec: 90, stay: true,
            isDone: () => purchase.remaining() <= 0,
            progress: () => purchase.remaining(), stallSec: 6,
        };
    }

    private hireGoal(store: Store, snapshot: StorePlaytestSnapshot): BotGoal | undefined {
        const desk = this.scan.hireDesks.find(d => d.getStoreId() === snapshot.id);
        if (!desk) {
            return undefined;
        }
        const roles = getStoreHireRoles(getStoreConfig(snapshot.id));
        const roster = StoreWorkerStorage.getRoster(snapshot.id) ?? [];
        const wallet = EconomyStorage.getBalance(CurrencyType.Money);
        let entry: StoreHireRoleConfig | undefined;
        for (const plan of HIRE_PLAN) {
            const role = roles.find(r => r.role === plan.role);
            const hired = roster.filter(worker => worker.role === plan.role).length;
            // A baker is only worth it once a mix station is built.
            if (plan.role === 'baker' && this.scan.mixStations.length === 0) {
                continue;
            }
            if (role && hired < Math.min(plan.max, getHireMaxCount(role))) {
                entry = role;
                break;
            }
        }
        if (!entry) {
            return undefined;
        }
        if (entry.cost > wallet) {
            this.noteSaving(`hire a ${entry.role} (${entry.cost})`);
            return undefined;
        }
        const target = this.zoneTarget(desk);
        const role = entry;
        let hired = false;
        return {
            key: `hire:${snapshot.id}:${role.role}`, kind: 'hire', detail: `${role.role} for ${role.cost}`, priority: 52,
            point: target.point, radius: target.radius, timeoutSec: 60, stay: true,
            isDone: () => hired,
            onArrive: () => {
                hired = hireStoreWorker(store, role);
                if (!hired) {
                    this.logOnce('hire-failed', `${snapshot.id}:${role.role}`, `hiring a ${role.role} at ${snapshot.id} failed (store refused or not affordable)`);
                }
            },
            stallSec: 3, progress: () => 0,
        };
    }

    /**
     * The cheapest affordable upgrade sold at a desk: staff (hire desk), farms (farm manager) or
     * animals (animal keeper — one more animal per level). With spare money (still enough after it for
     * the priciest thing for sale) it's UPGRADE_SPARE_PRIORITY — purchases usually wait on wood/stone,
     * not money, so at a flat 25 the bot never upgraded anything while money piled up.
     */
    private upgradeGoal(stores: Store[], purchases: Purchase[]): BotGoal | undefined {
        const wallet = EconomyStorage.getBalance(CurrencyType.Money);
        const reserve = Math.max(0, ...purchases.map(purchase => purchase.money));
        let best: { key: string; kind: string; detail: string; cost: number; desk: Entity; buy: () => void } | undefined;
        const offer = (candidate: NonNullable<typeof best>): void => {
            if (candidate.cost <= wallet && (!best || candidate.cost < best.cost)) {
                best = candidate;
            }
        };
        for (const store of stores) {
            const desk = this.scan.hireDesks.find(d => d.getStoreId() === store.getId());
            if (!desk) {
                continue;
            }
            const config = getStoreConfig(store.getId());
            for (const worker of StoreWorkerStorage.getRoster(store.getId()) ?? []) {
                const next = getNextWorkerUpgrade(config, worker.role, worker.level ?? 1);
                if (next) {
                    offer({ key: `upgrade:${worker.id}:${next.level}`, kind: 'upgrade staff', detail: `${worker.id} -> Lv ${next.level}`, cost: next.cost, desk,
                        buy: () => upgradeStoreWorker(store.getId(), worker.id) });
                }
            }
        }
        for (const desk of this.scan.farmDesks) {
            const animals = desk.getKind() === 'animals';
            const next = animals ? cheapestAnimalUpgrade(desk.getIds()) : cheapestFarmUpgrade(desk.getIds());
            if (next) {
                offer({ key: `upgrade:${next.id}:${next.level}`, kind: animals ? 'upgrade animals' : 'upgrade farm', detail: `${next.id} -> Lv ${next.level}`, cost: next.cost, desk,
                    buy: () => (animals ? upgradeAnimalStall(next.id) : upgradeFarm(next.id)) });
            }
        }
        if (!best) {
            return undefined;
        }
        const chosen: NonNullable<typeof best> = best;
        const target = this.zoneTarget(chosen.desk);
        let done = false;
        return {
            key: chosen.key, kind: chosen.kind, detail: `${chosen.detail} for ${chosen.cost}`,
            priority: wallet - chosen.cost >= reserve ? UPGRADE_SPARE_PRIORITY : 25,
            point: target.point, radius: target.radius, timeoutSec: 60, stay: true,
            isDone: () => done,
            // One try either way — a failed upgrade (money spent meanwhile) is re-picked next think.
            onArrive: () => {
                chosen.buy();
                done = true;
            },
        };
    }

    /** Harvest / collect what's short, and deliver what's carried — see this file's own doc. */
    private restockGoals(snapshots: StorePlaytestSnapshot[]): BotGoal[] {
        const goals: BotGoal[] = [];
        const needs = this.computeNeeds(snapshots);

        // Deliver: anything carried that a shelf takes — shelves have no limit for the player, and
        // a real player unloads crops at the shelf rather than walking around with them. Short
        // shelves first; a full stack (blocking every harvest) beats gathering and purchases too.
        const stackFull = !CarryStack.hasRoomFor(1);
        for (const [type, need] of needs) {
            const carried = BackpackStorage.getCount(type);
            if (carried <= 0 || need.sinks.length === 0) {
                continue;
            }
            const sink = this.nearestZone(need.sinks.filter(zone => !zone.isFull()));
            if (sink) {
                const priority = need.need > 0 ? 46 + Math.min(10, need.demand) + (stackFull ? 5 : 0) : (stackFull ? 56 : 47);
                goals.push(this.deliverGoal(sink, type, priority));
            }
        }

        // Harvest: what clients are waiting for first; the shelf buffer only at low priority, so
        // building / gathering for the next unlock gets a turn (see resourceForPurchaseGoal()).
        if (!stackFull) {
            const short = [...needs].filter(([type, need]) => need.need - BackpackStorage.getCount(type) > 0).sort((a, b) => (b[1].need + b[1].demand * 2) - (a[1].need + a[1].demand * 2));
            for (const [type, need] of short) {
                const goal = this.harvestGoal(type, need.need - BackpackStorage.getCount(type), need.demand > 0 ? 42 + Math.min(10, need.demand) : 34);
                if (goal && !this.isBlacklisted(goal.key)) {
                    goals.push(goal);
                    break;
                }
            }
        }

        // Make: a mix station with everything it needs, whose product is short — ONE batch per
        // visit, then back to the shelves. It used to stay until the station couldn't make more
        // (up to maxOutput batches) at a priority restocking couldn't interrupt, so the bot stood
        // there while shelves ran empty. Clients asking for the product make it as urgent as
        // restocking; otherwise it's a top-up, below anything clients are waiting on.
        for (const station of this.scan.mixStations) {
            const state = station.getPlaytestState();
            const need = needs.get(state.product);
            if (!state.ready || (need?.need ?? 0) <= 0) {
                continue;
            }
            const madeBefore = state.made;
            goals.push({
                key: `make:${state.product}`, kind: 'make', detail: `${state.product} at the mix station`,
                priority: (need?.demand ?? 0) > 0 ? 42 + Math.min(10, need!.demand) : 33,
                point: state.makingPoint, radius: 0.5, timeoutSec: 40, stay: true,
                isDone: () => station.getPlaytestState().made > madeBefore || !station.getPlaytestState().ready,
                progress: () => station.getPlaytestState().made, stallSec: 15,
            });
        }

        // Stack full of things nothing wants — dump it (a real player would, eventually).
        if (!CarryStack.hasRoomFor(1) && goals.length === 0) {
            const trash = this.nearestZone(this.scan.storageZones.filter(zone => zone.getConfig().trash));
            if (trash) {
                const target = this.zoneTarget(trash);
                this.logOnce('wasted', 'stack', 'stack full of items no shelf wants — dumped them in the trash');
                goals.push({
                    key: `dump:${trash.getStorageId()}`, kind: 'dump', detail: 'stack full of unwanted items', priority: 20,
                    point: target.point, radius: target.radius, timeoutSec: 30, stay: true,
                    isDone: () => CarryStack.hasRoomFor(1), progress: () => CarryStack.carriedCount(), stallSec: 8,
                });
            }
        }
        return goals;
    }

    /** Per item: how many more the shelves should get (demand + buffer - stock), plus the shelves taking it. */
    private computeNeeds(snapshots: StorePlaytestSnapshot[]): Map<ResourceType, { need: number; demand: number; sinks: StorageZone[] }> {
        const needs = new Map<ResourceType, { need: number; demand: number; sinks: StorageZone[] }>();
        const zonesById = new Map(this.scan.storageZones.map(zone => [zone.getStorageId(), zone]));
        for (const snapshot of snapshots) {
            for (const storage of snapshot.storages) {
                const zone = zonesById.get(storage.id);
                if (!storage.resourceType || !zone || zone.getConfig().collect || zone.getConfig().trash) {
                    continue;
                }
                const entry = needs.get(storage.resourceType) ?? { need: 0, demand: 0, sinks: [] };
                entry.sinks.push(zone);
                needs.set(storage.resourceType, entry);
            }
            for (const client of snapshot.clients) {
                for (const want of client.getWants()) {
                    const entry = needs.get(want.type);
                    if (entry) {
                        entry.demand += want.remaining;
                    }
                }
            }
        }
        for (const [type, entry] of needs) {
            const stock = entry.sinks.reduce((sum, zone) => sum + StorageInventory.getCount(zone.getStorageId(), type), 0);
            const capacity = entry.sinks.every(zone => zone.isFull()) ? 0 : Infinity;
            entry.need = Math.min(capacity, Math.max(0, entry.demand + this.style.shelfBuffer - stock));
        }
        // Mix station ingredients: worth bringing while the product is short.
        for (const station of this.scan.mixStations) {
            const state = station.getPlaytestState();
            if ((needs.get(state.product)?.need ?? 0) <= 0) {
                continue;
            }
            for (const input of state.inputs) {
                const zone = zonesById.get(input.storageId);
                if (!zone || zone.isFull()) {
                    continue;
                }
                const entry = needs.get(input.resourceType) ?? { need: 0, demand: 0, sinks: [] };
                entry.sinks.push(zone);
                entry.need = Math.max(entry.need, input.batch * 2 - StorageInventory.getCount(input.storageId, input.resourceType));
                needs.set(input.resourceType, entry);
            }
        }
        return needs;
    }

    private deliverGoal(zone: StorageZone, type: ResourceType, priority: number): BotGoal {
        const target = this.zoneTarget(zone);
        return {
            key: `deliver:${zone.getStorageId()}`, kind: 'deliver', detail: `${BackpackStorage.getCount(type)} ${type} to ${zone.getStorageId()}`, priority,
            point: target.point, radius: target.radius, timeoutSec: 60, stay: true,
            isDone: () => BackpackStorage.getCount(type) <= 0 || zone.isFull(),
            progress: () => BackpackStorage.getCount(type), stallSec: 5,
        };
    }

    /** Walk onto the nearest ripe farm cell / collect box holding `type`, until `amount` is carried or the stack is full. */
    private harvestGoal(type: ResourceType, amount: number, priority: number, farmId?: string): BotGoal | undefined {
        const here = this.playerPosition();
        const target = BackpackStorage.getCount(type) + Math.max(1, amount);
        const enough = (): boolean => BackpackStorage.getCount(type) >= target || !CarryStack.hasRoomFor(1);

        let bestTile: FarmPlotTile | undefined;
        let bestDist = Infinity;
        for (const tile of FarmPlotTile.getAll()) {
            if ((farmId && tile.farmId !== farmId) || tile.getReadyYield()?.resourceType !== type) {
                continue;
            }
            const key = `harvest:${tile.farmId}:${tile.col},${tile.row}`;
            const pos = tile.transform.position;
            if (this.isBlacklisted(key) || !this.isUnlocked(pos.x, pos.z)) {
                continue;
            }
            const dist = pos.distanceToSquared(here);
            if (dist < bestDist) {
                bestDist = dist;
                bestTile = tile;
            }
        }
        const box = this.nearestZone(this.scan.storageZones.filter(zone => zone.getConfig().collect && StorageInventory.getCount(zone.getStorageId(), type) > 0));
        const boxDist = box ? this.zoneTarget(box).point.distanceToSquared(here) : Infinity;

        if (bestTile && bestDist <= boxDist) {
            const tile = bestTile;
            return {
                key: `harvest:${tile.farmId}:${tile.col},${tile.row}`, kind: 'harvest', detail: `${type} at ${tile.farmId}`, priority,
                point: tile.transform.position.clone().setY(0), radius: 0.3, timeoutSec: 45, stay: true,
                isDone: () => enough() || tile.getReadyYield() === undefined,
                progress: () => BackpackStorage.getCount(type), stallSec: 4,
            };
        }
        if (box) {
            const zoneTarget = this.zoneTarget(box);
            return {
                key: `collect:${box.getStorageId()}`, kind: 'harvest', detail: `${type} from ${box.getStorageId()}`, priority,
                point: zoneTarget.point, radius: zoneTarget.radius, timeoutSec: 45, stay: true,
                isDone: () => enough() || StorageInventory.getCount(box.getStorageId(), type) <= 0,
                progress: () => BackpackStorage.getCount(type), stallSec: 4,
            };
        }
        return undefined;
    }

    /** Chop / mine / pick up `type` (wood, stone, ...) until `amount` is in the backpack — from `zone` when it has any. */
    private gatherGoal(type: ResourceType, amount: number, priority: number, zone?: number): BotGoal | undefined {
        const here = this.playerPosition();
        const accept = (node: GatherTarget): boolean => {
            const pos = node.position;
            if (!this.isUnlocked(pos.x, pos.z) || this.isBlacklisted(`gather:${this.nodeKey(node)}`)) {
                return false;
            }
            if (node instanceof ResourceNode) {
                const tool = ACTION_CONFIG[PROVIDER_CONFIG[node.providerType].action].tool;
                if (tool !== undefined && !ItemStorage.hasCount(tool as ItemType, 1)) {
                    this.logOnce('missing-tool', `${type}:${tool}`, `wants ${type} but every source needs a ${tool} the player doesn't have`);
                    return false;
                }
            }
            return true;
        };
        const inZone = zone === undefined ? undefined
            : ResourceNodeRegistry.findNearest(type, here, node => accept(node) && this.host.zoneVisibility.getZoneForPosition(node.position.x, node.position.z) === zone);
        const node = inZone ?? ResourceNodeRegistry.findNearest(type, here, accept);
        if (!node) {
            this.logOnce('no-source', type, `needs ${amount} ${type} but no reachable source exists right now`);
            return undefined;
        }
        const loose = !(node instanceof ResourceNode);
        const available = (): boolean => ResourceNodeRegistry.has(node) && (!(node instanceof ResourceNode) || node.isAvailable);
        // Auto-gather only starts on a node inside the character's facing cone — and the bot stops
        // facing wherever its last path segment pointed, so turn it toward the node while it waits.
        // (Once a swing starts, PlayerActionController drives the facing itself.)
        const player = this.host.player;
        const facing = player.getComponent(FacingComponent);
        const actions = player.getComponent(PlayerActionController);
        return {
            key: `gather:${this.nodeKey(node)}`, kind: 'gather', detail: `${type} (${BackpackStorage.getCount(type)}/${amount})`, priority,
            point: node.position.clone().setY(0), radius: loose ? 0.4 : GATHER_RANGE, timeoutSec: 60, stay: true,
            isDone: () => BackpackStorage.getCount(type) >= amount || !available(),
            progress: () => BackpackStorage.getCount(type), stallSec: 10,
            whileArrived: () => {
                if (!loose && !actions?.isBusy) {
                    facing?.faceToward(node.position);
                }
            },
            onEnd: () => {
                if (!actions?.isBusy) {
                    facing?.clearTarget();
                }
            },
        };
    }

    /**
     * Gather what the cheapest money-affordable purchase still needs in resources (wood, stone).
     * Starts below serving clients (40) and climbs the longer that purchase has been waiting —
     * +5 a game minute, up to 58 — so a busy store can't starve the next building forever.
     */
    private resourceForPurchaseGoal(purchases: Purchase[]): BotGoal | undefined {
        const wallet = EconomyStorage.getBalance(CurrencyType.Money);
        const candidates = purchases.filter(p => p.resources.length > 0 && p.money <= wallet + 50).sort((a, b) => a.money - b.money);
        for (const purchase of candidates) {
            const missing = purchase.resources.find(cost => BackpackStorage.getCount(cost.type) < cost.amount);
            if (missing) {
                const waitingMin = (this.timeSec - (this.firstSeenForSale.get(purchase.key) ?? this.timeSec)) / 60;
                const goal = this.gatherGoal(missing.type, missing.amount, Math.min(58, 40 + Math.floor(waitingMin * 5)));
                if (goal) {
                    goal.detail += ` for ${purchase.label}`;
                    return goal;
                }
            }
        }
        return undefined;
    }

    /** Every 15 s: what's for sale and what each is still waiting on — the report's "for sale" timeline. */
    private logForSale(purchases: Purchase[]): void {
        for (const purchase of purchases) {
            if (!this.firstSeenForSale.has(purchase.key)) {
                this.firstSeenForSale.set(purchase.key, this.timeSec);
            }
        }
        const next = [...purchases].sort((a, b) => a.money - b.money).find(p => !this.canAfford(p));
        this.nextUnlockLabel = next
            ? `next: ${next.label} — needs ${[next.money > 0 ? `${next.money} money` : '', ...next.resources.map(r => `${r.amount} ${r.type}`)].filter(Boolean).join(' + ')}`
            : purchases.length === 0 ? 'nothing for sale' : '';
        if (this.timeSec - this.lastForSaleLogSec < FOR_SALE_LOG_SEC) {
            return;
        }
        this.lastForSaleLogSec = this.timeSec;
        const wallet = EconomyStorage.getBalance(CurrencyType.Money);
        this.recorder.logForSale(purchases.map(purchase => {
            const short = purchase.resources.filter(cost => BackpackStorage.getCount(cost.type) < cost.amount)
                .map(cost => `${cost.amount - BackpackStorage.getCount(cost.type)} ${cost.type}`);
            if (purchase.money > wallet) {
                short.unshift(`${purchase.money - wallet} money`);
            }
            return { key: purchase.key, label: purchase.label, money: purchase.money, resources: purchase.resources, missing: short.join(' + ') };
        }));
    }

    private idleGoal(snapshots: StorePlaytestSnapshot[], purchases: Purchase[]): BotGoal {
        const wallet = EconomyStorage.getBalance(CurrencyType.Money);
        const next = purchases.filter(p => !this.canAfford(p)).sort((a, b) => a.money - b.money)[0];
        const reason = next ? `saving for ${next.label} (${wallet}/${next.money})` : this.savingFor ? `saving to ${this.savingFor}` : 'nothing to do';
        this.savingFor = undefined;
        const snapshot = snapshots.find(s => s.cashierShown);
        const point = snapshot ? new THREE.Vector3(snapshot.cashier.x, 0, snapshot.cashier.z) : this.playerPosition().clone();
        // Short-lived, so the next think re-evaluates (and the logged reason stays current).
        const until = this.timeSec + 5;
        return {
            key: `idle:${until}`, kind: 'idle', detail: reason, priority: 1,
            point, radius: 1.2, timeoutSec: 600, stay: true, isDone: () => this.timeSec >= until,
        };
    }

    private gotoGoal(kind: string, detail: string, point: THREE.Vector3, radius: number, isDone: () => boolean, stay = false): BotGoal {
        return { key: `${kind}:${point.x.toFixed(1)},${point.z.toFixed(1)}`, kind, detail, priority: 60, point, radius, timeoutSec: 90, stay, isDone };
    }

    // ---- Purchases

    /** Everything for sale right now, anywhere unlocked: storages/stalls/stations, farm plots, building levels. */
    private listPurchases(): Purchase[] {
        const list: Purchase[] = [];
        for (const zone of this.scan.purchaseZones) {
            const cost = zone.getRemainingCost();
            const target = this.zoneTarget(zone);
            if (!this.isUnlocked(target.point.x, target.point.z) || (cost.money <= 0 && cost.resources.length === 0)) {
                continue;
            }
            list.push({
                key: `storage:${zone.getStorageId()}`, label: zone.getStorageId(), money: cost.money, resources: cost.resources,
                point: target.point, radius: target.radius,
                remaining: () => (StorageOwnershipStorage.isOwned(zone.getStorageId()) ? 0 : sumCost(zone.getRemainingCost())),
            });
        }
        for (const zone of this.scan.farmZones) {
            const price = zone.getRemainingPrice();
            const target = this.zoneTarget(zone);
            if (price <= 0 || !this.isUnlocked(target.point.x, target.point.z)) {
                continue;
            }
            list.push({
                key: `farm:${zone.getFarmId()}`, label: zone.getFarmId(), money: price, resources: [],
                point: target.point, radius: target.radius, remaining: () => zone.getRemainingPrice(),
            });
        }
        for (const zone of this.scan.buildingZones) {
            const id = zone.getBuildingId();
            const next = BuildingStorage.getNextLevelConfig(id);
            const tool = BUILDING_CONFIG[id]?.requiredTool;
            const target = this.zoneTarget(zone);
            if (!next || zone.isAwaitingReentry() || !this.isUnlocked(target.point.x, target.point.z)) {
                continue;
            }
            if (tool !== undefined && !ItemStorage.hasCount(tool as ItemType, 1)) {
                this.logOnce('missing-tool', `building:${id}`, `${id} needs a ${tool} to build`);
                continue;
            }
            const remaining = (): { money: number; resources: { type: ResourceType; amount: number }[] } => {
                const level = BuildingStorage.getNextLevelConfig(id);
                if (!level || level.level !== next.level) {
                    return { money: 0, resources: [] };
                }
                return {
                    money: Math.max(0, (level.money ?? 0) - BuildingStorage.getMoneyProgress(id)),
                    resources: (Object.entries(level.requirements) as [ResourceType, number][])
                        .map(([type, amount]) => ({ type, amount: Math.max(0, amount - BuildingStorage.getProgress(id, type)) }))
                        .filter(cost => cost.amount > 0),
                };
            };
            const cost = remaining();
            if (cost.money <= 0 && cost.resources.length === 0) {
                continue;
            }
            list.push({
                key: `building:${id}`, label: `${id} Lv ${next.level}`, money: cost.money, resources: cost.resources,
                point: target.point, radius: target.radius, remaining: () => sumCost(remaining()),
            });
        }
        // Tool shops (the carrier crate, the pickaxe): the next level, when it's not cooling down.
        for (const shop of this.scan.shops) {
            const next = shop.getPlaytestPurchase();
            const target = this.zoneTarget(shop);
            if (!next || !this.isUnlocked(target.point.x, target.point.z)) {
                continue;
            }
            const label = next.label;
            list.push({
                key: `shop:${shop.getShopId()}`, label, money: next.money, resources: next.resources,
                point: target.point, radius: target.radius,
                // Bought = the level went up (the next one is a different label) or it's cooling down.
                remaining: () => {
                    const now = shop.getPlaytestPurchase();
                    return now && now.label === label ? sumCost(now) : 0;
                },
            });
        }
        // The upgrades menu (backpack, axe, pickaxe, ...) — bought from anywhere, once its button is up.
        if (UpgradeMenu.isButtonUnlocked()) {
            for (const entry of UpgradeMenu.getEntries()) {
                if (!entry.cost) {
                    continue;
                }
                const level = entry.level;
                const shopId = entry.shopId;
                list.push({
                    key: `menu:${shopId}:${level + 1}`,
                    label: `${entry.name} Lv ${level + 1}`,
                    money: entry.cost.money,
                    resources: (Object.entries(entry.cost.resources) as [ResourceType, number][]).map(([type, amount]) => ({ type, amount })),
                    point: this.playerPosition().clone(),
                    radius: 99,
                    remaining: () => (ShopUpgradeStorage.getLevel(shopId) > level ? 0 : 1),
                    buyNow: () => UpgradeMenu.buy(shopId) !== undefined,
                });
            }
        }
        return list.filter(p => !this.isBlacklisted(p.key));
    }

    private canAfford(purchase: Purchase): boolean {
        return EconomyStorage.getBalance(CurrencyType.Money) >= purchase.money
            && purchase.resources.every(cost => BackpackStorage.getCount(cost.type) >= cost.amount);
    }

    private noteSaving(what: string): void {
        this.savingFor ??= what;
    }

    // ---- Running a goal

    private startGoal(goal: BotGoal): void {
        this.goal = goal;
        this.goalElapsedSec = 0;
        this.arrived = false;
        this.blockedNearGoal = false;
        this.stallTimerSec = 0;
        this.lastProgress = NaN;
        this.stuckCount = 0;
        this.stuckTimerSec = 0;
        this.lastPosition.copy(this.playerPosition());
        this.sidestepSec = 0;
        this.recorder.beginActivity(goal.kind, goal.detail);
        this.plan();
    }

    private finishGoal(outcome: string): void {
        if (!this.goal) {
            return;
        }
        this.goal.onEnd?.();
        this.goal = undefined;
        this.path.length = 0;
        this.host.player.movementController.setScriptedInput(0, 0);
        this.recorder.endActivity(outcome);
    }

    private abandon(reason: string, issueKind: string, blacklistSec = BLACKLIST_SEC): void {
        const goal = this.goal!;
        this.blacklist.set(goal.key, this.timeSec + blacklistSec);
        if (goal.kind !== 'idle' && goal.kind !== 'distracted') {
            const pos = this.playerPosition();
            this.logOnce(issueKind, goal.key, `${goal.kind} "${goal.detail}" — ${reason}`, pos.x, pos.z);
        }
        this.finishGoal(reason);
    }

    private plan(): void {
        this.path.length = 0;
        this.pathIndex = 0;
        this.replanTimerSec = REPLAN_SEC;
        const goal = this.goal;
        if (!goal) {
            return;
        }
        const from = this.playerPosition();
        if (this.nav.findPath(from, goal.point, this.path, this.style.avoidFields)) {
            return;
        }
        // Maybe the map just changed (a wall rose, a zone opened) — rebuild once and retry.
        this.nav.rebuildNow();
        if (this.nav.findPath(from, goal.point, this.path, this.style.avoidFields)) {
            return;
        }
        // No way there on the bot's map. Walking straight at it only grinds into a wall (the old
        // behaviour — the "stuck" loops) — skip it for a while and say where it couldn't get to.
        this.path.length = 0;
        this.abandon(`no path from (${from.x.toFixed(1)}, ${from.z.toFixed(1)}) to (${goal.point.x.toFixed(1)}, ${goal.point.z.toFixed(1)})`, 'no-path', NO_PATH_BLACKLIST_SEC);
    }

    /** The bot's map and current route — for the ?botnav overlay (NavDebugOverlay.ts). */
    public getNav(): WorldNavGrid {
        return this.nav;
    }

    public getPath(): readonly THREE.Vector3[] {
        return this.path;
    }

    private runGoal(delta: number): void {
        const goal = this.goal;
        const controller = this.host.player.movementController;
        if (!goal) {
            controller.setScriptedInput(0, 0);
            return;
        }
        if (goal.isDone()) {
            this.finishGoal('done');
            return;
        }
        if (this.host.isPlayerFrozen()) {
            return;
        }
        this.goalElapsedSec += delta;
        if (this.goalElapsedSec > goal.timeoutSec) {
            this.abandon(`timed out after ${Math.round(goal.timeoutSec)} s`, 'timeout');
            return;
        }

        const pos = this.playerPosition();
        const dist = Math.hypot(goal.point.x - pos.x, goal.point.z - pos.z);
        if (dist <= goal.radius || this.blockedNearGoal) {
            controller.setScriptedInput(0, 0);
            if (!this.arrived) {
                this.arrived = true;
                goal.onArrive?.();
                if (!goal.stay) {
                    this.finishGoal('arrived');
                    return;
                }
            }
            goal.whileArrived?.();
            this.checkStall(goal, delta);
            return;
        }

        // Walked off the spot (pushed by a client, ...) — just walk back, no stall clock meanwhile.
        this.followPath(goal, pos, delta);
    }

    private checkStall(goal: BotGoal, delta: number): void {
        if (!goal.progress || goal.stallSec === undefined) {
            return;
        }
        const progress = goal.progress();
        if (progress !== this.lastProgress) {
            this.lastProgress = progress;
            this.stallTimerSec = 0;
            return;
        }
        this.stallTimerSec += delta;
        if (this.stallTimerSec >= goal.stallSec) {
            this.abandon(`no progress for ${goal.stallSec} s after arriving`, 'stalled');
        }
    }

    private followPath(goal: BotGoal, pos: THREE.Vector3, delta: number): void {
        this.replanTimerSec -= delta;
        if (this.replanTimerSec <= 0) {
            this.plan();
            if (this.goal !== goal) {
                return;
            }
        }

        // Stuck: barely moved over STUCK_CHECK_SEC while trying to walk.
        this.stuckTimerSec += delta;
        if (this.stuckTimerSec >= STUCK_CHECK_SEC) {
            const moved = Math.hypot(pos.x - this.lastPosition.x, pos.z - this.lastPosition.z);
            this.lastPosition.copy(pos);
            this.stuckTimerSec = 0;
            if (moved < STUCK_MIN_MOVE) {
                if (Math.hypot(goal.point.x - pos.x, goal.point.z - pos.z) <= goal.radius + 1) {
                    this.blockedNearGoal = true;
                    return;
                }
                this.stuckCount++;
                if (this.stuckCount >= STUCK_LIMIT) {
                    this.abandon(`stuck near (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}) heading for (${goal.point.x.toFixed(1)}, ${goal.point.z.toFixed(1)})`, 'stuck');
                    return;
                }
                // Step sideways off whatever it's pressed against (alternating sides), then re-plan.
                this.sidestepSec = SIDESTEP_SEC;
                this.sidestepSign = -this.sidestepSign;
                return;
            } else {
                this.stuckCount = 0;
            }
        }

        if (this.sidestepSec > 0) {
            this.sidestepSec -= delta;
            const ahead = this.pathIndex < this.path.length ? this.path[this.pathIndex] : goal.point;
            const ax = ahead.x - pos.x;
            const az = ahead.z - pos.z;
            const len = Math.hypot(ax, az) || 1;
            // Perpendicular to where it was trying to go, a little backwards.
            this.host.player.movementController.setScriptedInput((-az / len) * this.sidestepSign - (ax / len) * 0.3, (ax / len) * this.sidestepSign - (az / len) * 0.3);
            if (this.sidestepSec <= 0) {
                this.plan();
            }
            return;
        }

        // Next waypoint; past the end of the path, straight at the goal point.
        while (this.pathIndex < this.path.length && Math.hypot(this.path[this.pathIndex].x - pos.x, this.path[this.pathIndex].z - pos.z) <= WAYPOINT_REACHED) {
            this.pathIndex++;
        }
        const target = this.pathIndex < this.path.length ? this.path[this.pathIndex] : goal.point;
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-4) {
            this.host.player.movementController.setScriptedInput(0, 0);
            return;
        }
        // Slow down for the last bit so the player stops inside small triggers instead of overshooting.
        const finalDist = Math.hypot(goal.point.x - pos.x, goal.point.z - pos.z);
        const pace = this.style.pace * Math.min(1, Math.max(0.35, finalDist / 1.5));
        this.host.player.movementController.setScriptedInput((dx / length) * pace, (dz / length) * pace);
    }

    // ---- Helpers

    private scanWorld(): void {
        const scan: Scan = { storageZones: [], purchaseZones: [], farmZones: [], buildingZones: [], hireDesks: [], mixStations: [], farmDesks: [], shops: [] };
        this.host.world.forEachEntity(entity => {
            if (entity instanceof StorageZone) {
                scan.storageZones.push(entity);
            } else if (entity instanceof StoragePurchaseZone) {
                scan.purchaseZones.push(entity);
            } else if (entity instanceof FarmZone) {
                scan.farmZones.push(entity);
            } else if (entity instanceof BuildingZone) {
                scan.buildingZones.push(entity);
            } else if (entity instanceof HireDeskZone) {
                scan.hireDesks.push(entity);
            } else if (entity instanceof FarmDeskZone) {
                scan.farmDesks.push(entity);
            } else if (entity instanceof MixStation) {
                scan.mixStations.push(entity);
            } else if (entity instanceof ShopZone) {
                scan.shops.push(entity);
            }
        });
        this.scan = scan;
    }

    /** Where to stand for an entity's trigger: its center, and how close counts as "on it". */
    private zoneTarget(entity: Entity): { point: THREE.Vector3; radius: number } {
        const body = entity.getComponent(RigidBody);
        if (!body) {
            return { point: entity.transform.position.clone().setY(0), radius: 0.5 };
        }
        const point = body.getCenter(new THREE.Vector3()).setY(0);
        return { point, radius: Math.max(0.2, Math.min(body.halfExtents.x, body.halfExtents.z) * 0.6) };
    }

    private nearestZone<T extends Entity>(zones: T[]): T | undefined {
        const here = this.playerPosition();
        let best: T | undefined;
        let bestDist = Infinity;
        for (const zone of zones) {
            const target = this.zoneTarget(zone);
            if (!this.isUnlocked(target.point.x, target.point.z)) {
                continue;
            }
            const dist = target.point.distanceToSquared(here);
            if (dist < bestDist) {
                bestDist = dist;
                best = zone;
            }
        }
        return best;
    }

    private isUnlocked(x: number, z: number): boolean {
        return this.host.zoneVisibility.isPositionUnlocked(x, z, 0.1, 0.1);
    }

    private isBlacklisted(key: string): boolean {
        const until = this.blacklist.get(key);
        if (until === undefined) {
            return false;
        }
        if (until <= this.timeSec) {
            this.blacklist.delete(key);
            return false;
        }
        return true;
    }

    private nodeKey(node: GatherTarget): string {
        return `${node.position.x.toFixed(1)},${node.position.z.toFixed(1)}`;
    }

    private logOnce(kind: string, key: string, detail: string, x?: number, z?: number): void {
        const id = `${kind}:${key}`;
        if (this.loggedIssues.has(id)) {
            return;
        }
        this.loggedIssues.add(id);
        this.recorder.logIssue(kind, detail, x, z);
    }

    private playerPosition(): THREE.Vector3 {
        return this.scratch.copy(this.host.player.transform.position);
    }
}

function sumCost(cost: { money: number; resources: { amount: number }[] }): number {
    return cost.money + cost.resources.reduce((sum, r) => sum + r.amount, 0);
}
