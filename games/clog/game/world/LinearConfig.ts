// ── Per-room config ───────────────────────────────────────────────────────────
// Add a row to grow the map; tweak any value without touching game code.
// foodCount is no longer per-row — it is computed from FOOD_CONFIG density below.

export interface LinearRoomConfig {
    size: number;          // platform side length (world units)
    gateValue: number;     // player value required to open the gate (0 = always open)
    foodValues: number[];  // pool drawn at random on each food spawn
}

//  Room  Size  Gate     Food          Speed
export const ROOM_CONFIGS: LinearRoomConfig[] = [
    { size: 60, gateValue: 0, foodValues: [2] },
    { size: 68, gateValue: 8, foodValues: [2] },
    { size: 76, gateValue: 16, foodValues: [2, 4] },
    { size: 86, gateValue: 32, foodValues: [2, 4] },
    { size: 96, gateValue: 64, foodValues: [4] },
    { size: 106, gateValue: 128, foodValues: [4] },
    { size: 116, gateValue: 256, foodValues: [4, 8] },
    { size: 126, gateValue: 512, foodValues: [8] },
    { size: 136, gateValue: 1024, foodValues: [8, 16] },
    { size: 148, gateValue: 2048, foodValues: [16] },
    { size: 160, gateValue: 4096, foodValues: [16] },
    { size: 172, gateValue: 8192, foodValues: [16, 32] },
];

export const KING_ROOM_INDEX = ROOM_CONFIGS.length - 1;

// ── Food config ───────────────────────────────────────────────────────────────
// One place for every food-related number. computeFoodCount() derives item
// counts from density so large rooms automatically get more food.
export const FOOD_CONFIG = {
    // ── Initial spawn ─────────────────────────────────────────────────────
    // Items placed when a room is first built. Kept intentionally small so
    // the room feels sparse and the trickle spawn creates tension.
    initialCount: 5,    // items placed on room creation (before any top-up)

    // ── Density (LevelManager target) ─────────────────────────────────────
    densityPer100: 1,    // items per 100 m²  (1 ≈ "1 per 10×10 area")
    minAbsolute: 5,    // floor: LevelManager never lets a room drop below this
    maxAbsolute: 80,    // ceiling: cap for very large rooms
    spawnPadding: 5,    // units trimmed from each wall edge before spawning

    // ── Top-up spawner (LevelManager) ─────────────────────────────────────
    spawnInterval: 3.5,  // seconds between top-up ticks
    minDistBetweenItems: 2.5,  // minimum separation between two food items
    minDistFromPlayer: 7,    // new items spawn at least this far from the player
    maxPlacementAttempts: 30,   // give up placement after this many tries
};

/**
 * Returns how many food items should exist in a room of `roomSize`.
 * Formula: density * spawnArea, clamped to [minAbsolute, maxAbsolute].
 */
export function computeFoodCount(roomSize: number): number {
    const side = Math.max(0, roomSize - FOOD_CONFIG.spawnPadding * 2);
    const count = Math.floor(FOOD_CONFIG.densityPer100 * side * side / 100);
    return Math.max(FOOD_CONFIG.minAbsolute, Math.min(FOOD_CONFIG.maxAbsolute, count));
}

// ── Camera config ─────────────────────────────────────────────────────────────
// Camera orbits the player at a fixed pitch; distance scales with player value.
//
//   pitch        — tilt in degrees (0 = horizon, 90 = directly overhead)
//   minDistance  — how far away the camera starts (player value = 2)
//   maxDistance  — how far it pulls back at its limit
//   maxAtValue   — the player value that reaches maxDistance
//   lerp         — position-follow smoothing (lower = floatier, higher = snappier)
export const CAMERA_CONFIG = {
    pitch: 45,           // degrees above horizon
    minDistance: 10,     // camera distance when value = 2
    maxDistance: 15,     // camera distance when value = maxAtValue
    maxAtValue: 8192,    // player value that maps to maxDistance
    followSpeed: 5,      // position-follow speed — higher = snappier (5 ≈ lerp 0.08 at 60fps)
};

// ── Room geometry config ──────────────────────────────────────────────────────
// One place to tune every wall type and the floor slab independently.
// All geometry in LinearArea.ts reads from this — no constants to chase.
export const ROOM_GEOMETRY = {
    // E/W side walls — thick blocks that prevent seeing outside the room.
    sideWalls: {
        thickness: 40,   // depth extending outward from room edge
        height: 3.5,     // above floor (top of visible wall)
        depthBelow: 30,  // below floor (hides the void)
        color: 0x1e2d3d,
        roughness: 0.9,
        opacity: 1.0,
    },
    // S-facing divider walls — flank the gate opening.
    dividerWalls: {
        thickness: 2,
        height: 3.5,
        depthBelow: 30,
        color: 0x1e2d3d,
        roughness: 0.9,
        opacity: 1.0,
    },
    // Floor platform — the slab the player walks on and its downward pedestal.
    base: {
        depth: 30,          // how far below y=0 the pedestal extends
        sideColor: 0x0d1020,
        roughness: 0.95,
    },
};

// ── Gate material config ──────────────────────────────────────────────────────
export const GATE_MATERIAL_CONFIG = {
    opacity: 1,              // gate transparency (0 = invisible, 1 = solid)
    roughness: 0.5,
    emissiveIntensity: 0.2,     // glow strength (locked uses red, open uses value color)
    lockedColor: '#aa2222',     // background when locked
    lockedBorder: '#ff5555',    // border/emissive when locked
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getLinearRoomConfig(roomIndex: number): LinearRoomConfig {
    if (roomIndex < ROOM_CONFIGS.length) return ROOM_CONFIGS[roomIndex];
    const last = ROOM_CONFIGS[ROOM_CONFIGS.length - 1];
    const extra = roomIndex - ROOM_CONFIGS.length + 1;
    return {
        size: Math.min(last.size + extra * 10, 300),
        gateValue: last.gateValue * Math.pow(2, extra),
        foodValues: last.foodValues
    };
}

export function linearRoomLabel(roomIndex: number): string {
    if (roomIndex === KING_ROOM_INDEX) return '♚ King';
    if (roomIndex > KING_ROOM_INDEX) return `Post-${roomIndex - KING_ROOM_INDEX}`;
    return `Room ${roomIndex + 1}`;
}
