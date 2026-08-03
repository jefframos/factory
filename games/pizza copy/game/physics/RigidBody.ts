// RigidBody.ts
//
// A box collider + velocity, attached to an Entity as a Component. Purely
// kinematic — no mass/impulses/rotation — PhysicsWorld integrates velocity
// into the entity's transform and pushes it back out of anything it
// overlaps (see PhysicsWorld.step()). A `static` body never moves (floor,
// walls, scenery) but still blocks dynamic bodies.
//
// The box is centered on `entity.transform.position + centerOffset`, sized
// `halfExtents * 2`. When PHYSICS_DEBUG is on, awake() attaches a
// wireframe box (as a child of the entity's transform, so it tracks it for
// free) sized/positioned to match — yellow for a trigger, green otherwise.
//
// awake()/destroy() self-register/unregister with `entity.world.physics` —
// callers just addComponent() this onto a World-spawned entity, no manual
// PhysicsWorld.register() bookkeeping needed. (A no-op if entity.world is
// unset, e.g. a bare `new Entity()` built outside a World for a test.)
//
// Events (all `Signal<RigidBody>`, firing with the OTHER body involved) —
// register directly on the instance, e.g.
// `playerRigidBody.onCollisionEnter.add(other => ...)`:
//   onCollisionEnter/Stay/Exit — fires for a pair where NEITHER side is a trigger; these
//     are the pairs PhysicsWorld also physically resolves (push-out).
//   onTriggerEnter/Stay/Exit   — fires for a pair where EITHER side has isTrigger=true;
//     these are never physically resolved (nothing gets pushed out), just detected.
// A pair only interacts at all (either kind of event, or physical push-out) if each
// body's `mask` includes the other's `layer` — see PhysicsConstants.ts's Layers/ALL_LAYERS
// and PhysicsWorld.shouldInteract().

import * as THREE from 'three';
import { Signal } from 'signals';
import Component from '../ecs/Component';
import { ALL_LAYERS, DEBUG_COLLIDER_COLOR, DEBUG_TRIGGER_COLOR, Layers, PHYSICS_DEBUG } from './PhysicsConstants';

export interface RigidBodyOptions {
    /** Half-width/height/depth of the box collider, world units. */
    halfExtents: THREE.Vector3;
    /** Static bodies never move and ignore gravity/velocity — use for floors, walls, obstacles. */
    isStatic?: boolean;
    /** Whether GRAVITY accumulates into velocity.y each frame — irrelevant for static bodies. */
    useGravity?: boolean;
    /** Collider center relative to entity.transform.position — e.g. (0, halfHeight, 0) so the transform's origin sits at the character's feet instead of its box's center. */
    centerOffset?: THREE.Vector3;
    /** If true, this body is never physically resolved (no push-out, doesn't block anything) — it only detects overlap and fires onTriggerEnter/Stay/Exit instead of onCollisionEnter/Stay/Exit. Default false. */
    isTrigger?: boolean;
    /** Which layer bucket this body is in — see Layers in PhysicsConstants.ts. Default Layers.Default. */
    layer?: number;
    /** Which layers this body is willing to interact with (physically or via triggers) — see ALL_LAYERS/Layers in PhysicsConstants.ts. Default ALL_LAYERS. */
    mask?: number;
}

export default class RigidBody extends Component {
    private static nextId = 0;
    /** Stable per-instance id — used by PhysicsWorld to key contact pairs (two RigidBodies have no other cheap, stable identity to build a Map key from). */
    public readonly id = RigidBody.nextId++;

    public readonly halfExtents: THREE.Vector3;
    public readonly centerOffset: THREE.Vector3;
    public readonly velocity = new THREE.Vector3();
    public readonly isStatic: boolean;
    public readonly useGravity: boolean;
    public readonly isTrigger: boolean;
    public readonly layer: number;
    public readonly mask: number;
    /** Set by PhysicsWorld each step — true only if this body is resting on something directly below it. */
    public grounded = false;

    public readonly onCollisionEnter: Signal<RigidBody> = new Signal();
    public readonly onCollisionStay: Signal<RigidBody> = new Signal();
    public readonly onCollisionExit: Signal<RigidBody> = new Signal();
    public readonly onTriggerEnter: Signal<RigidBody> = new Signal();
    public readonly onTriggerStay: Signal<RigidBody> = new Signal();
    public readonly onTriggerExit: Signal<RigidBody> = new Signal();

    private debugMesh?: THREE.LineSegments;

    public constructor(options: RigidBodyOptions) {
        super();
        this.halfExtents = options.halfExtents;
        this.centerOffset = options.centerOffset ?? new THREE.Vector3(0, 0, 0);
        this.isStatic = options.isStatic ?? false;
        this.useGravity = options.useGravity ?? !this.isStatic;
        this.isTrigger = options.isTrigger ?? false;
        this.layer = options.layer ?? Layers.Default;
        this.mask = options.mask ?? ALL_LAYERS;
    }

    public awake(): void {
        this.entity.world?.physics.register(this);

        if (!PHYSICS_DEBUG) {
            return;
        }

        const geometry = new THREE.BoxGeometry(
            this.halfExtents.x * 2,
            this.halfExtents.y * 2,
            this.halfExtents.z * 2,
        );
        this.debugMesh = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: this.isTrigger ? DEBUG_TRIGGER_COLOR : DEBUG_COLLIDER_COLOR }),
        );
        this.debugMesh.position.copy(this.centerOffset);
        this.entity.transform.add(this.debugMesh);
    }

    /** World-space box center — entity position plus this body's local offset. */
    public getCenter(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        return target.copy(this.entity.transform.position).add(this.centerOffset);
    }

    public getMin(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        return this.getCenter(target).sub(this.halfExtents);
    }

    public getMax(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        return this.getCenter(target).add(this.halfExtents);
    }

    public destroy(): void {
        this.entity.world?.physics.unregister(this);

        this.debugMesh?.geometry.dispose();
        (this.debugMesh?.material as THREE.Material | undefined)?.dispose();
        this.debugMesh?.removeFromParent();
    }
}
