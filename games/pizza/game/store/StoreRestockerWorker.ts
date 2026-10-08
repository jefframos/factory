// StoreRestockerWorker.ts
//
// A store's RESTOCKER worker (StoreWorker.ts's base; settings in StoreTypes.ts's
// StoreRestockerWorkerConfig) — keeps the shelves stocked from the farms:
//
//   idle ──job: emptiest shelf whose crop is ready somewhere──► toTile ──arrived──► harvesting
//    ▲                                                           ▲                     │
//    │                                                           └─ room left + another ready tile
//    │                                                                                 │ full / none left
//    └──────────── depositing (one item at a time onto the shelf) ◄── arrived ── toShelf ◄┘
//
// It carries like the player: a crate on its back (the player's own
// PlayerConfig.carrier) with the items stacked in it — the same
// CarrierStackVisual, fed from this worker's own counts. carryCapacity (per
// level) is how many fit. Harvested crops fly from the farm cell onto its
// back; delivered ones fly from its back onto the shelf and land in
// StorageInventory (so StorageZone's pile and the clients see them).
//
// It picks up from any RestockSource (store/RestockSupply.ts): ripe farm cells, and the boxes
// animal stalls lay into (eggs, milk) / mix station dispensers (butter, bread) — one item each.
//
// Jobs and sources are CLAIMED through the Store (see findRestockJob() /
// claimReadySource()): two restockers never chase the same source, and several
// can work the same shelf only while it has room for all of their loads (each
// prefers a shelf nobody else is serving).
//
// What's on its back is saved with the store's worker roster
// (StoreWorkerStorage.ts), so a reload mid-delivery still delivers.

import * as THREE from 'three';
import StoreWorker, { StoreWorkerBaseOptions, StoreWorkerNavHost, randomRange } from './StoreWorker';
import { StoreWorkerRole } from './StoreTypes';
import type { SavedStoreWorker, SavedWorkerCarry } from './StoreWorkerStorage';
import type { RestockSource } from './RestockSupply';
import CarrierStackVisual, { stackItemScale } from '../components/CarrierStackVisual';
import { getPileScale } from '../components/ItemPile';
import { flyResourceModel } from '../components/FlyToStack';
import { StorageInventory } from '../data/StorageInventory';
import { getPlayerConfig } from '../data/PlayerConfig';
import { ResourceType } from '../actions/ResourceTypes';
import type { NpcBodyOptions } from '../world/NpcBodyLoader';

/** How often an idle restocker looks for a job, seconds. */
const JOB_CHECK_SEC = 1;
/** Seconds standing still between two idle wander walks. */
const WANDER_IDLE_SEC: [number, number] = [1.5, 3.5];
/** Pause after picking up one cell's harvest, before heading on. */
const HARVEST_PAUSE_SEC = 0.35;
/** Gap between two items leaving its back at the shelf. */
const DEPOSIT_STAGGER_SEC = 0.15;
/** A walk that hasn't arrived after this long (unreachable goal) gives the job up. */
const WALK_TIMEOUT_SEC = 30;
/** Delivered items aim this high above the shelf's own position. */
const SHELF_LAND_HEIGHT = 0.6;
/** Fallback flight end/start when the carrier hasn't loaded yet — roughly its back. */
const FALLBACK_CARRY_HEIGHT = 1.2;

/** One delivery: which shelf, what it takes, and where to stand to fill it. */
export interface RestockJob {
    storageId: string;
    type: ResourceType;
    /** Where the worker walks to drop items — the shelf's dropper, or the shelf itself. */
    dropPoint: THREE.Vector3;
    /** The shelf's own position — items fly here. */
    shelfPosition: THREE.Vector3;
}

/** What a restocker needs from its Store. */
export interface StoreRestockerHost extends StoreWorkerNavHost {
    /** Middle of the store's shelves — where it idles. */
    getHomePoint(): THREE.Vector3;
    getRestockerStats(level: number): { moveSpeed: number; carryCapacity: number };
    /** The emptiest shelf whose item is ready at some unclaimed source — claimed for `worker`. undefined = nothing to do. */
    findRestockJob(worker: StoreRestockerWorker): RestockJob | undefined;
    /** A shelf for `type` (even a full one) — for items already on its back (e.g. after a reload). Claimed for `worker`. */
    findShelfFor(worker: StoreRestockerWorker, type: ResourceType): RestockJob | undefined;
    /** The nearest ready source (farm cell, stall box, dispenser) of `type` that nobody else claimed — claimed for `worker`. */
    claimReadySource(worker: StoreRestockerWorker, type: ResourceType, near: THREE.Vector3): RestockSource | undefined;
    /** Drops every shelf/cell `worker` claimed. */
    releaseClaims(worker: StoreRestockerWorker): void;
    /** Parent for flying item models (world space). */
    getFlightParent(): THREE.Object3D | undefined;
    /** Something saved changed (what's on its back) — the store re-saves its roster. */
    notifyWorkerChanged(): void;
}

export interface StoreRestockerOptions extends StoreWorkerBaseOptions {
    carryCapacity: number;
    wanderRadius: number;
    /** Items on its back from the save. */
    carried?: readonly SavedWorkerCarry[];
}

export type StoreRestockerState = 'idle' | 'toTile' | 'harvesting' | 'toShelf' | 'depositing';

export default class StoreRestockerWorker extends StoreWorker {
    public readonly role: StoreWorkerRole = 'restocker';

    private readonly host: StoreRestockerHost;
    private readonly wanderRadius: number;
    private carryCapacity: number;
    /** Everything it holds (items still flying onto its back included). */
    private readonly carried = new Map<ResourceType, number>();
    /** Of `carried`, how many are still in the air toward its back (not drawn on the stack yet). */
    private readonly incoming = new Map<ResourceType, number>();
    private stack?: CarrierStackVisual;

    private state: StoreRestockerState = 'idle';
    private job?: RestockJob;
    private source?: RestockSource;
    private timerSec = 0;
    private wanderTimerSec = 0;
    private walkTimerSec = 0;

    private readonly scratch = new THREE.Vector3();

    public constructor(host: StoreRestockerHost, options: StoreRestockerOptions) {
        super(host, options);
        this.host = host;
        this.wanderRadius = options.wanderRadius;
        this.carryCapacity = options.carryCapacity;
        for (const entry of options.carried ?? []) {
            if (entry.amount > 0) {
                this.carried.set(entry.type, (this.carried.get(entry.type) ?? 0) + entry.amount);
            }
        }
    }

    public override awake(): void {
        super.awake();
        this.stack = this.addComponent(new CarrierStackVisual({
            getBody: () => this.body,
            getCounts: () => this.visibleCounts(),
        }));
    }

    public override destroy(): void {
        this.host.releaseClaims(this);
        super.destroy();
    }

    // ---- Store-facing API

    /** How many items it carries at once — what the Store counts as promised to a shelf it's working (see findRestockJob()). */
    public getCarryCapacity(): number {
        return this.carryCapacity;
    }

    public getState(): StoreRestockerState {
        return this.state;
    }

    public applyLevel(level: number): void {
        this.level = level;
        const stats = this.host.getRestockerStats(level);
        this.setMoveSpeed(stats.moveSpeed);
        this.carryCapacity = stats.carryCapacity;
    }

    /** Its StoreWorkerStorage entry. */
    public toSave(): SavedStoreWorker {
        const carried = [...this.carried].filter(([, amount]) => amount > 0).map(([type, amount]) => ({ type, amount }));
        return { id: this.workerId, role: this.role, level: this.level, ...(carried.length > 0 ? { carried } : {}) };
    }

    // ---- Body

    protected override bodyOptions(): NpcBodyOptions {
        return { carrier: getPlayerConfig().carrier };
    }

    // ---- States

    private setState(next: StoreRestockerState): void {
        this.state = next;
        this.walkTimerSec = 0;
        switch (next) {
            case 'idle':
                this.host.releaseClaims(this);
                this.job = undefined;
                this.source = undefined;
                this.timerSec = 0;
                this.stopWalking();
                break;
            case 'toTile':
                this.walkTo(this.source!.walkPoint);
                break;
            case 'harvesting':
                this.harvestTile();
                this.timerSec = HARVEST_PAUSE_SEC;
                break;
            case 'toShelf':
                this.source = undefined;
                this.walkTo(this.job!.dropPoint, false);
                break;
            case 'depositing':
                this.timerSec = 0;
                break;
        }
    }

    protected think(delta: number): void {
        switch (this.state) {
            case 'idle':
                this.updateIdle(delta);
                break;
            case 'toTile':
                this.updateToTile(delta);
                break;
            case 'harvesting':
                this.timerSec -= delta;
                if (this.timerSec <= 0) {
                    this.nextTileOrShelf();
                }
                break;
            case 'toShelf':
                if (this.isWalkDone()) {
                    this.setState('depositing');
                } else if (this.walkTimedOut(delta)) {
                    this.setState('idle');
                }
                break;
            case 'depositing':
                this.updateDepositing(delta);
                break;
        }
    }

    /** Items already on its back go to their shelf first; otherwise look for a job every JOB_CHECK_SEC and wander between checks. */
    private updateIdle(delta: number): void {
        this.timerSec -= delta;
        if (this.timerSec <= 0) {
            this.timerSec = JOB_CHECK_SEC;
            const heldType = this.firstCarriedType();
            if (heldType !== undefined) {
                const shelf = this.host.findShelfFor(this, heldType);
                if (shelf) {
                    this.job = shelf;
                    this.setState('toShelf');
                    return;
                }
            } else {
                const job = this.host.findRestockJob(this);
                const source = job && this.host.claimReadySource(this, job.type, this.transform.position);
                if (job && source) {
                    this.job = job;
                    this.source = source;
                    this.setState('toTile');
                    return;
                }
                this.host.releaseClaims(this);
            }
        }

        if (!this.isWalkDone()) {
            return;
        }
        this.wanderTimerSec -= delta;
        if (this.wanderTimerSec <= 0) {
            this.wanderTimerSec = randomRange(WANDER_IDLE_SEC);
            const spot = this.pickWanderSpot(this.host.getHomePoint(), this.wanderRadius);
            if (spot) {
                this.walkTo(spot, false);
            }
        }
    }

    /** Walking to a claimed source — if what it had is gone (the player took it), try another one. */
    private updateToTile(delta: number): void {
        if (!this.source?.getReadyYield()) {
            this.nextTileOrShelf();
            return;
        }
        if (this.isWalkDone()) {
            this.setState('harvesting');
        } else if (this.walkTimedOut(delta)) {
            this.setState(this.totalCarried() > 0 && this.job ? 'toShelf' : 'idle');
        }
    }

    /** More room and another ready cell of the same crop -> go there; otherwise deliver what it has (or give up with nothing). */
    private nextTileOrShelf(): void {
        const job = this.job;
        if (!job) {
            this.setState('idle');
            return;
        }
        if (this.totalCarried() < this.carryCapacity) {
            const next = this.host.claimReadySource(this, job.type, this.transform.position);
            if (next) {
                this.source = next;
                this.setState('toTile');
                return;
            }
        }
        this.setState(this.totalCarried() > 0 ? 'toShelf' : 'idle');
    }

    /** Takes the source's pickup (if it fits — a first pick always does) and flies each unit onto its back. */
    private harvestTile(): void {
        const source = this.source;
        const ready = source?.getReadyYield();
        if (!source || !ready) {
            return;
        }
        const total = this.totalCarried();
        if (total > 0 && total + ready.amount > this.carryCapacity) {
            return;
        }
        const harvested = source.takeForWorker();
        if (!harvested) {
            return;
        }
        const from = source.launchPoint.clone();
        for (let i = 0; i < harvested.amount; i++) {
            this.flyOntoBack(harvested.resourceType, from);
        }
        this.host.notifyWorkerChanged();
    }

    /** At the shelf: one item every DEPOSIT_STAGGER_SEC off the top of its back onto the shelf, then back to idle. */
    private updateDepositing(delta: number): void {
        const job = this.job;
        if (!job) {
            this.setState('idle');
            return;
        }
        this.faceTarget = job.shelfPosition;
        this.timerSec -= delta;
        if (this.timerSec > 0) {
            return;
        }
        this.timerSec = DEPOSIT_STAGGER_SEC;

        // Only what's actually drawn on its back leaves (anything still flying on lands first).
        const type = [...this.carried.keys()].find(candidate => this.visibleCount(candidate) > 0);
        if (type === undefined) {
            if (this.totalCarried() === 0) {
                this.setState('idle');
            }
            return;
        }
        // Launch from the actual top item on its back (same idea as StorageZone.nextOutgoing()).
        const onTop = this.stack?.peekTop(candidate => candidate === type, this.scratch);
        const from = onTop !== undefined
            ? this.scratch.clone()
            : this.transform.position.clone().setY(this.transform.position.y + FALLBACK_CARRY_HEIGHT);
        this.removeCarried(type);
        this.stack?.markDirty();
        this.host.notifyWorkerChanged();

        const parent = this.host.getFlightParent();
        const scale = stackItemScale() * getPileScale(type);
        const storageId = job.storageId;
        if (!parent) {
            StorageInventory.add(storageId, type, 1);
            return;
        }
        const target = job.shelfPosition.clone().setY(job.shelfPosition.y + SHELF_LAND_HEIGHT);
        flyResourceModel({
            parent,
            type,
            from,
            startScale: scale,
            endScale: scale,
            resolveTarget: out => out.copy(target),
            onArrive: () => StorageInventory.add(storageId, type, 1),
        });
    }

    // ---- Carrying

    /** Adds one `type` now (counts toward capacity/save right away) and flies it onto the next slot on its back — drawn there once it lands. */
    private flyOntoBack(type: ResourceType, from: THREE.Vector3): void {
        this.carried.set(type, (this.carried.get(type) ?? 0) + 1);
        this.incoming.set(type, (this.incoming.get(type) ?? 0) + 1);
        const slot = this.totalCarried() - 1;
        const land = (): void => {
            this.incoming.set(type, Math.max(0, (this.incoming.get(type) ?? 0) - 1));
            this.stack?.markDirty();
        };

        const parent = this.host.getFlightParent();
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

    private removeCarried(type: ResourceType): void {
        const left = (this.carried.get(type) ?? 0) - 1;
        if (left > 0) {
            this.carried.set(type, left);
        } else {
            this.carried.delete(type);
        }
    }

    private visibleCount(type: ResourceType): number {
        return (this.carried.get(type) ?? 0) - (this.incoming.get(type) ?? 0);
    }

    /** What CarrierStackVisual draws — landed items only. */
    private visibleCounts(): [ResourceType, number][] {
        return [...this.carried.keys()].map(type => [type, Math.max(0, this.visibleCount(type))]);
    }

    private totalCarried(): number {
        let total = 0;
        this.carried.forEach(amount => total += amount);
        return total;
    }

    private firstCarriedType(): ResourceType | undefined {
        return [...this.carried].find(([, amount]) => amount > 0)?.[0];
    }

    private walkTimedOut(delta: number): boolean {
        this.walkTimerSec += delta;
        return this.walkTimerSec >= WALK_TIMEOUT_SEC;
    }
}
