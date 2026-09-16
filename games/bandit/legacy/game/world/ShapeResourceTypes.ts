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
// optionally gated on owning some item, rather than just walked over;
// 'provider' is a real gatherable ResourceNode (tree/stone deposit/berry
// bush — an action/life/respawn cycle, same as one hand-painted on
// resourcesLayer) scattered across the shape instead of hard-placed at a
// fixed spot. Only one of `resourceType`/`animalType`/`providerType` is
// actually read at a time (whichever `spawnType` selects) — all three
// fields exist on every placement so the web editor's generic field-schema
// engine (see schemas.js's own doc on the '$spawnerShapeIds' virtual
// source) doesn't need conditional-field-visibility support just for this;
// ShapeResourceSpawner is what actually enforces "only the selected one
// matters."
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
import { ProviderType } from '../actions/ProviderTypes';

export type ShapeSpawnType = 'resource' | 'animal' | 'provider';

export interface ShapeResourcePlacement {
    /** What kind of thing this placement spawns — undefined means 'resource', same as every placement before this field existed (see this file's own doc). 'provider' spawns a real gatherable ResourceNode (tree/stone deposit/berry bush — action/life/respawn cycle) scattered across this shape instead of a one-shot LooseResourceNode pickup — see ShapeResourceSpawner.ts's own materialize() doc. */
    spawnType?: ShapeSpawnType;
    /** Which gameplay resource this placement spawns — only read when `spawnType` is 'resource' (or omitted). See DynamicResourcePlacement.resourceType's own doc, same convention. */
    resourceType?: ResourceType;
    /** Which animal this placement spawns — only read when `spawnType` is 'animal'. See AnimalTypes.ts. */
    animalType?: AnimalType;
    /** Which provider this placement spawns — only read when `spawnType` is 'provider'. See ProviderTypes.ts. */
    providerType?: ProviderType;
    /** The "id" custom property of a "spawner"-type object on mapSettings (see WorldObjectRegistry.getShape()) — the area this placement is allowed to spawn within (and, for an animal placement, the area it wanders inside — see AnimalNode.ts). */
    shapeId: string;
    /** Target instances within this shape at once — used only when `density` is unset or 0 (see that field's own doc); see this file's own doc for why this is a flat count, not DynamicResourcePlacement's density rate, for a small fixed-size shape. */
    count: number;
    /**
     * Target instances per WORLD_UNITS_PER_TILE² of the shape's own actual area (see
     * WorldObjectRegistry.shapeArea()) — same per-area RATE framing DynamicResourcePlacement.
     * density uses per-cell, just measured against a drawn shape's continuous area instead of
     * a discrete cell count. Whenever this is set and greater than 0, it OVERRIDES `count`
     * entirely for that placement — undefined or 0 (the default, and every placement before
     * this field existed) falls back to `count` as before. The intent: `count` for a small,
     * known-size area where "exactly N of these" reads naturally; `density` for a large area
     * where a flat count would either be sparse in a huge shape or overcrowded in a small one
     * once the shape gets resized — same reasoning a designer would reach for
     * DynamicResourcePlacement's density over a flat count on a big terrain patch.
     */
    density?: number;
    /** A new instance must land at least this far (world units) from every OTHER instance of THIS SAME placement — same persisted-record check as DynamicResourcePlacement.minDistance. For an animal placement this only constrains its INITIAL spawn point; nothing keeps two wandering animals apart afterward. */
    minDistance: number;
    /** How often, in seconds, ShapeResourceSpawner re-checks whether this placement is under its target (count, or density-derived when set — see `density`'s own doc) and can spawn more. */
    checkIntervalSec: number;
}

/**
 * The stable identity of one placement — mirrors DynamicResourceTypes.placementKey(), just
 * keyed off shapeId instead of spawnerTileType, and off whichever of resourceType/animalType
 * `spawnType` actually selects (see this file's own doc) rather than always resourceType.
 */
export function shapePlacementKey(placement: ShapeResourcePlacement): string {
    const spawnType = placement.spawnType ?? 'resource';
    const identity = spawnType === 'animal' ? placement.animalType : spawnType === 'provider' ? placement.providerType : placement.resourceType;
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
    },
    {
        "spawnType": "provider",
        "providerType": ProviderType.Tree,
        "shapeId": "treeSpawner",
        "density": 0.2,
        "minDistance": 3,
        "checkIntervalSec": 120
    }
];
