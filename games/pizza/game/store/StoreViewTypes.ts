// StoreViewTypes.ts
//
// A store's LOOK, as opposed to its gameplay (StoreTypes.ts):
//   - floor checkers — every "floor" rect drawn on a "--storeView--" layer (see
//     StoreLayerNames.ts / CheckerFloorBuilder.ts) is painted with one of these.
//   - walls — WALL_SETUP (height/thickness) is shared by EVERY "polyWall" in the game; only the
//     look (a wall style) differs per store (see PolyWallBuilder.ts).
//
// Same {default, byId} two-export shape as StoreTypes.ts: DEFAULT_FLOOR_CHECKER is what every
// store's floor uses unless something picks a FLOOR_CHECKER_BY_ID entry by id — today that's
// the store's own StoreConfig.floorChecker (Stores tab); later a player-bought floor resolves
// through the same getStoreFloorChecker() and just takes priority over it. Edited from the
// pizza web editor's Store View tab -> Floor (games/pizza/web). Walls work the same way:
// DEFAULT_WALL_STYLE / WALL_STYLE_BY_ID, StoreConfig.wallStyle, getStoreWallStyle() — Store View
// tab -> Wall, whose shared "Wall Setup" card is WALL_SETUP.

import { getStoreConfig } from './StoreTypes';

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
export const FLOOR_CHECKER_BY_ID: Partial<Record<string, FloorCheckerConfig>> = {};

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

/** Size shared by every "polyWall" in the game — see this file's own doc. */
export interface WallSetupConfig {
    /** World units, from the floor (FloorLayers.baseY) up. */
    height: number;
    /** World units, centered on the drawn line. */
    thickness: number;
    /** A "polyDoor" opening's height, from the floor up (world units) — walkable, no collider. */
    doorHeight: number;
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
}

export const WALL_SETUP: WallSetupConfig = {
    "height": 4,
    "thickness": 0.35,
    "doorHeight": 3,
    "windowHeight": 1.5
};

/** Every store's walls unless it picks another style by id — see this file's own doc. */
export const DEFAULT_WALL_STYLE: WallStyleConfig = {
    "name": "Plain",
    "bottomColor": "#8a6f5a",
    "topColor": "#e9e2d6",
    "bottomHeight": 1.2
};

/** Named wall styles a store can pick instead of the default (StoreConfig.wallStyle). */
export const WALL_STYLE_BY_ID: Partial<Record<string, WallStyleConfig>> = {};

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

/** The wall style store `storeId`'s walls show — the one place a future bought wall plugs in. No store = the default. */
export function getStoreWallStyle(storeId?: string): WallStyleConfig {
    return getWallStyle(storeId ? getStoreConfig(storeId).wallStyle : undefined);
}
