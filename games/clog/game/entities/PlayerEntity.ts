import * as THREE from "three";
import { CubeBuilder } from "../builders/CubeBuilder";
import { BendService } from "../services/BendService";
import { BOUNCE_AMPLITUDE, BOUNCE_DURATION, MANUAL_BOOST_DRAIN_DURATION, MANUAL_BOOST_REENGAGE_THRESHOLD, MANUAL_BOOST_RECHARGE_DURATION, MOVE_SPEED, SMALL_VALUE_SPEED_BOOST, SMALL_VALUE_SPEED_THRESHOLD, TAP_BOOST_DURATION, TAP_BOOST_MULTIPLIER, followDist, sizeForValue } from "../ClogConstants";
import { dbg, dbgTail } from "../debug/MergeDebugger";
import { MergeQueue } from "../systems/MergeQueue";
import { WalkBob } from "../components/WalkBob"; // [view:WalkBob]
import { FloatBob } from "../components/FloatBob";
import { BlobShadow } from "./BlobShadow";
import { TailCube } from "./TailCube";
import type { ISimEntity, TailEntry } from "../sim/SimWorld";

const ROTATION_SPEED = 12;
const HISTORY_SAMPLE_DIST = 0.25; // world-units between sampled waypoints
const FOLLOW_STIFFNESS = 12; // damping coefficient; ~0.18/frame at 60fps, frame-rate independent
const MERGE_SPEED = 14;      // world-units per second for merge slide
const MIN_MERGE_TIME = 0.1;  // floor so very-close merges still have a visible pop
const SETTLE_DELAY = 0.7;

export class PlayerEntity implements ISimEntity {
    public value: number;
    public transform: THREE.Group;
    private mesh: THREE.Mesh;

    private tail: TailCube[] = [];
    private scene: THREE.Scene;
    private mergeQueue: MergeQueue;
    private eatIndicator: THREE.Mesh | null;

    private targetRotation = new THREE.Quaternion();
    private readonly UP = new THREE.Vector3(0, 1, 0);

    /** History of sampled world positions (newest first). */
    private posHistory: THREE.Vector3[] = [];
    private distSinceLastSample = 0;

    private moveInputX = 0;
    private moveInputZ = 0;
    private wasMoving = false;
    /** Counts down from TAP_BOOST_DURATION once movement starts from a standstill — see update(). */
    private tapBoostTimer = 0;
    /** Held-boost switch — see setBoosting(). */
    private manualBoostHeld = false;
    /** 0..1 — manual boost stamina. Drains while held+active, refills while not — see update(). */
    private manualBoostMeter = 1;
    /** True once the meter has fully drained while held — blocks re-engaging the boost until it refills past MANUAL_BOOST_REENGAGE_THRESHOLD, even if still held. */
    private manualBoostLocked = false;
    private bounceTimer = 0;
    private shadow: BlobShadow;
    private walkBob = new WalkBob();   // [view:WalkBob]
    private floatBob = new FloatBob();

    /** @param showEatIndicator Whether to build the forward-facing direction triangle — the player wants it visible, but NPCs render without it. */
    constructor(value: number, scene: THREE.Scene, showEatIndicator = true) {
        this.value = value;
        this.scene = scene;
        this.mergeQueue = new MergeQueue();

        this.mesh = CubeBuilder.buildPlayer(value);
        this.mesh.position.y = 0.5;

        this.transform = new THREE.Group();
        this.transform.add(this.mesh);

        if (showEatIndicator) {
            // Direction triangle — flat on the ground, apex points forward (+Z local).
            // Opaque (like the player cube) so it renders in the opaque pass and
            // stays visible — just tinted by the water — instead of being culled
            // by the water's depth write when submerged.
            const triVerts = new Float32Array([
                0, 0, 0.65,  // apex (forward)
                -0.42, 0, -0.35,  // back-left
                0.42, 0, -0.35,  // back-right
            ]);
            const triGeo = new THREE.BufferGeometry();
            triGeo.setAttribute('position', new THREE.BufferAttribute(triVerts, 3));
            triGeo.computeVertexNormals();
            const triMat = new THREE.MeshStandardMaterial({
                color: 0xffffff, side: THREE.DoubleSide,
            });
            BendService.applyBend(triMat);
            this.eatIndicator = new THREE.Mesh(triGeo, triMat);
            this.transform.add(this.eatIndicator);
        } else {
            this.eatIndicator = null;
        }

        scene.add(this.transform);
        this.updateScale();
        this.shadow = new BlobShadow(scene);
    }

    /** Hides the forward-facing direction triangle — e.g. while the player is parked on the boot menu, not yet controllable. No-op for NPCs (built without one). */
    public setEatIndicatorVisible(visible: boolean): void {
        if (this.eatIndicator) this.eatIndicator.visible = visible;
    }

    get position(): THREE.Vector3 {
        return this.transform.position;
    }

    /** World-space point just above the entity's head — anchor for floating UI that needs to track it on screen (e.g. the boost indicator). Run through BendService so the anchor lines up with where the bent mesh actually renders, not its raw (un-bent) transform position — matters most near screen corners, farthest from the bend origin. */
    get uiAnchor(): THREE.Vector3 {
        const raw = this.position.clone().add(new THREE.Vector3(0, sizeForValue(this.value) + 0.5, 0));
        return BendService.applyToPosition(raw);
    }

    /** 0..1 — fraction of the tap-start speed boost still remaining, or the manual boost meter's current level whenever it isn't sitting full (draining, locked-out, or recharging); 0 when neither is active. Drives the boost indicator's fill. */
    get boostT(): number {
        if (this.manualBoostMeter < 1) return this.manualBoostMeter;
        return this.tapBoostTimer / TAP_BOOST_DURATION;
    }

    /** Held-boost switch for the pointer-follow control scheme (see PointerFollowInput) and AI-controlled entities (see BotController) — boosted for exactly as long as it's held, with real drain/recharge via manualBoostMeter below, unlike the timed tap-start burst above. */
    setBoosting(held: boolean): void {
        this.manualBoostHeld = held;
    }

    /** Radius of the eat circle (scales with value). Used for player/NPC kills and tail-snipes. */
    get eatRadius(): number {
        return sizeForValue(this.value) * 0.8;
    }

    /** Radius for picking up loose food — a bit more forgiving than eatRadius since food can be grabbed from any side (no facing check). */
    get foodRadius(): number {
        return this.eatRadius * 1.3;
    }

    /** Physical collision radius used by AreaManager for gate/wall push-out. */
    get collisionRadius(): number {
        return sizeForValue(this.value) * 0.5;
    }

    /** Base movement speed, before the tap-start boost — flat across all values except a small edge for fresh spawns (see SMALL_VALUE_SPEED_THRESHOLD). */
    private get moveSpeed(): number {
        const boost = this.value <= SMALL_VALUE_SPEED_THRESHOLD ? SMALL_VALUE_SPEED_BOOST : 1;
        return MOVE_SPEED * boost;
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
        this.mesh.scale.setScalar(s);
        this.mesh.position.y = s * 0.5;
        if (this.eatIndicator) {
            const eatR = this.eatRadius;
            // Keep indicator above the water surface (elevation 0.45 + max wave ~0.30).
            this.eatIndicator.position.set(0, s * 0.5, s * 1.1);
            this.eatIndicator.scale.setScalar(eatR);
        }
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
        // Linearly interpolate between adjacent waypoints so the target moves
        // continuously instead of snapping every 0.25 units (Math.round caused
        // ~30Hz micro-jitter visible as subtle tail shaking).
        const rawIdx = dist / HISTORY_SAMPLE_DIST;
        const lo = Math.min(Math.floor(rawIdx), this.posHistory.length - 1);
        const hi = Math.min(lo + 1, this.posHistory.length - 1);
        if (lo === hi) return this.posHistory[lo];
        return this.posHistory[lo].clone().lerp(this.posHistory[hi], rawIdx - lo);
    }

    update(delta: number): void {
        const mx = this.moveInputX;
        const mz = this.moveInputZ;

        // ── Tap-start speed boost ────────────────────────────────────────────
        // A brief burst right when input goes from stopped to moving — makes
        // starting off feel snappier without inflating sustained cruise speed.
        // Suppressed when the movement-start coincides with an explicit manual
        // boost hold (the pointer-follow scheme's first tap does double duty as
        // both "start moving" and "start boosting" — see PointerFollowInput) so
        // the two boost systems don't run in parallel and fight over what
        // boostT should report.
        const isMoving = mx !== 0 || mz !== 0;
        if (isMoving && !this.wasMoving && !this.manualBoostHeld) this.tapBoostTimer = TAP_BOOST_DURATION;
        this.wasMoving = isMoving;
        if (this.tapBoostTimer > 0) this.tapBoostTimer = Math.max(0, this.tapBoostTimer - delta);

        // ── Manual (held) boost meter ────────────────────────────────────────
        // Stamina-style: draining while actively boosted, refilling otherwise.
        // Hitting empty locks the boost off — even if still held — until the
        // meter refills past MANUAL_BOOST_REENGAGE_THRESHOLD, so an empty
        // meter can't instantly re-trigger the next frame.
        const manualBoostActive = this.manualBoostHeld && !this.manualBoostLocked && this.manualBoostMeter > 0;
        if (manualBoostActive) {
            this.manualBoostMeter = Math.max(0, this.manualBoostMeter - delta / MANUAL_BOOST_DRAIN_DURATION);
            if (this.manualBoostMeter <= 0) this.manualBoostLocked = true;
        } else {
            this.manualBoostMeter = Math.min(1, this.manualBoostMeter + delta / MANUAL_BOOST_RECHARGE_DURATION);
            if (this.manualBoostLocked && this.manualBoostMeter >= MANUAL_BOOST_REENGAGE_THRESHOLD) this.manualBoostLocked = false;
        }

        // ── Movement ──────────────────────────────────────────────────────────
        const prevPos = this.transform.position.clone();
        const speed = this.moveSpeed * (this.tapBoostTimer > 0 || manualBoostActive ? TAP_BOOST_MULTIPLIER : 1);
        this.transform.position.x += mx * speed * delta;
        this.transform.position.z += mz * speed * delta;

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

        // ── Float + walk bob ─────────────────────────────────────────────────
        const bobY = this.walkBob.update(delta, mx !== 0 || mz !== 0);
        const floatY = this.floatBob.update(delta);
        this.mesh.position.y = this.mesh.scale.x * 0.5 + bobY + floatY;

        // ── Shadows ───────────────────────────────────────────────────────────
        this.shadow.update(this.transform.position.x, this.transform.position.z, sizeForValue(this.value));
        for (const cube of this.tail) {
            cube.update(delta);
        }

        // ── Tail snake-follow: distance-based spline positioning ──────────────
        // Each cube's slot is determined by arc-length from the player so that
        // larger cubes automatically get more spacing. Only skip cubes that are
        // actively sliding (isMerging); scheduled/locked cubes keep following.
        const followFactor = 1 - Math.exp(-FOLLOW_STIFFNESS * delta);
        for (let i = 0; i < this.tail.length; i++) {
            if (this.tail[i].isMerging) continue;
            const target = this.historyPositionAt(this.tailSlotDist(i));
            if (target) this.tail[i].position.lerp(target, followFactor);
        }

        // ── Advance merge animations ──────────────────────────────────────────
        this.mergeQueue.update(delta);

        // Catches any pair that just became eligible (a settle timer expiring
        // above, most commonly) instead of relying solely on the event-driven
        // calls elsewhere — cheap since scheduleMerges immediately bails once
        // nothing qualifies.
        this.scheduleMerges();
    }

    /** Dev-only: instantly double the player's value. */
    debugDoubleValue(): void {
        this.value *= 2;
        CubeBuilder.updateTextures(this.mesh, this.value, true);
        this.updateScale();
        this.startBounce();
    }

    /** Smallest value across the player head and all tail cubes. */
    get minTailValue(): number {
        if (this.tail.length === 0) return this.value;
        return Math.min(this.value, ...this.tail.map(c => c.value));
    }

    /** Total value: head + every tail cube combined. Used as the .io score. */
    get score(): number {
        return this.tail.reduce((sum, c) => sum + c.value, this.value);
    }

    /** ISimEntity — flat snapshot of the tail for AI queries. Weakest cube is last. */
    tailSnapshot(): TailEntry[] {
        return this.tail.map(c => ({ position: c.position, value: c.value }));
    }

    /**
     * Called when the player collides with a collectible.
     * Inserts the cube at its sorted position (descending by value) so it
     * merges with an equal neighbour instead of being discarded.
     * The cube stays at its current world position — snake-follow pulls it
     * smoothly to its tail slot over the next few frames.
     */
    collect(cube: TailCube): void {
        dbg("collect", { value: cube.value, tailLen: this.tail.length });

        const insertIdx = this.findInsertIdx(cube.value);
        this.tail.splice(insertIdx, 0, cube);
        cube.startBounce();
        // Cosmetic-only grace period before this cube is eligible to merge —
        // see TailCube.settleRemaining for why this is a per-cube timer and
        // not a mergeQueue task (that queue is one-at-a-time; collecting
        // several cubes fast used to queue that many sequential blocks).
        cube.settleRemaining = SETTLE_DELAY;
    }

    /** Returns the first tail index where tail[i].value < value (descending order). */
    private findInsertIdx(value: number): number {
        for (let i = 0; i < this.tail.length; i++) {
            if (this.tail[i].value < value) return i;
        }
        return this.tail.length;
    }

    // ── Merge logic ────────────────────────────────────────────────────────────

    /**
     * Scans for the rearmost adjacent equal-value pair in the tail
     * (or a match with the player) and queues one merge.
     * Called again after each merge completes to handle cascades.
     */
    private scheduleMerges(): void {
        dbgTail("scheduleMerges", this.value, this.tail);
        // Player merge takes priority: if the front tail cube matches or
        // exceeds the player value, absorb it first before processing
        // back-of-tail pairs. Without this, a settle delay can schedule a
        // tail merge that doubles tail[0] past the player's value,
        // permanently blocking the player from growing.
        //
        // ">=" and not "===": food can be collected with a value bigger than
        // the player's current one (e.g. a fresh level-2 player picking up
        // an 8), and findInsertIdx() correctly slots that straight into
        // tail[0] (biggest-first order) — but a strict equality check here
        // would then NEVER fire for it, since front.value (8) never equals
        // this.value (2) on its own. That cube would sit at the front of the
        // tail forever, looking exactly like the "head=2 but a huge first
        // tail piece" oddity — this is what enqueuePlayerMerge's
        // Math.max(...) below resolves: growing straight to the food's
        // value instead of only ever doubling.
        if (this.tail.length > 0) {
            const front = this.tail[0];
            if (front.value >= this.value && front.settleRemaining <= 0 && !front.isMerging && !front.isScheduled && !front.isLocked) {
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
            if (a.value === b.value && a.settleRemaining <= 0 && b.settleRemaining <= 0
                && !a.isMerging && !a.isScheduled && !a.isLocked && !b.isMerging && !b.isScheduled && !b.isLocked) {
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
                // collect() sorts new cubes in by comparing against other
                // cubes' *current* values — but `into` just doubled, so any
                // cube collected while this merge was still animating was
                // positioned relative to into's old, smaller value. Re-sort
                // to restore descending order now that it's settled; safe
                // any time since merge tasks hold direct object references,
                // not indices (bar the indexOf(from) above, already robust
                // to reordering for the same reason).
                this.tail.sort((a, b) => b.value - a.value);
                dbgTail("after tailMerge", this.value, this.tail);
                this.scheduleMerges();
            },
        });
    }

    /** Animate tail[0] sliding into the player, then grow the player's value — doubling for a same-value merge, or straight to the food's value if it was bigger than the player (see scheduleMerges' ">=" comment). */
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
                this.value = Math.max(this.value * 2, from.value);
                dbg("playerMerge.onDone", { newPlayerVal: this.value });
                CubeBuilder.updateTextures(this.mesh, this.value, true);
                this.updateScale();
                this.startBounce();
                from.destroy();
                this.tail.splice(0, 1);
                dbgTail("after playerMerge", this.value, this.tail);
                this.scheduleMerges();
            },
        });
    }

    /**
     * Detaches and returns the first tail cube within `radius` of `pos` whose
     * value is at most `maxValue` — matches the head-eats-head rule in
     * EntityEating.ts, which also allows equal values (whoever actually
     * connects wins). Cubes mid-merge are protected (skipped) so a steal
     * can't corrupt an in-flight merge animation. Re-triggers merge scanning
     * since removing a cube changes adjacency.
     */
    tryDetachTailCube(pos: THREE.Vector3, radius: number, maxValue: number): TailCube | null {
        for (let i = 0; i < this.tail.length; i++) {
            const cube = this.tail[i];
            if (cube.isMerging || cube.isScheduled || cube.isLocked) continue;
            if (cube.value > maxValue) continue;
            if (pos.distanceTo(cube.position) >= radius) continue;
            this.tail.splice(i, 1);
            this.scheduleMerges();
            return cube;
        }
        return null;
    }

    /**
     * Called when a bigger player eats this entity's head. Hands back every
     * cube this entity owned — its existing tail plus a fresh one for the
     * head's own value — for the eater to scatter as loose food, then tears
     * down everything else (mesh, shadow, merge queue).
     */
    onEaten(): TailCube[] {
        const dropped = this.tail;
        dropped.push(new TailCube(this.value, this.scene, this.position.clone()));
        this.tail = [];
        this.teardownVisuals();
        return dropped;
    }

    destroy(): void {
        for (const cube of this.tail) cube.destroy();
        this.tail = [];
        this.teardownVisuals();
    }

    private teardownVisuals(): void {
        this.shadow.destroy();
        this.mergeQueue.destroy();
        CubeBuilder.disposeMesh(this.mesh);
        if (this.eatIndicator) {
            (this.eatIndicator.material as THREE.Material).dispose();
            this.eatIndicator.geometry.dispose();
        }
        this.transform.removeFromParent();
    }
}
