// FarmFootprints.ts
//
// A farm plot (see FarmTypes.ts's own doc) is reserved ground — nothing a
// random spawner scatters (loose resources, providers, animals — see
// DynamicResourceSpawner.ts/ShapeResourceSpawner.ts) should ever land inside
// one, or a level designer buying/looking at a plot could find a tree or a
// wandering pig sitting on top of their crops. This file is the shared
// "is this candidate point inside ANY farm plot" check both spawners call
// right alongside their own minDistance rejection, before accepting a
// candidate cell/point — never as a materialize()-time check, since
// rejecting there would just silently drop the candidate instead of letting
// the caller's own retry loop roll a different one.
//
// Rotation is ignored — treated as each plot's own unrotated axis-aligned
// bounds, same simplification SpawnerShape's 'rect'/'circle' kinds already
// make (see WorldObjectRegistry.ts's own doc), and consistent with FarmZone/
// FarmPlotTile themselves, which likewise never apply a farm object's own
// rotationDeg.

import WorldObjectRegistry from './WorldObjectRegistry';

export interface FarmFootprint {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

/** Every "farm" plot's own AABB footprint, read once from the map's "mapSettings" layer (WorldObjectRegistry.getAllOfType('farm')) — call once per spawner at construction, not per candidate check, since the map's own farm placements never change at runtime. */
export function collectFarmFootprints(worldObjects: WorldObjectRegistry): FarmFootprint[] {
    return [...worldObjects.getAllOfType('farm').values()].map(placement => ({
        minX: placement.x - placement.width / 2,
        maxX: placement.x + placement.width / 2,
        minZ: placement.z - placement.depth / 2,
        maxZ: placement.z + placement.depth / 2,
    }));
}

/** True if (x, z) falls inside ANY of `footprints` — the actual per-candidate rejection test. */
export function isInsideAnyFarmFootprint(x: number, z: number, footprints: readonly FarmFootprint[]): boolean {
    return footprints.some(f => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ);
}
