// SurfaceQuery.ts
//
// "What's the top of the solid thing standing here?" — read off the static physics colliders
// (counters, tables, crates: anything solid the player bumps into), whose tops follow their
// models' surfaces (see BuildingZone.fitPieceColliderHeight()). Used to rest things on whatever
// a level designer drew under them, e.g. a mix station's boxes on a kitchen counter (MixStation).

import * as THREE from 'three';
import type PhysicsWorld from './PhysicsWorld';
import { Layers } from './PhysicsConstants';

/** Tops lower than this are floors/decals, not surfaces to rest on. */
const MIN_SURFACE_TOP = 0.1;
/** Tops higher than this are walls/tall props, not surfaces to rest on. */
const MAX_SURFACE_TOP = 3;

const scratchMin = new THREE.Vector3();
const scratchMax = new THREE.Vector3();

/**
 * World Y of the highest static solid collider top whose footprint contains (x, z), between
 * MIN_SURFACE_TOP and MAX_SURFACE_TOP above `floorY` — undefined when nothing solid stands there.
 */
export function findSolidTopAt(physics: PhysicsWorld, x: number, z: number, floorY = 0): number | undefined {
    let best: number | undefined;
    physics.forEachBody(body => {
        if (!body.isStatic || body.isTrigger || (body.layer & Layers.Player) !== 0) {
            return;
        }
        body.getMin(scratchMin);
        body.getMax(scratchMax);
        if (x < scratchMin.x || x > scratchMax.x || z < scratchMin.z || z > scratchMax.z) {
            return;
        }
        const top = scratchMax.y - floorY;
        if (top < MIN_SURFACE_TOP || top > MAX_SURFACE_TOP) {
            return;
        }
        if (best === undefined || scratchMax.y > best) {
            best = scratchMax.y;
        }
    });
    return best;
}
