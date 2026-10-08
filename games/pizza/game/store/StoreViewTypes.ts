// StoreViewTypes.ts
//
// A store's LOOK, as opposed to its gameplay (StoreTypes.ts):
//   - floor checkers — every "floor" rect drawn on a "--storeView--" layer (see
//     StoreLayerNames.ts / CheckerFloorBuilder.ts) is painted with one of these.
//   - walls — a wall SETUP (height/thickness/opening heights: DEFAULT_WALL_SETUP, or a
//     WALL_SETUP_BY_ID entry) and a wall STYLE (the look) — see PolyWallBuilder.ts.
//
// Any single floor / wall / door drawn in Tiled can override its look with a "style" custom prop
// (a style id from the matching *_BY_ID table, e.g. a door with style "glass"), and a wall its
// size with a "setup" prop — see WorldObjectRegistry's StoreFloorPlacement / StoreWallPlacement /
// StoreWallOpening and BuildingZone.buildWall(). Without one: the building's pick, else the
// store's, else the default (below).
//
// Same {default, byId} two-export shape as StoreTypes.ts: DEFAULT_FLOOR_CHECKER is what every
// store's floor uses unless something picks a FLOOR_CHECKER_BY_ID entry by id — today that's
// the store's own StoreConfig.floorChecker (Stores tab); later a player-bought floor resolves
// through the same getStoreFloorChecker() and just takes priority over it. Edited from the
// pizza web editor's Store View tab -> Floor (games/pizza/web). Walls work the same way:
// DEFAULT_WALL_STYLE / WALL_STYLE_BY_ID, StoreConfig.wallStyle, getStoreWallStyle() — Store View
// tab -> Wall; sizes are Store View tab -> Wall Setup (DEFAULT_WALL_SETUP first). And doors: DEFAULT_DOOR_STYLE /
// DOOR_STYLE_BY_ID (Store View tab -> Door) — picked per building (BuildingConfig.doorStyle,
// e.g. a store section), else per store (StoreConfig.doorStyle), else the default.

import { getStoreConfig } from './StoreTypes';
import { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

export interface FloorCheckerConfig {
    /** Display name — shown in the web editor (and later, in a floor shop). Optional. */
    name?: string;
    /** The two alternating colors. */
    colorA: string;
    colorB: string;
    /** Size of one checker square, in map tiles — 1 = one 32px Tiled tile per square, 0.5 = twice as dense, 2 = twice as big. */
    scale: number;
}

/** Every store's floor unless it picks another one by id — see this file's own doc. */
export const DEFAULT_FLOOR_CHECKER: FloorCheckerConfig = {
    "name": "Kitchen tiles",
    "colorA": "#d4dbde",
    "colorB": "#bdbcbc",
    "scale": 1
};

/** Named checkers a store can pick instead of the default (StoreConfig.floorChecker). */
export const FLOOR_CHECKER_BY_ID: Partial<Record<string, FloorCheckerConfig>> = {
    "roomTiles": {
        "name": "Room Tiles",
        "colorA": "#e9dcc0",
        "colorB": "#b48b5e",
        "scale": 0.5
    }
};

/** The checker with id `id` — the default when unset or unknown (warns on unknown). */
export function getFloorChecker(id?: string): FloorCheckerConfig {
    if (!id) {
        return DEFAULT_FLOOR_CHECKER;
    }
    const checker = FLOOR_CHECKER_BY_ID[id];
    if (!checker) {
        console.warn(`[StoreViewTypes] floor checker "${id}" doesn't exist — using the default`);
        return DEFAULT_FLOOR_CHECKER;
    }
    return checker;
}

/** The checker store `storeId`'s floor shows — the one place a future bought floor plugs in. No store (a floor drawn for a building no store opens) = the default. */
export function getStoreFloorChecker(storeId?: string): FloorCheckerConfig {
    return getFloorChecker(storeId ? getStoreConfig(storeId).floorChecker : undefined);
}

/** A wall's SIZE (height/thickness/opening heights). Every "polyWall" uses DEFAULT_WALL_SETUP unless its own Tiled "setup" prop names a WALL_SETUP_BY_ID entry — see getWallSetup(). */
export interface WallSetupConfig {
    /** Display name — shown in the web editor. Optional. */
    name?: string;
    /** World units, from the floor (FloorLayers.baseY) up. */
    height: number;
    /** World units, centered on the drawn line. */
    thickness: number;
    /** A "polyDoor" opening's height, from the floor up (world units) — walkable, no collider. */
    doorHeight: number;
    /** Same, for a door with the "isHigh" prop. */
    tallDoorHeight: number;
    /** A "polyWindow" opening's height (world units), centered on the wall's height. */
    windowHeight: number;
}

/** A wall's look — for now two flat bands: `bottomColor` up to `bottomHeight`, `topColor` above. */
export interface WallStyleConfig {
    /** Display name — shown in the web editor (and later, in a shop). Optional. */
    name?: string;
    bottomColor: string;
    topColor: string;
    /** Where the bottom band ends, world units from the floor (clamped to the wall's height). */
    bottomHeight: number;
    /** 0-1 — below 1 the bottom band is see-through (glass). Unset = 1, solid. */
    bottomOpacity?: number;
    /** 0-1 — below 1 the top band is see-through, e.g. a shop-front: solid bottom, glass top. Unset = 1, solid. */
    topOpacity?: number;
}

/** The wall setup every wall uses unless it names another — the first entry of the editor's Store View tab -> Wall Setup. */
export const DEFAULT_WALL_SETUP: WallSetupConfig = {
    "name": "Standard",
    "height": 6,
    "thickness": 0.35,
    "doorHeight": 4,
    "tallDoorHeight": 5.5,
    "windowHeight": 1.5
};

/** Named wall setups a wall can pick with its Tiled "setup" prop (e.g. a low counter wall). */
export const WALL_SETUP_BY_ID: Partial<Record<string, WallSetupConfig>> = {};

/** The wall setup with id `id` — the default when unset or unknown (warns on unknown). */
export function getWallSetup(id?: string): WallSetupConfig {
    if (!id) {
        return DEFAULT_WALL_SETUP;
    }
    const setup = WALL_SETUP_BY_ID[id];
    if (!setup) {
        console.warn(`[StoreViewTypes] wall setup "${id}" doesn't exist — using the default`);
        return DEFAULT_WALL_SETUP;
    }
    return setup;
}

/** Every store's walls unless it picks another style by id — see this file's own doc. */
export const DEFAULT_WALL_STYLE: WallStyleConfig = {
    "name": "Plain",
    "bottomColor": "#8a6f5a",
    "topColor": "#e9e2d6",
    "bottomHeight": 1.2
};

/** Named wall styles a store can pick instead of the default (StoreConfig.wallStyle), or a single wall with its Tiled "style" prop. */
export const WALL_STYLE_BY_ID: Partial<Record<string, WallStyleConfig>> = {
    "glassTop": {
        "name": "Glass Top",
        "bottomColor": "#8a6f5a",
        "topColor": "#9fd8ff",
        "bottomHeight": 1.2,
        "bottomOpacity": 1,
        "topOpacity": 0.35
    }
};

/** The wall style with id `id` — the default when unset or unknown (warns on unknown). */
export function getWallStyle(id?: string): WallStyleConfig {
    if (!id) {
        return DEFAULT_WALL_STYLE;
    }
    const style = WALL_STYLE_BY_ID[id];
    if (!style) {
        console.warn(`[StoreViewTypes] wall style "${id}" doesn't exist — using the default`);
        return DEFAULT_WALL_STYLE;
    }
    return style;
}

/**
 * A "polyFence" line's look and size (see PolyFenceBuilder.ts): wooden posts every
 * `postSpacing` with `railCount` rails between them — see-through, low. Every fence uses
 * DEFAULT_FENCE_STYLE unless its own Tiled "style" prop names a FENCE_STYLE_BY_ID entry.
 */
export interface FenceStyleConfig {
    /** Display name — shown in the web editor. Optional. */
    name?: string;
    color: string;
    /** Post height, world units from the floor. */
    height: number;
    /** Most distance between two posts, world units (every corner gets a post too). */
    postSpacing: number;
    /** Post width/depth, world units — also the collider's thickness. */
    postWidth: number;
    /** Horizontal rails between two posts. */
    railCount: number;
    /** Rail height (its depth is 60% of this), world units. */
    railThickness: number;
}

/** Every fence's look unless its Tiled "style" prop picks another — plain brown wood. */
export const DEFAULT_FENCE_STYLE: FenceStyleConfig = {
    "name": "Wood",
    "color": "#b16648",
    "height": 1.1,
    "postSpacing": 2,
    "postWidth": 0.3,
    "railCount": 2,
    "railThickness": 0.14
};

/** Named fence styles a "polyFence" can pick with its Tiled "style" prop. */
export const FENCE_STYLE_BY_ID: Partial<Record<string, FenceStyleConfig>> = {};

/** The fence style with id `id` — the default when unset or unknown (warns on unknown). */
export function getFenceStyle(id?: string): FenceStyleConfig {
    if (!id) {
        return DEFAULT_FENCE_STYLE;
    }
    const style = FENCE_STYLE_BY_ID[id];
    if (!style) {
        console.warn(`[StoreViewTypes] fence style "${id}" doesn't exist — using the default`);
        return DEFAULT_FENCE_STYLE;
    }
    return style;
}

/**
 * A fence door — what goes in the hole a "polyDoor" rect cuts in a "polyFence" (see
 * PolyFenceBuilder.layout() / world/FenceDoor.ts). Every fence door uses DEFAULT_FENCE_DOOR_SETUP
 * unless its polyDoor's own Tiled "setup" prop names a FENCE_DOOR_SETUP_BY_ID entry.
 */
export interface FenceDoorSetupConfig {
    /** Display name — shown in the web editor. Optional. */
    name?: string;
    /** The doorway model — first entry used, stretched along the fence to fill the hole. "Group.Key" strings or MODELS.* definitions. */
    models?: (string | ModelDefinition)[];
    /** Hole width (world units), centered on where the polyDoor crosses the fence. Unset = the whole crossing. */
    width?: number;
    /** Model height, world units from the floor. */
    height: number;
    /** x the model's depth, on top of keeping its own proportions to the height. Unset = 1. */
    depthScale?: number;
    /** Solid support at each side of the hole, world units from each end inward — the middle stays walkable. 0 = no colliders. */
    colliderInset: number;
    /** Extra yaw (degrees) for a model whose width doesn't run along its own X. Unset = 0. */
    rotationOffsetDeg?: number;
}

/** Every fence door unless its polyDoor's "setup" prop picks another. */
export const DEFAULT_FENCE_DOOR_SETUP: FenceDoorSetupConfig = {
    "name": "Wood Doorway",
    "models": [
        "Deco.FenceDoorway"
    ],
    "height": 5,
    "colliderInset": 2
};

/** Named fence door setups a "polyDoor" over a fence can pick with its Tiled "setup" prop. */
export const FENCE_DOOR_SETUP_BY_ID: Partial<Record<string, FenceDoorSetupConfig>> = {};

/** The fence door setup with id `id` — the default when unset or unknown (warns on unknown). */
export function getFenceDoorSetup(id?: string): FenceDoorSetupConfig {
    if (!id) {
        return DEFAULT_FENCE_DOOR_SETUP;
    }
    const setup = FENCE_DOOR_SETUP_BY_ID[id];
    if (!setup) {
        console.warn(`[StoreViewTypes] fence door setup "${id}" doesn't exist — using the default`);
        return DEFAULT_FENCE_DOOR_SETUP;
    }
    return setup;
}

/** The wall style store `storeId`'s walls show — the one place a future bought wall plugs in. No store = the default. */
export function getStoreWallStyle(storeId?: string): WallStyleConfig {
    return getWallStyle(storeId ? getStoreConfig(storeId).wallStyle : undefined);
}

/**
 * How the door in a "polyDoor" opening looks (StoreDoor.ts): a model, or — with no model — a
 * plain panel in `color` at `opacity` (below 1 = see-through, e.g. glass).
 */
export interface DoorStyleConfig {
    /** Display name — shown in the web editor (and later, in a shop). Optional. */
    name?: string;
    /**
     * A single door's leaf model — first entry used, stretched to the leaf's width/height, then ×
     * `scale`. Unset/empty = the plain panel. "Group.Key" strings or MODELS.* definitions (the
     * editor writes either — see StoreDoor's resolveModelRef() call).
     */
    models?: (string | ModelDefinition)[];
    /** Same, for each of a DOUBLE door's two leaves (an "isDouble" opening, or a sliding door that parts in two) — e.g. a leaf with its handle on the inside edge. Unset/empty = `models`. */
    doubleModels?: (string | ModelDefinition)[];
    /** Multiplier on the model's fitted size (1 = exactly the leaf). Model only. */
    scale?: number;
    /** Plain panel only. */
    color: string;
    /** Plain panel only — 1 = solid, 0 = invisible. */
    opacity: number;
}

/** Every door unless its building or store picks another style by id — see this file's own doc. */
export const DEFAULT_DOOR_STYLE: DoorStyleConfig = {
    "name": "Wood",
    "models": [
        "Store.DoorA"
    ],
    "doubleModels": [
        "Store.DoorB"
    ],
    "color": "#6b4a32",
    "opacity": 1
};

/** Named door styles a building (BuildingConfig.doorStyle) or store (StoreConfig.doorStyle) can pick. */
export const DOOR_STYLE_BY_ID: Partial<Record<string, DoorStyleConfig>> = {
    "glass": {
        "name": "Glass",
        "color": "#9fd8ff",
        "opacity": 0.35
    }
};

/** The door style with id `id` — the default when unset or unknown (warns on unknown). */
export function getDoorStyle(id?: string): DoorStyleConfig {
    if (!id) {
        return DEFAULT_DOOR_STYLE;
    }
    const style = DOOR_STYLE_BY_ID[id];
    if (!style) {
        console.warn(`[StoreViewTypes] door style "${id}" doesn't exist — using the default`);
        return DEFAULT_DOOR_STYLE;
    }
    return style;
}

/** The door style store `storeId`'s doors use. No store = the default. */
export function getStoreDoorStyle(storeId?: string): DoorStyleConfig {
    return getDoorStyle(storeId ? getStoreConfig(storeId).doorStyle : undefined);
}
