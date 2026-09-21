// PhysicsWorld.ts
//
// Owns every RigidBody in a scene and steps them each frame: apply gravity
// to dynamic bodies' velocity, integrate position one axis at a time, and
// push back out of any body it now overlaps (classic collide-and-slide —
// resolving X, then Z, then Y separately means sliding along a wall/box
// instead of getting stuck on the first axis that overlaps). Static bodies
// are never moved by this, only collided against.
//
// After moving everyone, updateContacts() does one broad-phase overlap pass
// to fire onCollisionEnter/Stay/Exit for solid pairs and onTriggerEnter/
// Stay/Exit for trigger pairs — see RigidBody.ts's own doc for the full
// event list.

import * as THREE from 'three';
import RigidBody from './RigidBody';
import { CONTACT_SKIN } from './PhysicsConstants';
import { DEFAULT_WORLD_SETTINGS, type WorldSettings } from './WorldSettings';

type Axis = 'x' | 'y' | 'z';

/**
 * Minimum GENUINE penetration (world units) overlaps() requires on every axis before
 * treating two bodies as overlapping for push-out resolution — see that method's own doc
 * for why. Comfortably above ordinary floating-point noise (repeated getMin()/getMax()
 * arithmetic on a body resting exactly flush against another routinely leaves a residue on
 * the order of 1e-17, see the bug this constant fixes) and comfortably below any real
 * overlap a moving body ever produces in one tick (typically 1e-3 or larger).
 */
const RESOLUTION_EPSILON = 1e-4;

function pairKey(a: RigidBody, b: RigidBody): string {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

export default class PhysicsWorld {
    /** Read LIVE every step() — mutate in place (e.g. from a dev-GUI) to retune gravity/max-delta with no rebuild. Pass a game's own settings object into the constructor to share identity with whatever else tunes it. */
    public readonly settings: WorldSettings;

    private readonly bodies: RigidBody[] = [];
    /** Pairs that overlapped as of the last updateContacts() call — compared against this step's overlaps to tell enter from stay from exit. */
    private readonly activePairs = new Map<string, [RigidBody, RigidBody]>();

    private readonly scratchMin = new THREE.Vector3();
    private readonly scratchMax = new THREE.Vector3();
    private readonly otherMin = new THREE.Vector3();
    private readonly otherMax = new THREE.Vector3();

    public constructor(settings: WorldSettings = { ...DEFAULT_WORLD_SETTINGS }) {
        this.settings = settings;
    }

    public register(body: RigidBody): void {
        this.bodies.push(body);
    }

    /** Removes the body AND immediately fires Exit for any pair it was still active in. */
    public unregister(body: RigidBody): void {
        const index = this.bodies.indexOf(body);
        if (index !== -1) {
            this.bodies.splice(index, 1);
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
        const delta = Math.min(rawDelta, this.settings.maxPhysicsDelta);

        for (const body of this.bodies) {
            if (body.isStatic) {
                continue;
            }

            if (body.useGravity) {
                body.velocity.y += this.settings.gravity * delta;
            }

            this.moveAxis(body, 'x', delta);
            this.moveAxis(body, 'z', delta);

            body.grounded = false;
            this.moveAxis(body, 'y', delta);
        }

        this.updateContacts();
    }

    /** True if `body` currently overlaps ANY other body it's allowed to interact with. */
    public isOverlappingAny(body: RigidBody): boolean {
        for (const other of this.bodies) {
            if (other === body || !this.shouldInteract(body, other) || !this.overlaps(body, other)) {
                continue;
            }
            return true;
        }
        return false;
    }

    private shouldInteract(a: RigidBody, b: RigidBody): boolean {
        return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
    }

    private moveAxis(body: RigidBody, axis: Axis, delta: number): void {
        const position = body.entity.transform.position;
        position[axis] += body.velocity[axis] * delta;

        if (body.isTrigger) {
            return;
        }

        for (const other of this.bodies) {
            if (other === body || other.isTrigger || !this.shouldInteract(body, other) || !this.overlaps(body, other)) {
                continue;
            }
            if (axis === 'y' && !other.blocksVertical) {
                continue;
            }

            this.pushOut(body, other, axis);
        }
    }

    /** Pushes `body` out of `other` along a single axis, taking whichever side has the smaller overlap, and zeroes/clamps velocity on that axis. */
    private pushOut(body: RigidBody, other: RigidBody, axis: Axis): void {
        body.getMin(this.scratchMin);
        body.getMax(this.scratchMax);
        other.getMin(this.otherMin);
        other.getMax(this.otherMax);

        const overlapNegative = this.scratchMax[axis] - this.otherMin[axis];
        const overlapPositive = this.otherMax[axis] - this.scratchMin[axis];
        const position = body.entity.transform.position;

        if (overlapNegative < overlapPositive) {
            position[axis] -= overlapNegative;
            if (body.velocity[axis] > 0) {
                body.velocity[axis] = 0;
            }
        } else {
            position[axis] += overlapPositive;
            if (axis === 'y' && body.velocity.y < 0) {
                body.grounded = true;
            }
            if (body.velocity[axis] < 0) {
                body.velocity[axis] = 0;
            }
        }
    }

    /**
     * Strict overlap test — used ONLY for push-out resolution. Requires GENUINE penetration
     * (see RESOLUTION_EPSILON's own doc), not just "no skin": a body resting exactly flush
     * against another (the steady state push-out itself produces) routinely carries a
     * floating-point residue on the order of 1e-17 on the axis it's resting against — with a
     * bare `<`/`>` zero-tolerance test, that residue alone reads as "genuinely overlapping"
     * on that axis. For a resting player against a vast, thin floor slab, that spuriously
     * satisfies the OTHER two axes' own overlap check too (the player's tiny footprint sits
     * nowhere near the slab's real edges), incorrectly triggering push-out resolution on an
     * axis (e.g. X) that was never actually penetrating anything — and for a static body far
     * larger than the moving one, BOTH the negative- and positive-side overlap distances come
     * out roughly equal to half the static body's own size, so pushOut() shoves the moving
     * body to that axis's edge (e.g. a 900-unit floor slab teleports the player to x≈450),
     * which can then land it outside the SAME body's bounds on that axis, permanently
     * breaking future collision against it (observed as the player free-falling through the
     * floor forever, ungrounded, after any resize/reposition landed the residue negative).
     */
    private overlaps(a: RigidBody, b: RigidBody): boolean {
        a.getMin(this.scratchMin);
        a.getMax(this.scratchMax);
        b.getMin(this.otherMin);
        b.getMax(this.otherMax);

        return (
            this.scratchMin.x < this.otherMax.x - RESOLUTION_EPSILON && this.scratchMax.x > this.otherMin.x + RESOLUTION_EPSILON &&
            this.scratchMin.y < this.otherMax.y - RESOLUTION_EPSILON && this.scratchMax.y > this.otherMin.y + RESOLUTION_EPSILON &&
            this.scratchMin.z < this.otherMax.z - RESOLUTION_EPSILON && this.scratchMax.z > this.otherMin.z + RESOLUTION_EPSILON
        );
    }

    /** Same test as overlaps(), expanded by CONTACT_SKIN on every face — used ONLY for the contact/event query. */
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
