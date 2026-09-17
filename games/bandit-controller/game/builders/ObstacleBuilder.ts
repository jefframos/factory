// ObstacleBuilder.ts
//
// Solid box obstacles shared by both runner minigames — SOLID (not a
// trigger), so the player physically bumps into and stops against one via
// ordinary collide-and-slide (see PhysicsWorld's own doc), same as any
// other static RigidBody. `onHit` fires once, from RigidBody.onCollisionEnter,
// the instant the player's own collider first touches it — the CALLER
// (RunnerMinigameScene/SwipeMinigameScene) is what actually freezes
// movement and plays the "hit" animation; this builder only wires the
// mesh + collider + one-shot event, it knows nothing about what happens
// after a hit.

import * as THREE from 'three';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { WorldBendService } from '../services/BendService';

/** A single obstacle box, both its visual mesh and its solid collider, centered at (x, halfExtents.y, z) so its base sits on the ground. `onHit` is guarded to fire at most once per obstacle even if the physics engine's own contact bookkeeping (enter/stay/exit) reports more than one enter for the same overlap. */
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

    const obstacle = world.spawn();
    obstacle.transform.position.copy(mesh.position);

    const rigidBody = obstacle.addComponent(new RigidBody({
        halfExtents,
        isStatic: true,
        layer: Layers.Environment,
    }));

    let hit = false;
    rigidBody.onCollisionEnter.add((other) => {
        if (hit || other.layer !== Layers.Player) {
            return;
        }
        hit = true;
        onHit();
    });
}
