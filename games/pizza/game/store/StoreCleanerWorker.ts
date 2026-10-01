// StoreCleanerWorker.ts
//
// A store's CLEANER worker (StoreWorker.ts's base; settings in StoreTypes.ts's
// StoreCleanerWorkerConfig — the same speed / carry-space levels as a
// restocker) — keeps the floor clean:
//
//   idle ──garbage on the floor──► toPiece ──arrived──► picking ──room left + more garbage──► toPiece
//    ▲                                                     │ full / none left
//    └──────── depositing (one piece at a time into the bin) ◄── arrived ── toTrash ◄┘
//
// It carries like the player and the restockers: the player's own crate on
// its back (PlayerConfig.carrier) with every piece stacked in it — drawn as
// the darkened item it was (CarrierStackSource.displayFor), same as the
// player's own carried garbage (see GarbageCarryStorage.ts). It throws them
// in the nearest trash storage (StorageConfig.trash), where they're destroyed.
//
// Pieces are CLAIMED through the Store (claimNearestGarbage()), so two
// cleaners never chase the same one; if the player grabs a piece first, the
// cleaner just moves on to the next. What's on its back is saved with the
// store's worker roster (StoreWorkerStorage.ts), so a reload mid-trip still
// ends at the bin.

import * as THREE from 'three';
import StoreWorker, { StoreWorkerBaseOptions, StoreWorkerNavHost, randomRange } from './StoreWorker';
import { StoreWorkerRole } from './StoreTypes';
import type { SavedStoreWorker, SavedWorkerCarry } from './StoreWorkerStorage';
import type StoreGarbage from './StoreGarbage';
import CarrierStackVisual, { stackItemScale } from '../components/CarrierStackVisual';
import { getPileScale } from '../components/ItemPile';
import { flyResourceModel } from '../components/FlyToStack';
import { getPlayerConfig } from '../data/PlayerConfig';
import { GARBAGE_DARKEN } from '../data/GarbageCarryStorage';
import { ResourceType } from '../actions/ResourceTypes';
import type { NpcBodyOptions } from '../world/NpcBodyLoader';

/**
 * The cleaner's carrier — a trashcan on its back instead of the crate restockers/clients wear, so
 * it reads as the cleaner at a glance (rig units, same as PlayerCarrierConfig). Restaurant.Trashcan
 * is 2 x 2.34 x 2 with its pivot in the MIDDLE (y -1 .. 1.34): at scale 32 it's 64 x 75 x 64, and
 * offset y 12 puts its bottom at y -20 — the same spot the crate's bottom sits (offset -20, pivot
 * at its bottom). The carried garbage stacks inside it.
 */
const CLEANER_CARRIER = {
    models: ['Restaurant.Trashcan'],
    scale: 32,
    offset: { x: 0, y: 12, z: -50 },
    rotationDeg: { x: 0, y: 0, z: 0 },
};

/** How often an idle cleaner looks for garbage, seconds. */
const JOB_CHECK_SEC = 1;
/** Seconds standing still between two idle wander walks. */
const WANDER_IDLE_SEC: [number, number] = [1.5, 3.5];
/** Pause after picking up a piece, before heading on. */
const PICK_PAUSE_SEC = 0.3;
/** Gap between two pieces leaving its back at the bin. */
const DEPOSIT_STAGGER_SEC = 0.15;
/** A walk that hasn't arrived after this long (unreachable goal) gives up. */
const WALK_TIMEOUT_SEC = 30;
/** Picked-up pieces launch from this high above the floor. */
const PICK_LAUNCH_HEIGHT = 0.2;
/** Fallback flight end/start when the carrier hasn't loaded yet — roughly its back. */
const FALLBACK_CARRY_HEIGHT = 1.2;

/** Where garbage gets thrown away: where to stand, and where the pieces fly to. */
export interface TrashTarget {
    dropPoint: THREE.Vector3;
    /** The bin's opening, world space — pieces fly here and are gone. */
    binPosition: THREE.Vector3;
}

/** What a cleaner needs from its Store. */
export interface StoreCleanerHost extends StoreWorkerNavHost {
    /** Where it idles. */
    getHomePoint(): THREE.Vector3;
    getCleanerStats(level: number): { moveSpeed: number; carryCapacity: number };
    /** The nearest piece of garbage nobody else claimed — claimed for `worker` (replacing its previous claim). */
    claimNearestGarbage(worker: StoreCleanerWorker, near: THREE.Vector3): StoreGarbage | undefined;
    /** True while `piece` is still on the floor. */
    hasGarbage(piece: StoreGarbage): boolean;
    /** Takes `piece` off the floor for `worker` — false if it's gone already (e.g. the player took it). */
    takeGarbage(worker: StoreCleanerWorker, piece: StoreGarbage): boolean;
    /** The nearest trash storage to `near`, or undefined if the map has none. */
    getTrashTarget(near: THREE.Vector3): TrashTarget | undefined;
    releaseGarbageClaims(worker: StoreCleanerWorker): void;
    getFlightParent(): THREE.Object3D | undefined;
    notifyWorkerChanged(): void;
}

export interface StoreCleanerOptions extends StoreWorkerBaseOptions {
    carryCapacity: number;
    wanderRadius: number;
    /** What was on its back in the save — the items each piece of garbage was. */
    carried?: readonly SavedWorkerCarry[];
}

export type StoreCleanerState = 'idle' | 'toPiece' | 'picking' | 'toTrash' | 'depositing';

export default class StoreCleanerWorker extends StoreWorker {
    public readonly role: StoreWorkerRole = 'cleaner';

    private readonly host: StoreCleanerHost;
    private readonly wanderRadius: number;
    private carryCapacity: number;
    /** What each piece on its back WAS, bottom to top (still-flying ones included). */
    private readonly carried: ResourceType[] = [];
    /** Of `carried`, how many (from the top) are still in the air toward its back. */
    private incoming = 0;
    private stack?: CarrierStackVisual;

    private state: StoreCleanerState = 'idle';
    private piece?: StoreGarbage;
    private trash?: TrashTarget;
    private timerSec = 0;
    private wanderTimerSec = 0;
    private walkTimerSec = 0;

    private readonly scratch = new THREE.Vector3();

    public constructor(host: StoreCleanerHost, options: StoreCleanerOptions) {
        super(host, options);
        this.host = host;
        this.wanderRadius = options.wanderRadius;
        this.carryCapacity = options.carryCapacity;
        for (const entry of options.carried ?? []) {
            for (let i = 0; i < entry.amount; i++) {
                this.carried.push(entry.type);
            }
        }
    }

    public override awake(): void {
        super.awake();
        this.stack = this.addComponent(new CarrierStackVisual({
            getBody: () => this.body,
            getCounts: () => [[ResourceType.Garbage, Math.max(0, this.carried.length - this.incoming)]],
            // Each piece drawn as the darkened item it was — same look as on the floor.
            displayFor: (type, ordinal) => {
                const was = type === ResourceType.Garbage ? this.carried[ordinal] : undefined;
                return was ? { type: was, darken: GARBAGE_DARKEN } : undefined;
            },
        }));
    }

    public override destroy(): void {
        this.host.releaseGarbageClaims(this);
        super.destroy();
    }

    // ---- Store-facing API

    public getState(): StoreCleanerState {
        return this.state;
    }

    public applyLevel(level: number): void {
        this.level = level;
        const stats = this.host.getCleanerStats(level);
        this.setMoveSpeed(stats.moveSpeed);
        this.carryCapacity = stats.carryCapacity;
    }

    /** Its StoreWorkerStorage entry — what it carries, as counts of what each piece was. */
    public toSave(): SavedStoreWorker {
        const counts = new Map<ResourceType, number>();
        this.carried.forEach(type => counts.set(type, (counts.get(type) ?? 0) + 1));
        const carried = [...counts].map(([type, amount]) => ({ type, amount }));
        return { id: this.workerId, role: this.role, level: this.level, ...(carried.length > 0 ? { carried } : {}) };
    }

    // ---- Body

    protected override bodyOptions(): NpcBodyOptions {
        // The player's carrier settings (stack mode, item scale, ...) with a trashcan instead of the crate.
        return { carrier: { ...getPlayerConfig().carrier, ...CLEANER_CARRIER } };
    }

    // ---- States

    private setState(next: StoreCleanerState): void {
        this.state = next;
        this.walkTimerSec = 0;
        switch (next) {
            case 'idle':
                this.host.releaseGarbageClaims(this);
                this.piece = undefined;
                this.trash = undefined;
                this.timerSec = 0;
                this.stopWalking();
                break;
            case 'toPiece':
                this.walkTo(this.piece!.transform.position);
                break;
            case 'picking':
                this.pickPiece();
                this.timerSec = PICK_PAUSE_SEC;
                break;
            case 'toTrash':
                this.piece = undefined;
                this.host.releaseGarbageClaims(this);
                this.walkTo(this.trash!.dropPoint, false);
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
            case 'toPiece':
                this.updateToPiece(delta);
                break;
            case 'picking':
                this.timerSec -= delta;
                if (this.timerSec <= 0) {
                    this.nextPieceOrTrash();
                }
                break;
            case 'toTrash':
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

    /** Garbage already on its back goes to the bin first; otherwise look for a piece every JOB_CHECK_SEC and wander between checks. */
    private updateIdle(delta: number): void {
        this.timerSec -= delta;
        if (this.timerSec <= 0) {
            this.timerSec = JOB_CHECK_SEC;
            if (this.carried.length < this.carryCapacity) {
                const piece = this.host.claimNearestGarbage(this, this.transform.position);
                if (piece) {
                    this.piece = piece;
                    this.setState('toPiece');
                    return;
                }
            }
            if (this.carried.length > 0 && this.goToTrash()) {
                return;
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

    /** Walking to a claimed piece — if it's gone (the player took it), go for the next one. */
    private updateToPiece(delta: number): void {
        if (!this.piece || !this.host.hasGarbage(this.piece)) {
            this.nextPieceOrTrash();
            return;
        }
        if (this.isWalkDone()) {
            this.setState('picking');
        } else if (this.walkTimedOut(delta)) {
            this.nextPieceOrTrash();
        }
    }

    /** Room left and another piece -> go get it; otherwise off to the bin with what it has (or back to idle with nothing). */
    private nextPieceOrTrash(): void {
        if (this.carried.length < this.carryCapacity) {
            const next = this.host.claimNearestGarbage(this, this.transform.position);
            if (next) {
                this.piece = next;
                this.setState('toPiece');
                return;
            }
        }
        if (this.carried.length === 0 || !this.goToTrash()) {
            this.setState('idle');
        }
    }

    private goToTrash(): boolean {
        const trash = this.host.getTrashTarget(this.transform.position);
        if (!trash) {
            return false;
        }
        this.trash = trash;
        this.setState('toTrash');
        return true;
    }

    /** Takes the piece off the floor (if it's still there) and flies it onto the next slot on its back. */
    private pickPiece(): void {
        const piece = this.piece;
        this.piece = undefined;
        if (!piece || !this.host.takeGarbage(this, piece)) {
            return;
        }
        const was = piece.type;
        this.carried.push(was);
        this.incoming++;
        this.host.notifyWorkerChanged();

        const slot = this.carried.length - 1;
        const land = (): void => {
            this.incoming = Math.max(0, this.incoming - 1);
            this.stack?.markDirty();
        };
        const parent = this.host.getFlightParent();
        if (!parent) {
            land();
            return;
        }
        const scale = stackItemScale() * getPileScale(was);
        flyResourceModel({
            parent,
            type: ResourceType.Garbage,
            displayType: was,
            darken: GARBAGE_DARKEN,
            from: piece.transform.position.clone().setY(PICK_LAUNCH_HEIGHT),
            startScale: scale,
            endScale: scale,
            resolveTarget: out => {
                if (!this.stack?.getSlotWorldTarget(slot, was, out)) {
                    out.copy(this.transform.position).setY(this.transform.position.y + FALLBACK_CARRY_HEIGHT);
                }
            },
            onArrive: land,
        });
    }

    /** At the bin: one piece every DEPOSIT_STAGGER_SEC off the top of its back into it (gone on arrival), then back to idle. */
    private updateDepositing(delta: number): void {
        const trash = this.trash;
        if (!trash) {
            this.setState('idle');
            return;
        }
        this.faceTarget = trash.binPosition;
        this.timerSec -= delta;
        if (this.timerSec > 0) {
            return;
        }
        this.timerSec = DEPOSIT_STAGGER_SEC;

        // Only what's drawn on its back leaves (anything still flying on lands first).
        if (this.carried.length - this.incoming <= 0) {
            if (this.carried.length === 0) {
                this.setState('idle');
            }
            return;
        }
        const onTop = this.stack?.peekTop(type => type === ResourceType.Garbage, this.scratch);
        const from = onTop !== undefined
            ? this.scratch.clone()
            : this.transform.position.clone().setY(this.transform.position.y + FALLBACK_CARRY_HEIGHT);
        const was = this.carried.pop()!;
        this.stack?.markDirty();
        this.host.notifyWorkerChanged();

        const parent = this.host.getFlightParent();
        if (!parent) {
            return;
        }
        const scale = stackItemScale() * getPileScale(was);
        const bin = trash.binPosition.clone();
        flyResourceModel({
            parent,
            type: ResourceType.Garbage,
            displayType: was,
            darken: GARBAGE_DARKEN,
            from,
            startScale: scale,
            // Shrinks into the bin, like the trash's own deposits (see StorageZone's trash path).
            endScale: scale * 0.2,
            resolveTarget: out => out.copy(bin),
            onArrive: () => undefined,
        });
    }

    private walkTimedOut(delta: number): boolean {
        this.walkTimerSec += delta;
        return this.walkTimerSec >= WALK_TIMEOUT_SEC;
    }
}
