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

function pairKey(a: RigidBody, b: RigidBody): string {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
}

export default class PhysicsWorld {
    private readonly bodies: RigidBody[] = [];
    /** Pairs that overlapped as of the last updateContacts() call — compared against this step's overlaps to tell enter from stay from exit. Keyed by pairKey() since two RigidBodies have no other cheap, stable joint identity. */
    private readonly activePairs = new Map<string, [RigidBody, RigidBody]>();

    private readonly scratchMin = new THREE.Vector3();
    private readonly scratchMax = new THREE.Vector3();
    private readonly otherMin = new THREE.Vector3();
    private readonly otherMax = new THREE.Vector3();

    public register(body: RigidBody): void {
        this.bodies.push(body);
    }

    /** Removes the body AND immediately fires Exit for any pair it was still active in — otherwise a body destroyed mid-overlap would just silently vanish from the next contact pass with no Exit ever reaching its (already-gone) listeners, or reach them a frame late for no reason. */
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
        }

        this.updateContacts();
    }

    /** Only bodies whose layer/mask allow it (see PhysicsConstants.ts's Layers) interact at all — neither physical push-out nor any collision/trigger event. Symmetric: each side's mask has to include the other's layer. */
    private shouldInteract(a: RigidBody, b: RigidBody): boolean {
        return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
    }

    private moveAxis(body: RigidBody, axis: Axis, delta: number): void {
        const position = body.entity.transform.position;
        position[axis] += body.velocity[axis] * delta;

        // Triggers are never physically resolved — see this class's own doc.
        if (body.isTrigger) {
            return;
        }

        for (const other of this.bodies) {
            if (other === body || other.isTrigger || !this.shouldInteract(body, other) || !this.overlaps(body, other)) {
                continue;
            }

            this.pushOut(body, other, axis);
        }
    }

    /** Pushes `body` out of `other` along a single axis, taking whichever side has the smaller overlap (so it pops out the nearest face), and zeroes/clamps velocity on that axis. */
    private pushOut(body: RigidBody, other: RigidBody, axis: Axis): void {
        body.getMin(this.scratchMin);
        body.getMax(this.scratchMax);
        other.getMin(this.otherMin);
        other.getMax(this.otherMax);

        const overlapNegative = this.scratchMax[axis] - this.otherMin[axis];
        const overlapPositive = this.otherMax[axis] - this.scratchMin[axis];
        const position = body.entity.transform.position;

        if (overlapNegative < overlapPositive) {
            // body sits on the min side of other (e.g. hitting its underside from below) — push it back.
            position[axis] -= overlapNegative;
            if (body.velocity[axis] > 0) {
                body.velocity[axis] = 0;
            }
        } else {
            // body sits on the max side of other (e.g. landing on top of it) — push it back.
            position[axis] += overlapPositive;
            if (axis === 'y' && body.velocity.y < 0) {
                body.grounded = true;
            }
            if (body.velocity[axis] < 0) {
                body.velocity[axis] = 0;
            }
        }
    }

    /** Strict overlap test — used ONLY for push-out resolution. Deliberately has no skin: it must stay exactly this strict, since a resting body (zero gap) reading as "still overlapping" here would make pushOut() fight itself every frame instead of settling (this is the same invariant the throw-out regression test in scripts/test-physics.ts pins down). */
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
