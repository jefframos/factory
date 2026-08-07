// TileMapConfig.ts
//
// Types + loaders for a Tiled (mapeditor.org) JSON export plus its
// companion tile lookup (map/tiles.json). Both are already preloaded into
// the 'json' PIXI.Assets bundle before any scene is built — see index.ts's
// loadAssets() and manifests/json.json — so loadTiledMap()/loadTileDefs()
// are synchronous reads, same convention as IslandStorage.loadIslands()
// reading 'islands.json'.
//
// The map has two tilelayers (see GROUND_LAYER_NAME/RESOURCE_LAYER_NAME):
// groundLayer paints the base terrain (TileMap.ts), resourcesLayer marks
// where gatherable resources sit — buildResourceSpawnsFromTileMap() turns
// its non-zero cells into ResourceSpawnDefs for WorldManager, so the tile
// map is the single source of truth for both what the ground looks like
// AND where resources spawn.
//
// map/tiles.json mirrors that split: `grounds` and `resources` are two
// separate lookup arrays, one per Tiled tileset. Tiled assigns each
// tileset's gid range in the order tilesets were added to the map — the
// ground tileset first, the resource tileset second — so
// getTilesetFirstGids() recovers which gid range belongs to which lookup by
// sorting on firstgid, without hardcoding either value. To add a new tile:
// append to the matching array in map/tiles.json and paint that id
// somewhere in Tiled — nothing here needs to change.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { ResourceType } from '../actions/ResourceTypes';
import { ResourceSpawnDef } from './WorldConfig';

export interface TileDef {
    name: string;
    color: string;
}

export interface TileDefsData {
    /** Tiled's pixel tile size — belongs to the tileset image, not the 3D world (see WORLD_UNITS_PER_TILE). Not currently used here; kept for a future texture-atlas painter. */
    tileSize: number;
    grounds: TileDef[];
    resources: TileDef[];
}

/** One chunk of an INFINITE map's layer — see TiledLayer's own doc. `data` is LOCAL to the chunk (index 0 is the chunk's own top-left cell), offset into the map's absolute tile grid by `x`/`y`, which are free to be negative (the map has grown up/left of where it started). */
export interface TiledChunk {
    data: number[];
    width: number;
    height: number;
    x: number;
    y: number;
}

export interface TiledLayer {
    /** Present on a BOUNDED (non-infinite) map's layer only — a flat, `width`-strided array. Infinite maps carry no such array at the layer level; see `chunks`. */
    data?: number[];
    /** Present on a bounded map's layer only, alongside `data`. Infinite maps carry no fixed layer width/height — the map can (and does, once exported "infinite" — see testMap1.json) grow in any direction, including negative. */
    width?: number;
    height?: number;
    /** Present on an INFINITE map's layer only — see TiledChunk's own doc. Use iterateLayerCells() rather than reading `data`/`chunks` directly; it handles both shapes and always yields ABSOLUTE tile-grid coordinates. */
    chunks?: TiledChunk[];
    type: string;
    visible: boolean;
    name: string;
}

export interface TiledTileset {
    firstgid: number;
}

export interface TiledMapData {
    /**
     * Present regardless of `infinite`, but only meaningful when it's false — Tiled keeps
     * writing SOME width/height on an infinite map's export (see testMap1.json), but it
     * reflects the map's last-saved editor canvas size, not the actual extent of painted
     * chunks (which can be, and is, bigger — and can extend negative). Never read these
     * for an infinite map; use iterateLayerCells() + tileCellToWorldPosition() instead,
     * both of which work in ABSOLUTE tile coordinates with no notion of a fixed size to
     * center around.
     */
    width: number;
    height: number;
    infinite?: boolean;
    layers: TiledLayer[];
    tilesets: TiledTileset[];
}

/** One non-empty cell, in ABSOLUTE tile-grid coordinates — see iterateLayerCells(). */
export interface TiledCell {
    gid: number;
    col: number;
    row: number;
}

/**
 * Iterates every nonzero cell in `layer`, whichever shape it's actually in — a bounded
 * map's flat `data` array, or an infinite map's `chunks` (see TiledLayer's own doc) — always
 * yielding ABSOLUTE tile-grid (col, row), never chunk-local or centered. This is the ONE
 * place that needs to know both shapes exist; every caller (TileMap.ts's ground painter,
 * buildResourceSpawnsFromTileMap() below) reads through this instead of touching
 * `layer.data`/`layer.chunks` itself, so a map re-exported infinite-or-not never needs a
 * second code path anywhere else.
 */
export function* iterateLayerCells(layer: TiledLayer): Iterable<TiledCell> {
    if (layer.chunks) {
        for (const chunk of layer.chunks) {
            for (let i = 0; i < chunk.data.length; i++) {
                const gid = chunk.data[i];
                if (gid <= 0) {
                    continue;
                }
                yield { gid, col: chunk.x + (i % chunk.width), row: chunk.y + Math.floor(i / chunk.width) };
            }
        }
        return;
    }

    const data = layer.data ?? [];
    const width = layer.width ?? 0;
    for (let i = 0; i < data.length; i++) {
        const gid = data[i];
        if (gid <= 0) {
            continue;
        }
        yield { gid, col: i % width, row: Math.floor(i / width) };
    }
}

export const GROUND_LAYER_NAME = 'groundLayer';
export const RESOURCE_LAYER_NAME = 'resourcesLayer';

/** World-units per Tiled grid cell — independent of Tiled's own pixel tilewidth/tileheight (which only matters for the tileset image). Bump this to change how "zoomed in" the painted map looks without touching map data. */
export const WORLD_UNITS_PER_TILE = 2;

/** Small lift above WorldManager's ground plane so painted tiles don't z-fight with it. */
export const TILE_PAINT_Y_OFFSET = 0.01;

/** Used if a gid on the map has no matching entry in tiles.json — keeps a bad map data reference visible (bright, obviously wrong) instead of invisible. */
export const FALLBACK_TILE_COLOR = '#ff00ff';

export const DEFAULT_TILE_MAP_ALIASES = {
    map: 'map/testMap1.json',
    tiles: 'map/tiles.json',
};

/**
 * Tiled tile names (map/tiles.json's resources[].name) that have a matching gameplay
 * ResourceType — see ResourceTypes.ts. A resource tile whose name isn't listed here
 * (gold, iron, coal, copper, ice_crystal, cactus, mushroom, ...) is skipped by
 * buildResourceSpawnsFromTileMap() until that ResourceType exists; nothing else needs to
 * change here when it does.
 */
export const RESOURCE_NAME_TO_TYPE: Partial<Record<string, ResourceType>> = {
    tree: ResourceType.Tree,
    stone: ResourceType.Stone,
    berries: ResourceType.Berries,
};

export function loadTiledMap(alias: string): TiledMapData {
    return PIXI.Assets.get(alias) as TiledMapData;
}

export function loadTileDefs(alias: string): TileDefsData {
    return PIXI.Assets.get(alias) as TileDefsData;
}

export function findLayer(map: TiledMapData, name: string): TiledLayer | undefined {
    return map.layers.find(layer => layer.type === 'tilelayer' && layer.visible && layer.name === name);
}

/** See this file's own doc — recovers the ground/resource tileset gid ranges by firstgid order rather than hardcoding either. */
export function getTilesetFirstGids(map: TiledMapData): { groundFirstGid: number; resourceFirstGid: number } {
    const sorted = [...map.tilesets].sort((a, b) => a.firstgid - b.firstgid);
    const groundFirstGid = sorted[0]?.firstgid ?? 1;
    const resourceFirstGid = sorted[1]?.firstgid ?? groundFirstGid;
    return { groundFirstGid, resourceFirstGid };
}

export function resolveGroundDef(gid: number, tileDefs: TileDefsData, groundFirstGid: number): TileDef | undefined {
    return tileDefs.grounds[gid - groundFirstGid];
}

export function resolveResourceDef(gid: number, tileDefs: TileDefsData, resourceFirstGid: number): TileDef | undefined {
    return tileDefs.resources[gid - resourceFirstGid];
}

/**
 * Converts an ABSOLUTE tile-grid (col, row) — see iterateLayerCells() — to a world XZ
 * position. Deliberately NOT centered on any map width/height: an infinite map has no
 * fixed size to center on (see TiledMapData's own doc), and tile (0, 0) needs to land at
 * the world origin regardless — that's what makes the player (which spawns at world
 * (0,0,0), see MainPlayer.ts) stand somewhere sensible on the map, and it's also just the
 * simpler mapping. A negative col/row (the map having grown up/left of where it started)
 * falls out correctly with no special-casing, same as a positive one. Same math TileMap.ts
 * uses to paint the ground, so resource nodes built from the resource layer land exactly
 * on the tile they're drawn on.
 */
export function tileCellToWorldPosition(col: number, row: number, worldUnitsPerTile: number): { x: number; z: number } {
    return {
        x: (col + 0.5) * worldUnitsPerTile,
        z: (row + 0.5) * worldUnitsPerTile,
    };
}

/**
 * Reads resourcesLayer's non-zero cells and turns each into a ResourceSpawnDef positioned
 * to match exactly where TileMap.ts paints that cell — the tile map is the single source
 * of truth for resource placement, so WorldManager no longer needs a hand-placed spawn
 * list (see WorldManager.ts's constructor).
 */
export function buildResourceSpawnsFromTileMap(
    mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
    tilesAlias: string = DEFAULT_TILE_MAP_ALIASES.tiles,
    worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
): ResourceSpawnDef[] {
    const map = loadTiledMap(mapAlias);
    const tileDefs = loadTileDefs(tilesAlias);
    const layer = findLayer(map, RESOURCE_LAYER_NAME);
    if (!layer) {
        return [];
    }

    const { resourceFirstGid } = getTilesetFirstGids(map);
    const warnedNames = new Set<string>();
    const spawns: ResourceSpawnDef[] = [];

    for (const { gid, col, row } of iterateLayerCells(layer)) {
        const def = resolveResourceDef(gid, tileDefs, resourceFirstGid);
        const resourceType = def && RESOURCE_NAME_TO_TYPE[def.name];
        if (!resourceType) {
            if (def && !warnedNames.has(def.name)) {
                warnedNames.add(def.name);
                console.warn(`[TileMapConfig] resource tile "${def.name}" has no matching ResourceType yet — skipping`);
            }
            continue;
        }

        const { x, z } = tileCellToWorldPosition(col, row, worldUnitsPerTile);

        spawns.push({
            id: `${def!.name}-${col}-${row}`,
            resourceType,
            position: new THREE.Vector3(x, 0, z),
        });
    }

    return spawns;
}
