// StoreLine.ts
//
// An ordered line of waiting spots in front of something a client queues at
// (a storage or the cashier) — the store's version of QuestGiverGroup's
// queueSpacing: whoever joined first stands at spot 0 (right at `target`),
// the next one `spacing` world units behind, and so on. When someone leaves,
// everyone behind them moves up one spot, so waiting clients never overlap.

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
    private readonly firstSpot: THREE.Vector3;
    /** Unit vector pointing from spot 0 toward the back of the line. */
    private readonly direction: THREE.Vector3;
    private readonly spacing: number;
    private readonly members: T[] = [];

    /**
     * `rect` is the thing being queued at; the line starts `margin` past its edge and extends
     * along `direction` if given, otherwise toward `towardPoint` (the store's own center).
     */
    public constructor(rect: StoreRect, towardPoint: THREE.Vector3, spacing: number, margin: number, direction?: StoreSpotDirection) {
        this.target = new THREE.Vector3(rect.x, 0, rect.z);
        this.spacing = spacing;

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

    /** Where `member` should stand right now — undefined if it isn't in this line. */
    public getSpotFor(member: T, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | undefined {
        const index = this.members.indexOf(member);
        if (index === -1) {
            return undefined;
        }
        return target.copy(this.firstSpot).addScaledVector(this.direction, index * this.spacing);
    }
}
