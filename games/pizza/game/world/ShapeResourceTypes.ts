// ShapeResourceTypes.ts
//
// Data-driven definition of something dynamically spawned inside a drawn
// AREA — sibling to DynamicResourceTypes.ts, same "identity already lives
// elsewhere, this file only says WHERE it's allowed to spawn" split, just
// swapping DynamicResourcePlacement's spawnerTileType (a WorldSpawner tile
// cluster) for a `shapeId` (a "spawner"-type object's "id" custom property
// on the mapSettings layer — e.g. "animalSpawner1", a hand-drawn polygon —
// see WorldObjectRegistry.ts's SpawnerShape doc) so a designer can scatter
// something across a freehand rect/circle/polygon area instead of a painted
// tile cluster. See ShapeResourceSpawner.ts for the actual spawn logic this
// drives.
//
// `spawnType` picks WHAT kind of thing a placement spawns — 'resource'
// (default, omitted on every placement before this field existed) is a
// plain LooseResourceNode pickup, same as always; 'animal' is an
// autonomous, wandering AnimalNode (see AnimalTypes.ts/AnimalNode.ts) that
// has to be CAUGHT — a continuous PRESENCE timer (AnimalCatchController.ts),
// optionally gated on owning some item, rather than just walked over. Only
// one of `resourceType`/`animalType` is actually read at a time (whichever
// `spawnType` selects) — both fields exist on every placement so the web
// editor's generic field-schema engine (see schemas.js's own doc on the
// '$spawnerShapeIds' virtual source) doesn't need conditional-field-visibility
// support just for this; ShapeResourceSpawner is what actually enforces
// "only the selected one matters."
//
// One ShapeResourcePlacement PER (spawnType, resourceType|animalType, shapeId)
// PAIR, same independent-budget reasoning DynamicResourceTypes.ts uses — a
// shapeId can host as many placements as make sense for it (mixing resource
// AND animal placements freely), and a resourceType/animalType can appear in
// as many shapes as it has areas to spawn in.
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
import { AnimalType } from '../actions/AnimalTypes';

export type ShapeSpawnType = 'resource' | 'animal';

export interface ShapeResourcePlacement {
    /** What kind of thing this placement spawns — undefined means 'resource', same as every placement before this field existed (see this file's own doc). */
    spawnType?: ShapeSpawnType;
    /** Which gameplay resource this placement spawns — only read when `spawnType` is 'resource' (or omitted). See DynamicResourcePlacement.resourceType's own doc, same convention. */
    resourceType?: ResourceType;
    /** Which animal this placement spawns — only read when `spawnType` is 'animal'. See AnimalTypes.ts. */
    animalType?: AnimalType;
    /** The "id" custom property of a "spawner"-type object on mapSettings (see WorldObjectRegistry.getShape()) — the area this placement is allowed to spawn within (and, for an animal placement, the area it wanders inside — see AnimalNode.ts). */
    shapeId: string;
    /** Target instances within this shape at once — see this file's own doc for why this is a flat count, not DynamicResourcePlacement's density rate. */
    count: number;
    /** A new instance must land at least this far (world units) from every OTHER instance of THIS SAME placement — same persisted-record check as DynamicResourcePlacement.minDistance. For an animal placement this only constrains its INITIAL spawn point; nothing keeps two wandering animals apart afterward. */
    minDistance: number;
    /** How often, in seconds, ShapeResourceSpawner re-checks whether this placement is under its `count` target and can spawn more. */
    checkIntervalSec: number;
}

/**
 * The stable identity of one placement — mirrors DynamicResourceTypes.placementKey(), just
 * keyed off shapeId instead of spawnerTileType, and off whichever of resourceType/animalType
 * `spawnType` actually selects (see this file's own doc) rather than always resourceType.
 */
export function shapePlacementKey(placement: ShapeResourcePlacement): string {
    const spawnType = placement.spawnType ?? 'resource';
    const identity = spawnType === 'animal' ? placement.animalType : placement.resourceType;
    return `${spawnType}:${identity}:${placement.shapeId}`;
}

/** Worked example: exactly one Pig, scattered inside "animalSpawner1" — see this file's own doc. */
export const SHAPE_RESOURCE_PLACEMENTS: ShapeResourcePlacement[] = [
    {
        "spawnType": "animal",
        "animalType": AnimalType.Pig,
        "shapeId": "animalSpawner1",
        "count": 1,
        "minDistance": 3,
        "checkIntervalSec": 60
    }
];
