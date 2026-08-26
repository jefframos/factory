// SolidArea.ts
//
// One shared definition of what a `solid` field means, for every entity
// type that has BOTH an interaction trigger AND an optional physical
// blocker over the same footprint — providers (ProviderConfig.solid),
// buildings (BuildingConfig.solid), shops (ShopConfig.solid), crafting
// tables (CraftTableConfig.solid), and queues (QueueConfig.solid). Gates
// are the one exception — see Gate.ts's own doc, they're solid by
// definition, no `solid` field exists on GateConfig at all.
//
// `solid` is a 0-1 fraction of whatever trigger footprint the caller
// already computed for its OWN interaction trigger (not a separate global
// tile-size constant — every one of these five systems already resolves
// its own per-instance halfExtents/centerOffset before adding its trigger
// RigidBody, from a Tiled-drawn area or a fixed fallback): 0 means no solid
// collider at all (fully walk-through — the default for every field until
// a designer opts a specific entry in), 1 means a solid box exactly
// matching the trigger's own halfExtents/centerOffset, 0.5 means the same
// box at half that size, still centered/grounded the same way.
//
// Deliberately a SEPARATE RigidBody from the interaction trigger, not a
// toggle on it — the trigger (isTrigger: true) has to keep firing
// enter/exit/stay regardless of `solid`, and a solid collider (isStatic:
// true, no isTrigger) blocking movement is an orthogonal concern. Every
// caller already builds these as two independent bodies (see
// ResourceNode.ts's pre-existing solidBody, which this file generalizes).

import * as THREE from 'three';
import RigidBody from './RigidBody';
import { Layers } from './PhysicsConstants';

/**
 * Returns a solid (non-trigger, isStatic) RigidBody sized `solid` (0-1) of
 * `triggerHalfExtents`/`triggerCenterOffset`, or undefined for `solid <= 0`
 * — the caller adds the returned component itself via entity.addComponent(),
 * same as any other optional component. `solid` above 1 is clamped to 1
 * (a designer typo shouldn't produce an oversized collider bigger than the
 * zone's own trigger).
 */
export function buildSolidArea(
    triggerHalfExtents: THREE.Vector3,
    triggerCenterOffset: THREE.Vector3,
    solid: number,
    layer: number = Layers.Environment,
): RigidBody | undefined {
    if (solid <= 0) {
        return undefined;
    }

    const fraction = Math.min(solid, 1);
    return new RigidBody({
        halfExtents: triggerHalfExtents.clone().multiplyScalar(fraction),
        centerOffset: triggerCenterOffset.clone().multiplyScalar(fraction),
        isStatic: true,
        layer,
    });
}
