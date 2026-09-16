// ── Island tile texture config ─────────────────────────────────────────────────
// Controls the canvas texture applied to tiles that use texture: 'island'.
// The generator reads these values; edit here to change the look without touching
// the generator code in builders/IslandTexture.ts.
//
// Atlas layout (square, 2×2 quadrants):
//   top-left    [U 0–0.5,   V 0.5–1] = side "collar" — unique art bordering the top
//   top-right   [U 0.5–1,   V 0.5–1] = grass (top faces), tiled every `tileSize` units
//   bottom-left [U 0–0.5,   V 0–0.5] = side "tile" — repeats below the collar
//   bottom-right[U 0.5–1,   V 0–0.5] = unused
//
// Real island art (see IslandStorage.ts / islands.json) must follow the same
// quadrant layout for loadRealIsland() to look right.

export const ISLAND_TEXTURE_CONFIG = {
    resolution: 128,         // px per atlas quadrant — increase for sharper texture
    tileSize: 2,             // world units per texture repeat (top tiling + side collar/tile)
    grass: {
        base: '#4a7c32',   // dominant green
        dark: '#3a6028',   // shadow patches / blade tips
        light: '#5c9040',   // sunlit spots
        patchCount: 24,          // number of variation blobs
    },
    sand: {
        base: '#c8a857',   // main sandy tan
        dark: '#b09040',   // shadowed pits
        light: '#dfc070',   // bright sparkles
        soilStrip: '#7a5a1a',   // dark strip at top (grass-root junction)
        patchCount: 18,
    },
} as const;

// ── Island tile definitions ────────────────────────────────────────────────────
// Keyed by map/tiles.json's grounds[].name (see TileMapConfig.ts) — every ground
// tile IslandMeshBuilder.ts paints as raised island geometry (i.e. every ground
// name except 'water', which becomes the water plane instead — see
// ISLAND_NON_LAND_TILES below) looks up its entry here. A name with no entry
// falls back to ISLAND_DEFAULT_TILE, so a brand-new ground tile added to
// tiles.json needs no MeshConfig change to render as flat island geometry —
// only add an entry here to give it a distinct height/bevel.
//
//   height     — how tall the tile is above the floor (world units)
//   color      — ignored: IslandMeshBuilder colors each mesh from the tile's own
//                map/tiles.json color instead, so there's one place tile color
//                is registered, not two. Kept on the interface for parity with
//                `texture: 'island'`, which paints over color entirely.
//   opacity    — 0 transparent → 1 solid  (default: 1)
//   roughness  — 0 glossy → 1 matte       (default: 0.9)
//   depthBelow — how far the mesh extends below y=0 (default: height >= 2 ? 30 : 0)
//   texture    — 'island' for grass-top/sand-sides atlas, or null for flat colour
//   radius     — corner bevel radius (world units); omit/0 = sharp; >0 = rounded edges

export interface TileConfig {
    height: number;
    color: number;
    opacity?: number;
    roughness?: number;
    depthBelow?: number;
    texture?: string | null;
    radius?: number;
    fadeFrom?: number;  // world Y where fragment is fully opaque (at and above)
    fadeTo?: number;    // world Y where fragment is fully transparent (at and below)
}

/** Ground tile names IslandMeshBuilder never meshes as land — they're left as gaps in the island geometry so the global water plane (ROOM_GEOMETRY.floor) shows through instead. */
export const ISLAND_NON_LAND_TILES: ReadonlySet<string> = new Set(['water']);

/**
 * height: 0 — the island top sits exactly at y=0, level with the rest of pizza's world
 * (player, buildings, drop/gate zones all assume ground level is y=0; clog's original
 * CELL_TERRAIN height of 1.0 sat land a full unit above that and overlapped everything).
 * ROOM_GEOMETRY.floor.elevation is set to -0.5 to match — water sits 0.5 below the island
 * top. depthBelow/radius/fade are unchanged from clog's numbers — those only shape the
 * (usually unseen) underside and outer bevel, not how high the top sits. Used for any
 * ground tile name with no entry in ISLAND_TILE_DEFS below.
 */
export const ISLAND_DEFAULT_TILE: TileConfig = {
    height: 0.001, color: 0x2a3a4a, depthBelow: 30, radius: 0.5, fadeFrom: 0, fadeTo: -10,
};

export const ISLAND_TILE_DEFS: Record<string, TileConfig> = {
    // Beach — lower and rounder than the default land tile, echoing a gentle slope into the water.
    sand: { height: 0.03, color: 0x2a3a4a, depthBelow: 30, radius: 0.6, fadeFrom: 0, fadeTo: -10 },
    // Slightly built-up, sharper-edged than the surrounding land.
    lava: { height: 0.45, color: 0x2a3a4a, depthBelow: 30, radius: 0.2, opacity: 0.95, fadeFrom: 0, fadeTo: -10 },
    rock: { height: 10, color: 0x2a3a4a, depthBelow: 2, radius: 0.2, opacity: 1, fadeFrom: 0, fadeTo: -10 },
};

// ── Room geometry & material config ──────────────────────────────────────────

export type FloorShader = 'water' | null;

export const ROOM_GEOMETRY = {
    base: {
        depth: 30,
        sideColor: 0x0d1020,
        roughness: 0.95,
    },
    floor: {
        roughness: 0.8,
        opacity: 0.8,
        shader: 'water' as FloorShader,
        // 0.5 below ISLAND_DEFAULT_TILE's height (0) — island tops sit at y=0, level with
        // the rest of the world, and the water surface sits 0.5 below that.
        elevation: -0.5,
    },
    // Height used when sealing the entrance gap after transition.
    walls: {
        height: 3.5,
    },
};

// ── Gate material config ──────────────────────────────────────────────────────

export const GATE_MATERIAL_CONFIG = {
    opacity: 1,
    roughness: 0.5,
    emissiveIntensity: 0.2,
    lockedColor: '#aa2222',
    lockedBorder: '#ff5555',
};
