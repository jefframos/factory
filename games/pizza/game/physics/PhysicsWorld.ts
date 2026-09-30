// PhysicsWorld.ts
//
// Owns every RigidBody in a scene and steps them each frame: apply gravity
// to dynamic bodies' velocity, integrate position one axis at a time, and
// push back out of any body it now overlaps (classic collide-and-slide —
// resolving X, then Z, then Y separately means sliding along a wall/box
// instead of getting stuck on the first axis that overlaps). Static bodies
// are never moved by this, only collided against. Two bodies only ever
// interact — physically OR via events — if shouldInteract() says their
// layer/mask allow it (see PhysicsConstants.ts's Layers), and a body with
// isTrigger=true never gets physically resolved at all (see moveAxis()).
//
// After moving everyone, updateContacts() does one broad-phase overlap pass
// (with a small positive skin, see CONTACT_SKIN) to fire
// onCollisionEnter/Stay/Exit for solid pairs and onTriggerEnter/Stay/Exit
// for trigger pairs — see RigidBody.ts's own doc for the full event list.
//
// One PhysicsWorld per scene — the scene creates it, calls register() for
// every RigidBody-bearing entity, and calls step(delta) once per frame
// (see PizzaScene).

import * as THREE from 'three';
import RigidBody from './RigidBody';
import { CONTACT_SKIN, GRAVITY, MAX_PHYSICS_DELTA } from './PhysicsConstants';

type Axis = 'x' | 'y' | 'z';

/**
 * Diagnostic threshold for pushToFace()'s own console.warn (see there) — bigger than any
 * legitimate single-axis overlap a normal-sized dynamic body (the player) should ever have
 * against a normal-sized static one, so a warning firing means something is actually wrong
 * (e.g. a body overlapping a MUCH bigger box than intended, like the ground plane's own
 * huge half-extents) rather than an ordinary contact.
 */
const PUSH_OUT_WARN_DISTANCE = 3;

/** moveAxis(): how far past a face still counts as "came from that side" — float slack for a body resting flush against it. */
const SWEEP_EPSILON = 1e-4;
/** depenetrate(): top speed (world units/second) a body already inside an obstacle is eased out at — quick, but a slide, never a teleport. */
const DEPENETRATION_SPEED = 6;
/** exitDistance(): how many boxes deep a way out is followed (one box into the next) before giving up on that direction. */
const DEPENETRATION_PASSES = 8;
/** depenetrate(): a body sunk at most this far into the top of something it stands on is lifted onto it (the ground), instead of slid out sideways. */
const DEPENETRATION_STEP_UP = 0.3;
const HORIZONTAL_AXES: readonly Axis[] = ['x', 'z'];

function pairKey(a: RigidBody, b: RigidBody): string {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

/** Best-effort human-readable label for whichever entity a RigidBody belongs to — the entity's own class name, plus a `providerType` field if it has one (e.g. ResourceNode) since that's usually the more useful name (e.g. "crystalDeposit" beats "ResourceNode"). Physics doesn't otherwise know about game-specific entity types, so this stays duck-typed rather than importing them. */
function describeEntity(body: RigidBody): string {
    const entity = body.entity as { constructor: { name: string }; providerType?: string };
    return entity.providerType ?? entity.constructor.name;
}

export default class PhysicsWorld {
    private readonly bodies: RigidBody[] = [];
    /** Pairs that overlapped as of the last updateContacts() call — compared against this step's overlaps to tell enter from stay from exit. Keyed by pairKey() since two RigidBodies have no other cheap, stable joint identity. */
    private readonly activePairs = new Map<string, [RigidBody, RigidBody]>();

    private readonly scratchMin = new THREE.Vector3();
    private readonly scratchMax = new THREE.Vector3();
    private readonly otherMin = new THREE.Vector3();
    private readonly otherMax = new THREE.Vector3();

    /** Bumped on every register()/unregister() — lets a reader (e.g. store/nav/StoreNavGrid's rebuild check) skip work while the set of bodies hasn't changed. */
    public get version(): number {
        return this.bodiesVersion;
    }
    private bodiesVersion = 0;

    /** Read-only walk over every registered body — for queries like "which static solids sit inside this area" (see Store.ts's nav grid). */
    public forEachBody(visit: (body: RigidBody) => void): void {
        for (const body of this.bodies) {
            visit(body);
        }
    }

    public register(body: RigidBody): void {
        this.bodies.push(body);
        this.bodiesVersion++;
    }

    /** Removes the body AND immediately fires Exit for any pair it was still active in — otherwise a body destroyed mid-overlap would just silently vanish from the next contact pass with no Exit ever reaching its (already-gone) listeners, or reach them a frame late for no reason. */
    public unregister(body: RigidBody): void {
        const index = this.bodies.indexOf(body);
        if (index !== -1) {
            this.bodies.splice(index, 1);
            this.bodiesVersion++;
        }

        for (const [key, pair] of this.activePairs) {
            if (pair[0] !== body && pair[1] !== body) {
                continue;
            }
            this.fireExit(pair[0], pair[1]);
            this.activePairs.delete(key);
        }
    }

    public step(rawDelta: number): void {
        // See MAX_PHYSICS_DELTA's doc — never integrate more than this in one call, no matter how long the real gap since the last frame was.
        const delta = Math.min(rawDelta, MAX_PHYSICS_DELTA);

        for (const body of this.bodies) {
            if (body.isStatic) {
                continue;
            }

            if (body.useGravity) {
                body.velocity.y += GRAVITY * delta;
            }

            this.moveAxis(body, 'x', delta);
            this.moveAxis(body, 'z', delta);

            body.grounded = false;
            this.moveAxis(body, 'y', delta);

            if (!body.isTrigger) {
                this.depenetrate(body, delta);
            }
        }

        this.updateContacts();
    }

    /**
     * True if `body` currently overlaps ANY other body it's allowed to interact with — solid
     * OR trigger alike — using the same strict AABB check overlaps() itself uses for push-out
     * resolution, just exposed publicly. For a SOLID other body, normal collide-and-slide
     * movement already keeps `body` from ever truly interpenetrating it, so that half is
     * mostly a safety net; the TRIGGER half is the one that actually matters for most callers
     * — a body can freely stand inside a trigger (that's the whole point of one), so nothing
     * else would otherwise flag it. e.g. PizzaScene's "is the player standing somewhere safe to
     * respawn" check (see PlayerPositionStorage.ts's own doc) wants NEITHER kind: not stuck
     * inside a wall, and not inside a queue/shop/building zone's own trigger either, since
     * respawning there would just re-trigger its enter logic (or its footprint) immediately.
     */
    public isOverlappingAny(body: RigidBody): boolean {
        for (const other of this.bodies) {
            if (other === body || !this.shouldInteract(body, other) || !this.overlaps(body, other)) {
                continue;
            }
            return true;
        }
        return false;
    }

    /** Only bodies whose layer/mask allow it (see PhysicsConstants.ts's Layers) interact at all — neither physical push-out nor any collision/trigger event. Symmetric: each side's mask has to include the other's layer. */
    private shouldInteract(a: RigidBody, b: RigidBody): boolean {
        return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
    }

    /**
     * Moves `body` along one axis, then resolves what it ran into — DIRECTIONALLY: an obstacle
     * this move entered is pushed back out through the face the body came from, never through to
     * the far face. The old "whichever face is nearer" rule shoved a body straight through a thin
     * wall (a 0.5-unit fence) once it got past its middle, and — when a body was already inside
     * something (pushed from one overlapping fence into its neighbour, or a collider created on
     * top of it) — teleported it along whatever axis it happened to be walking on, up to the full
     * length of the box. An obstacle the body was ALREADY overlapping on this axis before the move
     * isn't this move's to resolve: depenetrate() eases it out afterwards.
     */
    private moveAxis(body: RigidBody, axis: Axis, delta: number): void {
        const position = body.entity.transform.position;
        body.getMin(this.scratchMin);
        body.getMax(this.scratchMax);
        const startMin = this.scratchMin[axis];
        const startMax = this.scratchMax[axis];
        position[axis] += body.velocity[axis] * delta;

        // Triggers are never physically resolved — see this class's own doc.
        if (body.isTrigger) {
            return;
        }

        for (const other of this.bodies) {
            if (other === body || other.isTrigger || !this.shouldInteract(body, other) || !this.overlaps(body, other)) {
                continue;
            }
            // A horizontal-only obstacle (see RigidBody.blocksVertical's own doc) never
            // resolves the Y axis — only the ground plane holds anything up or stops a fall.
            if (axis === 'y' && !other.blocksVertical) {
                continue;
            }

            other.getMin(this.otherMin);
            other.getMax(this.otherMax);
            if (startMax <= this.otherMin[axis] + SWEEP_EPSILON) {
                this.pushToFace(body, other, axis, -1);
            } else if (startMin >= this.otherMax[axis] - SWEEP_EPSILON) {
                this.pushToFace(body, other, axis, 1);
            }
            // else: already inside `other` along this axis before moving — see depenetrate().
        }
    }

    /**
     * Places `body` flush against `other`'s face on `axis` — `side` -1 = its min face (the body
     * came from below/behind), +1 = its max face — and stops velocity heading back into it.
     */
    private pushToFace(body: RigidBody, other: RigidBody, axis: Axis, side: -1 | 1): void {
        body.getMin(this.scratchMin);
        body.getMax(this.scratchMax);
        other.getMin(this.otherMin);
        other.getMax(this.otherMax);
        const position = body.entity.transform.position;
        const push = side < 0 ? this.scratchMax[axis] - this.otherMin[axis] : this.otherMax[axis] - this.scratchMin[axis];
        if (push > PUSH_OUT_WARN_DISTANCE) {
            console.warn(`[PhysicsWorld] large push-out on axis "${axis}": ${push.toFixed(2)} units — ${describeEntity(body)} pushed by ${describeEntity(other)}`);
        }
        if (side < 0) {
            position[axis] -= push;
            if (body.velocity[axis] > 0) {
                body.velocity[axis] = 0;
            }
        } else {
            position[axis] += push;
            if (axis === 'y' && body.velocity.y < 0) {
                body.grounded = true;
            }
            if (body.velocity[axis] < 0) {
                body.velocity[axis] = 0;
            }
        }
    }

    /**
     * Eases a body that's still INSIDE something after its move (see moveAxis()'s own doc) back
     * out, in two parts:
     *   1. Sunk a little into something it stands on (a blocksVertical box whose top is within
     *      DEPENETRATION_STEP_UP of the body's feet — the ground): lifted onto it in full.
     *   2. Otherwise, for each of ±X/±Z, how far it would have to slide to clear EVERYTHING it
     *      would pass through that way (see exitDistance() — following one box into the next, so
     *      inside a group of touching boxes it heads for the group's real edge instead of
     *      ping-ponging between neighbours), then slides the shortest of those at most
     *      DEPENETRATION_SPEED * delta per step — a quick slide out, never a teleport.
     */
    private depenetrate(body: RigidBody, delta: number): void {
        const position = body.entity.transform.position;

        for (const other of this.bodies) {
            if (!this.isSolidAgainst(body, other) || !other.blocksVertical || !this.overlaps(body, other)) {
                continue;
            }
            body.getMin(this.scratchMin);
            other.getMax(this.otherMax);
            const sink = this.otherMax.y - this.scratchMin.y;
            if (sink > 0 && sink <= DEPENETRATION_STEP_UP) {
                position.y += sink;
                body.grounded = true;
                body.velocity.y = Math.max(0, body.velocity.y);
            }
        }

        if (!this.bodies.some(other => this.isSolidAgainst(body, other) && this.overlaps(body, other))) {
            return;
        }
        let bestAxis: Axis = 'x';
        let bestSign = 1;
        let bestDistance = Infinity;
        for (const axis of HORIZONTAL_AXES) {
            for (const sign of [-1, 1] as const) {
                const distance = this.exitDistance(body, axis, sign);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestAxis = axis;
                    bestSign = sign;
                }
            }
        }
        if (Number.isFinite(bestDistance)) {
            position[bestAxis] += bestSign * Math.min(bestDistance, DEPENETRATION_SPEED * delta);
        }
    }

    /** A non-trigger body `body` can collide with (layers/masks allowing). */
    private isSolidAgainst(body: RigidBody, other: RigidBody): boolean {
        return other !== body && !other.isTrigger && this.shouldInteract(body, other);
    }

    /**
     * How far `body` would have to slide along `axis` in direction `sign` to overlap nothing at
     * all: clears each box it overlaps, then re-checks from there (the next box may start where
     * the last ends), up to DEPENETRATION_PASSES boxes deep. Infinity if still inside after that.
     */
    private exitDistance(body: RigidBody, axis: Axis, sign: -1 | 1): number {
        body.getMin(this.scratchMin);
        body.getMax(this.scratchMax);
        const baseMin = this.scratchMin.clone();
        const baseMax = this.scratchMax.clone();
        let distance = 0;
        for (let pass = 0; pass < DEPENETRATION_PASSES; pass++) {
            let furthest = 0;
            for (const other of this.bodies) {
                if (!this.isSolidAgainst(body, other)) {
                    continue;
                }
                other.getMin(this.otherMin);
                other.getMax(this.otherMax);
                const shift = sign * distance;
                const minX = baseMin.x + (axis === 'x' ? shift : 0);
                const maxX = baseMax.x + (axis === 'x' ? shift : 0);
                const minZ = baseMin.z + (axis === 'z' ? shift : 0);
                const maxZ = baseMax.z + (axis === 'z' ? shift : 0);
                const overlapping = minX < this.otherMax.x && maxX > this.otherMin.x
                    && baseMin.y < this.otherMax.y && baseMax.y > this.otherMin.y
                    && minZ < this.otherMax.z && maxZ > this.otherMin.z;
                if (!overlapping) {
                    continue;
                }
                const bodyEdge = sign > 0 ? baseMin[axis] + shift : baseMax[axis] + shift;
                const need = sign > 0 ? this.otherMax[axis] - bodyEdge : bodyEdge - this.otherMin[axis];
                furthest = Math.max(furthest, need);
            }
            if (furthest <= 0) {
                return distance;
            }
            distance += furthest;
        }
        return Infinity;
    }

    /** Strict overlap test — used ONLY for push-out resolution. Deliberately has no skin: it must stay exactly this strict, since a resting body (zero gap) reading as "still overlapping" here would make push-out fight itself every frame instead of settling (this is the same invariant the throw-out regression test in scripts/test-physics.ts pins down). */
    private overlaps(a: RigidBody, b: RigidBody): boolean {
        a.getMin(this.scratchMin);
        a.getMax(this.scratchMax);
        b.getMin(this.otherMin);
        b.getMax(this.otherMax);

        return (
            this.scratchMin.x < this.otherMax.x && this.scratchMax.x > this.otherMin.x &&
            this.scratchMin.y < this.otherMax.y && this.scratchMax.y > this.otherMin.y &&
            this.scratchMin.z < this.otherMax.z && this.scratchMax.z > this.otherMin.z
        );
    }

    /** Same test as overlaps(), expanded by CONTACT_SKIN on every face — used ONLY for the contact/event query below, so a body resting exactly touching another (push-out's steady state) still reads as "in contact" and keeps firing Stay instead of flickering Enter/Exit every frame. */
    private overlapsWithSkin(a: RigidBody, b: RigidBody): boolean {
        a.getMin(this.scratchMin);
        a.getMax(this.scratchMax);
        b.getMin(this.otherMin);
        b.getMax(this.otherMax);

        return (
            this.scratchMin.x - CONTACT_SKIN < this.otherMax.x && this.scratchMax.x + CONTACT_SKIN > this.otherMin.x &&
            this.scratchMin.y - CONTACT_SKIN < this.otherMax.y && this.scratchMax.y + CONTACT_SKIN > this.otherMin.y &&
            this.scratchMin.z - CONTACT_SKIN < this.otherMax.z && this.scratchMax.z + CONTACT_SKIN > this.otherMin.z
        );
    }

    /** One broad-phase pass over every pair, comparing this step's overlaps against last step's (activePairs) to dispatch Enter/Stay/Exit — see this class's own doc and RigidBody.ts's event list. O(n^2); fine for the handful of bodies a scene like this has. */
    private updateContacts(): void {
        const current = new Map<string, [RigidBody, RigidBody]>();

        for (let i = 0; i < this.bodies.length; i++) {
            for (let j = i + 1; j < this.bodies.length; j++) {
                const a = this.bodies[i];
                const b = this.bodies[j];
                if (!this.shouldInteract(a, b) || !this.overlapsWithSkin(a, b)) {
                    continue;
                }
                current.set(pairKey(a, b), [a, b]);
            }
        }

        for (const [key, pair] of current) {
            if (this.activePairs.has(key)) {
                this.fireStay(pair[0], pair[1]);
            } else {
                this.fireEnter(pair[0], pair[1]);
            }
        }

        for (const [key, pair] of this.activePairs) {
            if (!current.has(key)) {
                this.fireExit(pair[0], pair[1]);
            }
        }

        this.activePairs.clear();
        for (const [key, pair] of current) {
            this.activePairs.set(key, pair);
        }
    }

    private fireEnter(a: RigidBody, b: RigidBody): void {
        if (a.isTrigger || b.isTrigger) {
            a.onTriggerEnter.dispatch(b);
            b.onTriggerEnter.dispatch(a);
        } else {
            a.onCollisionEnter.dispatch(b);
            b.onCollisionEnter.dispatch(a);
        }
    }

    private fireStay(a: RigidBody, b: RigidBody): void {
        if (a.isTrigger || b.isTrigger) {
            a.onTriggerStay.dispatch(b);
            b.onTriggerStay.dispatch(a);
        } else {
            a.onCollisionStay.dispatch(b);
            b.onCollisionStay.dispatch(a);
        }
    }

    private fireExit(a: RigidBody, b: RigidBody): void {
        if (a.isTrigger || b.isTrigger) {
            a.onTriggerExit.dispatch(b);
            b.onTriggerExit.dispatch(a);
        } else {
            a.onCollisionExit.dispatch(b);
            b.onCollisionExit.dispatch(a);
        }
    }
}
