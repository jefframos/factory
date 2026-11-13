// Bend.ts
//
// The world bend (core BendService) for every restaurant scene: everything curves down away from a centre (the station,
// the market's crates). The rooms (core/rooms) bend through RoomHooks; everything else, `bendAll` (each frame: food,
// dishes and customers come and go).

import * as THREE from 'three';
import { RoomHooks } from 'core/rooms/RoomHooks';
import { BendService } from 'core/services/BendService';

/**
 * World-Y drop per unit² of distance from the centre. Flat pieces (walls, floors) are cut into this long steps so they
 * curve along their length, not only at their corners.
 */
export const BEND = { strength: 0.002, segmentLength: 1, maxSegments: 128 };

RoomHooks.segmentsForSpan = (length) => Math.min(BEND.maxSegments, Math.max(1, Math.ceil(length / BEND.segmentLength)));
RoomHooks.applyMaterial = (material) => BendService.applyBend(material);

/** The bend's centre (on the floor). */
export function bendAround(x: number, z: number): void {
    BendService.uniforms.uBendStrength.value = BEND.strength;
    BendService.updateOrigin(new THREE.Vector3(x, 0, z));
}

/** Bends every material under `root` (BendService skips ones already bent). */
export function bendAll(root: THREE.Object3D): void {
    root.traverse((object) => {
        const material = (object as THREE.Mesh).material;
        if (!material) return;
        (Array.isArray(material) ? material : [material]).forEach((m) => BendService.applyBend(m));
    });
}
