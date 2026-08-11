// QuestGiverEntity.ts
//
// The NPC/prop that walks a queue's task in and out along a hand-drawn
// waypoint path (see WorldObjectRegistry.getWaypoints()/PizzaScene's own
// doc) — a bare-bones test entity, not an actual interactive NPC yet: picks
// one of QuestGiverConfig's candidate meshes, loads it via GlbVisualComponent,
// scale/rotation rolled once from the config's own ranges.
//
// Waypoints are sorted ascending by order (see getWaypoints()'s own doc) —
// index 0 is conventionally right next to the queue, the LAST index the
// far/off-map entrance the giver spawns at. The full cycle:
//   1. Spawn at the LAST waypoint, immediately start walking toward index 0
//      (decreasing index) — one leg at a time, never skipping a waypoint.
//   2. On reaching index 0 (right at the queue), mark presence
//      (QueueStorage.setGiverPresent(id, true) — see that method's own doc
//      for why QueueZone gates BOTH deposits and its own panel visibility on
//      this, not just on whether a task happens to exist: a task can be
//      active/persisted with no giver actually there yet, e.g. right after a
//      reload) and tell QueueStorage to start a task RIGHT NOW
//      (QueueStorage.startTaskNow() — bypasses the normal cooldown timer
//      entirely; for a giver-driven queue, ARRIVAL is what makes a task
//      available, not a clock), then stand still, waiting.
//   3. Every frame, check whether that task has been delivered
//      (QueueStorage.getState(id).activeTask undefined again). The instant
//      it has, clear presence and reverse direction, walking back out
//      (increasing index), one leg at a time.
//   4. On reaching the LAST waypoint again (fully left), "reshuffle" — tear
//      down the current mesh and pick a fresh one (pickRandom() again; a
//      no-op today since queue1 only has one candidate model, but free
//      variety once a queue's config lists more than one) — then WAITS
//      there (see `idleAtFarWaypointSec`'s own doc) before turning around
//      and walking back IN.
//
// Each leg's duration is DERIVED from the real distance between its two
// waypoints divided by QuestGiverConfig.moveSpeed (world units/sec) — not
// hand-tuned per leg — so drawing waypoints closer together or farther
// apart in Tiled just naturally speeds up or slows down that stretch of the
// walk at a constant pace. The entity's own yaw EASES toward the direction
// of travel rather than snapping (see currentYaw/targetYaw and update()),
// on top of whatever fixed rotationDeg correction the config wants for the
// model's own "forward."
//
// Spawned by PizzaScene.setupQueues() alongside a QueueZone, only when BOTH
// QuestGiverTypes.getQuestGiverConfig(id) returns something AND the map has
// at least two waypoints targeting that id — a path needs at least a start
// and an end.

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { QueueStorage } from '../data/QueueStorage';
import { getQueueConfig } from '../data/QueueTypes';
import { QuestGiverConfig } from '../data/QuestGiverTypes';
import { WaypointPlacement } from '../world/WorldObjectRegistry';
import { pickRandom, resolveRange } from '../world/AssetLibraryRegistry';

/** Floor on a single leg's tween duration — guards against a division blip (two waypoints drawn on top of each other) producing a zero/negative-duration gsap tween. */
const MIN_LEG_DURATION_SEC = 0.05;
/** How fast the entity's actual facing eases toward the direction it's walking — see currentYaw/targetYaw's own doc. Same exponential-decay shape PizzaScene's own camera follow uses. */
const ROTATION_EASE_SPEED = 8;

export default class QuestGiverEntity extends Entity {
    private readonly queueId: string;
    private readonly config: QuestGiverConfig;
    /** World positions, sorted ascending by order — index 0 is right next to the queue, the last index is the far spawn/exit point. See this file's own doc. */
    private readonly path: THREE.Vector3[];

    private visual?: GlbVisualComponent;
    /** Which way the current (or next) leg walks — 'in' decreases the path index (toward the queue), 'out' increases it (toward the exit). */
    private direction: 'in' | 'out' = 'in';
    /** The waypoint index the giver is CURRENTLY standing at — only meaningful between legs; mid-tween, `startLeg()`'s own closure tracks the in-flight from/to directly. */
    private currentIndex = 0;
    /** True only while parked at index 0 with a task active, waiting for the player to deliver it — see update()'s own doc. */
    private waitingForDelivery = false;
    /** Set true by destroy() — checked by the leg tween's onComplete and the idle-wait delayedCall so neither fires any further travel/task logic after this entity is torn down. */
    private destroyed = false;

    /**
     * How long the giver waits at the FAR waypoint before turning back around, once it's
     * fully left (see onArrivedGoingOut()) — computed once in awake() from the queue's own
     * `cooldownSec` (see QueueTypes.ts) minus the walk's own round-trip time (out + in, which
     * are identical: same path, same speed), clamped to zero. Without this, "the interval
     * between tasks is however long the walk takes" (see this file's own doc) meant a SHORT
     * path made new tasks appear almost instantly — this reintroduces a target overall pace
     * (e.g. 30s between deliveries) while still being unable to make the round trip ARRIVE any
     * faster than the path/speed actually allow (if the walk alone already exceeds
     * cooldownSec, this is just 0 — no waiting, the travel time IS the interval).
     */
    private idleAtFarWaypointSec = 0;

    /** The entity's ACTUAL current facing (radians) — eases toward `targetYaw` every frame (see update()) instead of snapping the instant a new leg starts, which read as a jarring pivot at every waypoint corner. */
    private currentYaw = 0;
    /** Set once per leg, in startLeg() — the direction of travel for whatever leg is currently playing (or about to). */
    private targetYaw = 0;

    public constructor(queueId: string, waypoints: readonly WaypointPlacement[], config: QuestGiverConfig) {
        super();
        this.queueId = queueId;
        this.config = config;
        this.path = waypoints.map(w => new THREE.Vector3(w.x, 0, w.z));
    }

    public override awake(): void {
        if (this.path.length < 2) {
            console.warn(`[QuestGiverEntity] "${this.queueId}" has fewer than 2 waypoints — a giver needs at least a start and an end, skipping`);
            return;
        }

        // One-way travel time — summing each leg's own (MIN_LEG_DURATION_SEC-floored) duration
        // rather than totalDistance/moveSpeed directly, so idleAtFarWaypointSec accounts for
        // that floor too on a path with very short legs. Walking in retraces the exact same
        // legs at the same speed, so this is the SAME duration both directions — see
        // `idleAtFarWaypointSec`'s own doc.
        let oneWaySec = 0;
        for (let i = 0; i < this.path.length - 1; i++) {
            oneWaySec += Math.max(this.path[i].distanceTo(this.path[i + 1]) / this.config.moveSpeed, MIN_LEG_DURATION_SEC);
        }
        const cooldownSec = getQueueConfig(this.queueId).cooldownSec;
        this.idleAtFarWaypointSec = Math.max(0, cooldownSec - oneWaySec * 2);

        this.currentIndex = this.path.length - 1;
        this.transform.position.copy(this.path[this.currentIndex]);
        this.spawnVisual();

        this.direction = 'in';
        this.startLeg(this.currentIndex - 1);
        // Face the first leg immediately rather than easing in from a default 0 yaw — only
        // subsequent CORNER turns should visibly ease (see this file's own doc).
        this.currentYaw = this.targetYaw;
    }

    public override update(delta: number): void {
        super.update(delta);

        // Eases the giver's actual facing toward whatever direction it's currently supposed to
        // be traveling — see currentYaw/targetYaw's own doc. Wrapped to the shortest angular
        // distance so it never spins the long way around a corner.
        let diff = this.targetYaw - this.currentYaw;
        diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        this.currentYaw += diff * (1 - Math.exp(-ROTATION_EASE_SPEED * delta));
        this.transform.rotation.y = this.currentYaw;

        // The ONE thing that can't be driven by a gsap onComplete callback — nothing calls
        // this entity when the player finishes delivering the task, so it has to poll (cheap;
        // only actually checked while genuinely parked and waiting — see `waitingForDelivery`'s
        // own doc).
        if (this.waitingForDelivery && QueueStorage.getState(this.queueId).activeTask === undefined) {
            this.waitingForDelivery = false;
            QueueStorage.setGiverPresent(this.queueId, false);
            this.direction = 'out';
            this.startLeg(this.currentIndex + 1);
        }
    }

    public override destroy(): void {
        this.destroyed = true;
        QueueStorage.setGiverPresent(this.queueId, false);
        super.destroy();
    }

    /** Builds this cycle's mesh — a fresh pickRandom() each time (see reshuffleVisual()), scale/rotation rolled once from the config's own ranges. */
    private spawnVisual(): void {
        const modelDef = pickRandom(this.config.models);
        const scale = resolveRange(this.config.scale);
        const rotationY = resolveRange(this.config.rotationDeg) * (Math.PI / 180);
        this.visual = this.addComponent(new GlbVisualComponent(modelDef, new THREE.Vector3(), scale, rotationY));
    }

    /** Tears down the just-finished cycle's mesh and builds a new one — see this file's own doc on why this happens once per full out-then-in cycle. Entity has no removeComponent(); the destroyed component is simply left in place (its own destroy() already made it inert — no mesh, no further lifecycle calls do anything) rather than compacting the array, an acceptable one-off cost for this test-scope entity. */
    private reshuffleVisual(): void {
        this.visual?.destroy();
        this.visual = undefined;
        this.spawnVisual();
    }

    /**
     * Tweens position from wherever the giver currently stands to `this.path[toIndex]` over a
     * duration derived from the real distance and `config.moveSpeed` (see this file's own
     * doc), facing the direction of travel for the whole leg (set once, not re-aimed every
     * frame, since a leg is a straight line). On arrival, either continues to the next leg in
     * the current direction, or — if this was the FINAL leg of that direction — hands off to
     * onArrivedGoingIn()/onArrivedGoingOut().
     */
    private startLeg(toIndex: number): void {
        const from = this.transform.position.clone();
        const to = this.path[toIndex];

        const distance = from.distanceTo(to);
        const duration = Math.max(distance / this.config.moveSpeed, MIN_LEG_DURATION_SEC);

        const dx = to.x - from.x;
        const dz = to.z - from.z;
        if (dx * dx + dz * dz > 1e-8) {
            // Sets the TARGET only — update() eases currentYaw toward this every frame rather
            // than snapping the model to face it instantly (see this file's own doc).
            this.targetYaw = Math.atan2(dx, dz);
        }

        const progress = { t: 0 };
        gsap.to(progress, {
            t: 1,
            duration,
            ease: 'none',
            onUpdate: () => {
                this.transform.position.lerpVectors(from, to, progress.t);
            },
            onComplete: () => {
                if (this.destroyed) {
                    return;
                }
                this.currentIndex = toIndex;
                if (this.direction === 'in') {
                    this.onArrivedGoingIn();
                } else {
                    this.onArrivedGoingOut();
                }
            },
        });
    }

    /**
     * Reached one more waypoint while walking IN — either the queue itself (index 0, see this
     * file's own doc step 2) or just another stop along the way. Presence is set BEFORE
     * startTaskNow() — QueueZone gates both deposits and its own panel visibility on presence
     * (see that file's own doc), so the task must never appear deliverable/visible even one
     * frame before the giver is actually marked as having arrived.
     */
    private onArrivedGoingIn(): void {
        if (this.currentIndex === 0) {
            QueueStorage.setGiverPresent(this.queueId, true);
            QueueStorage.startTaskNow(this.queueId, getQueueConfig(this.queueId));
            this.waitingForDelivery = true;
            return;
        }

        this.startLeg(this.currentIndex - 1);
    }

    /**
     * Reached one more waypoint while walking OUT — either the far exit (last index, see this
     * file's own doc step 4) or just another stop along the way. Reaching the far exit
     * reshuffles the mesh immediately, then waits `idleAtFarWaypointSec` (possibly zero — see
     * that field's own doc) before turning around and walking back in.
     */
    private onArrivedGoingOut(): void {
        if (this.currentIndex === this.path.length - 1) {
            this.reshuffleVisual();
            this.direction = 'in';

            if (this.idleAtFarWaypointSec <= 0) {
                this.startLeg(this.currentIndex - 1);
                return;
            }

            gsap.delayedCall(this.idleAtFarWaypointSec, () => {
                if (this.destroyed) {
                    return;
                }
                this.startLeg(this.currentIndex - 1);
            });
            return;
        }

        this.startLeg(this.currentIndex + 1);
    }
}
