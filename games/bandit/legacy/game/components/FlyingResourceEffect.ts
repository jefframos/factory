// FlyingResourceEffect.ts
//
// Small placeholder cube that arcs between two world positions — the
// "something just moved into/out of the backpack" visual beat. Two current
// callers, same function, opposite directions:
//   - AutoGatherController: resource node -> backpack, once per landed hit.
//   - DropZone: backpack -> drop zone, once per unit as a deposit drains out
//     (see BackpackStorage.removeOne(), fired from `onArrive` below).
// Purely decorative otherwise: BackpackStorage's counts are the source of
// truth for what's carried, not this — a chip interrupted mid-flight (the
// scene it was added to gets torn down) costs nothing but its own visual.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';

const CHIP_SIZE = 0.24;
const FLIGHT_DURATION_SEC = 0.45;
/** How high the chip arcs above a straight line to its destination — purely cosmetic. */
const ARC_HEIGHT = 0.6;

/**
 * `scene` is any THREE.Object3D the chip can be parented to for the duration of its flight
 * (typically the THREE.Scene itself — e.g. `node.transform.parent!`, since ResourceNode's
 * transform is already added directly to the scene by WorldManager) — positions are all
 * WORLD-space, so `scene` only needs to be something on-screen, not positioned at either
 * endpoint itself. `onArrive` fires once, right as the chip reaches `toWorld` (before it's
 * torn down) — e.g. DropZone decrementing BackpackStorage by one per chip.
 */
export function spawnFlyingResourceChip(
    scene: THREE.Object3D,
    fromWorld: THREE.Vector3,
    toWorld: THREE.Vector3,
    color: number,
    onArrive?: () => void,
): void {
    const geometry = new THREE.BoxGeometry(CHIP_SIZE, CHIP_SIZE, CHIP_SIZE);
    const material = new THREE.MeshStandardMaterial({ color });
    BendService.applyBend(material);

    const chip = new THREE.Mesh(geometry, material);
    chip.position.copy(fromWorld);
    scene.add(chip);

    const apex = fromWorld.clone().lerp(toWorld, 0.5).add(new THREE.Vector3(0, ARC_HEIGHT, 0));
    const legA = new THREE.Vector3();
    const legB = new THREE.Vector3();

    const progress = { t: 0 };
    gsap.to(progress, {
        t: 1,
        duration: FLIGHT_DURATION_SEC,
        ease: 'power1.in',
        onUpdate: () => {
            // Quadratic Bezier: fromWorld -> apex (arc peak) -> toWorld.
            legA.lerpVectors(fromWorld, apex, progress.t);
            legB.lerpVectors(apex, toWorld, progress.t);
            chip.position.lerpVectors(legA, legB, progress.t);
        },
        onComplete: () => {
            onArrive?.();
            geometry.dispose();
            material.dispose();
            chip.removeFromParent();
        },
    });
}
