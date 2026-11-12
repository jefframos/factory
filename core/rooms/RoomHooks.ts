// RoomHooks.ts
//
// What core/rooms needs from the game it's in, set once at startup (only one game runs per build). The defaults are a
// plain flat world: rooms stand at y 0, walls aren't subdivided, materials are left as they are, nothing fades.
//
// A game with a curved world and walls that fade between the camera and the player (Pizza, Dig, Bandit: their
// BendService) points these at it:
//   RoomHooks.floorY = FloorLayers.baseY;
//   RoomHooks.segmentsForSpan = (length) => BendService.segmentsForSpan(length);
//   RoomHooks.applyMaterial = (material) => BendService.applyBend(material);
//   RoomHooks.occludeParts = (mesh, parts) => BendService.applyOcclusionFadeToParts(mesh, parts, STRUCTURE_OCCLUSION_FADE);
//   RoomHooks.occludeObject = (root) => BendService.applyOcclusionFadeToObject(root, STRUCTURE_OCCLUSION_FADE);

import type * as THREE from 'three';

/** A stretch of one wall mesh (its index range and bounds): the unit the occlusion fade works on. */
export interface OcclusionPart {
    start: number;
    count: number;
    box: THREE.Box3;
}

export const RoomHooks = {
    /** The floor's world Y: where walls, floors and doors stand. */
    floorY: 0,
    /** How many pieces a span of `length` is cut into (a curved world bends along them). */
    segmentsForSpan: (_length: number): number => 1,
    /** Called on every material a room builds (a curved world injects its bend). */
    applyMaterial: (_material: THREE.Material): void => undefined,
    /** A wall mesh and its stretches: the game may fade the ones between the camera and the player. */
    occludeParts: (_mesh: THREE.Mesh, _parts: readonly OcclusionPart[]): void => undefined,
    /** A solid door leaf (an untransformed root): the game may fade it the same way. */
    occludeObject: (_root: THREE.Object3D): void => undefined,
};
