import * as THREE from "three";
import { CubeBuilder } from "../builders/CubeBuilder";
import { BOUNCE_AMPLITUDE, BOUNCE_DURATION, followDist, sizeForValue } from "../ClogConstants";
import { dbg, dbgTail } from "../debug/MergeDebugger";
import { MergeQueue } from "../systems/MergeQueue";
import { TailCube } from "./TailCube";

const MOVE_SPEED = 8;
const ROTATION_SPEED = 12;
const HISTORY_SAMPLE_DIST = 0.25; // world-units between sampled waypoints
const FOLLOW_LERP = 0.18;
const MERGE_SPEED = 14;      // world-units per second for merge slide
const MIN_MERGE_TIME = 0.1;  // floor so very-close merges still have a visible pop
const SETTLE_DELAY = 0.7;

export class PlayerEntity {
    public value: number;
    public transform: THREE.Group;
    private mesh: THREE.Mesh;

    private tail: TailCube[] = [];
    private scene: THREE.Scene;
    private mergeQueue: MergeQueue;
    private eatIndicator: THREE.Mesh;

    private targetRotation = new THREE.Quaternion();
    private readonly UP = new THREE.Vector3(0, 1, 0);

    /** History of sampled world positions (newest first). */
    private posHistory: THREE.Vector3[] = [];
    private distSinceLastSample = 0;

    private moveInputX = 0;
    private moveInputZ = 0;
    private bounceTimer = 0;

    constructor(value: number, scene: THREE.Scene) {
        this.value = value;
        this.scene = scene;
        this.mergeQueue = new MergeQueue();

        this.mesh = CubeBuilder.buildPlayer(value);
        this.mesh.position.y = 0.5;

        this.transform = new THREE.Group();
        this.transform.add(this.mesh);

        // Eat-area indicator ring (lies flat in front of the cube)
        const ringGeo = new THREE.RingGeometry(0.8, 1.0, 40);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.35,
            side: THREE.DoubleSide, depthWrite: false,
        });
        this.eatIndicator = new THREE.Mesh(ringGeo, ringMat);
        this.eatIndicator.rotation.x = -Math.PI / 2;
        this.transform.add(this.eatIndicator);

        scene.add(this.transform);
        this.updateScale();
    }

    get position(): THREE.Vector3 {
        return this.transform.position;
    }

    /** Radius of the eat circle (scales with value). */
    get eatRadius(): number {
        return sizeForValue(this.value) * 0.8;
    }

    /** World-space center of the eat circle (in front of the cube face). */
    get eatPosition(): THREE.Vector3 {
        const s = sizeForValue(this.value);
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.transform.quaternion);
        return this.transform.position.clone().add(fwd.multiplyScalar(s * 1.1));
    }

    /** Rescales the player mesh and eat indicator to match the current value. */
    private updateScale(): void {
        const s = sizeForValue(this.value);
        const eatR = this.eatRadius;
        this.mesh.scale.setScalar(s);
        this.mesh.position.y = s * 0.5;
        this.eatIndicator.position.set(0, 0.05, s * 1.1);
        this.eatIndicator.scale.setScalar(eatR);
    }

    private startBounce(): void {
        this.bounceTimer = BOUNCE_DURATION;
    }

    setMoveInput(x: number, z: number): void {
        this.moveInputX = x;
        this.moveInputZ = z;
    }

    /**
     * Total arc-length distance along the spline to the center of tail[i],
     * measured from the player center. Used by snake-follow and collect().
     */
    private tailSlotDist(idx: number): number {
        let d = 0;
        for (let i = 0; i <= idx; i++) {
            const prevVal = i === 0 ? this.value : this.tail[i - 1].value;
            d += followDist(prevVal, this.tail[i].value);
        }
        return d;
    }

    /** Position on the history spline at arc-length `dist` from the player. */
    private historyPositionAt(dist: number): THREE.Vector3 | null {
        if (this.posHistory.length === 0) return null;
        // Clamp to the oldest available waypoint rather than returning null.
        // Without this, cubes freeze when their slot index grows beyond history
        // length after a merge doubles their value (and their required spacing).
        const idx = Math.min(Math.round(dist / HISTORY_SAMPLE_DIST), this.posHistory.length - 1);
        return this.posHistory[idx];
    }

    update(delta: number): void {
        const mx = this.moveInputX;
        const mz = this.moveInputZ;

        // ── Movement ──────────────────────────────────────────────────────────
        const prevPos = this.transform.position.clone();
        this.transform.position.x += mx * MOVE_SPEED * delta;
        this.transform.position.z += mz * MOVE_SPEED * delta;

        // ── Position history (waypoints for tail snake-following) ─────────────
        const moved = this.transform.position.distanceTo(prevPos);
        this.distSinceLastSample += moved;
        if (this.distSinceLastSample >= HISTORY_SAMPLE_DIST) {
            this.posHistory.unshift(this.transform.position.clone());
            this.distSinceLastSample = 0;
            // Keep enough history to cover the full tail plus a generous buffer.
            // Minimum 200 slots (50 world-units) so a cube that just doubled in
            // value and needs more spacing always has a valid history slot.
            const maxDist = this.tail.length > 0
                ? this.tailSlotDist(this.tail.length - 1) + 8
                : 8;
            const maxSlots = Math.max(200, Math.ceil(maxDist / HISTORY_SAMPLE_DIST));
            if (this.posHistory.length > maxSlots) this.posHistory.length = maxSlots;
        }

        // ── Smooth rotation toward movement direction ─────────────────────────
        if (mx !== 0 || mz !== 0) {
            this.targetRotation.setFromAxisAngle(this.UP, Math.atan2(mx, mz));
        }
        this.transform.quaternion.slerp(this.targetRotation, Math.min(1, ROTATION_SPEED * delta));

        // ── Scale bounce after a player merge ────────────────────────────────
        if (this.bounceTimer > 0) {
            this.bounceTimer = Math.max(0, this.bounceTimer - delta);
            const t = 1 - this.bounceTimer / BOUNCE_DURATION;
            const punch = 1 + BOUNCE_AMPLITUDE * Math.sin(t * Math.PI);
            const s = sizeForValue(this.value) * punch;
            this.mesh.scale.setScalar(s);
            this.mesh.position.y = s * 0.5;
        }

        // ── Drive tail cube bounce animations ────────────────────────────────
        for (const cube of this.tail) {
            cube.update(delta);
        }

        // ── Tail snake-follow: distance-based spline positioning ──────────────
        // Each cube's slot is determined by arc-length from the player so that
        // larger cubes automatically get more spacing. Only skip cubes that are
        // actively sliding (isMerging); locked-but-stationary cubes keep following.
        for (let i = 0; i < this.tail.length; i++) {
            if (this.tail[i].isMerging) continue;
            const target = this.historyPositionAt(this.tailSlotDist(i));
            if (target) this.tail[i].position.lerp(target, FOLLOW_LERP);
        }

        // ── Advance merge animations ──────────────────────────────────────────
        this.mergeQueue.update(delta);
    }

    /**
     * Called when the player collides with a collectible.
     * Appends the cube to the tail and schedules new merges without
     * interrupting any merge animations already in progress.
     */
    collect(cube: TailCube): void {
        dbg("collect", { value: cube.value, tailLen: this.tail.length });
        // Place the new cube at its eventual spline position so it doesn't
        // teleport; if history is too short yet, fall back to the tail end.
        const newIdx = this.tail.length;
        const newDist = newIdx === 0
            ? followDist(this.value, cube.value)
            : this.tailSlotDist(newIdx - 1) + followDist(this.tail[newIdx - 1].value, cube.value);
        const anchor = this.historyPositionAt(newDist)
            ?? (this.tail.length > 0
                ? this.tail[this.tail.length - 1].position.clone()
                : this.transform.position.clone());
        cube.transform.position.copy(anchor);

        this.tail.push(cube);

        // Let the cube travel to its spline slot before merging starts
        this.mergeQueue.enqueue({
            duration: SETTLE_DELAY,
            onProgress: () => { /* just wait */ },
            onDone: () => this.scheduleMerges(),
        });
    }

    // ── Merge logic ────────────────────────────────────────────────────────────

    /**
     * Scans for the rearmost adjacent equal-value pair in the tail
     * (or a match with the player) and queues one merge.
     * Called again after each merge completes to handle cascades.
     */
    private scheduleMerges(): void {
        dbgTail("scheduleMerges", this.value, this.tail);
        // Player merge takes priority: if the front tail cube matches the player
        // value, absorb it first before processing back-of-tail pairs. Without
        // this, a settle delay can schedule a tail merge that doubles tail[0]
        // past the player's value, permanently blocking the player from growing.
        if (this.tail.length > 0) {
            const front = this.tail[0];
            if (front.value === this.value && !front.isMerging && !front.isScheduled && !front.isLocked) {
                dbg("→ playerMerge", { playerVal: this.value, frontVal: this.tail[0].value });
                this.enqueuePlayerMerge();
                return;
            }
        }

        // Scan front-to-back so the pair closest to the player merges first.
        // Back-to-front scan lets far-back chains cascade and create large values
        // that sandwich smaller cubes with no equal neighbour (permanent orphan).
        for (let i = 0; i < this.tail.length - 1; i++) {
            const a = this.tail[i];     // closer to player
            const b = this.tail[i + 1]; // farther from player
            if (a.value === b.value && !a.isMerging && !a.isScheduled && !a.isLocked && !b.isMerging && !b.isScheduled && !b.isLocked) {
                // b slides into a (back cube slides toward player)
                dbg("→ tailMerge", { from: i + 1, into: i, val: a.value });
                this.enqueueTailMerge(i + 1, i);
                return;
            }
        }
    }

    /** Animate tail[fromIdx] sliding into tail[intoIdx], then double intoIdx's value. */
    private enqueueTailMerge(fromIdx: number, intoIdx: number): void {
        const from = this.tail[fromIdx];
        const into = this.tail[intoIdx];

        // Mark at enqueue time to block re-scheduling, but don't stop snake-follow yet.
        // isMerging (which stops snake-follow) is set in onStart when animation actually begins.
        from.isScheduled = true;
        into.isLocked = true;

        // Positions captured in onStart so the cube keeps following the spline
        // until its animation turn arrives (no frozen-in-place waiting).
        const anim = { startPos: new THREE.Vector3(), targetPos: new THREE.Vector3() };

        this.mergeQueue.enqueue({
            duration: MIN_MERGE_TIME, // overwritten in onStart with real distance
            onStart: (task) => {
                anim.startPos.copy(from.position);
                anim.targetPos.copy(into.position);
                task.duration = Math.max(MIN_MERGE_TIME, anim.startPos.distanceTo(anim.targetPos) / MERGE_SPEED);
                from.isMerging = true;
                from.isScheduled = false;
            },
            onProgress: (t) => {
                from.position.lerpVectors(anim.startPos, anim.targetPos, t);
            },
            onDone: () => {
                // Re-derive the index at execution time: a player-merge that ran
                // earlier may have shifted all indices down via splice(0,1).
                const currentIdx = this.tail.indexOf(from);
                if (currentIdx === -1) {
                    dbg("tailMerge.onDone.skip", { reason: "from not in tail (stolen?)", intoVal: into.value });
                    into.isLocked = false;
                    this.scheduleMerges();
                    return;
                }
                const newVal = into.value * 2;
                dbg("tailMerge.onDone", { intoIdx: currentIdx - 1, fromIdx: currentIdx, newVal });
                into.isLocked = false;
                into.setValue(newVal);
                into.startBounce();
                from.destroy();
                this.tail.splice(currentIdx, 1);
                dbgTail("after tailMerge", this.value, this.tail);
                this.scheduleMerges();
            },
        });
    }

    /** Animate tail[0] sliding into the player, then double the player's value. */
    private enqueuePlayerMerge(): void {
        const from = this.tail[0];
        from.isScheduled = true;

        let startPos = new THREE.Vector3();

        this.mergeQueue.enqueue({
            duration: MIN_MERGE_TIME, // overwritten in onStart
            onStart: (task) => {
                startPos = from.position.clone();
                task.duration = Math.max(MIN_MERGE_TIME, startPos.distanceTo(this.transform.position) / MERGE_SPEED);
                from.isMerging = true;
                from.isScheduled = false;
            },
            onProgress: (t) => {
                // Player position is live intentionally: the cube should always
                // arrive exactly at the player center even if they're moving.
                from.position.lerpVectors(startPos, this.transform.position, t);
            },
            onDone: () => {
                this.value *= 2;
                dbg("playerMerge.onDone", { newPlayerVal: this.value });
                CubeBuilder.updateTextures(this.mesh, this.value);
                this.updateScale();
                this.startBounce();
                from.destroy();
                this.tail.splice(0, 1);
                dbgTail("after playerMerge", this.value, this.tail);
                this.scheduleMerges();
            },
        });
    }

    destroy(): void {
        this.mergeQueue.destroy();
        for (const cube of this.tail) cube.destroy();
        this.tail = [];
        CubeBuilder.disposeMesh(this.mesh);
        (this.eatIndicator.material as THREE.Material).dispose();
        this.eatIndicator.geometry.dispose();
        this.transform.removeFromParent();
    }
}
