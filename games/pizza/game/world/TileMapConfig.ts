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
import { ProviderType } from '../actions/ProviderTypes';
import { ResourceSpawnDef } from './WorldConfig';

export interface TileDef {
    name: string;
    color: string;
    /**
     * Resources tiles only — which PROVIDER (ProviderTypes.ts) a painted cell of this tile
     * spawns, edited from the pizza web editor's Map tab. Takes precedence over
     * RESOURCE_NAME_TO_TYPE below when set, so reassigning a resource tile to a different (or
     * newly-added) provider is a tiles.json edit, not a code change. Stored as a plain string
     * here (not typed `ProviderType`) since this file is loaded as raw JSON at runtime.
     */
    providerType?: string;
    /**
     * Ground tiles only — whether the player can walk onto a painted cell of this tile,
     * settable from the pizza web editor's Map tab. Undefined (tiles.json predating this
     * field) falls back to NON_WALKABLE_GROUND_TILES below — see isGroundWalkable().
     */
    walkable?: boolean;
    /**
     * Ground tiles only — a painted cell of this tile draws NOTHING at all (no flat-paint
     * quad, no IslandMeshBuilder raised terrain — see TileMap.build()'s own doc on how each
     * rendering path skips it) while still counting as a real cell for `walkable` above, so
     * "an invisible walkway" is just a tile with BOTH `walkable: true` and `transparent: true`
     * checked — same independent-flags convention as `walkable` itself, not implied by it
     * either way. Undefined/false (the default) draws normally, unchanged from before this
     * field existed. NOTE: since IslandMeshBuilder's blob geometry never sees this cell at
     * all, a transparent tile surrounded by normal land reads as a rounded-edge HOLE/gap in
     * the terrain (revealing whatever's beneath — water, void) rather than a flush, invisible
     * patch level with the surrounding ground; that's the tradeoff of skipping it entirely
     * rather than trying to render it with zero opacity.
     */
    transparent?: boolean;
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
    /** Present on an `objectgroup` layer only (layer.type === 'objectgroup') — see TiledObject's own doc and WorldObjectRegistry.ts, the one reader. */
    objects?: TiledObject[];
    type: string;
    visible: boolean;
    name: string;
}

/** One custom property on a TiledObject, as Tiled's "Custom Properties" panel exports it — see TiledObject's own doc for why this project reads THESE instead of the object's own name/type fields. `value` is typed loosely because Tiled exports a "bool"/"float"/"int" property as an ACTUAL JSON boolean/number, not a string — only a "string"-typed custom property is really a string; see getObjectBooleanProperty() for the one reader that cares about the distinction today. */
export interface TiledObjectProperty {
    name: string;
    type: string;
    value: string | boolean | number;
}

/**
 * One placed object from an `objectgroup` layer (e.g. "mapSettings") — a rectangle Tiled's
 * map editor lets you draw anywhere, independent of the tile grid. This project doesn't use
 * the object's own `name`/`type` fields (both left blank in Tiled — every object exported so
 * far has `name: ""`, `type: ""`) — instead, a "type" and "id" custom property are set per
 * object (see TiledObjectProperty), read via getObjectProperty() below. x/y/width/height are
 * in PIXEL space (Tiled's native unit for objects, unlike tile layers' col/row) with x/y
 * anchored at the rectangle's TOP-LEFT corner — see objectCenterToWorldPosition() for the
 * conversion to world XZ.
 */
export interface TiledObject {
    id: number;
    name: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    visible: boolean;
    properties?: TiledObjectProperty[];
    /**
     * Present ONLY on a "tile object" — one placed by dragging an image (or picking a tile)
     * straight onto an object layer in Tiled, rather than drawing a plain rectangle — see
     * MeshLayerSpawner.ts's own doc, the one reader. Unlike a plain rectangle object (x/y at
     * the TOP-left, per this interface's own doc above), Tiled anchors a TILE object's x/y at
     * its BOTTOM-left instead — the same convention a tile LAYER cell uses — so converting one
     * to a world position needs `y - height` (not `y`) for its top edge; see
     * MeshLayerSpawner.ts's own conversion.
     */
    gid?: number;
}

/** Reads a named STRING custom property off a TiledObject (see its own doc) — undefined if that object has no property by this name. Coerces to a string even if Tiled happened to export a non-"string"-typed property under this name, so existing callers (all of which expect a string, e.g. an id/type/target) keep their original signature. */
export function getObjectProperty(obj: TiledObject, propertyName: string): string | undefined {
    const value = obj.properties?.find(p => p.name === propertyName)?.value;
    return value === undefined ? undefined : String(value);
}

/** Reads a named "bool"-typed custom property off a TiledObject — see TiledObjectProperty.value's own doc for why Tiled exports these as a real JSON boolean, not the string every OTHER custom property here happens to be. Missing property (never drawn at all) reads as false, same "absence means the default/off state" convention as every other optional flag in this codebase. */
export function getObjectBooleanProperty(obj: TiledObject, propertyName: string): boolean {
    const value = obj.properties?.find(p => p.name === propertyName)?.value;
    return value === true || value === 'true';
}

/** Coerces one raw TiledObjectProperty value to a number — Tiled exports a "float"/"int"-typed property as a real JSON number, but this also tolerates a numeric STRING (a "string"-typed property someone used for a number by habit) rather than silently treating it as unset. undefined for anything else (missing, or genuinely non-numeric text). */
function coercePropertyToNumber(value: string | boolean | number | undefined): number | undefined {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

/** Reads a named numeric ("float"/"int") custom property off a TiledObject — undefined if that object has no property by this name, or it isn't numeric. */
export function getObjectNumberProperty(obj: TiledObject, propertyName: string): number | undefined {
    return coercePropertyToNumber(obj.properties?.find(p => p.name === propertyName)?.value);
}

/**
 * Same TILE-definition lookup as getTiledTileBooleanProperty() (see that function's own doc
 * for why a tile's OWN properties — not a placed object's — are the normal place for this),
 * just numeric — e.g. a bridge model's tile carrying `offsetY: 1` so every object placed from
 * it sits raised by the same amount, without a level designer having to set that per-object
 * every time. undefined if `gid` doesn't resolve to any tileset/tile, or that tile has no such
 * property at all.
 */
export function getTiledTileNumberProperty(map: TiledMapData, gid: number | undefined, propertyName: string): number | undefined {
    if (!gid) {
        return undefined;
    }
    const owner = findTilesetOwningGid(map, gid);
    if (!owner) {
        return undefined;
    }
    const localId = gid - owner.firstgid;
    const value = owner.tiles?.find(tile => tile.id === localId)?.properties?.find(p => p.name === propertyName)?.value;
    return coercePropertyToNumber(value);
}

/**
 * Converts one TiledObject's pixel-space rectangle to world units — its center position AND
 * its width/depth footprint AND its own `rotation`, same "the tile/pixel grid and the 3D world
 * are different unit systems" conversion tileCellToWorldPosition() does for ground cells, just
 * from pixels instead of col/row. `tileSizePx` is the tileset's pixel tile size (map/
 * tiles.json's `tileSize`, e.g. 32) — the ratio worldUnitsPerTile/tileSizePx is what actually
 * converts pixels to world units, for position AND size alike.
 *
 * Tiled anchors a plain rectangle object at its TOP-left corner, but a TILE object (one with a
 * `gid` — see TiledObject.gid's own doc) at its BOTTOM-left instead, and rotates EITHER kind
 * around that same origin point, not the rectangle's center — rotating a placed object in
 * Tiled swings its whole footprint around its own corner. So the true center isn't the fixed
 * local offset a rotation=0 object would have; that offset has to be rotated by the SAME angle,
 * around the SAME origin, before being added back to (obj.x, obj.y) — see MeshLayerSpawner.ts's
 * own doc, where this exact fix originated for "meshes"-layer placements; this generalizes it
 * to every "mapSettings" placement (buildings, gates, queues, droppers, ...) too, since any of
 * those can equally be drawn as a rotated tile object.
 *
 * Tiled is a 2D top-down editor, so a rect's `width`/`height` are both HORIZONTAL — they map
 * to world X and Z respectively (a footprint, in the object's own UN-rotated local frame),
 * never to the mesh's vertical Y height. There's no third dimension in a Tiled object to derive
 * that from — a spawner combining this with a config-driven mesh should keep that config's own
 * height (Y) and only override X/Z from `width`/`depth` here (see PizzaScene's
 * setupBuildingZone()/setupGates()). `rotationDeg` is Tiled's own clockwise-degrees value,
 * unconverted — a caller applying it to a THREE object's Y-axis rotation needs the same sign
 * flip MeshLayerSpawner.ts's own `rotationY` doc explains (Tiled clockwise vs THREE's
 * counter-clockwise-positive Y, viewed from above).
 */
export function objectToWorldRect(
    obj: TiledObject,
    tileSizePx: number,
    worldUnitsPerTile: number,
): { x: number; z: number; width: number; depth: number; rotationDeg: number } {
    const scale = worldUnitsPerTile / tileSizePx;
    const rotationRad = (obj.rotation * Math.PI) / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);

    const localCenterX = obj.width / 2;
    const localCenterY = obj.gid ? -obj.height / 2 : obj.height / 2;
    const rotatedCenterX = localCenterX * cos - localCenterY * sin;
    const rotatedCenterY = localCenterX * sin + localCenterY * cos;

    return {
        x: (obj.x + rotatedCenterX) * scale,
        z: (obj.y + rotatedCenterY) * scale,
        width: obj.width * scale,
        depth: obj.height * scale,
        rotationDeg: obj.rotation,
    };
}

export interface TiledTileset {
    firstgid: number;
    /** Present on a traditional single-image tileset (grounds.png/resources.png) — one shared sheet, not used by resolveTiledTileImageName()'s own callers today but kept for completeness. */
    image?: string;
    /**
     * Present on an "image collection" tileset instead — one entry per tile, each with its OWN
     * image path relative to the map file. Tiled auto-generates exactly this shape the moment
     * a level designer drags a loose PNG onto an object layer (see MeshLayerSpawner.ts's own
     * doc) — `id` is 0-based, LOCAL to this tileset (subtract firstgid from a gid to get it).
     * `properties` is the TILE's own custom-properties list (set once, in Tiled, on the tile
     * definition itself via right-click -> "Tile Properties" — NOT on any one placed object) —
     * e.g. a "solid" bool checked there applies to EVERY object placed from that tile, which is
     * exactly the point: "is this crate solid" is a property of the crate, not of one particular
     * instance of it. See getTiledTileBooleanProperty(), the one reader.
     */
    tiles?: { id: number; image: string; properties?: TiledObjectProperty[] }[];
}

/** Shared by resolveTiledTileImageName()/getTiledTileBooleanProperty() — the tileset with the LARGEST firstgid that's still `<= gid`, or undefined if `gid` is 0/negative or smaller than every tileset's own firstgid. */
function findTilesetOwningGid(map: TiledMapData, gid: number): TiledTileset | undefined {
    if (gid <= 0) {
        return undefined;
    }
    const sorted = [...map.tilesets].sort((a, b) => a.firstgid - b.firstgid);
    let owner: TiledTileset | undefined;
    for (const tileset of sorted) {
        if (tileset.firstgid > gid) {
            break;
        }
        owner = tileset;
    }
    return owner;
}

/**
 * Reads a "bool"-typed custom property set on the TILE DEFINITION `gid` resolves to (see
 * TiledTileset.tiles' own `properties` doc) — NOT on any placed object. Missing tileset/tile,
 * or a tile with no such property at all, reads as false, same "absence means off" convention
 * getObjectBooleanProperty() uses for a placed object's own properties.
 */
export function getTiledTileBooleanProperty(map: TiledMapData, gid: number | undefined, propertyName: string): boolean {
    if (!gid) {
        return false;
    }
    const owner = findTilesetOwningGid(map, gid);
    if (!owner) {
        return false;
    }
    const localId = gid - owner.firstgid;
    const value = owner.tiles?.find(tile => tile.id === localId)?.properties?.find(p => p.name === propertyName)?.value;
    return value === true || value === 'true';
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

/** Extra Y lift applied per additional groundLayer-named layer (see findLayers()/TileMap.ts) — e.g. a decorative "groundLayer2" painted overlay sits GROUND_LAYER_Y_STEP above the base "groundLayer", "groundLayer3" another step above that, and so on, so each stacked layer visibly renders on top of the one below instead of z-fighting with it. */
export const GROUND_LAYER_Y_STEP = 0.05;

/** Used if a gid on the map has no matching entry in tiles.json — keeps a bad map data reference visible (bright, obviously wrong) instead of invisible. */
export const FALLBACK_TILE_COLOR = '#ff00ff';

export const DEFAULT_TILE_MAP_ALIASES = {
    map: 'map/testMap1.json',
    tiles: 'map/tiles.json',
};

/**
 * Tiled tile names (map/tiles.json's resources[].name) that have a matching PROVIDER (see
 * ProviderTypes.ts) — a painted resourcesLayer cell is a provider PLACEMENT, not a resource
 * placement (what it actually yields is the provider's own drop table). A resource tile
 * whose name isn't listed here (gold, iron, coal, copper, ice_crystal, cactus, mushroom,
 * ...) is skipped by buildResourceSpawnsFromTileMap() until a matching provider exists;
 * nothing else needs to change here when it does. The Tiled tile is still named "berries"
 * (no map/tileset changes needed) even though it now resolves to ProviderType.BerryBush.
 *
 * This is only the FALLBACK — map/tiles.json's own resources[].providerType (settable from the
 * pizza web editor's Map tab) is checked first, see buildResourceSpawnsFromTileMap() below. Kept
 * around so a tiles.json entry that predates that field still resolves the same way it always did.
 */
export const RESOURCE_NAME_TO_TYPE: Partial<Record<string, ProviderType>> = {
    tree: ProviderType.Tree,
    stone: ProviderType.StoneDeposit,
    berries: ProviderType.BerryBush,
};

/**
 * Ground tile names (map/tiles.json's grounds[].name) the player cannot walk onto — only a
 * FALLBACK for a tiles.json entry that predates the per-tile `walkable` field (see TileDef),
 * checked by isGroundWalkable() below. New ground tiles should set `walkable: false` from
 * the pizza web editor's Map tab instead of being added here.
 */
export const NON_WALKABLE_GROUND_TILES: ReadonlySet<string> = new Set(['water', 'lava', 'rock']);

export function isGroundWalkable(def: TileDef | undefined): boolean {
    if (def === undefined) {
        return true;
    }
    if (def.walkable !== undefined) {
        return def.walkable;
    }
    return !NON_WALKABLE_GROUND_TILES.has(def.name);
}

export function loadTiledMap(alias: string): TiledMapData {
    return PIXI.Assets.get(alias) as TiledMapData;
}

export function loadTileDefs(alias: string): TileDefsData {
    return PIXI.Assets.get(alias) as TileDefsData;
}

export function findLayer(map: TiledMapData, name: string): TiledLayer | undefined {
    return map.layers.find(layer => layer.type === 'tilelayer' && layer.visible && layer.name === name);
}

/**
 * All tilelayers whose name CONTAINS `name` (not an exact match) — kept in the same order
 * Tiled exported them (map.layers' own array order), which is what determines paint order:
 * the Nth match gets lifted N steps higher (see GROUND_LAYER_Y_STEP). Lets a map author stack
 * decorative ground variants (e.g. "groundLayer", "groundLayer2", "groundLayer_path") without
 * this project needing to know how many there are or what they're called beyond sharing that
 * substring — see TileMap.ts's build(), the one caller.
 */
export function findLayers(map: TiledMapData, name: string): TiledLayer[] {
    return map.layers.filter(layer => layer.type === 'tilelayer' && layer.visible && layer.name.includes(name));
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

/**
 * Resolves ANY gid (not just the ground/resource tilesets getTilesetFirstGids() knows about)
 * to whichever tileset actually owns it — the one with the LARGEST firstgid that's still
 * `<= gid` — then reads that tile's own image. For an "image collection" tileset (see
 * TiledTileset.tiles' own doc) that's the per-tile entry at `gid - tileset.firstgid`; for a
 * traditional single-sheet tileset it's just the tileset's own shared `image` (good enough for
 * MeshLayerSpawner.ts's purposes, which only ever deals with one-tile image-collection
 * tilesets in practice). Returns just the image's own BASENAME (no directory) — the only part
 * ModelSnapshotTool.decodeModelRef() needs; the rest is Tiled's own relative-path bookkeeping.
 * undefined if `gid` is 0/negative or doesn't fall inside any known tileset's range at all.
 */
export function resolveTiledTileImageName(map: TiledMapData, gid: number): string | undefined {
    const owner = findTilesetOwningGid(map, gid);
    if (!owner) {
        return undefined;
    }

    const localId = gid - owner.firstgid;
    const imagePath = owner.tiles?.find(tile => tile.id === localId)?.image ?? owner.image;
    return imagePath?.split(/[/\\]/).pop();
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
        const providerType = def && ((def.providerType as ProviderType | undefined) ?? RESOURCE_NAME_TO_TYPE[def.name]);
        if (!providerType) {
            if (def && !warnedNames.has(def.name)) {
                warnedNames.add(def.name);
                console.warn(`[TileMapConfig] resource tile "${def.name}" has no matching provider yet — skipping`);
            }
            continue;
        }

        const { x, z } = tileCellToWorldPosition(col, row, worldUnitsPerTile);

        spawns.push({
            id: `${def!.name}-${col}-${row}`,
            providerType,
            position: new THREE.Vector3(x, 0, z),
        });
    }

    return spawns;
}
