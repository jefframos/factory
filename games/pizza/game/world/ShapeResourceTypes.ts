// ShapeResourceTypes.ts
//
// Data-driven definition of a resource dynamically spawned inside a drawn
// AREA — sibling to DynamicResourceTypes.ts, same "resource identity already
// lives in ResourceTypes.ts, this file only says WHERE it's allowed to
// spawn" split, just swapping DynamicResourcePlacement's spawnerTileType
// (a WorldSpawner tile cluster) for a `shapeId` (a "spawner"-type object's
// "id" custom property on the mapSettings layer — e.g. "animalSpawner1",
// a hand-drawn polygon — see WorldObjectRegistry.ts's SpawnerShape doc) so a
// designer can scatter loot across a freehand rect/circle/polygon area
// instead of a painted tile cluster. See ShapeResourceSpawner.ts for the
// actual spawn logic this drives.
//
// One ShapeResourcePlacement PER (resourceType, shapeId) PAIR, same
// independent-budget reasoning DynamicResourceTypes.ts uses — a shapeId can
// host as many resourceTypes as make sense for it, and a resourceType can
// appear in as many shapes as it has areas to spawn in.
//
// `count` (not a density RATE like DynamicResourcePlacement.density) is the
// target instance count for the WHOLE shape at once — a drawn spawner area
// is a small, known, fixed size (unlike "however much matching terrain
// happens to be near the player right now"), so there's no need for a
// per-nearby-cell rate here; the shape itself IS the budget.
//
// Add a new spawn area: draw a "spawner" object on mapSettings (rect,
// ellipse, or polygon — any of the three, see WorldObjectRegistry.ts's own
// doc), give it an "id" custom property, then add one placement entry below
// referencing that id. ShapeResourceSpawner picks up the change with no
// other code changes.

import { ResourceType } from '../actions/ResourceTypes';

export interface ShapeResourcePlacement {
    /** Which gameplay resource this placement spawns — see DynamicResourcePlacement.resourceType's own doc, same convention. */
    resourceType: ResourceType;
    /** The "id" custom property of a "spawner"-type object on mapSettings (see WorldObjectRegistry.getShape()) — the area this placement is allowed to spawn within. */
    shapeId: string;
    /** Target instances within this shape at once — see this file's own doc for why this is a flat count, not DynamicResourcePlacement's density rate. */
    count: number;
    /** A new instance must land at least this far (world units) from every OTHER instance of THIS SAME placement — same persisted-record check as DynamicResourcePlacement.minDistance. */
    minDistance: number;
    /** How often, in seconds, ShapeResourceSpawner re-checks whether this placement is under its `count` target and can spawn more. */
    checkIntervalSec: number;
}

/** The stable identity of one placement — mirrors DynamicResourceTypes.placementKey(), just keyed off shapeId instead of spawnerTileType. */
export function shapePlacementKey(placement: ShapeResourcePlacement): string {
    return `${placement.resourceType}:${placement.shapeId}`;
}

/** Test placement: a handful of crystals scattered inside "animalSpawner1" — see this file's own doc. */
export const SHAPE_RESOURCE_PLACEMENTS: ShapeResourcePlacement[] = [
    {
        resourceType: ResourceType.Crystal,
        shapeId: 'animalSpawner1',
        count: 3,
        minDistance: 3,
        checkIntervalSec: 5,
    },
];
