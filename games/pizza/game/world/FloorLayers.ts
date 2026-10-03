// FloorLayers.ts
//
// The ONE place that decides how high each flat thing on the floor sits, so they never
// z-fight. Bottom to top:
//
//   ground layer 0   "groundLayer"   (IslandMeshBuilder / TileMap)        groundY
//   ground layer 1   "groundLayer2"  ... one groundLayerGap per layer     groundY + i * groundLayerGap
//   store floor      checker floor rects (CheckerFloorBuilder)           top ground layer + storeFloorGap
//   decals           dropper / trigger / purchase outlines (DottedLineBuilder)  store floor + decalGap
//   floor labels     prices/costs painted on the floor (FloorLabelComponent)    decals + labelGap
//
// BASE Y — `baseY` (= the store floor): where everything STANDING on the floor is placed —
// buildings, storages, shops, droppers, store parts, map props... Use onFloor(x, z) for its
// position. Things drawn RELATIVE to such an entity (its dropper outline, its floor label)
// use decalLocalY / labelLocalY, which assume the entity sits at baseY. Something that does NOT
// sit at baseY (an animal walking the ground at y 0) passes its own y: localY(layer, ownY).
//
// A ground tile's own relief (MeshConfig.ts ISLAND_TILE_DEFS `height` — 0.001 default, sand
// 0.03, ...) is added on top of its layer's Y and is NOT part of this stack: keep raised tile
// types out from under stores, or they poke through the store floor.
//
// Edited from the pizza web editor's Floor Layers tab (games/pizza/web) — saved as the
// "default" entry below, same single-entry convention as PlayerConfig.ts.

import * as THREE from 'three';

export interface FloorLayerConfig {
    /** Y of the base ground layer ("groundLayer"). */
    groundY: number;
    /** Lift of each extra ground layer ("groundLayer2", "groundLayer3", ...) over the one below. */
    groundLayerGap: number;
    /** How many ground layers the stack makes room for — the store floor sits above the top one. */
    groundLayerCount: number;
    /** Store floor above the top ground layer. */
    storeFloorGap: number;
    /** Dropper / zone outlines above the store floor. */
    decalGap: number;
    /** Floor text (prices, costs) above the outlines. */
    labelGap: number;
}

const DEFAULT_FLOOR_LAYER_CONFIG: FloorLayerConfig = {
    "groundY": 0,
    "groundLayerGap": 0.01,
    "groundLayerCount": 2,
    "storeFloorGap": 0.01,
    "decalGap": 0.005,
    "labelGap": 0.005
};

export const FLOOR_LAYER_CONFIG_BY_ID: Partial<Record<string, FloorLayerConfig>> = {
    default: {
        ...DEFAULT_FLOOR_LAYER_CONFIG,
        "groundY": 0,
        "groundLayerGap": 0.01,
        "groundLayerCount": 2,
        "storeFloorGap": 0.01,
        "decalGap": 0.005,
        "labelGap": 0.005
    },
};

const config = FLOOR_LAYER_CONFIG_BY_ID.default ?? DEFAULT_FLOOR_LAYER_CONFIG;

/** Y of ground layer `index` (0 = "groundLayer", 1 = "groundLayer2", ...). */
export function groundLayerY(index: number): number {
    return config.groundY + index * config.groundLayerGap;
}

const storeFloorY = groundLayerY(Math.max(0, config.groundLayerCount - 1)) + config.storeFloorGap;
const decalY = storeFloorY + config.decalGap;
const labelY = decalY + config.labelGap;

/** Every layer's resolved WORLD Y — see this file's own doc for the order. */
export const FloorLayers = {
    storeFloorY,
    decalY,
    labelY,
    /** Where things standing on the floor are placed — see this file's own doc. */
    baseY: storeFloorY,
    /** A decal's Y relative to an entity at baseY (DottedLineBuilder's default). */
    decalLocalY: decalY - storeFloorY,
    /** A floor label's Y relative to an entity at baseY (FloorLabelComponent). */
    labelLocalY: labelY - storeFloorY,
} as const;

/** `layerY` (a FloorLayers world Y) relative to an entity standing at `entityY`. */
export function localY(layerY: number, entityY: number): number {
    return layerY - entityY;
}

/** A position on the floor — (x, baseY, z). Use for anything standing on the ground. */
export function onFloor(x: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, FloorLayers.baseY, z);
}
