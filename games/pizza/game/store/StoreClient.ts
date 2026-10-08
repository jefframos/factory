// StoreClient.ts
//
// One shopper in a Store (see Store.ts), run as an explicit state machine.
// Each state is one entry in `states` (enter / update / exit), so a new
// activity later (sitting, eating, ...) is a new ClientState plus one
// handler — nothing else in the class has to know about it.
//
//   toShelf ──arrived──► queuing ◄──────► browsing
//      ▲  │                 │ front          (looks at another shelf for a bit,
//      │  │ front            ▼                keeps its place in line)
//      │  └──arrived──► picking ──item done──► toShelf (next item)
//      │                    │ shelf empty           └─ list done ─► toCashier
//      │                    ▼
//      └──restocked─── wandering  (strolls the store, still asking for the item)
//
//   toCashier ──arrived──► cashierQueue ──front──► readyToPay ──paid──► leaving ──► done
//
//   Any shopping state, out of patience with nothing bought ──► leaving
//
// What it has picked rides on its back, like the player's and a restocker's
// (StoreRestockerWorker.ts): the same crate (PlayerConfig.carrier) with the
// items stacked in it — CarrierStackVisual fed from its own bought counts.
// Each picked unit flies from the shelf onto the next slot and is drawn there
// once it lands; it keeps carrying everything through paying and walking out.
//
// Queues (StoreLine) decide ORDER only; where a queue index stands comes
// from the store's queue layout (StoreQueueSpots.ts). Walking is NavAgent
// on the store's nav grid: paths around shelves/solids, steering around
// other clients and the player.
//
// Mood (StoreClientMood, shown as a face in its bubble): arrives HAPPY and
// only gets frustrated while it's WAITING (see isFrustrated()) — for an item
// that's out of stock (heading to / standing at an empty shelf, or wandering
// until a restock) or in the cashier line. Each moodStepSec (its own — see the
// constructor) spent waiting drops it one step; walking, picking in-stock
// items and waiting behind others at a stocked shelf don't count, so a client
// who finds everything in stock and is served right away stays happy.
// Completing an item while more are still left cheers it up one step.
// Dropping to SAD with nothing bought yet makes it walk out without buying;
// with anything bought it stays — but once it has been at the bottom mood
// (ANGRY) for angryDropSec while still waiting, it walks to a CLEAN spot of the
// store ('dumping' — StoreClientHost.findCleanDropSpot()), drops everything it
// carries there as garbage (StoreClientHost.dropGarbage(), see
// StoreGarbage.ts) and walks out without paying. With StoreConfig.forgivingEarlyLevels, early store levels
// set a floor the mood never drops below (level 1: HAPPY, level 2: ANNOYED —
// see StoreClientHost.getMoodFloor()), so nobody walks out or pays less
// there. Its mood at payment scales what it pays — see applyMoodToPrice().

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import CharacterBody from '../entities/CharacterBody';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import CarrierStackVisual, { stackItemScale } from '../components/CarrierStackVisual';
import { getPileScale } from '../components/ItemPile';
import { flyResourceModel } from '../components/FlyToStack';
import { getPlayerConfig } from '../data/PlayerConfig';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { getNpcConfig, NpcLook, rollNpcLook } from '../data/NpcTypes';
import { loadNpcBody } from '../world/NpcBodyLoader';
import { ResourceType } from '../actions/ResourceTypes';
import { StorageInventory } from '../data/StorageInventory';
import NavAgent, { NavNeighbor } from './nav/NavAgent';
import StoreNavGrid from './nav/StoreNavGrid';
import StoreBubble, { StoreBubbleContent } from './StoreBubble';
import StoreLine from './StoreLine';
import type { SavedStoreClient, SavedStoreClientWant } from './StoreClientStorage';
import { GameAnalytics } from '../analytics/GameAnalytics';
import {
    DEFAULT_ANGRY_DROP_SEC,
    DEFAULT_BROWSE_CHANCE,
    DEFAULT_CLIENT_RADIUS,
    STORE_MOOD_LADDER,
    StoreClientMood,
    StoreConfig,
    applyMoodToPrice,
    getStoreItemPrice,
} from './StoreTypes';

const NPC_MOVE_INPUT_MAGNITUDE = 0.5;
/** How often a client checks for another storage with its item in stock (in line at an empty one, or wandering). */
const REROUTE_CHECK_SEC = 1;
/** Bubble height above the client's feet until its rig (and so its Head bone) has loaded. */
const FALLBACK_HEAD_HEIGHT = 2;
/** Picked items fly from this high above the storage's own position. */
const STORAGE_ICON_HEIGHT = 1;
/** A fed-up client walking to a clean spot dumps wherever it is after this long (unreachable spot). */
const DUMP_WALK_TIMEOUT_SEC = 12;
/** Where a picked item aims if the crate hasn't loaded yet — roughly its back. */
const FALLBACK_CARRY_HEIGHT = 1.2;
const ARRIVAL_MOOD_INDEX = STORE_MOOD_LADDER.indexOf('happy');
/** Reaching this mood with nothing bought yet makes a client walk out. */
const LEAVE_EMPTY_HANDED_MOOD_INDEX = STORE_MOOD_LADDER.indexOf('sad');
/** At the front of an empty shelf, how long a client waits before giving up its place and wandering. */
const WANDER_AFTER_EMPTY_SEC = 2;
/** Seconds between "should I go browse?" rolls while waiting in a shelf line (random in range). */
const RESTLESS_SEC: [number, number] = [3, 6];
/** Seconds spent looking once at a browse spot. */
const BROWSE_LOOK_SEC: [number, number] = [2, 4];
/** Seconds standing still between two wander walks. */
const WANDER_IDLE_SEC: [number, number] = [1.5, 3.5];

/** A storage a client can queue at — built by Store.ts, one per active storage inside the store. */
export interface StoreStorageRef {
    readonly id: string;
    readonly position: THREE.Vector3;
    readonly line: StoreLine<StoreClient>;
}

/** Somewhere to stand, and what to look at once there. */
export interface StoreSpot {
    point: THREE.Vector3;
    lookAt?: THREE.Vector3;
}

/** What a client needs from its Store — an interface so this file doesn't import Store.ts. */
export interface StoreClientHost {
    readonly config: StoreConfig;
    readonly screenHost: ScreenAnchorHost;
    readonly cashierLine: StoreLine<StoreClient>;
    /** The best storage to get `type` from right now, or undefined if no active storage sells it any more. */
    chooseStorageFor(type: ResourceType): StoreStorageRef | undefined;
    /** Whether the store is currently revealed (fog of war) — the bubble hides while it isn't. */
    isVisible(): boolean;
    /** Lowest mood a client can drop to right now (early store levels), undefined = no floor — see Store.getMoodFloor(). */
    getMoodFloor(): StoreClientMood | undefined;
    /** True while nobody (neither the player nor a cashier worker) is serving at the cashier — a client waiting to pay then shows a '!' (see bubbleContent()). */
    isCashierUnattended(): boolean;
    /** The store's walkability grid — undefined until built (clients then walk straight). */
    getNavGrid(): StoreNavGrid | undefined;
    /** Everyone to steer around (all clients, including `this` — skipped by identity — and the player). */
    getNavNeighbors(): readonly NavNeighbor[];
    /** A spot to go look at something while waiting in `line` (near another shelf), or undefined. */
    findBrowseSpot(client: StoreClient, line: StoreLine<StoreClient>): StoreSpot | undefined;
    /** A random free spot to stroll to while waiting for a restock, or undefined. */
    findWanderSpot(client: StoreClient): StoreSpot | undefined;
    /** A fed-up client throws `types` (one entry per unit) on the floor around `from` — they become garbage. */
    dropGarbage(from: THREE.Vector3, types: ResourceType[]): void;
    /** Where a fed-up client goes to dump its items — a clean (garbage-free) free spot in the store, or undefined (it dumps where it stands). */
    findCleanDropSpot(client: StoreClient): THREE.Vector3 | undefined;
    /** Something saved by toSave() changed (an item picked, mood, or it paid/left) — the store re-saves its clients. */
    notifyClientChanged(): void;
}

export interface StoreClientWant {
    type: ResourceType;
    amount: number;
}

interface WantProgress {
    type: ResourceType;
    remaining: number;
    bought: number;
    /** Nothing in the store sells it any more (storage disabled/removed) — dropped from the list. */
    skipped?: boolean;
}

/** See this file's own doc for the state diagram. */
export type ClientState =
    | 'toShelf'
    | 'queuing'
    | 'browsing'
    | 'picking'
    | 'wandering'
    | 'toCashier'
    | 'cashierQueue'
    | 'readyToPay'
    | 'dumping'
    | 'leaving'
    | 'done';

interface StateHandler {
    enter?(): void;
    update(delta: number): void;
    exit?(): void;
}

/** States still working through the shopping list — mood can make these walk out. */
const SHOPPING_STATES: ReadonlySet<ClientState> = new Set<ClientState>(['toShelf', 'queuing', 'browsing', 'picking', 'wandering']);
/** States before paying — the mood clock runs through these. */
const MOOD_STATES: ReadonlySet<ClientState> = new Set<ClientState>([...SHOPPING_STATES, 'toCashier', 'cashierQueue', 'readyToPay']);

export default class StoreClient extends Entity implements NavNeighbor {
    /** Swings store doors open when near one — see StoreDoor.ts. */
    public readonly opensDoors = true;
    public readonly npcId: string;
    /** Its rolled color/face/scale (see NpcConfig.colors) — kept so a saved client looks the same after a reload. */
    public readonly look: NpcLook;
    private readonly host: StoreClientHost;
    private readonly wants: WantProgress[];
    private readonly exitPoint: THREE.Vector3;
    /** This client's own seconds per mood step — rolled by Store (rollClientMoodStepSec()), so some clients are more tolerant than others. */
    private readonly moodStepSec: number;
    private readonly body = new CharacterBody();
    private readonly bubble = new StoreBubble();
    private readonly agent: NavAgent;
    private readonly states: Record<ClientState, StateHandler>;
    private anchor?: ScreenAnchorComponent;

    private state: ClientState = 'toShelf';
    private wantIndex = 0;
    private storage?: StoreStorageRef;
    private pickTimerSec = 0;
    private emptyTimerSec = 0;
    private rerouteTimerSec = REROUTE_CHECK_SEC;
    private restlessTimerSec = randomRange(RESTLESS_SEC);
    private moodIndex = ARRIVAL_MOOD_INDEX;
    private moodTimerSec = 0;
    /** Seconds spent at the bottom mood while frustrated — see updateAngryDrop(). */
    private angryTimerSec = 0;
    /** Seconds spent walking to its dump spot — see updateDumping(). */
    private dumpTimerSec = 0;
    /** Browsing / wandering: where it's headed, and whether it's arrived and is looking around. */
    private outing?: StoreSpot;
    private outingLookSec = 0;
    /** What to face while standing still this frame — set by the current state. */
    private faceTarget?: THREE.Vector3;

    private readonly spot = new THREE.Vector3();
    private readonly scratchFrom = new THREE.Vector3();
    /** The crate on its back — see this file's own doc. */
    private stack?: CarrierStackVisual;
    /** Picked units still flying onto its back, per type — counted in `bought` already, drawn once landed. */
    private readonly incoming = new Map<ResourceType, number>();

    public constructor(host: StoreClientHost, spawnAt: THREE.Vector3, exitPoint: THREE.Vector3, wants: StoreClientWant[], npcId: string, moodStepSec: number, look?: NpcLook) {
        super();
        this.host = host;
        this.exitPoint = exitPoint.clone();
        this.wants = wants.map(want => ({ type: want.type, remaining: want.amount, bought: 0 }));
        this.npcId = npcId;
        const npcConfig = getNpcConfig(npcId) ?? getNpcConfig('default');
        this.look = look ?? (npcConfig ? rollNpcLook(npcConfig) : {});
        this.moodStepSec = moodStepSec;
        this.transform.position.copy(spawnAt);
        this.agent = new NavAgent(this.transform.position, () => host.getNavGrid(), {
            radius: host.config.clientRadius ?? DEFAULT_CLIENT_RADIUS,
            speed: host.config.moveSpeed,
        });

        this.states = {
            toShelf: { update: delta => this.updateToShelf(delta) },
            queuing: { update: delta => this.updateQueuing(delta) },
            browsing: { enter: () => this.startOuting(), update: delta => this.updateBrowsing(delta), exit: () => this.endOuting() },
            picking: { enter: () => { this.pickTimerSec = 0; this.emptyTimerSec = 0; }, update: delta => this.updatePicking(delta) },
            wandering: { enter: () => this.enterWandering(), update: delta => this.updateWandering(delta), exit: () => this.endOuting() },
            toCashier: { enter: () => this.host.cashierLine.join(this), update: () => this.updateToCashier() },
            cashierQueue: { update: () => this.updateCashierQueue() },
            readyToPay: { update: () => this.updateReadyToPay() },
            dumping: { enter: () => this.enterDumping(), update: delta => this.updateDumping(delta) },
            leaving: { enter: () => this.enterLeaving(), update: () => this.updateLeaving() },
            done: { enter: () => this.agent.stop(), update: () => undefined },
        };
    }

    // ---- NavNeighbor

    public get position(): THREE.Vector3 {
        return this.transform.position;
    }

    public isNavMoving(): boolean {
        return this.agent.isMoving;
    }

    // ---- Entity

    public override awake(): void {
        this.transform.add(this.body.container);
        const npcConfig = getNpcConfig(this.npcId) ?? getNpcConfig('default');
        if (npcConfig) {
            void loadNpcBody(this.body, npcConfig, { carrier: getPlayerConfig().carrier, look: this.look })
                .catch(error => console.error(`[StoreClient] failed to load npc "${this.npcId}"`, error));
        } else {
            console.warn(`[StoreClient] npc "${this.npcId}" has no NpcConfig registered — client will be invisible`);
        }

        this.stack = this.addComponent(new CarrierStackVisual({
            getBody: () => this.body,
            getCounts: () => this.carriedCounts(),
        }));

        const headTarget = new THREE.Vector3();
        const bubbleOffset = new THREE.Vector3(0, this.host.config.bubbleOffset, 0);
        this.anchor = this.addComponent(new ScreenAnchorComponent(
            this.host.screenHost,
            this.bubble.content,
            () => this.getHeadWorldPosition(headTarget).add(bubbleOffset),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));
    }

    public override update(delta: number): void {
        super.update(delta);

        if (MOOD_STATES.has(this.state) && this.isFrustrated()) {
            this.updateMood(delta);
            this.updateAngryDrop(delta);
        }

        this.faceTarget = undefined;
        this.states[this.state].update(delta);
        this.agent.update(delta, this.host.getNavNeighbors());

        const moving = this.agent.isMoving;
        // Re-read through a cast: TS narrowed faceTarget to undefined above and can't see the state handler set it.
        const faceTarget = this.faceTarget as THREE.Vector3 | undefined;
        if (!moving && faceTarget) {
            this.body.faceDirection(faceTarget.x - this.transform.position.x, faceTarget.z - this.transform.position.z);
        }
        const dirX = moving ? this.agent.moveDirX * NPC_MOVE_INPUT_MAGNITUDE : 0;
        const dirZ = moving ? this.agent.moveDirZ * NPC_MOVE_INPUT_MAGNITUDE : 0;
        // `grounded: true` — see QuestGiverEntity.update()'s own doc: every idle/walk transition is gated on it.
        this.body.update(delta, dirX, dirZ, { grounded: true });

        this.bubble.show(this.bubbleContent());
        this.anchor?.setForceHidden(!this.host.isVisible());
    }

    public override destroy(): void {
        this.storage?.line.leave(this);
        this.host.cashierLine.leave(this);
        this.bubble.destroy();
        this.body.destroy();
        super.destroy();
    }

    // ---- Store-facing API

    public getState(): ClientState {
        return this.state;
    }

    /** True once standing at the front of the cashier line with everything picked, waiting for the player. */
    public isReadyToPay(): boolean {
        return this.state === 'readyToPay';
    }

    /** Store.ts calls this when the player is at the cashier — frees the cashier spot, starts walking to the exit and returns what this client pays. */
    public pay(): number {
        const amount = this.getTotalPrice();
        this.setState('leaving');
        return amount;
    }

    public getMood(): StoreClientMood {
        return STORE_MOOD_LADDER[this.moodIndex];
    }

    public isFinished(): boolean {
        return this.state === 'done';
    }

    /**
     * What StoreClientStorage keeps for this client — only once it holds at least one picked item
     * and hasn't paid yet (see that file's own doc), undefined otherwise. Always restored into
     * 'toShelf', which carries on with whatever's left of the list, or heads to the cashier.
     */
    public toSave(): SavedStoreClient | undefined {
        if (!MOOD_STATES.has(this.state) || !this.wants.some(want => want.bought > 0)) {
            return undefined;
        }
        return {
            npcId: this.npcId,
            look: this.look,
            wants: this.wants.map(want => ({ type: want.type, remaining: want.remaining, bought: want.bought })),
            moodIndex: this.moodIndex,
            moodStepSec: this.moodStepSec,
            x: this.transform.position.x,
            z: this.transform.position.z,
            exitX: this.exitPoint.x,
            exitZ: this.exitPoint.z,
        };
    }

    /** Puts back a saved client's progress (see toSave()) — call right after constructing it with the same wants. */
    public restoreProgress(wants: readonly SavedStoreClientWant[], moodIndex: number): void {
        wants.forEach((saved, index) => {
            const want = this.wants[index];
            if (want && want.type === saved.type) {
                want.remaining = Math.max(0, saved.remaining);
                want.bought = Math.max(0, saved.bought);
            }
        });
        this.moodIndex = Math.max(0, Math.min(STORE_MOOD_LADDER.length - 1, Math.floor(moodIndex)));
        this.stack?.markDirty();
    }

    /** Where it's walking right now (debug drawing). */
    public getPath(): readonly THREE.Vector3[] {
        return this.agent.getRemainingPath();
    }

    public getHeadWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        const head = this.body.getBone('Head');
        if (head && this.body.container.visible) {
            return head.getWorldPosition(target);
        }
        return target.copy(this.transform.position).setY(this.transform.position.y + FALLBACK_HEAD_HEIGHT);
    }

    // ---- State machine

    private setState(next: ClientState): void {
        if (next === this.state) {
            return;
        }
        this.states[this.state].exit?.();
        this.state = next;
        this.states[next].enter?.();
    }

    /** Walking to its spot in a shelf's line (or picking the next shelf when it has none). */
    private updateToShelf(delta: number): void {
        const storage = this.ensureStorage();
        if (!storage) {
            return;
        }
        this.checkReroute(delta);
        if (this.state !== 'toShelf' || !this.storage) {
            return;
        }
        this.walkToLineSpot(this.storage.line);
        if (this.agent.hasArrived()) {
            this.setState(this.storage.line.isFront(this) ? 'picking' : 'queuing');
        }
    }

    /** Standing in a shelf's line, not at the front yet — may get restless and go browsing. */
    private updateQueuing(delta: number): void {
        const storage = this.storage;
        if (!storage) {
            this.setState('toShelf');
            return;
        }
        this.checkReroute(delta);
        if (this.state !== 'queuing') {
            return;
        }
        // Line moved up (or its spots were re-laid): walk to the new spot.
        this.walkToLineSpot(storage.line);
        if (!this.agent.hasArrived()) {
            this.setState('toShelf');
            return;
        }
        this.faceTarget = storage.position;

        this.restlessTimerSec -= delta;
        if (this.restlessTimerSec <= 0) {
            this.restlessTimerSec = randomRange(RESTLESS_SEC);
            // Only when there's still someone ahead to wait for.
            if (storage.line.indexOf(this) >= 1 && Math.random() < (this.host.config.browseChance ?? DEFAULT_BROWSE_CHANCE)) {
                this.outing = this.host.findBrowseSpot(this, storage.line);
                if (this.outing) {
                    this.setState('browsing');
                }
            }
        }
    }

    /** Away from its spot looking at another shelf — keeps its place, heads back when it's up next. */
    private updateBrowsing(delta: number): void {
        const storage = this.storage;
        if (!storage || !this.outing || storage.line.indexOf(this) <= 0) {
            this.setState('toShelf');
            return;
        }
        if (!this.agent.hasArrived()) {
            return;
        }
        this.faceTarget = this.outing.lookAt;
        this.outingLookSec -= delta;
        if (this.outingLookSec <= 0) {
            this.setState('toShelf');
        }
    }

    /** At the front of a shelf's line, taking one unit at a time. An empty shelf sends it wandering. */
    private updatePicking(delta: number): void {
        const storage = this.storage;
        const want = this.currentWant();
        if (!storage || !want) {
            this.setState('toShelf');
            return;
        }
        this.faceTarget = storage.position;

        if (StorageInventory.getCount(storage.id, want.type) <= 0) {
            this.pickTimerSec = 0;
            this.checkReroute(delta);
            if (this.state !== 'picking') {
                return;
            }
            this.emptyTimerSec += delta;
            if (this.emptyTimerSec >= WANDER_AFTER_EMPTY_SEC) {
                this.setState('wandering');
            }
            return;
        }
        this.emptyTimerSec = 0;

        this.pickTimerSec += delta;
        if (this.pickTimerSec < this.host.config.pickDelaySec) {
            return;
        }
        this.pickTimerSec = 0;
        if (StorageInventory.remove(storage.id, want.type, 1) <= 0) {
            return;
        }
        want.remaining--;
        want.bought++;
        this.host.notifyClientChanged();
        this.flyPickedItem(want.type, storage.position);
        if (want.remaining <= 0) {
            this.leaveStorage();
            if (this.wants.some(other => other.remaining > 0 && !other.skipped)) {
                this.changeMood(1);
            }
            // toShelf -> ensureStorage() picks the next item (in-stock ones first).
            this.setState('toShelf');
        }
    }

    /** Everything left on its list is out of stock: gives up its place and strolls, checking back every REROUTE_CHECK_SEC. */
    private enterWandering(): void {
        this.leaveStorage();
        this.rerouteTimerSec = REROUTE_CHECK_SEC;
        this.nextWanderSpot();
    }

    private updateWandering(delta: number): void {
        this.rerouteTimerSec -= delta;
        if (this.rerouteTimerSec <= 0) {
            this.rerouteTimerSec = REROUTE_CHECK_SEC;
            // ANY item still on its list back in stock (not just the one it gave up on) -> go get it.
            const inStock = this.findWantIndex(true);
            if (inStock !== -1 || !this.currentWant()) {
                if (inStock !== -1) {
                    this.wantIndex = inStock;
                }
                this.setState('toShelf');
                return;
            }
        }

        // No free spot last time (crowded store): idle where it is, then try again.
        if (this.outing && !this.agent.hasArrived()) {
            return;
        }
        this.faceTarget = this.outing?.lookAt;
        this.outingLookSec -= delta;
        if (this.outingLookSec <= 0) {
            this.nextWanderSpot();
        }
    }

    /** Walking to its spot in the cashier line. */
    private updateToCashier(): void {
        this.walkToLineSpot(this.host.cashierLine);
        if (this.agent.hasArrived()) {
            this.setState(this.host.cashierLine.isFront(this) ? 'readyToPay' : 'cashierQueue');
        }
    }

    /** Standing in the cashier line behind someone. */
    private updateCashierQueue(): void {
        this.walkToLineSpot(this.host.cashierLine);
        if (!this.agent.hasArrived()) {
            this.setState('toCashier');
            return;
        }
        this.faceTarget = this.host.cashierLine.target;
        if (this.host.cashierLine.isFront(this)) {
            this.setState('readyToPay');
        }
    }

    /** At the front of the cashier line, waiting for the player — Store.ts calls pay(). */
    private updateReadyToPay(): void {
        this.walkToLineSpot(this.host.cashierLine);
        if (!this.agent.hasArrived()) {
            this.setState('toCashier');
            return;
        }
        this.faceTarget = this.host.cashierLine.target;
    }

    private enterLeaving(): void {
        this.host.notifyClientChanged();
        this.leaveStorage();
        this.host.cashierLine.leave(this);
        this.agent.setGoal(this.exitPoint);
    }

    private updateLeaving(): void {
        if (this.agent.hasArrived()) {
            this.setState('done');
        }
    }

    // ---- State helpers

    /**
     * The storage for the current want, joining its line if needed. With no storage yet it
     * (re)picks WHICH item to go for — one in stock first (see findWantIndex()) — and moves on
     * to checkout when the list is done.
     */
    private ensureStorage(): StoreStorageRef | undefined {
        while (!this.storage) {
            this.wantIndex = this.findWantIndex(false);
            const want = this.currentWant();
            if (!want) {
                this.startCheckout();
                return undefined;
            }
            this.storage = this.host.chooseStorageFor(want.type);
            if (!this.storage) {
                want.skipped = true;
                continue;
            }
            this.storage.line.join(this);
        }
        return this.storage;
    }

    /**
     * Waiting on an empty storage: go where something on its list IS in stock — the same item
     * at another storage first, else any other item it still needs (so a client never idles on
     * an empty shelf while it could be getting something else).
     */
    private checkReroute(delta: number): void {
        this.rerouteTimerSec -= delta;
        const storage = this.storage;
        const want = this.currentWant();
        if (this.rerouteTimerSec > 0 || !storage || !want) {
            return;
        }
        this.rerouteTimerSec = REROUTE_CHECK_SEC;
        if (StorageInventory.getCount(storage.id, want.type) > 0) {
            return;
        }
        const better = this.host.chooseStorageFor(want.type);
        if (better && better !== storage && StorageInventory.getCount(better.id, want.type) > 0) {
            this.leaveStorage();
            this.storage = better;
            better.line.join(this);
            this.setState('toShelf');
            return;
        }
        const other = this.findWantIndex(true);
        if (other !== -1 && other !== this.wantIndex) {
            this.leaveStorage();
            this.wantIndex = other;
            this.setState('toShelf');
        }
    }

    /** The want it's going for — undefined when there's none left (or the current one is done/dropped). */
    private currentWant(): WantProgress | undefined {
        const want = this.wants[this.wantIndex];
        return want && want.remaining > 0 && !want.skipped ? want : undefined;
    }

    /**
     * Index of the item to go for next: one that's in stock somewhere first; unless `inStockOnly`,
     * otherwise the first one still needed. -1 if none. Marks items nothing sells any more as skipped.
     */
    private findWantIndex(inStockOnly: boolean): number {
        let fallback = -1;
        // Current item first, so a tie keeps what it was already doing.
        const order = [this.wantIndex, ...this.wants.map((_, index) => index).filter(index => index !== this.wantIndex)];
        for (const index of order) {
            const want = this.wants[index];
            if (!want || want.remaining <= 0 || want.skipped) {
                continue;
            }
            const storage = this.host.chooseStorageFor(want.type);
            if (!storage) {
                want.skipped = true;
                continue;
            }
            if (StorageInventory.getCount(storage.id, want.type) > 0) {
                return index;
            }
            if (fallback === -1) {
                fallback = index;
            }
        }
        return inStockOnly ? -1 : fallback;
    }

    private leaveStorage(): void {
        this.storage?.line.leave(this);
        this.storage = undefined;
    }

    private walkToLineSpot(line: StoreLine<StoreClient>): void {
        if (line.getSpotFor(this, this.spot)) {
            this.agent.setGoal(this.spot);
        }
    }

    /** Browsing: head for `outing` (set by updateQueuing()). */
    private startOuting(): void {
        this.outingLookSec = randomRange(BROWSE_LOOK_SEC);
        if (this.outing) {
            this.agent.setGoal(this.outing.point);
        }
    }

    private endOuting(): void {
        this.outing = undefined;
    }

    private nextWanderSpot(): void {
        this.outing = this.host.findWanderSpot(this);
        this.outingLookSec = randomRange(WANDER_IDLE_SEC);
        if (this.outing) {
            this.agent.setGoal(this.outing.point);
        }
    }

    // ---- Mood & money

    /** Waiting on something — an out-of-stock item, or the cashier line. Only then does the mood clock run (see this file's own doc). */
    private isFrustrated(): boolean {
        switch (this.state) {
            case 'wandering':
            case 'cashierQueue':
            case 'readyToPay':
                return true;
            case 'toShelf':
            case 'queuing':
            case 'browsing':
            case 'picking': {
                const want = this.currentWant();
                return !!this.storage && !!want && StorageInventory.getCount(this.storage.id, want.type) <= 0;
            }
            default:
                return false;
        }
    }

    /** One step worse every this.moodStepSec spent frustrated (see isFrustrated()); out of patience with nothing bought yet -> walks out. */
    private updateMood(delta: number): void {
        this.moodTimerSec += delta;
        if (this.moodTimerSec < this.moodStepSec) {
            return;
        }
        const floor = this.host.getMoodFloor();
        if (floor !== undefined && this.moodIndex <= STORE_MOOD_LADDER.indexOf(floor)) {
            this.moodTimerSec = 0;
            return;
        }
        this.changeMood(-1);
        if (SHOPPING_STATES.has(this.state) && this.moodIndex <= LEAVE_EMPTY_HANDED_MOOD_INDEX && !this.wants.some(want => want.bought > 0)) {
            GameAnalytics.clientLeft('out-of-patience');
            this.setState('leaving');
        }
    }

    /** At the bottom mood (ANGRY) for angryDropSec while still waiting, holding anything -> drops it all as garbage and walks out (see this file's own doc). */
    private updateAngryDrop(delta: number): void {
        if (this.moodIndex > 0 || !MOOD_STATES.has(this.state)) {
            this.angryTimerSec = 0;
            return;
        }
        this.angryTimerSec += delta;
        if (this.angryTimerSec < (this.host.config.angryDropSec ?? DEFAULT_ANGRY_DROP_SEC)) {
            return;
        }
        // Holding something: go find a clean spot to dump it first. Nothing: just leave.
        const holding = this.wants.some(want => want.bought > 0);
        GameAnalytics.clientLeft(holding ? 'angry-dumped' : 'angry');
        this.setState(holding ? 'dumping' : 'leaving');
    }

    /** Off to a clean spot (see this file's own doc) — out of every line; with no spot found it dumps right here. */
    private enterDumping(): void {
        this.leaveStorage();
        this.host.cashierLine.leave(this);
        this.dumpTimerSec = 0;
        const spot = this.host.findCleanDropSpot(this);
        if (spot) {
            this.agent.setGoal(spot);
        } else {
            this.agent.stop();
        }
    }

    /** Dumps on arrival (or after DUMP_WALK_TIMEOUT_SEC, wherever it got to), then walks out. */
    private updateDumping(delta: number): void {
        this.dumpTimerSec += delta;
        if (!this.agent.hasArrived() && this.dumpTimerSec < DUMP_WALK_TIMEOUT_SEC) {
            return;
        }
        this.agent.stop();
        this.dropEverything();
        this.setState('leaving');
    }

    /** Throws everything it carries (in flight onto its back included) on the floor as garbage. */
    private dropEverything(): void {
        const dropped: ResourceType[] = [];
        for (const want of this.wants) {
            for (let i = 0; i < want.bought; i++) {
                dropped.push(want.type);
            }
            want.bought = 0;
        }
        this.incoming.clear();
        this.stack?.markDirty();
        if (dropped.length > 0) {
            this.host.dropGarbage(this.transform.position.clone().setY(this.transform.position.y + FALLBACK_CARRY_HEIGHT), dropped);
        }
    }

    /** Steps the mood up (+1) or down (-1), clamped to the ladder — restarts the time spent in the current mood. */
    private changeMood(step: number): void {
        this.moodIndex = Math.max(0, Math.min(STORE_MOOD_LADDER.length - 1, this.moodIndex + step));
        this.moodTimerSec = 0;
        this.host.notifyClientChanged();
    }

    private startCheckout(): void {
        // Couldn't buy anything at all — just leave.
        if (this.getBasePrice() <= 0) {
            GameAnalytics.clientLeft('nothing-to-buy');
        }
        this.setState(this.getBasePrice() > 0 ? 'toCashier' : 'leaving');
    }

    /** What this client pays right now — its base price scaled by its current mood. */
    private getTotalPrice(): number {
        return applyMoodToPrice(this.host.config, this.getMood(), this.getBasePrice());
    }

    private getBasePrice(): number {
        const base = this.wants.reduce((sum, want) => sum + want.bought * getStoreItemPrice(want.type), 0);
        return base > 0 ? Math.max(1, Math.round(base * this.host.config.priceMultiplier)) : 0;
    }

    // ---- Presentation

    private bubbleContent(): StoreBubbleContent {
        const mood = this.getMood();
        if (SHOPPING_STATES.has(this.state)) {
            const wants = this.wants.filter(want => want.remaining > 0 && !want.skipped).map(want => ({ type: want.type, remaining: want.remaining }));
            const current = this.currentWant();
            const outOfStock = this.state === 'wandering' || (this.state === 'picking' && !!this.storage && !!current && StorageInventory.getCount(this.storage.id, current.type) <= 0);
            const waitingFor = outOfStock ? current?.type : undefined;
            // Can't find what it wants (empty shelf / wandering for it) — a '?' says so.
            return wants.length > 0 ? { kind: 'wants', mood, wants, waitingFor, ...(waitingFor ? { alert: 'question' as const } : {}) } : { kind: 'mood', mood };
        }
        switch (this.state) {
            case 'toCashier':
            case 'cashierQueue':
                return { kind: 'pay', mood, amount: this.getTotalPrice() };
            case 'readyToPay':
                // At the front with nobody serving — a '!' calls the player over.
                return { kind: 'pay', mood, amount: this.getTotalPrice(), ...(this.host.isCashierUnattended() ? { alert: 'exclamation' as const } : {}) };
            case 'dumping':
            case 'leaving':
                return { kind: 'mood', mood };
            default:
                return { kind: 'hidden' };
        }
    }

    /** What its crate draws: every bought unit that has landed (see flyPickedItem()). */
    private carriedCounts(): [ResourceType, number][] {
        return this.wants.map(want => [want.type, Math.max(0, want.bought - (this.incoming.get(want.type) ?? 0))]);
    }

    /** One picked unit flies from the shelf onto the next slot on its back (`bought` already counts it) — drawn there once it lands. */
    private flyPickedItem(type: ResourceType, storagePosition: THREE.Vector3): void {
        const from = this.scratchFrom.copy(storagePosition).setY(storagePosition.y + STORAGE_ICON_HEIGHT).clone();
        this.incoming.set(type, (this.incoming.get(type) ?? 0) + 1);
        const slot = this.wants.reduce((sum, want) => sum + want.bought, 0) - 1;
        const land = (): void => {
            this.incoming.set(type, Math.max(0, (this.incoming.get(type) ?? 0) - 1));
            this.stack?.markDirty();
        };

        const parent = this.transform.parent;
        if (!parent) {
            land();
            return;
        }
        const scale = stackItemScale() * getPileScale(type);
        flyResourceModel({
            parent,
            type,
            from,
            startScale: scale,
            endScale: scale,
            resolveTarget: out => {
                if (!this.stack?.getSlotWorldTarget(slot, type, out)) {
                    out.copy(this.transform.position).setY(this.transform.position.y + FALLBACK_CARRY_HEIGHT);
                }
            },
            onArrive: land,
        });
    }
}

function randomRange([min, max]: [number, number]): number {
    return min + Math.random() * (max - min);
}
