// RigidBody.ts
//
// A box collider + velocity, attached to an Entity as a Component. Purely
// kinematic — no mass/impulses/rotation — PhysicsWorld integrates velocity
// into the entity's transform and pushes it back out of anything it
// overlaps (see PhysicsWorld.step()). A `static` body never moves (floor,
// walls) but still blocks dynamic bodies.
//
// The box is centered on `entity.transform.position + centerOffset`, sized
// `halfExtents * 2`.
//
// awake()/destroy() self-register/unregister with `entity.world.physics` —
// callers just addComponent() this onto a World-spawned entity.
//
// Events (all `Signal<RigidBody>`, firing with the OTHER body involved):
//   onCollisionEnter/Stay/Exit — fires for a pair where NEITHER side is a trigger.
//   onTriggerEnter/Stay/Exit   — fires for a pair where EITHER side has isTrigger=true.
// A pair only interacts at all if each body's `mask` includes the other's `layer`.

import * as THREE from 'three';
import { Signal } from 'signals';
import Component from 'core/ecs/Component';
import type { WorldBendService } from 'core/services/BendService';
import { ALL_LAYERS, DEBUG_COLLIDER_COLOR, DEBUG_COLLIDER_OPACITY, DEBUG_TRIGGER_COLOR, Layers, PHYSICS_DEBUG, PHYSICS_TRIGGER_DEBUG } from './PhysicsConstants';

export interface RigidBodyOptions {
    /** Half-width/height/depth of the box collider, world units. */
    halfExtents: THREE.Vector3;
    /** Static bodies never move and ignore gravity/velocity — use for floors, walls, obstacles. */
    isStatic?: boolean;
    /** Whether GRAVITY accumulates into velocity.y each frame — irrelevant for static bodies. */
    useGravity?: boolean;
    /** Collider center relative to entity.transform.position — e.g. (0, halfHeight, 0) so the transform's origin sits at the character's feet instead of its box's center. */
    centerOffset?: THREE.Vector3;
    /** If true, this body is never physically resolved — it only detects overlap and fires onTriggerEnter/Stay/Exit instead of onCollisionEnter/Stay/Exit. Default false. */
    isTrigger?: boolean;
    /** Which layer bucket this body is in — see Layers in PhysicsConstants.ts. Default Layers.Default. */
    layer?: number;
    /** Which layers this body is willing to interact with. Default ALL_LAYERS. */
    mask?: number;
    /** Whether OTHER bodies get pushed out of THIS one along the Y axis — default true. */
    blocksVertical?: boolean;
    /**
     * Whichever world-bend flavor the CALLER's own visual mesh for this body already uses
     * (BendService's plain radial dip, RunnerBendService's depth-only curve, ...) — applied to
     * the debug wireframe material (see awake()) so it curves along with the geometry it's
     * meant to outline instead of floating in flat, unbent space wherever the bend is actually
     * visible (i.e. anywhere far enough from the bend origin to matter). Omitted entirely
     * (rather than defaulted here) since RigidBody itself has no idea which bend flavor, if
     * any, a given scene is using — every caller already threads its own bendService through
     * to its OWN geometry the same explicit way (see ObstacleBuilder.ts/GateBuilder.ts/
     * WorldEnvironment.ts), so this just needs to be handed the same one.
     */
    bendService?: WorldBendService;
}

export default class RigidBody extends Component {
    private static nextId = 0;
    /** Stable per-instance id — used by PhysicsWorld to key contact pairs. */
    public readonly id = RigidBody.nextId++;

    public readonly halfExtents: THREE.Vector3;
    public readonly centerOffset: THREE.Vector3;
    public readonly velocity = new THREE.Vector3();
    public readonly isStatic: boolean;
    public readonly useGravity: boolean;
    public readonly isTrigger: boolean;
    public readonly layer: number;
    public readonly mask: number;
    public readonly blocksVertical: boolean;
    /** Set by PhysicsWorld each step — true only if this body is resting on something directly below it. */
    public grounded = false;

    public readonly onCollisionEnter: Signal<RigidBody> = new Signal();
    public readonly onCollisionStay: Signal<RigidBody> = new Signal();
    public readonly onCollisionExit: Signal<RigidBody> = new Signal();
    public readonly onTriggerEnter: Signal<RigidBody> = new Signal();
    public readonly onTriggerStay: Signal<RigidBody> = new Signal();
    public readonly onTriggerExit: Signal<RigidBody> = new Signal();

    private debugMesh?: THREE.LineSegments;
    private readonly bendService?: WorldBendService;

    public constructor(options: RigidBodyOptions) {
        super();
        this.halfExtents = options.halfExtents;
        this.centerOffset = options.centerOffset ?? new THREE.Vector3(0, 0, 0);
        this.isStatic = options.isStatic ?? false;
        this.useGravity = options.useGravity ?? !this.isStatic;
        this.isTrigger = options.isTrigger ?? false;
        this.layer = options.layer ?? Layers.Default;
        this.mask = options.mask ?? ALL_LAYERS;
        this.blocksVertical = options.blocksVertical ?? true;
        this.bendService = options.bendService;
    }

    public awake(): void {
        this.entity.world?.physics.register(this);
        this.buildDebugMesh();
    }

    /** (Re)builds the debug wireframe from the CURRENT halfExtents/centerOffset — a no-op unless this body's own PHYSICS_DEBUG/PHYSICS_TRIGGER_DEBUG flag is on. Called from awake(), and again from setSize() so a resized body's wireframe stays the right shape instead of showing its OLD size. */
    private buildDebugMesh(): void {
        if (!this.isTrigger && !PHYSICS_DEBUG) {
            return;
        }

        if (this.isTrigger && !PHYSICS_TRIGGER_DEBUG) {
            return;
        }

        const geometry = new THREE.BoxGeometry(
            this.halfExtents.x * 2,
            this.halfExtents.y * 2,
            this.halfExtents.z * 2,
        );
        const debugMaterial = new THREE.LineBasicMaterial({
            color: this.isTrigger ? DEBUG_TRIGGER_COLOR : DEBUG_COLLIDER_COLOR,
            transparent: true,
            opacity: DEBUG_COLLIDER_OPACITY,
            // A collider box is often sized/positioned exactly the same as its own
            // opaque visual mesh (e.g. ObstacleBuilder's full-height hit-zone trigger) —
            // depth-testing against that mesh would just z-fight and mostly disappear
            // behind it, so this deliberately draws on top of everything, X-ray style,
            // same as any other physics debug overlay.
            depthTest: false,
        });
        // Bends the wireframe the same way the caller's own visual geometry bends (see
        // RigidBodyOptions.bendService's own doc) — LineBasicMaterial resolves to the SAME
        // "basic" built-in shader MeshBasicMaterial does (three.js has no separate line
        // shader), so it has the `#include <project_vertex>` chunk BendService/
        // RunnerBendService both target, same as any other bent material in this codebase.
        this.bendService?.applyBend(debugMaterial);
        this.debugMesh = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), debugMaterial);
        // Depth-tested geometry still renders in submission order among itself, but a
        // depthTest:false material needs an explicit renderOrder to reliably land after
        // (visually on top of) the opaque meshes it's meant to outline, rather than the
        // outcome depending on scene-graph traversal order.
        this.debugMesh.renderOrder = 999;
        this.debugMesh.position.copy(this.centerOffset);
        this.entity.transform.add(this.debugMesh);
    }

    /**
     * Resizes this body live — e.g. MainPlayer shrinking its own collider while sliding, to
     * fit under a raised bar obstacle with no collider below a certain height (see
     * ObstacleBuilder.buildObstacle's `baseY` param). PhysicsWorld reads halfExtents/
     * centerOffset fresh every step (see getMin()/getMax()), so this takes effect
     * immediately for both collision resolution and trigger overlap — no re-registration
     * needed. `centerOffset` defaults to keeping whatever it already was (e.g. a caller that
     * only ever changes height still has to pass a new Y offset itself if it wants the box's
     * bottom to stay anchored at the same place — see PlayerSettings.ts's own stand/slide
     * helpers, which always compute both together).
     */
    public setSize(halfExtents: THREE.Vector3, centerOffset?: THREE.Vector3): void {
        this.halfExtents.copy(halfExtents);
        if (centerOffset) {
            this.centerOffset.copy(centerOffset);
        }

        if (!this.debugMesh) {
            return;
        }
        this.debugMesh.geometry.dispose();
        (this.debugMesh.material as THREE.Material).dispose();
        this.debugMesh.removeFromParent();
        this.debugMesh = undefined;
        this.buildDebugMesh();
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
