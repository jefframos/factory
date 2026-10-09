// StoreLine.ts
//
// An ordered line of waiting spots in front of something a client queues at
// (a storage or the cashier) — the store's version of QuestGiverGroup's
// queueSpacing: whoever joined first stands at spot 0 (right at `target`),
// the next one `spacing` world units behind, and so on. When someone leaves,
// everyone behind them moves up one spot, so waiting clients never overlap.
//
// With a `frontSpot` (the map's "clientPoint" for that part — see StoreLayout.ts)
// the line starts exactly there and runs straight on, away from the target
// (or along the configured direction), and is always laid out straight — never
// clustered around the target (`straight`).
//
// The ORDER is all this class decides. WHERE spot N is comes from setSpots()
// (see StoreQueueSpots.ts — a straight line or a cluster around the target,
// fitted to the store's nav grid); until that's called, spots fall back to
// the plain straight line described above.

import * as THREE from 'three';
import { StoreRect } from './StoreLayout';
import { StoreSpotDirection } from './StoreTypes';

const DIRECTION_VECTORS: Record<StoreSpotDirection, THREE.Vector3> = {
    north: new THREE.Vector3(0, 0, -1),
    south: new THREE.Vector3(0, 0, 1),
    east: new THREE.Vector3(1, 0, 0),
    west: new THREE.Vector3(-1, 0, 0),
};

export default class StoreLine<T> {
    /** What the line is FOR (a storage / the cashier) — clients face it while waiting. */
    public readonly target: THREE.Vector3;
    /** Spot 0 of the plain straight line — where the front client stands (e.g. picks items). */
    public readonly firstSpot: THREE.Vector3;
    /** Unit vector pointing from spot 0 toward the back of the line. */
    public readonly direction: THREE.Vector3;
    /** Laid out as a straight line even in a 'cluster' store — set when the map gives this line its own front spot. */
    public readonly straight: boolean;
    public readonly spacing: number;
    private readonly members: T[] = [];
    /** Spot positions by queue index — see setSpots(). Empty = the straight-line fallback. */
    private spots: THREE.Vector3[] = [];

    /**
     * `rect` is the thing being queued at; the line starts `margin` past its edge and extends
     * along `direction` if given, otherwise toward `towardPoint` (the store's own center).
     */
    public constructor(rect: StoreRect, towardPoint: THREE.Vector3, spacing: number, margin: number, direction?: StoreSpotDirection, frontSpot?: { x: number; z: number }) {
        this.target = new THREE.Vector3(rect.x, 0, rect.z);
        this.spacing = spacing;
        this.straight = frontSpot !== undefined;

        if (frontSpot) {
            // Starts on the map's own point; continues away from the target unless told otherwise.
            this.firstSpot = new THREE.Vector3(frontSpot.x, 0, frontSpot.z);
            this.direction = direction
                ? DIRECTION_VECTORS[direction].clone()
                : new THREE.Vector3(frontSpot.x - rect.x, 0, frontSpot.z - rect.z);
            if (this.direction.lengthSq() < 1e-6) {
                this.direction.copy(DIRECTION_VECTORS.south);
            }
            this.direction.normalize();
            return;
        }

        if (direction) {
            this.direction = DIRECTION_VECTORS[direction].clone();
        } else {
            this.direction = new THREE.Vector3(towardPoint.x - rect.x, 0, towardPoint.z - rect.z);
            if (this.direction.lengthSq() < 1e-6) {
                this.direction.copy(DIRECTION_VECTORS.south);
            }
            this.direction.normalize();
        }

        // How far the rect reaches along `direction` from its own center.
        const extent = Math.abs(this.direction.x) * rect.width / 2 + Math.abs(this.direction.z) * rect.depth / 2;
        this.firstSpot = this.target.clone().addScaledVector(this.direction, extent + margin);
    }

    public get length(): number {
        return this.members.length;
    }

    public join(member: T): void {
        if (!this.members.includes(member)) {
            this.members.push(member);
        }
    }

    public leave(member: T): void {
        const index = this.members.indexOf(member);
        if (index !== -1) {
            this.members.splice(index, 1);
        }
    }

    public has(member: T): boolean {
        return this.members.includes(member);
    }

    public isFront(member: T): boolean {
        return this.members[0] === member;
    }

    public front(): T | undefined {
        return this.members[0];
    }

    /** Queue position (0 = front), or -1 if not in this line. */
    public indexOf(member: T): number {
        return this.members.indexOf(member);
    }

    /** Replaces where each queue index stands. Indices past the end continue straight on from the last spot. */
    public setSpots(spots: THREE.Vector3[]): void {
        this.spots = spots.map(spot => spot.clone());
    }

    /** Every spot currently laid out (debug drawing). */
    public getSpots(): readonly THREE.Vector3[] {
        return this.spots;
    }

    /** Straight-line position of queue index `index` — the fallback layout. */
    public lineSpot(index: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        return target.copy(this.firstSpot).addScaledVector(this.direction, index * this.spacing);
    }

    /** Where `member` should stand right now — undefined if it isn't in this line. */
    public getSpotFor(member: T, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | undefined {
        const index = this.members.indexOf(member);
        if (index === -1) {
            return undefined;
        }
        if (this.spots.length === 0) {
            return this.lineSpot(index, target);
        }
        if (index < this.spots.length) {
            return target.copy(this.spots[index]);
        }
        return target.copy(this.spots[this.spots.length - 1]).addScaledVector(this.direction, (index - this.spots.length + 1) * this.spacing);
    }
}
