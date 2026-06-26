// ── Per-room config ───────────────────────────────────────────────────────────
// Add a row to grow the map; tweak any value without touching game code.
// foodCount is no longer per-row — it is computed from FOOD_CONFIG density below.

export interface LinearRoomConfig {
    size: number;          // platform side length (world units)
    gateValue: number;     // player value required to open the gate (0 = always open)
    foodValues: number[];  // pool drawn at random on each food spawn
    speedScale: number;    // multiplied into delta — makes bigger rooms feel slower
}

//  Room  Size  Gate     Food          Speed
export const ROOM_CONFIGS: LinearRoomConfig[] = [
    { size: 60, gateValue: 0, foodValues: [2], speedScale: 1.00 },
    { size: 68, gateValue: 8, foodValues: [2], speedScale: 0.97 },
    { size: 76, gateValue: 16, foodValues: [2, 4], speedScale: 0.95 },
    { size: 86, gateValue: 32, foodValues: [2, 4], speedScale: 0.92 },
    { size: 96, gateValue: 64, foodValues: [4], speedScale: 0.88 },
    { size: 106, gateValue: 128, foodValues: [4], speedScale: 0.84 },
    { size: 116, gateValue: 256, foodValues: [4, 8], speedScale: 0.80 },
    { size: 126, gateValue: 512, foodValues: [8], speedScale: 0.75 },
    { size: 136, gateValue: 1024, foodValues: [8, 16], speedScale: 0.70 },
    { size: 148, gateValue: 2048, foodValues: [16], speedScale: 0.64 },
    { size: 160, gateValue: 4096, foodValues: [16], speedScale: 0.58 },
    { size: 172, gateValue: 8192, foodValues: [16, 32], speedScale: 0.52 },
];

export const KING_ROOM_INDEX = ROOM_CONFIGS.length - 1;

// ── Food config ───────────────────────────────────────────────────────────────
// One place for every food-related number. computeFoodCount() derives item
// counts from density so large rooms automatically get more food.
export const FOOD_CONFIG = {
    // ── Initial spawn ─────────────────────────────────────────────────────
    // Items placed when a room is first built. Kept intentionally small so
    // the room feels sparse and the trickle spawn creates tension.
    initialCount:          5,    // items placed on room creation (before any top-up)

    // ── Density (LevelManager target) ─────────────────────────────────────
    densityPer100:         1,    // items per 100 m²  (1 ≈ "1 per 10×10 area")
    minAbsolute:           5,    // floor: LevelManager never lets a room drop below this
    maxAbsolute:          80,    // ceiling: cap for very large rooms
    spawnPadding:          5,    // units trimmed from each wall edge before spawning

    // ── Top-up spawner (LevelManager) ─────────────────────────────────────
    spawnInterval:         3.5,  // seconds between top-up ticks
    minDistBetweenItems:   2.5,  // minimum separation between two food items
    minDistFromPlayer:     7,    // new items spawn at least this far from the player
    maxPlacementAttempts:  30,   // give up placement after this many tries
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
// Camera pulls back continuously based on the player's world-depth (|player.z|).
// Formula:  targetY = baseY + depth * yPerDepth   (clamped to maxY)
//           targetZ = baseZ + depth * zPerDepth   (clamped to maxZ)
// Increase zPerDepth for more dramatic zoom-out; raise lerp for snappier follow.
export const CAMERA_CONFIG = {
    baseY: 5,      // height at depth 0
    baseZ: 10,     // distance at depth 0
    yPerDepth: 0.022,  // +Y per world unit of player depth
    zPerDepth: 0.050,  // +Z per world unit of player depth
    maxY: 40,     // maximum camera height
    maxZ: 100,    // maximum camera distance
    lerp: 0.08,   // position-follow smoothing (lower = floatier)
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getLinearRoomConfig(roomIndex: number): LinearRoomConfig {
    if (roomIndex < ROOM_CONFIGS.length) return ROOM_CONFIGS[roomIndex];
    const last = ROOM_CONFIGS[ROOM_CONFIGS.length - 1];
    const extra = roomIndex - ROOM_CONFIGS.length + 1;
    return {
        size: Math.min(last.size + extra * 10, 300),
        gateValue: last.gateValue * Math.pow(2, extra),
        foodValues: last.foodValues,
        speedScale: Math.max(last.speedScale - extra * 0.03, 0.30),
    };
}

export function linearRoomLabel(roomIndex: number): string {
    if (roomIndex === KING_ROOM_INDEX) return '♚ King';
    if (roomIndex > KING_ROOM_INDEX) return `Post-${roomIndex - KING_ROOM_INDEX}`;
    return `Room ${roomIndex + 1}`;
}
