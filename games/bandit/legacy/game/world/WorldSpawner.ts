// WorldSpawner.ts
//
// Reads every tilelayer whose name CONTAINS "spawnerLayer" (see
// findLayers()'s own doc — substring match, Tiled export order, same
// convention TileMap.ts already uses for stacked "groundLayer"/"groundLayer2"
// variants) and clusters each layer's own painted tiles into CONNECTED,
// SAME-TYPE groups — e.g. the diamond-shaped blob of gid-1 cells currently
// painted on testMap1's "spawnerLayer" comes out as one cluster, not one
// entry per tile.
//
// A cluster's `type` is a NAME, not a raw gid — this tileset (see
// TileMapConfig.ts's own doc/map/tiles.json) carries no per-tile custom
// properties, so a spawner tile is really just whichever ground/resource
// tile got painted there in Tiled (e.g. gid 1 -> tiles.json's grounds[0],
// "grass"), resolved via the exact same getTilesetFirstGids()/
// resolveGroundDef()/resolveResourceDef() lookup buildResourceSpawnsFromTileMap()
// already uses for resourcesLayer — clustering still groups by the
// underlying gid (two different gids could theoretically resolve to the
// same name, and those should stay separate clusters), the name is only
// resolved once per cluster, for the humans reading logFindings()/whatever
// consumes getLayers() later. Falls back to `gid:<n>` for a gid that
// resolves to neither tileset (shouldn't happen with a real map, but reads
// better than silently showing nothing if it ever does).
//
// Layers are NEVER merged: each layer this finds gets its OWN independent
// list of clusters (SpawnerLayerClusters), even if two different
// spawnerLayer-named layers happen to paint overlapping cells — a caller
// that wants combined behavior across layers can zip these lists together
// itself, but this class doesn't assume that's ever wanted.
//
// Clustering is a plain flood-fill (BFS) over 4-directional (orthogonal)
// neighbors only, per distinct gid — two same-type cells touching only at a
// diagonal corner are NOT considered connected, matching how a level
// designer painting a contiguous shape on the tile grid would expect
// "connected" to read. A cluster's `center` is the average world position of
// every cell it contains (its centroid), not its bounding-box center, so an
// irregular (L-shaped, diamond, ...) cluster centers on where its mass
// actually is rather than a corner of empty space.
//
// Log-only for now, per the brief — getLayers() exists for whatever actually
// spawns something from these clusters later; nothing reads it yet.

import {
    DEFAULT_TILE_MAP_ALIASES,
    findLayers,
    getTilesetFirstGids,
    iterateLayerCells,
    loadTiledMap,
    loadTileDefs,
    resolveGroundDef,
    resolveResourceDef,
    TileDefsData,
    TiledLayer,
    tileCellToWorldPosition,
    WORLD_UNITS_PER_TILE,
} from './TileMapConfig';

/** Every tilelayer whose name contains this is treated as a spawner layer — see this file's own doc. */
export const SPAWNER_LAYER_NAME_FILTER = 'spawnerLayer';

/** Orthogonal-only adjacency — see this file's own doc for why diagonal neighbors don't count as connected. */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface SpawnerCell {
    col: number;
    row: number;
}

export interface SpawnerCluster {
    /** The resolved ground/resource tile name every cell in this cluster shares (e.g. "grass") — see this file's own doc for how that's resolved and why clustering itself still groups by the underlying gid, not this name. */
    type: string;
    /** The raw gid backing `type` — kept alongside the resolved name for anything that wants the underlying tile id directly (e.g. a future lookup into a spawner-specific config keyed by gid rather than name). */
    gid: number;
    /** Every cell belonging to this cluster, in the order the flood-fill visited them — no particular ordering guaranteed beyond that. */
    cells: SpawnerCell[];
    /** World-space centroid (average, not bounding-box center — see this file's own doc) of every cell in `cells`. */
    center: { x: number; z: number };
}

/** `gid` resolved to a tiles.json name via the same firstgid-range lookup TileMapConfig.ts's buildResourceSpawnsFromTileMap() uses — see this file's own doc. */
function resolveTileName(gid: number, tileDefs: TileDefsData, groundFirstGid: number, resourceFirstGid: number): string {
    const groundDef = resolveGroundDef(gid, tileDefs, groundFirstGid);
    if (groundDef) {
        return groundDef.name;
    }

    const resourceDef = resolveResourceDef(gid, tileDefs, resourceFirstGid);
    if (resourceDef) {
        return resourceDef.name;
    }

    return `gid:${gid}`;
}

export interface SpawnerLayerClusters {
    layerName: string;
    clusters: SpawnerCluster[];
}

function cellKey(col: number, row: number): string {
    return `${col},${row}`;
}

/**
 * Flood-fills one layer's non-zero cells into per-gid connected clusters — see this file's
 * own doc for the adjacency rule. Builds a full col/row -> gid lookup first (rather than
 * re-scanning `layer` on every neighbor check) since iterateLayerCells() only offers a
 * one-shot iterator, not random access.
 */
function clusterLayer(
    layer: TiledLayer,
    worldUnitsPerTile: number,
    tileDefs: TileDefsData,
    groundFirstGid: number,
    resourceFirstGid: number,
): SpawnerCluster[] {
    const gidByKey = new Map<string, number>();
    for (const { gid, col, row } of iterateLayerCells(layer)) {
        gidByKey.set(cellKey(col, row), gid);
    }

    const visited = new Set<string>();
    const clusters: SpawnerCluster[] = [];

    for (const [startKey, startGid] of gidByKey) {
        if (visited.has(startKey)) {
            continue;
        }
        visited.add(startKey);

        const [startCol, startRow] = startKey.split(',').map(Number);
        const cells: SpawnerCell[] = [];
        const queue: SpawnerCell[] = [{ col: startCol, row: startRow }];

        while (queue.length > 0) {
            const cell = queue.pop()!;
            cells.push(cell);

            for (const [dCol, dRow] of NEIGHBOR_OFFSETS) {
                const neighbor = { col: cell.col + dCol, row: cell.row + dRow };
                const neighborKey = cellKey(neighbor.col, neighbor.row);
                if (visited.has(neighborKey) || gidByKey.get(neighborKey) !== startGid) {
                    continue;
                }

                visited.add(neighborKey);
                queue.push(neighbor);
            }
        }

        const centerSum = cells.reduce(
            (sum, cell) => {
                const world = tileCellToWorldPosition(cell.col, cell.row, worldUnitsPerTile);
                sum.x += world.x;
                sum.z += world.z;
                return sum;
            },
            { x: 0, z: 0 },
        );

        clusters.push({
            type: resolveTileName(startGid, tileDefs, groundFirstGid, resourceFirstGid),
            gid: startGid,
            cells,
            center: { x: centerSum.x / cells.length, z: centerSum.z / cells.length },
        });
    }

    return clusters;
}

export default class WorldSpawner {
    private readonly layers: SpawnerLayerClusters[];

    public constructor(
        mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
        tilesAlias: string = DEFAULT_TILE_MAP_ALIASES.tiles,
        worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
    ) {
        const map = loadTiledMap(mapAlias);
        const tileDefs = loadTileDefs(tilesAlias);
        const { groundFirstGid, resourceFirstGid } = getTilesetFirstGids(map);
        const spawnerLayers = findLayers(map, SPAWNER_LAYER_NAME_FILTER);

        this.layers = spawnerLayers.map(layer => ({
            layerName: layer.name,
            clusters: clusterLayer(layer, worldUnitsPerTile, tileDefs, groundFirstGid, resourceFirstGid),
        }));

        this.logFindings();
    }

    /** Every spawner layer found, each with its OWN independent cluster list — see this file's own doc for why these are never merged. Empty array if no layer matched SPAWNER_LAYER_NAME_FILTER at all. */
    public getLayers(): readonly SpawnerLayerClusters[] {
        return this.layers;
    }

    private logFindings(): void {
        if (this.layers.length === 0) {
            console.log(`[WorldSpawner] no layer whose name contains "${SPAWNER_LAYER_NAME_FILTER}" found on the map`);
            return;
        }

        for (const { layerName, clusters } of this.layers) {
            console.log(`[WorldSpawner] "${layerName}": ${clusters.length} cluster(s)`);
            clusters.forEach((cluster, index) => {
                console.log(
                    `  - cluster ${index}: type="${cluster.type}" (gid ${cluster.gid}) cells=${cluster.cells.length}` +
                    ` center=(${cluster.center.x.toFixed(2)}, ${cluster.center.z.toFixed(2)})`,
                );
            });
        }
    }
}
