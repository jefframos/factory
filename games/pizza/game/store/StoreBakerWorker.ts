// StoreBakerWorker.ts
//
// A store's BAKER worker (StoreWorker.ts's base; settings in StoreTypes.ts's bakerWorker) — runs
// the store's kitchen: the built mix stations inside the store's area (world/MixStation.ts).
//
//   idle ──carrying something a box takes──────────────────────────► toBox ──► depositing ──┐
//    │  ──a station can mix (and no other baker is on it)──► toStation ──► mixing ───────────┤
//    │  ──a box short of its ingredient (product box not full)──► toSource ──► picking ──┐    │
//    │                                       ▲   more needed + room + another source ───┘    │
//    │                                       └── otherwise ──► toBox ──► depositing ─────────┤
//    └─ nothing to do: wanders in the kitchen ◄──────────────────────────────────────────────┘
//
// Ingredients come from wherever they are: a store shelf holding them (it takes one like a client
// would), or a restock source — a ripe farm cell, an animal stall's box, another station's
// product box (store/RestockSupply.ts). The Store claims sources and stations (see
// claimIngredientSource() / claimStation()) so two workers never chase the same one.
//
// It carries like a restocker (the player's crate on its back, carryCapacity items) but never
// takes the product anywhere — the player or a restocker brings it to the shelf (with two or more
// restockers, one of them prioritises the kitchen's products — see Store.findRestockJob()).
// What's on its back is saved with the roster (StoreWorkerStorage.ts).

import * as THREE from 'three';
import StoreWorker, { StoreWorkerBaseOptions, StoreWorkerNavHost, randomRange } from './StoreWorker';
import { StoreWorkerRole } from './StoreTypes';
import type { SavedStoreWorker, SavedWorkerCarry } from './StoreWorkerStorage';
import type { RestockSource } from './RestockSupply';
import type MixStation from '../world/MixStation';
import type { MixStationInputNeed } from '../world/MixStation';
import CarrierStackVisual, { stackItemScale } from '../components/CarrierStackVisual';
import { getPileScale } from '../components/ItemPile';
import { flyResourceModel } from '../components/FlyToStack';
import { getPlayerConfig } from '../data/PlayerConfig';
import { ResourceType } from '../actions/ResourceTypes';
import type { NpcBodyOptions } from '../world/NpcBodyLoader';

/** How often an idle baker looks for something to do, seconds. */
const JOB_CHECK_SEC = 1;
/** Seconds standing still between two idle wander walks. */
const WANDER_IDLE_SEC: [number, number] = [2, 4];
/** Pause after one pickup, before heading on. */
const PICK_PAUSE_SEC = 0.35;
/** Gap between two items leaving its back into a box. */
const DEPOSIT_STAGGER_SEC = 0.2;
/** A walk that hasn't arrived after this long (unreachable goal) gives the job up. */
const WALK_TIMEOUT_SEC = 30;
/** Fallback flight end/start when the carrier hasn't loaded yet — roughly its back. */
const FALLBACK_CARRY_HEIGHT = 1.2;

/** What a baker needs from its Store. */
export interface StoreBakerHost extends StoreWorkerNavHost {
    /** The built mix stations inside the store — its kitchen. */
    getKitchenStations(): MixStation[];
    /** Middle of the kitchen — where it idles. */
    getKitchenHome(): THREE.Vector3;
    getBakerStats(level: number): { moveSpeed: number; carryCapacity: number };
    /** True if no OTHER baker is on `station` — claimed for `worker` (replacing its previous station). */
    claimStation(worker: StoreBakerWorker, station: MixStation): boolean;
    /** The nearest unclaimed place holding `type` — a store shelf or a restock source — claimed for `worker`. */
    claimIngredientSource(worker: StoreBakerWorker, type: ResourceType, near: THREE.Vector3): RestockSource | undefined;
    /** Drops every station/source `worker` claimed. */
    releaseClaims(worker: StoreBakerWorker): void;
    /** Parent for flying item models (world space). */
    getFlightParent(): THREE.Object3D | undefined;
    /** Something saved changed (what's on its back) — the store re-saves its roster. */
    notifyWorkerChanged(): void;
}

export interface StoreBakerOptions extends StoreWorkerBaseOptions {
    carryCapacity: number;
    wanderRadius: number;
    /** Items on its back from the save. */
    carried?: readonly SavedWorkerCarry[];
}

export type StoreBakerState = 'idle' | 'toSource' | 'picking' | 'toBox' | 'depositing' | 'toStation' | 'mixing';

/** One ingredient box it's working on — which station, which box, what it takes. */
interface BoxTarget {
    station: MixStation;
    index: number;
    type: ResourceType;
    position: THREE.Vector3;
}

export default class StoreBakerWorker extends StoreWorker {
    public readonly role: StoreWorkerRole = 'baker';

    private readonly host: StoreBakerHost;
    private readonly wanderRadius: number;
    private carryCapacity: number;
    /** Everything it holds (items still flying onto its back included). */
    private readonly carried = new Map<ResourceType, number>();
    /** Of `carried`, how many are still in the air toward its back. */
    private readonly incoming = new Map<ResourceType, number>();
    private stack?: CarrierStackVisual;

    private state: StoreBakerState = 'idle';
    /** The box it's fetching for / filling. */
    private box?: BoxTarget;
    /** The station it's walking to / mixing at. */
    private station?: MixStation;
    private source?: RestockSource;
    /** Units still wanted for `box` on this trip. */
    private wanted = 0;
    private timerSec = 0;
    private wanderTimerSec = 0;
    private walkTimerSec = 0;

    private readonly scratch = new THREE.Vector3();

    public constructor(host: StoreBakerHost, options: StoreBakerOptions) {
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

    public getState(): StoreBakerState {
        return this.state;
    }

    /** One short line for playtest reports — e.g. "toSource milk +milk1", "mixing butter", "idle". */
    public getReportLabel(): string {
        const what = this.state === 'toStation' || this.state === 'mixing' ? this.station?.getProduct() : this.box?.type;
        const carrying = [...this.carried].filter(([, n]) => n > 0).map(([type, n]) => `${type}${n}`).join(',');
        return `${this.state}${what ? ` ${what}` : ''}${carrying ? ` +${carrying}` : ''}`;
    }

    public applyLevel(level: number): void {
        this.level = level;
        const stats = this.host.getBakerStats(level);
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

    private setState(next: StoreBakerState): void {
        this.state = next;
        this.walkTimerSec = 0;
        switch (next) {
            case 'idle':
                this.host.releaseClaims(this);
                this.box = undefined;
                this.station = undefined;
                this.source = undefined;
                this.wanted = 0;
                this.timerSec = 0;
                this.stopWalking();
                break;
            case 'toSource':
                this.walkTo(this.source!.walkPoint, false);
                break;
            case 'picking':
                this.pickFromSource();
                this.timerSec = PICK_PAUSE_SEC;
                break;
            case 'toBox':
                this.source = undefined;
                this.walkTo(this.box!.position, false);
                break;
            case 'depositing':
                this.timerSec = 0;
                break;
            case 'toStation':
                this.walkTo(this.station!.getMakingPoint());
                break;
            case 'mixing':
                break;
        }
    }

    protected think(delta: number): void {
        switch (this.state) {
            case 'idle':
                this.updateIdle(delta);
                break;
            case 'toSource':
                this.updateToSource(delta);
                break;
            case 'picking':
                this.timerSec -= delta;
                if (this.timerSec <= 0) {
                    this.nextSourceOrBox();
                }
                break;
            case 'toBox':
                if (this.isWalkDone()) {
                    this.setState('depositing');
                } else if (this.walkTimedOut(delta)) {
                    this.setState('idle');
                }
                break;
            case 'depositing':
                this.updateDepositing(delta);
                break;
            case 'toStation':
                if (!this.station?.canMix()) {
                    this.setState('idle');
                } else if (this.isWalkDone()) {
                    this.setState('mixing');
                } else if (this.walkTimedOut(delta)) {
                    this.setState('idle');
                }
                break;
            case 'mixing':
                this.updateMixing();
                break;
        }
    }

    /** Every JOB_CHECK_SEC: unload into a box, else mix, else fetch an ingredient; wanders in the kitchen between checks. */
    private updateIdle(delta: number): void {
        this.timerSec -= delta;
        if (this.timerSec <= 0) {
            this.timerSec = JOB_CHECK_SEC;
            if (this.startDelivery() || this.startMixing() || this.startFetching()) {
                return;
            }
            this.host.releaseClaims(this);
        }

        if (!this.isWalkDone()) {
            return;
        }
        this.wanderTimerSec -= delta;
        if (this.wanderTimerSec <= 0) {
            this.wanderTimerSec = randomRange(WANDER_IDLE_SEC);
            const spot = this.pickWanderSpot(this.host.getKitchenHome(), this.wanderRadius);
            if (spot) {
                this.walkTo(spot, false);
            }
        }
    }

    /** Something on its back that a box has room for -> take it there. */
    private startDelivery(): boolean {
        let best: BoxTarget | undefined;
        let bestDistance = Infinity;
        for (const station of this.host.getKitchenStations()) {
            for (const need of station.getInputNeeds()) {
                if ((this.carried.get(need.resourceType) ?? 0) <= 0 || need.count >= need.capacity) {
                    continue;
                }
                const distance = need.position.distanceToSquared(this.transform.position);
                if (distance < bestDistance) {
                    best = this.boxTarget(station, need);
                    bestDistance = distance;
                }
            }
        }
        if (!best) {
            return false;
        }
        this.box = best;
        this.setState('toBox');
        return true;
    }

    /** A station with a batch ready and its product box not full, that no other baker is on -> go mix. */
    private startMixing(): boolean {
        const station = this.host.getKitchenStations()
            .filter(candidate => candidate.canMix())
            .sort((a, b) => a.getMakingPoint().distanceToSquared(this.transform.position) - b.getMakingPoint().distanceToSquared(this.transform.position))
            .find(candidate => this.host.claimStation(this, candidate));
        if (!station) {
            return false;
        }
        this.station = station;
        this.setState('toStation');
        return true;
    }

    /**
     * A box short of its ingredient at a station whose product box has room -> fetch some. Boxes
     * that block a batch (below one batch) first, then the emptiest; only types with a ready
     * source, and only as many as fit on its back and in the box.
     */
    private startFetching(): boolean {
        const room = this.carryCapacity - this.totalCarried();
        if (room <= 0) {
            return false;
        }
        const candidates: { station: MixStation; need: MixStationInputNeed }[] = [];
        for (const station of this.host.getKitchenStations()) {
            if (!station.hasOutputRoom()) {
                continue;
            }
            for (const need of station.getInputNeeds()) {
                if (need.count < need.capacity) {
                    candidates.push({ station, need });
                }
            }
        }
        candidates.sort((a, b) =>
            Number(a.need.count >= a.need.batch) - Number(b.need.count >= b.need.batch)
            || a.need.count / a.need.capacity - b.need.count / b.need.capacity);
        for (const { station, need } of candidates) {
            const source = this.host.claimIngredientSource(this, need.resourceType, this.transform.position);
            if (source) {
                this.box = this.boxTarget(station, need);
                this.source = source;
                this.wanted = Math.min(room, need.capacity - need.count);
                this.setState('toSource');
                return true;
            }
        }
        return false;
    }

    /** Walking to a claimed source — if what it had is gone (someone took it), try another. */
    private updateToSource(delta: number): void {
        if (!this.source?.getReadyYield()) {
            this.nextSourceOrBox();
            return;
        }
        if (this.isWalkDone()) {
            this.setState('picking');
        } else if (this.walkTimedOut(delta)) {
            this.setState(this.totalCarried() > 0 && this.box ? 'toBox' : 'idle');
        }
    }

    /** Still wants more and has room -> the next source of the same type; otherwise to the box (or idle with nothing). */
    private nextSourceOrBox(): void {
        const box = this.box;
        if (!box) {
            this.setState('idle');
            return;
        }
        if (this.wanted > 0 && this.totalCarried() < this.carryCapacity) {
            const next = this.host.claimIngredientSource(this, box.type, this.transform.position);
            if (next) {
                this.source = next;
                this.setState('toSource');
                return;
            }
        }
        this.setState((this.carried.get(box.type) ?? 0) > 0 ? 'toBox' : 'idle');
    }

    /** Takes one pickup (if it fits — a first pick always does) and flies each unit onto its back. */
    private pickFromSource(): void {
        const source = this.source;
        const ready = source?.getReadyYield();
        if (!source || !ready) {
            return;
        }
        const total = this.totalCarried();
        if (total > 0 && total + ready.amount > this.carryCapacity) {
            this.wanted = 0;
            return;
        }
        const taken = source.takeForWorker();
        if (!taken) {
            return;
        }
        const from = source.launchPoint.clone();
        for (let i = 0; i < taken.amount; i++) {
            this.flyOntoBack(taken.resourceType, from);
        }
        if (taken.resourceType === this.box?.type) {
            this.wanted -= taken.amount;
        }
        this.host.notifyWorkerChanged();
    }

    /** At the box: one item every DEPOSIT_STAGGER_SEC off its back into the box, until it has none of that type or the box is full. */
    private updateDepositing(delta: number): void {
        const box = this.box;
        if (!box) {
            this.setState('idle');
            return;
        }
        this.faceTarget = box.position;
        this.timerSec -= delta;
        if (this.timerSec > 0) {
            return;
        }
        this.timerSec = DEPOSIT_STAGGER_SEC;

        if ((this.carried.get(box.type) ?? 0) <= 0) {
            this.setState('idle');
            return;
        }
        // Only what's actually drawn on its back leaves — anything still flying on lands first.
        if (this.visibleCount(box.type) <= 0) {
            return;
        }
        const onTop = this.stack?.peekTop(candidate => candidate === box.type, this.scratch);
        const from = onTop !== undefined
            ? this.scratch.clone()
            : this.transform.position.clone().setY(this.transform.position.y + FALLBACK_CARRY_HEIGHT);
        if (!box.station.depositFromWorker(box.index, box.type, from)) {
            // Box full (the player filled it meanwhile) — keep the rest; idle finds another box or uses it later.
            this.setState('idle');
            return;
        }
        this.removeCarried(box.type);
        this.stack?.markDirty();
        this.host.notifyWorkerChanged();
    }

    /** Standing in the making area: keeps the station mixing while it can make another batch. */
    private updateMixing(): void {
        const station = this.station;
        if (!station?.canMix()) {
            this.setState('idle');
            return;
        }
        station.operate();
        this.faceTarget = station.transform.position;
    }

    // ---- Carrying

    private boxTarget(station: MixStation, need: MixStationInputNeed): BoxTarget {
        return { station, index: need.index, type: need.resourceType, position: need.position.clone() };
    }

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

    private walkTimedOut(delta: number): boolean {
        this.walkTimerSec += delta;
        return this.walkTimerSec >= WALK_TIMEOUT_SEC;
    }
}
