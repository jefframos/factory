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

export interface TiledLayer {
    data: number[];
    width: number;
    height: number;
    type: string;
    visible: boolean;
    name: string;
}

export interface TiledTileset {
    firstgid: number;
}

export interface TiledMapData {
    width: number;
    height: number;
    layers: TiledLayer[];
    tilesets: TiledTileset[];
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

/** Converts a layer's (col, row) grid cell to a world XZ position, centered on the map — same math TileMap.ts uses to paint the ground, so resource nodes built from the resource layer land exactly on the tile they're drawn on. */
export function tileCellToWorldPosition(
    col: number,
    row: number,
    mapWidth: number,
    mapHeight: number,
    worldUnitsPerTile: number,
): { x: number; z: number } {
    const halfWidth = (mapWidth * worldUnitsPerTile) / 2;
    const halfHeight = (mapHeight * worldUnitsPerTile) / 2;
    return {
        x: (col + 0.5) * worldUnitsPerTile - halfWidth,
        z: (row + 0.5) * worldUnitsPerTile - halfHeight,
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

    for (let i = 0; i < layer.data.length; i++) {
        const gid = layer.data[i];
        if (gid <= 0) {
            continue;
        }

        const def = resolveResourceDef(gid, tileDefs, resourceFirstGid);
        const resourceType = def && RESOURCE_NAME_TO_TYPE[def.name];
        if (!resourceType) {
            if (def && !warnedNames.has(def.name)) {
                warnedNames.add(def.name);
                console.warn(`[TileMapConfig] resource tile "${def.name}" has no matching ResourceType yet — skipping`);
            }
            continue;
        }

        const col = i % layer.width;
        const row = Math.floor(i / layer.width);
        const { x, z } = tileCellToWorldPosition(col, row, map.width, map.height, worldUnitsPerTile);

        spawns.push({
            id: `${def!.name}-${i}`,
            resourceType,
            position: new THREE.Vector3(x, 0, z),
        });
    }

    return spawns;
}
