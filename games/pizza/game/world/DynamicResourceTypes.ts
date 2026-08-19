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
// Same "pure data, no engine imports" shape as ResourceTypes.ts/
// BuildingTypes.ts — add a new entry here (plus a matching ResourceType +
// RESOURCE_CONFIG + AssetLibraryRegistry entry) and DynamicResourceSpawner
// picks it up with no other code changes. THIS is "where densities are
// set" — see `density`'s own doc below; there's no separate "starting
// density" setting, because the very first proximity check
// (DynamicResourceSpawner.update()'s first tick) already fills the area
// around wherever the player starts up to this same target — see that
// file's own doc.

import { ResourceType } from '../actions/ResourceTypes';

export interface DynamicResourceConfig {
    /** Unique among DYNAMIC_RESOURCE_CONFIG — also DynamicResourceStorage's own persistence key for this config's spawned cells. */
    id: string;
    /** Which gameplay resource a spawned instance is — its LooseResourceNode, gather behavior, and BackpackStorage bucket all come from RESOURCE_CONFIG[resourceType] (see ResourceTypes.ts), same as a map-painted resource. */
    resourceType: ResourceType;
    /** Which WorldSpawner cluster TYPE (a resolved tile name, e.g. "grass" — see WorldSpawner.ts's own doc) this resource is allowed to spawn within. Every cell of every cluster with this type, across every "spawnerLayer"-named layer, is a valid candidate spot. */
    spawnerTileType: string;
    /**
     * Target instances per eligible cell, WITHIN the player's current proximity radius (see
     * DynamicResourceSpawner.ts's own doc — PERFORMANCE_CONFIG.resourceLoadRadius) — e.g. 0.05
     * against 200 nearby "grass" cells targets round(200 * 0.05) = 10 instances near the
     * player right now. This is deliberately a RATE, not a flat world-wide count: the eligible
     * cell count naturally shrinks/grows with however much matching terrain happens to be
     * near the player at any moment, so density reads the same whether they're standing next
     * to a tiny grass patch or a huge one, and the game never has to precompute (or persist)
     * anything for the parts of the map nobody's anywhere near yet.
     */
    density: number;
    /** A new instance must land at least this far (world units) from every OTHER instance of this SAME config — checked against every PERSISTED record (see DynamicResourceStorage.ts), not just currently-rendered ones, so density stays consistent even for cells the player hasn't walked back into view of yet. */
    minDistance: number;
    /** How often, in seconds, DynamicResourceSpawner re-checks whether this config is under its current density target near the player and can spawn more — see DynamicResourceSpawner.update(). */
    checkIntervalSec: number;
}

/** Test resource: loose bark scattered across the "grass" spawner cluster — see this file's own doc and LooseResourceNode.ts. */
export const DYNAMIC_RESOURCE_CONFIG: DynamicResourceConfig[] = [
    {
        id: 'bark',
        resourceType: ResourceType.Bark,
        spawnerTileType: 'grass',
        density: 0.05,
        minDistance: 4,
        checkIntervalSec: 5,
    },
];
