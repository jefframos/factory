import * as THREE from "three";
import { PlayerEntity } from "../entities/PlayerEntity";
import { SimWorld } from "../sim/SimWorld";
import { Blackboard, BotParams } from "./Blackboard";
import { Action, BTNode, NodeStatus, Selector } from "./BehaviorTree";

/** Per-tick context handed to every BT node — everything a node needs to sense the world and act. */
export type BotContext = {
    entity: PlayerEntity;
    blackboard: Blackboard;
    delta: number;
    /** Node output: desired normalized move direction for this tick. Reset to (0,0) at the start of every tick. */
    moveDir: THREE.Vector2;
};

const STEER_LERP = 6; // blend speed for desired direction, avoids twitchy bots
// Final approach onto food needs a much snappier response than cruising does —
// the bearing to a close target changes far faster per unit of movement than
// it does from a distance (pure-pursuit geometry), and STEER_LERP's smoothing
// combined with PlayerEntity's own rotation slerp can't keep up. Without this,
// the entity's forward-offset "mouth" (see PlayerEntity.eatPosition) keeps
// swinging past the food instead of locking onto it, so it orbits forever
// instead of eating — looks like it "stops in front of it and backs away,
// repeating." seekNearestFood ramps steerUrgency up as it nears its target.
const CLOSE_STEER_LERP = 24;
const SEPARATION_RADIUS_MULT = 3; // personal-space radius, in multiples of own collisionRadius
const SEPARATION_WEIGHT = 1.5;    // how hard nearby entities push apart, relative to the BT's own steering
const ORIGIN_2D = new THREE.Vector2(0, 0);
const UP_3D = new THREE.Vector3(0, 1, 0);
const LOG_INTERVAL = 0.5; // seconds between console lines per bot while logging is on — enough to catch a stuck bot without flooding the console

// Stuck watchdog — lives here, not in any one BT node, because getting
// physically wedged (an obstacle corner where SimWorld.resolveDirection's
// single-point probe can flicker between "clear" and "blocked" every frame —
// see its own docs on missing thin/angled geometry) can happen under *any*
// behaviour: leash, flee, seekFood, chase all drive a nonzero moveDir that
// can land the entity in the same kind of dead spot. wander/seekFood/flee
// naturally drift onto a new heading over time and usually self-recover, but
// not reliably — and leash's heading never varies at all — so this applies
// uniformly after the BT has already picked a direction, tracking real
// displacement (not any behaviour-specific "am I making progress" measure,
// which can itself stall while wedged) and forcing a fixed sideways detour
// once movement has stalled for too long.
const STUCK_ESCAPE_DELAY = 1.0; // seconds of near-zero movement before we try a sidestep
const STUCK_MOVE_EPS = 0.05;    // world-units — below this counts as "not moving" for the watchdog

// Braveness drifts on its own each tick instead of being a fixed personality
// knob — see Blackboard.braveness. It gravitates toward the bot's own
// aggressiveness (braver personalities rest at a higher average nerve) with
// a random wobble on top, so "how brave am I feeling right now" varies
// moment to moment the way the user described, without needing any
// event-driven bookkeeping (scares, close calls, etc).
const BRAVENESS_DRIFT_RATE = 0.5;  // max random nudge per second
const BRAVENESS_REVERT_RATE = 0.15; // how fast it's pulled back toward its aggressiveness baseline
// Above this, a bot will risk sneaking up on a vulnerable tail cube even on
// an entity it wouldn't dare fight head-on. See snipeVulnerableTail.
const BRAVE_THRESHOLD = 0.65;

// A threat can only actually reach you if you're roughly in front of it —
// PlayerEntity.eatPosition is a point offset ahead of an entity along
// whatever direction it's currently facing, so `eatPosition - position` is
// its facing direction. Dotting that against the direction to a candidate
// tells us whether the candidate sits inside its forward bite arc — i.e.
// "would this entity actually notice/reach me." Used both to decide whether
// a nearby threat can actually catch us (fleeFromThreat only reacts to
// threats that are facing us — safe on their back, per the user's framing)
// and whether a would-be snipe target is currently facing us back (too risky
// to approach — see snipeVulnerableTail).
const DANGER_CONE_HALF_ANGLE = Math.PI / 3; // 60° each side = 120° total forward arc

function isFacingTarget(observerPos: THREE.Vector3, observerEatPos: THREE.Vector3, targetPos: THREE.Vector3): boolean {
    const facing = observerEatPos.clone().sub(observerPos);
    if (facing.lengthSq() < 1e-6) return true; // no discernible facing — assume worst case
    facing.normalize();

    const toTarget = targetPos.clone().sub(observerPos);
    if (toTarget.lengthSq() < 1e-6) return true; // exactly overlapping

    toTarget.normalize();
    return facing.dot(toTarget) >= Math.cos(DANGER_CONE_HALF_ANGLE);
}

/** Flat, dat.GUI-friendly snapshot of one bot's live state — for the AI debug panel. */
export type BotDebugInfo = {
    x: number;
    z: number;
    value: number;
    /** Name of whichever behaviour tree node is currently driving movement. */
    state: string;
};

/** Drives one bot PlayerEntity each frame: perceive via SimWorld, tick a behaviour tree, steer via setMoveInput. */
export class BotController {
    private static nextId = 1;

    readonly id = BotController.nextId++;
    readonly blackboard: Blackboard;
    /** Debug-only: freezes this bot in place (no AI tick, no movement) when true. */
    paused = false;
    /**
     * Debug-only, per-bot (see DevGuiManager 'AI Bot N' > 'Log AI (console)').
     * Flip on just the bot you're watching, let it sit a few seconds, then
     * copy its `[bot N]` lines from the console — keeping it per-instance
     * instead of a single global switch means it doesn't get drowned out by
     * every other bot's lines too.
     */
    logging = false;
    /** Debug-only: live readout for the AI debug panel — refreshed every update(). */
    readonly debug: BotDebugInfo = { x: 0, z: 0, value: 0, state: "wander" };

    private readonly tree: BTNode<BotContext>;
    private readonly currentDir = new THREE.Vector2();
    private logTimer = 0;
    private lastLoggedPos: THREE.Vector2 | null = null;
    /** Last frame's post-obstacle-avoidance direction — see resolveDirection's `preferred` param. */
    private lastResolvedDir: THREE.Vector3 | null = null;
    // Stuck watchdog state — see STUCK_ESCAPE_DELAY above.
    private stuckPos: THREE.Vector3 | null = null;
    private stuckTimer = 0;
    private escapeAngle: number | null = null;

    constructor(
        public readonly entity: PlayerEntity,
        params: Partial<BotParams> = {},
        tree: BTNode<BotContext> = buildDefaultTree(entity.position.clone()),
    ) {
        this.blackboard = new Blackboard(params);
        this.tree = tree;
    }

    update(delta: number): void {
        if (this.paused) {
            this.entity.setMoveInput(0, 0); // otherwise it keeps drifting on whatever input was set before pausing
            return;
        }

        this.blackboard.position.copy(this.entity.position);
        this.blackboard.value = this.entity.value;
        this.updateBraveness(delta);
        this.blackboard.set("steerUrgency", 0); // seekNearestFood raises this on final approach

        const ctx: BotContext = {
            entity: this.entity,
            blackboard: this.blackboard,
            delta,
            moveDir: new THREE.Vector2(0, 0),
        };
        this.tree.tick(ctx);
        const rawDir = ctx.moveDir.clone(); // BT output before separation — kept only for logDebug
        this.applySeparation(ctx);
        const postSeparationDir = ctx.moveDir.clone();

        // Smooth the raw BT output so retargeting doesn't look robotic — but
        // blend toward CLOSE_STEER_LERP when a node reports urgency (see
        // seekNearestFood) so tight final-approach maneuvering isn't smeared
        // by the same lag budgeted for calm long-distance cruising.
        const urgency = this.blackboard.get<number>("steerUrgency") ?? 0;
        const lerpRate = STEER_LERP + urgency * (CLOSE_STEER_LERP - STEER_LERP);
        const t = 1 - Math.exp(-lerpRate * delta);
        this.currentDir.lerp(ctx.moveDir, t);

        let resolved = new THREE.Vector3(0, 0, 0);
        if (this.currentDir.lengthSq() > 0.0001) {
            let dir3 = new THREE.Vector3(this.currentDir.x, 0, this.currentDir.y).normalize();
            dir3 = this.applyStuckEscape(dir3, delta);
            resolved = SimWorld.resolveDirection(this.entity.position, dir3, this.entity.collisionRadius * 2, this.lastResolvedDir);
            this.entity.setMoveInput(resolved.x, resolved.z);
            this.lastResolvedDir = resolved.lengthSq() > 0 ? resolved : null;
        } else {
            this.entity.setMoveInput(0, 0);
            this.lastResolvedDir = null;
        }

        this.debug.x = this.entity.position.x;
        this.debug.z = this.entity.position.z;
        this.debug.value = this.entity.value;
        this.debug.state = this.blackboard.get<string>("state") ?? "wander";

        if (this.logging) this.logDebug(delta, rawDir, postSeparationDir, resolved);
    }

    destroy(): void {
        this.tree.reset?.();
    }

    /** See BRAVENESS_DRIFT_RATE/BRAVENESS_REVERT_RATE above. */
    private updateBraveness(delta: number): void {
        const baseline = this.blackboard.params.aggressiveness;
        const drift = (Math.random() - 0.5) * BRAVENESS_DRIFT_RATE * delta;
        const pull = (baseline - this.blackboard.braveness) * BRAVENESS_REVERT_RATE * delta;
        this.blackboard.braveness = Math.max(0, Math.min(1, this.blackboard.braveness + drift + pull));
    }

    /**
     * Tracks real displacement independent of whichever BT node is currently
     * driving, and rotates the desired direction by a fixed sideways angle
     * once movement has stalled for STUCK_ESCAPE_DELAY — see the constant's
     * comment for why this lives here instead of in any one behaviour. The
     * angle is rolled once per stuck episode and held (not re-rolled every
     * frame) so the escape attempt is a straight line long enough to actually
     * clear whatever it's wedged against, then cleared as soon as real
     * progress resumes.
     */
    private applyStuckEscape(dir3: THREE.Vector3, delta: number): THREE.Vector3 {
        const pos = this.entity.position;
        if (this.stuckPos && pos.distanceTo(this.stuckPos) < STUCK_MOVE_EPS) {
            this.stuckTimer += delta;
        } else {
            this.stuckTimer = 0;
            this.stuckPos = pos.clone();
            this.escapeAngle = null;
        }

        if (this.stuckTimer <= STUCK_ESCAPE_DELAY) return dir3;

        if (this.escapeAngle === null) {
            this.escapeAngle = (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random() * Math.PI / 4);
        }
        return dir3.clone().applyAxisAngle(UP_3D, this.escapeAngle);
    }

    /**
     * Prints one line every LOG_INTERVAL while `logging` is on. Covers the
     * whole steering pipeline (BT output -> separation -> smoothing ->
     * obstacle-avoidance resolve) plus the BT's own state flags, so a stuck
     * bot's log should show exactly which stage is producing ~zero net
     * movement: e.g. rawDir non-zero but resolved=(0,0,0) means
     * SimWorld.resolveDirection is boxed in by terrain on every probed angle;
     * `resolved` alternating between two fixed vectors every line while
     * `smoothed`/rawDir stay constant is the "vibrating in place" 2-cycle
     * (see resolveDirection's `preferred` param — should be fixed now, but if
     * you see this pattern again that's what to look for); rawDir and postSep
     * pointing opposite ways means separation from a crowding neighbor is
     * cancelling out the seek direction; foodReachable=0 with foodSeen>0
     * means every visible food is outside leash range.
     */
    private logDebug(delta: number, rawDir: THREE.Vector2, postSeparationDir: THREE.Vector2, resolved: THREE.Vector3): void {
        this.logTimer += delta;
        if (this.logTimer < LOG_INTERVAL) return;
        this.logTimer = 0;

        const pos = this.entity.position;
        const moved = this.lastLoggedPos ? Math.hypot(pos.x - this.lastLoggedPos.x, pos.z - this.lastLoggedPos.y) : 0;
        this.lastLoggedPos = new THREE.Vector2(pos.x, pos.z);

        const bb = this.blackboard;
        const fmt2 = (v: THREE.Vector2 | THREE.Vector3) => `(${v.x.toFixed(2)},${('z' in v ? v.z : v.y).toFixed(2)})`;
        console.log(
            `[bot ${this.id}] state=${bb.get<string>("state") ?? "?"} `
            + `pos=(${pos.x.toFixed(1)},${pos.z.toFixed(1)}) value=${this.entity.value} `
            + `movedLast${LOG_INTERVAL}s=${moved.toFixed(2)} `
            + `rawDir=${fmt2(rawDir)} postSep=${fmt2(postSeparationDir)} `
            + `smoothed=${fmt2(this.currentDir)} resolved=${fmt2(resolved)} `
            + `leashing=${bb.get<boolean>("leashing") ?? false} panicking=${bb.get<boolean>("panicking") ?? false} `
            + `braveness=${bb.braveness.toFixed(2)} `
            + `targetDist=${bb.get<number>("targetDist")?.toFixed(2) ?? "-"} `
            + `foodSeen=${bb.get<number>("foodSeen") ?? "-"} foodReachable=${bb.get<number>("foodReachable") ?? "-"}`,
        );
    }

    /**
     * Nudges `ctx.moveDir` away from any nearby entity. Every bot picks its
     * target purely by "nearest" (nearest food, nearest prey) with no notion
     * of personal space, so two bots near each other frequently target the
     * exact same food cube and walk to the exact same point — and since
     * nothing pushes agents apart from each other (resolveEntityCollisions
     * only resolves against terrain), they visibly stack on top of it. This
     * is a plain steering nudge, not a BT node, so it applies regardless of
     * which behaviour is currently driving.
     */
    private applySeparation(ctx: BotContext): void {
        const { entity } = ctx;
        const radius = entity.collisionRadius * SEPARATION_RADIUS_MULT;
        const nearby = SimWorld.query(entity.position, radius, entity).entities;
        if (nearby.length === 0) return;

        let sepX = 0, sepZ = 0;
        for (const other of nearby) {
            let dx = entity.position.x - other.position.x;
            let dz = entity.position.z - other.position.z;
            let d = Math.sqrt(dx * dx + dz * dz);
            if (d < 0.001) { dx = 1; dz = 0; d = 1; } // exactly overlapping — no direction to push from, pick one
            const push = 1 - d / radius; // stronger the closer they are
            sepX += (dx / d) * push;
            sepZ += (dz / d) * push;
        }
        ctx.moveDir.x += sepX * SEPARATION_WEIGHT;
        ctx.moveDir.y += sepZ * SEPARATION_WEIGHT;
    }
}

// ── Default tree ──────────────────────────────────────────────────────────────
// Priority order: flee a lethal threat (survival beats everything, including
// leash — see fleeFromThreat's comment), return home if too far out, chase
// weaker prey (if aggressive enough and it's actually catchable within leash
// range), sneak up on a vulnerable tail cube if feeling brave enough right
// now, seek the nearest food, otherwise wander. This is a placeholder tree
// that proves the Blackboard/BehaviorTree/SimWorld plumbing end-to-end and
// exercises every BotParams knob — swap in richer trees per entity later.

function buildDefaultTree(home: THREE.Vector3): BTNode<BotContext> {
    return new Selector([
        fleeFromThreat(),
        returnToLeash(home),
        chaseWeakerPrey(home),
        snipeVulnerableTail(home),
        seekNearestFood(home),
        wander(),
    ]);
}

// Once triggered, keep heading home until well inside the circle (70% of
// leashRadius) instead of releasing the instant it crosses back over the
// boundary. Without this hysteresis band, a single frame of "walk home"
// crosses back inside leashRadius, handing off to wander — whose heading
// still points outward — which immediately crosses back out, re-triggering
// the leash next frame. That flip/flop repeats every frame (visible as the
// bot's `state` alternating leash/wander) and the two opposite steering
// directions average out to ~zero net motion, so it also looks stuck in place.
const LEASH_RELEASE_FACTOR = 0.7;

function returnToLeash(home: THREE.Vector3): BTNode<BotContext> {
    return new Action((ctx) => {
        const { entity, blackboard } = ctx;
        const r = blackboard.params.leashRadius;
        const dist2 = entity.position.distanceToSquared(home);
        const leashing = blackboard.get<boolean>("leashing") ?? false;

        if (leashing) {
            if (dist2 <= (r * LEASH_RELEASE_FACTOR) ** 2) {
                blackboard.set("leashing", false);
                // Pick a fresh wander heading on release. Otherwise the bot
                // resumes wandering with the same stale heading it had before
                // being pulled home, so it just walks straight back out along
                // the same line, gets leashed again, comes back, and repeats
                // — the "no exploration, same path over and over" pattern.
                blackboard.set("wanderHeading", Math.random() * Math.PI * 2);
                return NodeStatus.Failure;
            }
        } else if (dist2 <= r * r) {
            return NodeStatus.Failure;
        } else {
            blackboard.set("leashing", true);
        }

        // Getting physically wedged en route (e.g. an obstacle corner) is
        // handled by BotController's own stuck watchdog, applied uniformly
        // after every behaviour picks a direction — see STUCK_ESCAPE_DELAY.
        const dx = home.x - entity.position.x;
        const dz = home.z - entity.position.z;
        ctx.moveDir.set(dx, dz).normalize();
        blackboard.set("state", "leash");
        return NodeStatus.Running;
    });
}

// Once panicking, a threat must clear this much further than awarenessRadius
// before we stand down. Without this hysteresis (same idea as
// LEASH_RELEASE_FACTOR above), a threat sitting right at the awareness
// boundary — e.g. also drawn to the same food — drifts in and out of range
// every frame or two, and the BT alternates flee <-> seekFood every tick.
// Each swap resets the other node's own state (new wander heading, fresh
// steering target), so the entity visibly flickers/rotates in place instead
// of committing to either behaviour.
const PANIC_RELEASE_MULT = 1.6;

// While fleeing, still pull a bit toward nearby food instead of running
// blindly — more human than pure panic, and it means a bot that dodges a
// threat near a food cluster doesn't ignore an easy grab right on its escape
// route. Kept secondary (safety direction dominates) via this weight.
const FLEE_FOOD_BIAS = 0.4;

function fleeFromThreat(): BTNode<BotContext> {
    return new Action((ctx) => {
        const { entity, blackboard } = ctx;
        const panicking = blackboard.get<boolean>("panicking") ?? false;
        const radius = panicking
            ? blackboard.params.awarenessRadius * PANIC_RELEASE_MULT
            : blackboard.params.awarenessRadius;

        const result = SimWorld.query(
            entity.position, radius, entity,
            { excludePlayer: blackboard.ignorePlayer },
        );
        const lethalValue = entity.value / blackboard.params.fleeThreshold;

        let threat: THREE.Vector3 | null = null;
        let bestDist2 = Infinity;
        for (const other of result.entities) {
            if (other.value < lethalValue) continue;
            // Only a threat that's actually facing us can catch us — one
            // sitting right behind is no danger at all (its own forward-offset
            // "mouth" points the other way). Ignoring it here, not just at the
            // eating-check level, is what makes "safe on their back" actually
            // change behaviour instead of just changing whether a bite lands.
            if (!isFacingTarget(other.position, other.eatPosition, entity.position)) continue;
            const d2 = entity.position.distanceToSquared(other.position);
            if (d2 < bestDist2) { bestDist2 = d2; threat = other.position; }
        }

        if (!threat) {
            blackboard.set("panicking", false);
            return NodeStatus.Failure;
        }

        // Panic ignores everything else lower in the Selector for as long as
        // it's active — flee runs first (above returnToLeash too — see
        // buildDefaultTree), this just keeps it Running (instead of
        // flickering to Failure) while a threat is anywhere within the
        // widened panic radius. Flee outranking leash matters: with leash on
        // top, an entity fleeing for its life that happens to cross its leash
        // boundary got yanked home *mid-escape*, potentially walking straight
        // back toward the threat — and once released, immediately resumed
        // fleeing, crossed the boundary again, and repeated: a flee<->leash
        // tug-of-war (same shape as the leash<->seekFood one, just for
        // survival instead of food) that looked like aimless zig-zagging
        // always pulling toward roughly the same spot. Leash still applies
        // once the threat is gone and it's safe to head home.
        blackboard.set("panicking", true);
        const fleeDir = new THREE.Vector2(entity.position.x - threat.x, entity.position.z - threat.z).normalize();

        const foodResult = SimWorld.query(entity.position, blackboard.params.awarenessRadius, entity);
        if (foodResult.food.length > 0) {
            let nearestFood = foodResult.food[0];
            let bestFoodDist2 = entity.position.distanceToSquared(nearestFood);
            for (let i = 1; i < foodResult.food.length; i++) {
                const d2 = entity.position.distanceToSquared(foodResult.food[i]);
                if (d2 < bestFoodDist2) { bestFoodDist2 = d2; nearestFood = foodResult.food[i]; }
            }
            const towardFood = new THREE.Vector2(nearestFood.x - entity.position.x, nearestFood.z - entity.position.z).normalize();
            fleeDir.addScaledVector(towardFood, FLEE_FOOD_BIAS).normalize();
        }

        ctx.moveDir.copy(fleeDir);
        blackboard.set("state", "flee");
        return NodeStatus.Running;
    });
}

// A chase that drags on this long without a kill gives up — either the prey
// keeps slipping away (its own flee/leash/separation steering fighting ours
// to a standstill) or it's simply not worth the detour. Without a give-up,
// two bots that are each individually "correct" (predator chasing, prey
// fleeing) can lock into an endless standoff that looks like a scripted
// zig-zag rather than either side actually winning or losing.
const CHASE_GIVEUP_TIME = 4;  // seconds of continuous chasing before giving up
const CHASE_COOLDOWN    = 3;  // seconds the predator won't re-engage chase after giving up — otherwise the very next tick just re-picks the same nearest prey and resumes the standoff

function chaseWeakerPrey(home: THREE.Vector3): BTNode<BotContext> {
    return new Action((ctx) => {
        const { entity, blackboard, delta } = ctx;
        if (blackboard.params.aggressiveness <= 0) return NodeStatus.Failure;

        let cooldown = blackboard.get<number>("chaseCooldown") ?? 0;
        if (cooldown > 0) {
            blackboard.set("chaseCooldown", cooldown - delta);
            blackboard.set("chaseTimer", 0);
            return NodeStatus.Failure;
        }

        const result = SimWorld.query(
            entity.position, blackboard.params.awarenessRadius, entity,
            { excludePlayer: blackboard.ignorePlayer },
        );
        // Higher aggressiveness accepts riskier (closer-to-even) matchups as worth chasing.
        const preyValueCeiling = entity.value * (0.3 + 0.7 * blackboard.params.aggressiveness);
        // Same idea as seekNearestFood's leash guard: don't commit to prey
        // we'd have to leave leash range to actually catch — otherwise
        // returnToLeash fights this node exactly like it used to fight
        // seekNearestFood over unreachable food.
        const leashR2 = blackboard.params.leashRadius * blackboard.params.leashRadius;

        let prey: THREE.Vector3 | null = null;
        let bestDist2 = Infinity;
        for (const other of result.entities) {
            if (other.value >= entity.value || other.value > preyValueCeiling) continue;
            if (home.distanceToSquared(other.position) > leashR2) continue;
            const d2 = entity.position.distanceToSquared(other.position);
            if (d2 < bestDist2) { bestDist2 = d2; prey = other.position; }
        }
        if (!prey) {
            blackboard.set("chaseTimer", 0);
            return NodeStatus.Failure;
        }

        const chaseTimer = (blackboard.get<number>("chaseTimer") ?? 0) + delta;
        if (chaseTimer > CHASE_GIVEUP_TIME) {
            blackboard.set("chaseCooldown", CHASE_COOLDOWN);
            blackboard.set("chaseTimer", 0);
            return NodeStatus.Failure;
        }
        blackboard.set("chaseTimer", chaseTimer);

        const dx = prey.x - entity.position.x;
        const dz = prey.z - entity.position.z;
        ctx.moveDir.set(dx, dz).normalize();
        blackboard.set("state", "chase");
        return NodeStatus.Running;
    });
}

/**
 * Sneaks up on a vulnerable tail cube on ANY nearby entity — including ones
 * far too big to chase head-on via chaseWeakerPrey — as long as: the entity
 * is currently brave enough to risk it (see Blackboard.braveness), the
 * target's weakest tail cube is actually small enough to eat, the approach
 * is reachable within leash range, and the target isn't currently facing us
 * (sneaking up on something that's already looking at you isn't sneaking).
 * The bite itself still just happens passively via EntityEating's proximity
 * check once close enough — this only supplies the "go there" decision that
 * was previously entirely missing, which is why bots never bothered trying.
 */
function snipeVulnerableTail(home: THREE.Vector3): BTNode<BotContext> {
    return new Action((ctx) => {
        const { entity, blackboard } = ctx;
        if (blackboard.braveness < BRAVE_THRESHOLD) return NodeStatus.Failure;

        const result = SimWorld.query(
            entity.position, blackboard.params.awarenessRadius, entity,
            { excludePlayer: blackboard.ignorePlayer },
        );
        const leashR2 = blackboard.params.leashRadius * blackboard.params.leashRadius;

        let targetPos: THREE.Vector3 | null = null;
        let bestDist2 = Infinity;
        for (const other of result.entities) {
            const weakest = other.tail[other.tail.length - 1];
            if (!weakest || weakest.value > entity.value) continue;
            if (isFacingTarget(other.position, other.eatPosition, entity.position)) continue;
            if (home.distanceToSquared(weakest.position) > leashR2) continue;
            const d2 = entity.position.distanceToSquared(weakest.position);
            if (d2 < bestDist2) { bestDist2 = d2; targetPos = weakest.position; }
        }
        if (!targetPos) return NodeStatus.Failure;

        const dx = targetPos.x - entity.position.x;
        const dz = targetPos.z - entity.position.z;
        ctx.moveDir.set(dx, dz).normalize();
        blackboard.set("state", "snipe");
        return NodeStatus.Running;
    });
}

// Wiggle bounds for the food-seek approach — a slow random-walk heading
// offset so bots weave toward food like real foraging instead of tracing a
// razor-straight, robotic line.
const FOOD_WIGGLE_RATE = 1.5; // radians/sec of max drift in the wiggle angle
const FOOD_WIGGLE_MAX  = 0.6; // radians (~34°) clamp on either side of the direct heading
// Multiple of eatRadius within which the wiggle fades out and steering snaps
// tight (see CLOSE_STEER_LERP) — right up against the food, the entity's
// forward-offset mouth has to line up precisely, and noisy heading here just
// makes it circle without ever eating. Wiggle is for the open-field search,
// not the final approach.
const ARRIVAL_RADIUS_MULT = 3;

function seekNearestFood(home: THREE.Vector3): BTNode<BotContext> {
    return new Action((ctx) => {
        const { entity, blackboard, delta } = ctx;
        const result = SimWorld.query(entity.position, blackboard.params.awarenessRadius, entity);
        blackboard.set("foodSeen", result.food.length);
        if (result.food.length === 0) {
            blackboard.set("foodReachable", 0);
            return NodeStatus.Failure;
        }

        // Ignore food outside our leash range from home. Without this, a bot
        // near its leash edge can spot food that's just beyond leashRadius,
        // head for it, get yanked back by returnToLeash before arriving, then
        // immediately re-target the same still-nearest food once released —
        // an endless walk-out/walk-back loop that looks like a scripted path
        // rather than exploration.
        const leashR2 = blackboard.params.leashRadius * blackboard.params.leashRadius;
        let nearest: THREE.Vector3 | null = null;
        let bestDist2 = Infinity;
        let reachable = 0;
        for (const f of result.food) {
            if (home.distanceToSquared(f) > leashR2) continue;
            reachable++;
            const d2 = entity.position.distanceToSquared(f);
            if (d2 < bestDist2) { bestDist2 = d2; nearest = f; }
        }
        blackboard.set("foodReachable", reachable);
        if (!nearest) return NodeStatus.Failure;

        const dx = nearest.x - entity.position.x;
        const dz = nearest.z - entity.position.z;
        const dist = Math.sqrt(bestDist2);
        blackboard.set("targetDist", dist);

        const arrivalRadius = entity.eatRadius * ARRIVAL_RADIUS_MULT;
        const arrivalT = Math.min(1, dist / arrivalRadius); // 1 = far (full wiggle), 0 = on top of it (no wiggle, max steer urgency)
        blackboard.set("steerUrgency", 1 - arrivalT);

        let wiggle = blackboard.get<number>("foodWiggle") ?? (Math.random() - 0.5) * 2 * FOOD_WIGGLE_MAX;
        wiggle += (Math.random() - 0.5) * FOOD_WIGGLE_RATE * delta;
        wiggle = Math.max(-FOOD_WIGGLE_MAX, Math.min(FOOD_WIGGLE_MAX, wiggle));
        blackboard.set("foodWiggle", wiggle);

        const dir = new THREE.Vector2(dx, dz).normalize().rotateAround(ORIGIN_2D, wiggle * arrivalT);
        ctx.moveDir.copy(dir);
        blackboard.set("state", "seekFood");
        return NodeStatus.Running;
    });
}

const WANDER_RETARGET_INTERVAL = 2.5; // seconds between new wander headings

function wander(): BTNode<BotContext> {
    return new Action((ctx) => {
        const { blackboard, delta } = ctx;
        let timer = blackboard.get<number>("wanderTimer") ?? 0;
        let heading = blackboard.get<number>("wanderHeading") ?? Math.random() * Math.PI * 2;

        timer -= delta;
        if (timer <= 0) {
            heading += (Math.random() - 0.5) * Math.PI; // turn up to +-90 degrees
            timer = WANDER_RETARGET_INTERVAL;
        }
        blackboard.set("wanderTimer", timer);
        blackboard.set("wanderHeading", heading);

        ctx.moveDir.set(Math.sin(heading), Math.cos(heading)).multiplyScalar(blackboard.params.wanderSpeed);
        blackboard.set("state", "wander");
        return NodeStatus.Running;
    });
}
