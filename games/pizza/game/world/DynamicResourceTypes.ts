// DynamicResourceTypes.ts
//
// Data-driven definition of a DYNAMICALLY-SPAWNED resource — loose ground
// loot that DynamicResourceSpawner.ts scatters across a WorldSpawner tile
// cluster (see that file's own doc) rather than sitting at fixed positions
// hand-painted on the Tiled map's resourcesLayer (see TileMapConfig.ts —
// that's still the normal source of truth for trees/stones/berries; this is
// a second, independent system for loot that should come and go over time,
// tracked as data and only rendered near the player — see
// DynamicResourceSpawner.ts's own doc).
//
// Two SEPARATE things are registered here, on purpose:
//   - The RESOURCE itself (a ResourceType — what it's called, what it looks
//     like, what it yields) — that identity already lives in ResourceTypes.ts/
//     AssetLibraryRegistry.ts, same as any other resource. Nothing new to
//     register for it here.
//   - Where it's allowed to spawn — one DynamicResourcePlacement PER
//     (resourceType, spawnerTileType) PAIR, each with its OWN density/
//     minDistance/checkIntervalSec. This is what lets the SAME resource
//     behave differently per terrain — e.g. bark denser/closer-together on
//     sand than it is on grass — without needing two different resources.
//     A resourceType can appear in as many placements as it has terrains to
//     spawn on; a spawnerTileType can host as many resourceTypes as make
//     sense for it. Neither list is unique on its own — only the PAIR is
//     (see placementKey()).
//
// Add a new resource: a ResourceType + RESOURCE_CONFIG entry + an
// AssetLibraryRegistry entry, same as always. Put it on a terrain: add one
// placement entry below. Give it a SECOND terrain with different spacing:
// add a second placement entry with the same resourceType and a different
// spawnerTileType/density/minDistance/checkIntervalSec — DynamicResourceSpawner
// picks up either change with no other code changes.

import { ResourceType } from '../actions/ResourceTypes';

export interface DynamicResourcePlacement {
    /** Which gameplay resource this placement spawns — its LooseResourceNode, gather behavior, and BackpackStorage bucket all come from RESOURCE_CONFIG[resourceType] (see ResourceTypes.ts), same as a map-painted resource. The SAME resourceType can appear in multiple placements (see this file's own doc) — each still tracked/persisted entirely independently, keyed by placementKey(). */
    resourceType: ResourceType;
    /** Which WorldSpawner cluster TYPE (a resolved tile name, e.g. "grass"/"sand" — see WorldSpawner.ts's own doc) this placement is allowed to spawn within. Every cell of every cluster with this type, across every "spawnerLayer"-named layer, is a valid candidate spot FOR THIS PLACEMENT specifically. */
    spawnerTileType: string;
    /**
     * Target instances per eligible cell, WITHIN the player's current proximity radius (see
     * DynamicResourceSpawner.ts's own doc — PERFORMANCE_CONFIG.resourceLoadRadius) — e.g. 0.05
     * against 200 nearby cells of this placement's own spawnerTileType targets round(200 *
     * 0.05) = 10 instances near the player right now. This is deliberately a RATE, not a flat
     * world-wide count: the eligible cell count naturally shrinks/grows with however much
     * matching terrain happens to be near the player at any moment, so density reads the same
     * whether they're standing next to a tiny patch or a huge one, and the game never has to
     * precompute (or persist) anything for the parts of the map nobody's anywhere near yet.
     */
    density: number;
    /** A new instance must land at least this far (world units) from every OTHER instance of THIS SAME placement — checked against every PERSISTED record (see DynamicResourceStorage.ts), not just currently-rendered ones, so density stays consistent even for cells the player hasn't walked back into view of yet. Does NOT check against a different placement for the same resourceType on another terrain — those are independent spacing budgets. */
    minDistance: number;
    /** How often, in seconds, DynamicResourceSpawner re-checks whether THIS placement is under its current density target near the player and can spawn more — see DynamicResourceSpawner.update(). */
    checkIntervalSec: number;
}

/**
 * The stable identity of one placement — its own DynamicResourceStorage persistence key AND
 * DynamicResourceSpawner's own runtime-state key. Derived from (resourceType, spawnerTileType)
 * rather than a separate hand-authored id: that pair is ALREADY guaranteed unique (see this
 * file's own doc — it's the one thing that has to be, so two placements for the same resource
 * on different terrain, or two different resources on the same terrain, never collide), so
 * there's nothing a config author needs to remember to keep unique themselves.
 */
export function placementKey(placement: DynamicResourcePlacement): string {
    return `${placement.resourceType}:${placement.spawnerTileType}`;
}

/** Test resources: loose bark scattered across "sand" spawner clusters, loose pebbles/grass fiber across "grass" ones — see this file's own doc and LooseResourceNode.ts. */
export const DYNAMIC_RESOURCE_PLACEMENTS: DynamicResourcePlacement[] = [
    {
        resourceType: ResourceType.Bark,
        spawnerTileType: 'sand',
        density: 0.02,
        minDistance: 8,
        checkIntervalSec: 5,
    },
    {
        resourceType: ResourceType.Pebble,
        spawnerTileType: 'grass',
        density: 0.02,
        minDistance: 8,
        checkIntervalSec: 5,
    },
    {
        resourceType: ResourceType.GrassFiber,
        spawnerTileType: 'grass',
        density: 0.02,
        minDistance: 8,
        checkIntervalSec: 5,
    },
];
