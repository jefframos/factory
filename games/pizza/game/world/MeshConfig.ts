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

// ── Tile definitions ──────────────────────────────────────────────────────────
// Each non-zero grid cell value maps to a TileConfig that controls how it looks.
// Add a new entry to TILE_DEFS to create a new tile type.
//
//   height     — how tall the tile is above the floor (world units)
//   color      — hex colour (e.g. 0x1e2d3d); ignored when texture is 'island'
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

export const TILE_DEFS: Record<number, TileConfig> = {
    // 1 — CELL_WALL: linear/gated mode's dungeon wall (RoomGrid.ts). Not used by Boundless.
    1: { height: 5.5, color: 0x1e2d3d, depthBelow: 30, fadeFrom: 0, fadeTo: -10, texture: 'island' },
    // 2 — CELL_OBSTACLE: short obstacle scattered on top of terrain (rounded corners via ClusterMeshBuilder.roundEdges)
    2: { height: 1.0, color: 0x2a3a4a, depthBelow: 10, radius: 0.5, fadeFrom: 0, fadeTo: -5, texture: 'island' },
    // 3 — CELL_TERRAIN: Boundless-mode island base ground — short, unlike the CELL_WALL tile above.
    3: { height: 1.0, color: 0x2a3a4a, depthBelow: 30, radius: 0.5, fadeFrom: 0, fadeTo: -10, texture: 'island' },
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
        elevation: 0.45,
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
