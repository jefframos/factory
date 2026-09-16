// QuestGiverEntity.ts
//
// The NPC/prop that walks a queue's task in and out along a hand-drawn
// waypoint path (see WorldObjectRegistry.getWaypoints()/PizzaScene's own
// doc) — picks one of QuestGiverConfig's VARIANTS (see QuestGiverTypes.ts's
// own doc: EITHER a static look via EntityViewRegistry, loaded as a
// GlbVisualComponent, OR an NpcTypes.ts id, loaded as an animated
// CharacterBody rig instead — see spawnVisual()/spawnNpcVisual()) plus a
// LootTableRegistry id.
//
// Waypoints are sorted ascending by order (see getWaypoints()'s own doc).
// Order 0 is ALWAYS the queue's own stop — the point a giver actually
// parks at to serve the task. Positive orders (1, 2, 3, ...) form the ENTRY
// path, ascending away from the queue to the far spawn point. NEGATIVE
// orders (-1, -2, -3, ...), if a level designer drew any, form a SEPARATE
// EXIT path — see `exitPath`'s own doc for why a giver takes that route
// out (and despawns) instead of reversing back out through the entry path.
//
// Movement is tracked as a single scalar ARC LENGTH along whichever path is
// currently active (see getCurrentArc()) — 0 sits exactly at the queue,
// increasing away from it — rather than "which waypoint index am I at":
// that's what lets a queued (non-front) giver come to rest at an arbitrary
// INTERPOLATED point between two waypoints (see QuestGiverGroup.
// getMinAllowedArc()/pointAtArcLength() below), not just at one of the
// path's own drawn stops. The full cycle:
//   1. Spawn at the entry path's far waypoint (arc = entryPath.totalLength),
//      immediately start walking toward the queue (arc decreasing).
//   2. On reaching arc 0 (right at the queue), mark presence
//      (QueueStorage.setGiverPresent(id, true) — see that method's own doc
//      for why QueueZone gates BOTH deposits and its own panel visibility on
//      this, not just on whether a task happens to exist: a task can be
//      active/persisted with no giver actually there yet, e.g. right after a
//      reload) and tell QueueStorage to start a task RIGHT NOW, drawn from
//      THIS CYCLE'S variant's own loot table (QueueStorage.startTaskNow() —
//      bypasses the normal cooldown timer entirely; for a giver-driven
//      queue, ARRIVAL is what makes a task available, not a clock), then
//      stand still, waiting.
//   3. Every frame, check whether that task has been delivered
//      (QueueStorage.getState(id).activeTask undefined again). The instant
//      it has, clear presence, and:
//        - if an exit path exists, switch to walking IT instead (see
//          `usingExitPath`) — arc resets to 0 in the exit path's own frame
//          (same physical point, the queue, as entry-arc 0), climbing
//          toward exitPath.totalLength. On reaching it, this giver
//          DESPAWNS — see QuestGiverGroup.update(), which notices via
//          isFinished() and removes/replaces it.
//        - otherwise (no exit path drawn), reverse back out through the
//          ENTRY path instead (arc increasing again) — the original,
//          reused-forever behavior described in step 4 below.
//   4. (No exit path only.) On reaching the entry path's far waypoint again
//      (arc = entryPath.totalLength), "reshuffle" — tear down the current
//      visual and roll a fresh variant (see spawnVisual()/
//      rollQuestGiverVariant()) — then WAITS there (see
//      `idleAtFarWaypointSec`'s own doc) before turning around and walking
//      back IN, reusing this same instance forever.
//
// Ground speed is always QuestGiverConfig.moveSpeed (world units/sec) —
// arc moves toward its current target at that rate every frame (see
// update()), so drawing waypoints closer together or farther apart in
// Tiled just naturally speeds up or slows down how quickly that stretch of
// the walk passes, at a constant pace throughout. For a static-`view`
// variant, the entity's own yaw EASES toward the direction of travel rather
// than snapping (see currentYaw/targetYaw and update()), on top of whatever
// fixed rotation correction the current variant's own EntityViewRegistry
// entry wants for the model's own "forward." For an `npc` variant,
// facing/rotation instead comes from CharacterBody's own moveInput-driven
// slerp (see update()) — currentYaw/targetYaw only feed IT a direction,
// nothing eases on top.
//
// Spawned by PizzaScene.setupQueues() alongside a QueueZone, only when BOTH
// QuestGiverTypes.getQuestGiverConfig(id) returns something AND the map has
// at least two waypoints targeting that id — a path needs at least a start
// and an end.
//
// Never spawned directly by the scene any more — QuestGiverGroup.ts owns
// that (see its own doc on QuestGiverConfig.maxEntities), so 1+ of these can
// walk the SAME path at once, single-file. `group` (this file's own
// constructor param) is how each instance asks "how far may I advance yet"
// (see update()'s own desiredArc calculation) — a maxEntities<=1 queue's
// single giver always gets "all the way to the queue," making that case
// identical to before QuestGiverGroup existed.

import * as THREE from 'three';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import GlbVisualComponent from '../components/GlbVisualComponent';
import CharacterBody from '../entities/CharacterBody';
import { QueueStorage } from '../data/QueueStorage';
import { getQueueConfig } from '../data/QueueTypes';
import { QuestGiverConfig, QuestGiverVariant, rollQuestGiverVariant } from '../data/QuestGiverTypes';
import { getLootTable } from '../data/LootTableTypes';
import { getNpcConfig } from '../data/NpcTypes';
import { loadNpcBody } from '../world/NpcBodyLoader';
import NpcLookAtSensor from '../world/NpcLookAtSensor';
import { WaypointPlacement } from '../world/WorldObjectRegistry';
import { resolveEntityView } from '../world/EntityViewRegistry';
import type QuestGiverGroup from './QuestGiverGroup';

/**
 * The analog-stick-style magnitude fed to npcBody.update() while actually moving (see
 * update()'s own dirX/dirZ) — deliberately NOT 1.0 (a full-magnitude unit vector):
 * CharacterBody's default idle->walk transition only fires while speed is BELOW walkToRunSpeed
 * (0.75 — see CharacterBody.setUp()'s own doc), and there is no idle->run transition at all, so
 * a full-1.0 jump straight from 'idle' matches neither condition and gets stuck in 'idle'
 * forever regardless of movement. Comfortably inside the walk band (above idleToWalkSpeed,
 * below walkToRunSpeed) so the giver always plays its walking gait while traveling at its own
 * configured moveSpeed, never running.
 */
const NPC_MOVE_INPUT_MAGNITUDE = 0.5;
/** How fast the entity's actual facing eases toward the direction it's walking — see currentYaw/targetYaw's own doc. Same exponential-decay shape PizzaScene's own camera follow uses. */
const ROTATION_EASE_SPEED = 8;
/** Arc-length slop below which "am I basically at the queue / at the end of this path" counts as arrived — real float movement toward a clamped target settles asymptotically close but rarely exactly on it. */
const ARRIVAL_EPSILON = 0.01;

/** A single walkable polyline plus its own precomputed arc-length bookkeeping — see buildWalkablePath()/pointAtArcLength(). Both `entryPath` and `exitPath` are one of these; kept as a plain data shape (not a class) since neither ever mutates after construction. */
interface WalkablePath {
    /** World positions, in walking order — index 0 is always the queue's own stop (order 0). */
    points: THREE.Vector3[];
    /** Cumulative arc length from points[0] to points[i], parallel to `points` — cumulativeDistance[0] is always 0. */
    cumulativeDistance: number[];
    /** Total path length (cumulativeDistance's last entry) — the arc value of the far end. */
    totalLength: number;
}

/** Builds a WalkablePath from `points` (already in walking order, index 0 = the queue). */
function buildWalkablePath(points: THREE.Vector3[]): WalkablePath {
    const cumulativeDistance = [0];
    for (let i = 0; i < points.length - 1; i++) {
        cumulativeDistance.push(cumulativeDistance[i] + points[i].distanceTo(points[i + 1]));
    }
    return { points, cumulativeDistance, totalLength: cumulativeDistance[cumulativeDistance.length - 1] ?? 0 };
}

/** World position at `arc` world units along `path` from its own points[0] — clamped to [0, path.totalLength]. This is what actually lets a queued giver stop anywhere BETWEEN two drawn waypoints (see QuestGiverGroup.getMinAllowedArc()), not just at one of them. */
function pointAtArcLength(path: WalkablePath, arc: number): THREE.Vector3 {
    const clamped = Math.max(0, Math.min(path.totalLength, arc));
    for (let i = 0; i < path.cumulativeDistance.length - 1; i++) {
        const segStart = path.cumulativeDistance[i];
        const segEnd = path.cumulativeDistance[i + 1];
        if (clamped <= segEnd || i === path.cumulativeDistance.length - 2) {
            const segLen = segEnd - segStart;
            const t = segLen > 1e-8 ? (clamped - segStart) / segLen : 0;
            return new THREE.Vector3().lerpVectors(path.points[i], path.points[i + 1], t);
        }
    }
    return path.points[0]?.clone() ?? new THREE.Vector3();
}

export default class QuestGiverEntity extends Entity {
    private readonly queueId: string;
    private readonly config: QuestGiverConfig;
    /** Order >= 0 waypoints, ascending — points[0] is the queue's own stop (order 0), the last point is the far spawn/entry waypoint. Every giver spawns here and walks this path in on every approach. */
    private readonly entryPath: WalkablePath;
    /**
     * Order <= 0 waypoints, re-ordered so points[0] is STILL the queue's own stop and the path
     * walks OUTWARD through increasingly negative orders to the far exit point — undefined
     * unless a level designer actually drew at least one negative-order waypoint for this
     * queue's own target id (see this file's own top doc). When present, a giver takes THIS
     * route out after delivering (instead of reversing back through entryPath) and despawns on
     * reaching its far end — see `usingExitPath`/update()'s own doc.
     */
    private readonly exitPath?: WalkablePath;
    /** Owning QuestGiverGroup (see that file's own doc) — even a maxEntities<=1 queue always has one, tracking this single giver alone; its getMinAllowedArc() then always returns 0 (nothing else to rank against), which is what keeps that case identical to before QuestGiverGroup existed. */
    private readonly group: QuestGiverGroup;

    private visual?: GlbVisualComponent;
    /** Set instead of `visual` when the current cycle's variant sets `npc` rather than `view` (see QuestGiverTypes.ts's own doc) — an animated CharacterBody rig walking the exact same path/state-machine below, rather than a static glb. Mutually exclusive with `visual`; update()/reshuffleVisual()/destroy() all branch on which one is actually set. */
    private npcBody?: CharacterBody;
    /** Built once `npcBody`'s rig has loaded, when its NpcConfig actually wants a cone of view — see NpcLookAtSensor.tryBuild()'s own doc. Undefined for a static-`visual` cycle, or before that load resolves, or a config with no viewRadius/viewAngleDeg. Cleared alongside `npcBody` in reshuffleVisual(). */
    private lookAtSensor?: NpcLookAtSensor;
    /** A live getter (not a snapshot) — same convention as NpcEntity's own getPlayerPosition, used ONLY by lookAtSensor (a static-`visual` cycle never reads this). */
    private readonly getPlayerPosition: () => THREE.Vector3;
    /** Whichever variant is currently walking this cycle (see spawnVisual()) — undefined only ever momentarily. onArrivedAtQueue() reads this variant's own LootTableRegistry entry (via getLootTable()), not the queue's. */
    private currentVariant?: QuestGiverVariant;
    /** Which way this giver is currently headed on whichever path is active — 'in' means arc should decrease (toward the queue, subject to QuestGiverGroup's own spacing gate, entryPath only), 'out' means arc should increase (away from the queue, ungated — either back out through entryPath, or, once `usingExitPath` is set, out through exitPath toward despawn). */
    private direction: 'in' | 'out' = 'in';
    /** This giver's current position, as an arc length from queue-arc-0 along WHICHEVER path is currently active (entryPath normally, exitPath once `usingExitPath`) — 0 at the queue, increasing away from it. The one piece of state update() actually moves; `transform.position` is always just pointAtArcLength(activePath, this.currentArc). */
    private currentArc = 0;
    /** True only while parked at the queue with a task active, waiting for the player to deliver it — see update()'s own doc. */
    private waitingForDelivery = false;
    /** Set true the instant a delivered task sends this giver out through `exitPath` instead of reversing back through entryPath (see update()'s own doc) — from that point on this giver is making a ONE-WAY trip to despawn, never re-entering. Always false (and irrelevant) when `exitPath` doesn't exist. */
    private usingExitPath = false;
    /** Set once this giver has reached the far end of `exitPath` — see isFinished()'s own doc. QuestGiverGroup.update() polls this to know when to actually remove/replace this instance. */
    private reachedDespawnPoint = false;
    /** Guards onArrivedAtFarWaypoint() from re-firing every frame while parked at entryPath's far waypoint (arc stays clamped there for the whole idleAtFarWaypointSec wait) — reset false the instant direction flips back to 'out' after a delivery. Only meaningful when `exitPath` doesn't exist (see update()'s own doc). */
    private hasReshuffledThisExit = false;
    /** Set true by destroy() — checked by the idle-wait delayedCall so it never fires any further travel/task logic after this entity is torn down. */
    private destroyed = false;

    /**
     * How long the giver waits at entryPath's own far waypoint before turning back around, once
     * it's fully left (see onArrivedAtFarWaypoint()) — computed once in awake() from the queue's
     * own `cooldownSec` (see QueueTypes.ts) minus the walk's own round-trip time (out + in, which
     * are identical: same path, same speed), clamped to zero. Without this, "the interval
     * between tasks is however long the walk takes" (see this file's own doc) meant a SHORT
     * path made new tasks appear almost instantly — this reintroduces a target overall pace
     * (e.g. 30s between deliveries) while still being unable to make the round trip ARRIVE any
     * faster than the path/speed actually allow (if the walk alone already exceeds
     * cooldownSec, this is just 0 — no waiting, the travel time IS the interval). Only ever
     * consulted when `exitPath` doesn't exist — a despawning giver never loops back around.
     */
    private idleAtFarWaypointSec = 0;

    /** The entity's ACTUAL current facing (radians) — eases toward `targetYaw` every frame (see update()) instead of snapping, which read as a jarring pivot at every waypoint corner. Only actually applied to `transform.rotation.y` for the static-`visual` case — an `npcBody` faces on its own (see update()). */
    private currentYaw = 0;
    /** Recomputed every frame this giver actually moves (see update()) — the direction of travel THIS frame. Also what update() derives npcBody's own moveInput direction from while `isMoving`. */
    private targetYaw = 0;
    /** True for whatever frame this giver's arc actually changed (i.e. it's not sitting exactly at its current target) — drives npcBody's moveInput direction (see update()): non-zero while genuinely moving so CharacterBody's own animator board walks/faces the direction of travel, zero the instant it settles (waiting at the queue for delivery, queued up behind another giver, waiting at the far waypoint) so it settles back to 'idle'. Irrelevant for the static-`visual` case. */
    private isMoving = false;
    /**
     * The queue's own world position (its collider/panel anchor, NOT entryPath.points[0]) —
     * used ONLY to fix this giver's facing while genuinely parked at the queue (see update()'s
     * own override), rather than relying purely on whatever direction the final approach leg's
     * geometry happened to leave `targetYaw` at. A waypoint drawn a little off the collider's
     * own center (easy to do by eye in Tiled) used to leave the giver visibly facing a bit
     * askew from the thing it's actually serving — this is the fix for that.
     */
    private readonly queuePosition: THREE.Vector3;
    /**
     * Set once at construction — see QuestGiverGroup.awake()'s own doc on `stoppedCount`. A
     * real number means "spawn directly at this arc-length position on the ENTRY path, skipping
     * the normal far-waypoint spawn + walk-in" — 0 is the queue itself (the front slot), a
     * multiple of `queueSpacing` is a queued-behind slot. Undefined means the normal spawn.
     * Whichever giver resumes at arc 0 additionally checks QueueStorage's own (persisted)
     * presence + active task in awake() to decide whether it should ALSO come back already
     * `waitingForDelivery`, rather than the group having to track/pass that separately.
     */
    private readonly resumeArc?: number;

    public constructor(
        queueId: string,
        waypoints: readonly WaypointPlacement[],
        config: QuestGiverConfig,
        queuePosition: THREE.Vector3,
        getPlayerPosition: () => THREE.Vector3,
        group: QuestGiverGroup,
        resumeArc?: number,
    ) {
        super();
        this.queueId = queueId;
        this.config = config;
        this.queuePosition = queuePosition;
        this.getPlayerPosition = getPlayerPosition;
        this.group = group;
        this.resumeArc = resumeArc;

        // waypoints is already sorted ascending by order (see WorldObjectRegistry.getWaypoints()'s
        // own doc) — find exactly where order 0 (the queue's own stop) sits. Anything BEFORE that
        // in the sorted list carries a NEGATIVE order and belongs to the exit path, not the entry
        // one — see this file's own top doc.
        const allPoints = waypoints.map(w => new THREE.Vector3(w.x, 0, w.z));
        let queueIdx = waypoints.findIndex(w => w.order === 0);
        if (queueIdx === -1) {
            // No explicit order-0 waypoint drawn — same fallback every path used before exit
            // waypoints existed at all: treat the lowest-order (array index 0) waypoint as the
            // queue's own stop.
            queueIdx = 0;
        }

        this.entryPath = buildWalkablePath(allPoints.slice(queueIdx));
        const exitPoints = allPoints.slice(0, queueIdx + 1).reverse();
        this.exitPath = exitPoints.length >= 2 ? buildWalkablePath(exitPoints) : undefined;
    }

    public override awake(): void {
        if (this.entryPath.points.length < 2) {
            console.warn(`[QuestGiverEntity] "${this.queueId}" has fewer than 2 entry waypoints — a giver needs at least a start and an end, skipping`);
            return;
        }

        const oneWaySec = this.entryPath.totalLength / this.config.moveSpeed;
        const cooldownSec = getQueueConfig(this.queueId).cooldownSec;
        this.idleAtFarWaypointSec = Math.max(0, cooldownSec - oneWaySec * 2);

        if (this.resumeArc !== undefined) {
            // Spawn directly at a resumed arc-length position — see `resumeArc`'s own doc.
            // Skips the normal far-waypoint spawn + walk-in entirely; a queued (non-zero arc)
            // resume just sits there exactly like a freshly-caught-up follower would, and
            // continues advancing normally (through the usual group-gated update() logic) once
            // whatever's ahead of it moves on.
            this.currentArc = Math.max(0, Math.min(this.entryPath.totalLength, this.resumeArc));
            this.transform.position.copy(pointAtArcLength(this.entryPath, this.currentArc));

            // Only the FRONT slot (arc 0) can legitimately resume already `waitingForDelivery` —
            // and only if QueueStorage's own (persisted) presence + an active task both survived
            // the reload too (never re-rolls a task; the persisted one is already active). A
            // queued-behind resume just waits its turn normally.
            if (this.currentArc <= ARRIVAL_EPSILON
                && QueueStorage.isGiverPresent(this.queueId)
                && QueueStorage.getState(this.queueId).activeTask !== undefined) {
                this.waitingForDelivery = true;
            }

            // Face generally toward the queue (the direction the entry path continues in from
            // here) rather than an arbitrary default — same "don't ease in from a bogus 0 yaw"
            // reasoning as the far-spawn branch below, just probed from a resumed midpoint
            // instead of the path's own last leg. update()'s own facing override (see its own
            // doc) takes over precisely once this giver is actually parked at the queue itself.
            const facingProbe = pointAtArcLength(this.entryPath, Math.max(0, this.currentArc - 1));
            const fdx = facingProbe.x - this.transform.position.x;
            const fdz = facingProbe.z - this.transform.position.z;
            if (fdx * fdx + fdz * fdz > 1e-8) {
                this.targetYaw = Math.atan2(fdx, fdz);
            }
            this.currentYaw = this.targetYaw;
        } else {
            this.currentArc = this.entryPath.totalLength;
            this.transform.position.copy(this.entryPath.points[this.entryPath.points.length - 1]);

            // Face the first leg immediately rather than easing in from a default 0 yaw — only
            // subsequent CORNER turns should visibly ease (see this file's own doc).
            const last = this.entryPath.points.length - 1;
            const dx = this.entryPath.points[last - 1].x - this.entryPath.points[last].x;
            const dz = this.entryPath.points[last - 1].z - this.entryPath.points[last].z;
            if (dx * dx + dz * dz > 1e-8) {
                this.targetYaw = Math.atan2(dx, dz);
            }
            this.currentYaw = this.targetYaw;
        }

        this.spawnVisual();
        this.direction = 'in';
    }

    public override update(delta: number): void {
        super.update(delta);

        const activePath = this.usingExitPath && this.exitPath ? this.exitPath : this.entryPath;

        // The one thing every frame actually has to decide: where is this giver TRYING to be
        // right now. Once `usingExitPath`, it's always heading to exitPath's own far end,
        // ungated (nobody follows a despawning giver — see this file's own top doc). Otherwise,
        // walking out (back through entryPath) is unconstrained; walking in is clamped to
        // whatever QuestGiverGroup currently allows (0 if nothing's ahead of this giver, or
        // `queueSpacing` past whoever is — see that method's own doc). Recomputed fresh every
        // frame rather than once per "leg" — there's no discrete leg any more, just a moving
        // target this giver's own arc continuously chases at config.moveSpeed.
        const desiredArc = this.usingExitPath
            ? activePath.totalLength
            : (this.direction === 'in' ? Math.max(0, this.group.getMinAllowedArc(this)) : this.entryPath.totalLength);

        const maxStep = this.config.moveSpeed * delta;
        if (this.currentArc > desiredArc) {
            this.currentArc = Math.max(desiredArc, this.currentArc - maxStep);
        } else if (this.currentArc < desiredArc) {
            this.currentArc = Math.min(desiredArc, this.currentArc + maxStep);
        }

        const newPosition = pointAtArcLength(activePath, this.currentArc);
        const dx = newPosition.x - this.transform.position.x;
        const dz = newPosition.z - this.transform.position.z;
        this.isMoving = dx * dx + dz * dz > 1e-10;
        if (this.isMoving) {
            this.targetYaw = Math.atan2(dx, dz);
        }
        this.transform.position.copy(newPosition);

        // Parked at the queue itself — face it EXACTLY (its own real world position, not a
        // waypoint) rather than trusting whatever direction the final approach leg's geometry
        // last left `targetYaw` at. See `queuePosition`'s own doc for why that could otherwise
        // read as a slightly-wrong rotation: a waypoint drawn a little off the collider's own
        // center aims the last leg at THAT point, not necessarily square at the queue. Checked
        // every frame while parked (not just once on arrival) so it stays correct even if
        // `queuePosition` were ever to move, and so a resumeAtQueue spawn (which starts here
        // with no "last leg" to have computed a direction from at all) still gets a correct
        // facing on its very first frame instead of an arbitrary default.
        const parkedAtQueue = !this.usingExitPath && this.direction === 'in' && this.currentArc <= ARRIVAL_EPSILON;
        let queueFacingDx = 0;
        let queueFacingDz = 0;
        if (parkedAtQueue) {
            queueFacingDx = this.queuePosition.x - this.transform.position.x;
            queueFacingDz = this.queuePosition.z - this.transform.position.z;
            if (queueFacingDx * queueFacingDx + queueFacingDz * queueFacingDz > 1e-8) {
                this.targetYaw = Math.atan2(queueFacingDx, queueFacingDz);
            }
        }

        if (this.npcBody) {
            // CharacterBody drives its OWN facing (a quaternion slerp on body.container, not
            // this entity's transform.rotation — see CharacterBody.update()'s own doc) and its
            // own idle/walk/run animator board, both purely from this moveInput direction —
            // no separate yaw-easing needed here, unlike the static-`visual` case below. Zero
            // input while not `isMoving` (waiting at the queue, queued up behind another giver,
            // waiting at the far waypoint) settles it back to 'idle' and stops it rotating any
            // further, same as any other stationary NpcEntity — EXCEPT CharacterBody.update()
            // only ever updates its own targetRotation from NONZERO moveInput (see that method's
            // own doc), so while parked (moveInput always 0) it would otherwise just keep
            // facing whatever direction the last REAL leg was walked in, same wrong-rotation
            // risk as the static-`visual` case above. faceDirection() is the documented way to
            // override that independently of moveInput — called every frame while parked so it
            // keeps tracking `queuePosition` (and immediately applies right from a resumeAtQueue
            // spawn's very first frame, which never walked a real leg to face from at all).
            if (parkedAtQueue) {
                this.npcBody.faceDirection(queueFacingDx, queueFacingDz);
            }

            const dirX = this.isMoving ? Math.sin(this.targetYaw) * NPC_MOVE_INPUT_MAGNITUDE : 0;
            const dirZ = this.isMoving ? Math.cos(this.targetYaw) * NPC_MOVE_INPUT_MAGNITUDE : 0;
            // `grounded: true` — this NPC never jumps/falls, but CharacterBody.setUp()'s own
            // idle<->walk<->run transitions are ALL gated on it (see that method's own
            // condition functions); AnimatorBoard's vars start undefined, so leaving this unset
            // would leave every transition's `vars.grounded === true` check permanently false —
            // stuck in 'idle' forever regardless of speed, exactly the bug this fixes.
            this.npcBody.update(delta, dirX, dirZ, { grounded: true });
        } else {
            // Eases the giver's actual facing toward whatever direction it's currently supposed
            // to be traveling — see currentYaw/targetYaw's own doc. Wrapped to the shortest
            // angular distance so it never spins the long way around a corner.
            let diff = this.targetYaw - this.currentYaw;
            diff = ((diff + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
            this.currentYaw += diff * (1 - Math.exp(-ROTATION_EASE_SPEED * delta));
            this.transform.rotation.y = this.currentYaw;
        }

        if (this.usingExitPath) {
            // One-way trip — the only thing left to check is "have I reached the far end yet."
            if (this.currentArc >= activePath.totalLength - ARRIVAL_EPSILON && !this.reachedDespawnPoint) {
                this.reachedDespawnPoint = true;
            }
        } else {
            // Arrived at the queue itself — only fires once per approach (guarded by
            // waitingForDelivery, which onArrivedAtQueue() sets true).
            if (this.direction === 'in' && this.currentArc <= ARRIVAL_EPSILON && !this.waitingForDelivery) {
                this.onArrivedAtQueue();
            }

            // Arrived (fully) at entryPath's far waypoint — only fires once per exit (see
            // `hasReshuffledThisExit`'s own doc).
            if (this.direction === 'out' && this.currentArc >= this.entryPath.totalLength - ARRIVAL_EPSILON && !this.hasReshuffledThisExit) {
                this.hasReshuffledThisExit = true;
                this.onArrivedAtFarWaypoint();
            }
        }

        // The ONE thing that can't be driven by an event — nothing calls this entity when the
        // player finishes delivering the task, so it has to poll (cheap; only actually checked
        // while genuinely parked and waiting — see `waitingForDelivery`'s own doc).
        if (this.waitingForDelivery && QueueStorage.getState(this.queueId).activeTask === undefined) {
            this.waitingForDelivery = false;
            QueueStorage.setGiverPresent(this.queueId, false);
            this.direction = 'out';

            if (this.exitPath) {
                // Same physical point (the queue) as entryPath's own arc 0 — no visual jump,
                // just switching which path's own arc-length frame `currentArc` is measured in.
                this.usingExitPath = true;
                this.currentArc = 0;
            } else {
                this.hasReshuffledThisExit = false;
            }
        }
    }

    /** Same cone-of-view sensor NpcEntity.ts uses (see NpcLookAtSensor.ts's own doc) — a no-op whenever `lookAtSensor` isn't built (static-`visual` cycle, config with no viewRadius/viewAngleDeg, or rig not loaded yet). Runs in lateUpdate() for the exact same reasons NpcEntity's own does — see that file's own doc. */
    public override lateUpdate(delta: number): void {
        if (this.npcBody) {
            this.lookAtSensor?.update(this.transform.position, this.npcBody.container.quaternion, this.getPlayerPosition(), delta);
        }
    }

    /**
     * World-space position of the current cycle's own `npc` visual's Head bone — undefined
     * whenever this cycle isn't an `npc` variant at all (a static `view` variant has no bone
     * to read), or its rig hasn't finished loading yet (see spawnNpcVisual()'s own doc on
     * loadNpcBody() being async). QueueZone reads this live (via PizzaScene's own wiring, see
     * registerQueueSpawnGates()) to float its task panel over the NPC's actual head instead of
     * a fixed point above the queue itself — undefined here just means "nothing to override
     * with," so a static `view` variant's queue keeps its existing fixed-anchor panel
     * unchanged.
     */
    public getNpcHeadWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | undefined {
        const headBone = this.npcBody?.getBone('Head');
        return headBone?.getWorldPosition(target);
    }

    /** True only while parked at the queue with a task active, waiting for the player to deliver it — see `waitingForDelivery`'s own doc. QuestGiverGroup.getActiveHeadWorldPosition() reads this to find whichever tracked giver is the one actually serving the queue's task right now. */
    public isPresentAtQueue(): boolean {
        return this.waitingForDelivery;
    }

    /**
     * Plays the "happy" one-shot pose (see PlayerAnimationConfig.happy's own doc — 'Excited' by
     * default) on this giver's `npcBody`, if it has one — a no-op for a static-`visual` cycle
     * (nothing to animate) or before the rig's own async load has resolved. Called by
     * QueueZone's `onTaskDelivered` hook (via QuestGiverGroup.playHappyAnimationForActiveGiver())
     * the instant a task's full amount lands, so the giver visibly celebrates for the SAME
     * REWARD_POPUP_HOLD_SEC window the reward callout holds, rather than just standing there (or
     * already walking away) while the amount's still on screen. Bypasses the idle/walk/run board
     * entirely (a direct AnimatorController.mix() call, same as CharacterBody.setUp()'s own doc
     * describes for 'talk'/'happy') — the board's own state is untouched, so once this giver
     * actually starts moving again (walking out, after the hold), the ordinary idle->walk
     * transition crossfades cleanly FROM whatever this pose left showing, with no explicit
     * "return to idle" call needed here.
     */
    public playHappyAnimation(): void {
        this.npcBody?.animator.mix('happy', 1, 0.15, false);
    }

    /** True while this giver is genuinely PARKED heading in — either the front one waiting for delivery, or a follower already stopped behind whoever's ahead of it (see isHeadingIn()/isMoving's own docs) — false while it's still actively walking a leg. QuestGiverGroup reads this to decide how many givers to report as "stopped in line" to QueueStorage (see that file's own doc on why only STOPPED givers are worth persisting — one still mid-walk needs no help surviving a reload; a fresh walk-in looks identical either way). */
    public isStoppedInLine(): boolean {
        return this.isHeadingIn() && !this.isMoving;
    }

    /** This giver's current arc-length position along whichever path is currently active (0 = at the queue, increasing away from it) — read by QuestGiverGroup.getMinAllowedArc() to rank every tracked giver and decide who's currently closest to the queue. Only meaningful while isHeadingIn() is true (see that method's own doc) — QuestGiverGroup never ranks a departing/exiting giver in the first place. */
    public getCurrentArc(): number {
        return this.currentArc;
    }

    /** True while this giver is still walking IN or parked waiting at the queue — false once it's turned to walk back OUT (whether reversing through entryPath, or, once an exitPath exists, heading out through it toward despawn). QuestGiverGroup.rankGivers() only ranks givers this returns true for, so a departing giver can never be picked as anyone else's "leader" — without this, a follower's own minAllowedArc stayed pegged to the departing giver's own (still climbing, unconstrained) arc for as long as it remained numerically smaller, dragging the follower out toward the exit right along with it instead of letting it advance to the now-empty queue. */
    public isHeadingIn(): boolean {
        return this.direction === 'in';
    }

    /** True once this giver has walked all the way out through `exitPath` and reached its far end — see `reachedDespawnPoint`'s own doc. Always false when `exitPath` doesn't exist (that giver loops forever instead — see this file's own top doc). QuestGiverGroup.update() removes/replaces this instance the first tick it sees this go true. */
    public isFinished(): boolean {
        return this.reachedDespawnPoint;
    }

    public override destroy(): void {
        this.destroyed = true;
        // ONLY if THIS giver still actually holds presence — normally false by the time
        // destroy() runs (QuestGiverGroup calls this once isFinished(), well after the
        // "waitingForDelivery cleared" block already cleared presence itself, back when THIS
        // giver's own task was delivered). Calling this unconditionally used to clobber
        // whichever OTHER giver had since become the new front and legitimately set presence
        // true again for ITS OWN task — this giver despawning walked in and stomped that flag
        // back to false, hiding the panel and blocking delivery on a task this giver had
        // nothing to do with. The only case this guard still fires for is an abrupt teardown
        // (e.g. scene destroy) while genuinely still parked waiting — where clearing presence
        // is correct.
        if (this.waitingForDelivery) {
            QueueStorage.setGiverPresent(this.queueId, false);
        }
        this.npcBody?.destroy();
        super.destroy();
    }

    /**
     * Rolls this cycle's variant (see rollQuestGiverVariant()) and builds its visual — the very
     * first variant ever picked for this QUEUE (see QuestGiverGroup.consumeForceLowestWeightVariant()'s
     * own doc — tracked at the GROUP level, not per-instance: with multiple/despawning givers, a
     * single instance's own "first pick" is meaningless, since each new instance would otherwise
     * force-lowest all over again and every giver that ever appeared showed the exact same
     * variant) is forced to the lowest-weight (rarest) one, every pick after that (whether a
     * later reshuffle on the SAME instance, or the very first pick for a brand-new one) rolls
     * normally. `npc` wins if a variant somehow sets both (see QuestGiverTypes.ts's own doc).
     * Skips building anything (with a warning) if the variant sets neither, or if a static
     * `view` has no model yet — see EntityViewRegistry.resolveEntityView()'s own doc.
     */
    private spawnVisual(): void {
        const variant = rollQuestGiverVariant(this.config, this.group.consumeForceLowestWeightVariant());
        this.currentVariant = variant;

        if (variant.npc) {
            this.spawnNpcVisual(variant.npc);
            return;
        }

        if (!variant.view) {
            console.warn(`[QuestGiverEntity] "${this.queueId}" variant has neither "view" nor "npc" set — nothing to show this cycle`);
            return;
        }

        const resolved = resolveEntityView(variant.view);
        if (!resolved) {
            console.warn(`[QuestGiverEntity] "${this.queueId}" variant view "${variant.view}" has no model yet — skipping this cycle's visual`);
            return;
        }

        const offset = new THREE.Vector3(...resolved.offset);
        const rotationY = resolved.rotationDeg * (Math.PI / 180);
        this.visual = this.addComponent(new GlbVisualComponent(resolved.model, offset, resolved.scale, rotationY));
    }

    /** Builds this cycle's visual as an animated CharacterBody NPC (see NpcTypes.ts) instead of a static glb — walks/idles through its own idle/walk animator board (see update()) rather than holding one fixed pose the whole way. `body.container` is parented immediately so it tracks this entity's position from frame one; the actual mesh/clips finish loading asynchronously (see loadNpcBody()), same as GlbVisualComponent's own async model resolve. */
    private spawnNpcVisual(npcId: string): void {
        const npcConfig = getNpcConfig(npcId);
        if (!npcConfig) {
            console.warn(`[QuestGiverEntity] "${this.queueId}" variant npc "${npcId}" has no NpcConfig registered — skipping this cycle's visual`);
            return;
        }

        const body = new CharacterBody();
        this.npcBody = body;
        this.transform.add(body.container);
        void loadNpcBody(body, npcConfig)
            // Same "built once the rig's rest pose is final" ordering as NpcEntity.load() — see
            // NpcLookAtSensor.tryBuild()'s own doc. Guarded on `this.npcBody === body` in case a
            // reshuffle already tore this cycle down (and spawned a new one) before this async
            // load resolved — an EntityBoneLookAt built on an already-destroyed bone hierarchy
            // would be pointless (and this.npcBody would already be some OTHER body's by then).
            .then(() => {
                if (this.npcBody === body) {
                    this.lookAtSensor = NpcLookAtSensor.tryBuild(body, npcConfig, npcId);
                }
            })
            .catch(error => console.error(`[QuestGiverEntity] "${this.queueId}" failed to load npc "${npcId}"`, error));
    }

    /** Tears down the just-finished cycle's visual (whichever kind it was) and builds a new one — see this file's own doc on why this happens once per full out-then-in cycle. Entity has no removeComponent(); a destroyed GlbVisualComponent is simply left in place (its own destroy() already made it inert — no mesh, no further lifecycle calls do anything) rather than compacting the array, an acceptable one-off cost for this test-scope entity. */
    private reshuffleVisual(): void {
        this.visual?.destroy();
        this.visual = undefined;
        this.npcBody?.destroy();
        this.npcBody = undefined;
        this.lookAtSensor = undefined;
        this.spawnVisual();
    }

    /**
     * Reached the queue itself while walking IN. Presence is set BEFORE startTaskNow() —
     * QueueZone gates both deposits and its own panel visibility on presence (see that file's
     * own doc), so the task must never appear deliverable/visible even one frame before the
     * giver is actually marked as having arrived.
     */
    private onArrivedAtQueue(): void {
        QueueStorage.setGiverPresent(this.queueId, true);
        const possibleTasks = this.currentVariant ? getLootTable(this.currentVariant.lootTable)?.possibleTasks ?? [] : [];
        QueueStorage.startTaskNow(this.queueId, possibleTasks);
        this.waitingForDelivery = true;
    }

    /**
     * Reached entryPath's own far waypoint while walking OUT (fully left) — only ever called
     * when `exitPath` doesn't exist (see update()'s own doc). Reshuffles the visual immediately,
     * then waits `idleAtFarWaypointSec` (possibly zero — see that field's own doc) before
     * turning back around. Direction flips back to 'in' either way; update()'s own desiredArc
     * calculation picks the walk back up from there with no further bookkeeping.
     */
    private onArrivedAtFarWaypoint(): void {
        this.reshuffleVisual();

        if (this.idleAtFarWaypointSec <= 0) {
            this.direction = 'in';
            return;
        }

        gsap.delayedCall(this.idleAtFarWaypointSec, () => {
            if (this.destroyed) {
                return;
            }
            this.direction = 'in';
        });
    }
}
