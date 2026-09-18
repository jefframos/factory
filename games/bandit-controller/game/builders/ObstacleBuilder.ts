// ObstacleBuilder.ts
//
// Box obstacles shared by both runner minigames, built from TWO separate
// colliders rather than one full-height solid box:
//
//   - a THIN solid platform, flush with the obstacle's own top — gives the
//     player something to physically land on and run along (same Y-only
//     collide-and-slide support as the ground itself), without ever
//     blocking horizontal movement.
//   - a full-height TRIGGER (never physically blocks anything) that decides
//     whether contact counts as a HIT: only if the player's own base is
//     still below the platform's height when it fires — i.e. a genuine
//     side hit, or catching it from below — not a landing.
//
// A single full-height SOLID box was tried first and didn't work like a
// runner game: the moment the player's forward-moving body touched its
// front face below the top, collide-and-slide zeroed their forward
// velocity right there, every single frame, regardless of how high they'd
// jumped — since the player can't control WHEN their automatic forward
// motion reaches the obstacle, only WHEN they jump, that made clearing an
// obstacle require already being at full jump height well before reaching
// it, which is essentially never achievable, so it read as "always hits."
// Splitting the top surface (solid, Y-only) from the hit judgment (trigger,
// never blocks X/Z) means a jump in progress always keeps carrying the
// player forward, and only their height at the moment of contact decides
// whether they clear it, land on it, or get hit.

import * as THREE from 'three';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { WorldBendService } from '../services/BendService';

/**
 * World units of slop allowed when deciding "is the player resting on top
 * of this obstacle" — collide-and-slide's own push-out doesn't necessarily
 * land perfectly flush (floating point), so a strict >= comparison would
 * occasionally misclassify a genuine top-landing as a hit.
 */
const TOP_LANDING_EPSILON = 0.05;
/** Half-thickness of the top platform collider — thin on purpose, see this file's own doc. */
const PLATFORM_HALF_THICKNESS = 0.1;

/** A single obstacle box — visual mesh, top-landing platform, and hit-detection trigger, all centered at (x, z), base at y=0. `onHit` is guarded to fire at most once per obstacle even if the physics engine's own contact bookkeeping (enter/stay/exit) reports more than one enter for the same overlap. */
export function buildObstacle(
    world: World,
    threeScene: THREE.Scene,
    x: number,
    z: number,
    halfExtents: THREE.Vector3,
    bendService: WorldBendService,
    onHit: () => void,
): void {
    const geometry = new THREE.BoxGeometry(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2);
    const material = new THREE.MeshStandardMaterial({ color: 0xb5342a });
    bendService.applyBend(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, halfExtents.y, z);
    threeScene.add(mesh);

    const topY = halfExtents.y * 2;

    const platform = world.spawn();
    platform.transform.position.set(x, topY - PLATFORM_HALF_THICKNESS, z);
    platform.addComponent(new RigidBody({
        halfExtents: new THREE.Vector3(halfExtents.x, PLATFORM_HALF_THICKNESS, halfExtents.z),
        isStatic: true,
        layer: Layers.Environment,
    }));

    const hitZone = world.spawn();
    hitZone.transform.position.set(x, halfExtents.y, z);
    const trigger = hitZone.addComponent(new RigidBody({
        halfExtents,
        isStatic: true,
        isTrigger: true,
        layer: Layers.Environment,
    }));

    let hit = false;
    const playerMin = new THREE.Vector3();

    trigger.onTriggerEnter.add((other) => {
        if (hit || other.layer !== Layers.Player) {
            return;
        }

        // Same "is the player's own base already flush with the top" check the platform
        // itself would otherwise resolve physically — the trigger has no such resolution
        // (it never blocks), so this is what tells a landing apart from an actual hit.
        other.getMin(playerMin);
        if (playerMin.y >= topY - TOP_LANDING_EPSILON) {
            return;
        }

        hit = true;
        onHit();
    });
}
