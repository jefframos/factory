// ── Obstacle placement ────────────────────────────────────────────────────────
// Stamp pre-defined shapes at positions chosen by seeded value noise.
// Add a room's `obstacles` field to enable; omit it for a clean open room.
//
// pattern  — rows of characters; any digit > 0 is the tile id to stamp,
//            '0' or '.' means "leave this cell alone".
// scale    — noise frequency.  ~0.1 = large sparse blobs, ~0.3 = tight clusters.
// threshold— noise value [0–1] above which a stamp fires.  0.6 = ~40% coverage.
// seed     — integer; same seed always produces the same layout.

export interface ObstacleConfig {
    tileId: number;  // which tile type to fill (e.g. 2 for obstacle)
    scale: number;  // noise frequency — smaller = larger blobs (try 0.04–0.10)
    threshold: number;  // noise cutoff [0–1] — higher = sparser blobs (try 0.60–0.75)
    seed: number;  // deterministic integer — same seed always produces the same layout
}

/** Ready-made patterns — use directly or as inspiration for inline ones. */
export const OBSTACLE_SHAPES = {
    dot: ['2'],
    bar3: ['222'],
    bar3V: ['2', '2', '2'],
    block: ['22', '22'],
    cross: ['020', '222', '020'],
    lNW: ['22', '20'],
    lNE: ['22', '02'],
    lSW: ['20', '22'],
    lSE: ['02', '22'],
    tDown: ['222', '020'],
    tUp: ['020', '222'],
    tLeft: ['02', '22', '02'],
    tRight: ['20', '22', '20'],
};

// ── Per-room config ───────────────────────────────────────────────────────────
// Add a row to grow the map; tweak any value without touching game code.
//
// layout (optional): define the room as a string-grid.
//   Each character is a tile id ('0' = free, '1' = wall, '2' = obstacle, etc.)
//   matching entries in TILE_DEFS above.  Rows run south→north (row 0 = gate side).
//   When omitted, the room is auto-generated: solid border + centred gate gap.

export interface LinearRoomConfig {
    size: number;         // platform side length in world units
    gateValue: number;         // player value required to open the gate (0 = always open)
    foodValues: number[];       // pool drawn at random on each food spawn
    layout?: string[];       // optional hand-crafted grid (overrides auto-generation)
    obstacles?: ObstacleConfig | null; // override default obstacles; null = no obstacles
}

//  Room  Size  Gate      Food
export const ROOM_CONFIGS: LinearRoomConfig[] = [
    {
        size: 60, gateValue: 8, foodValues: [2],
        obstacles: { tileId: 2, scale: 0.05, threshold: 0.88, seed: 1 }
    },
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
export const FOOD_CONFIG = {
    initialCount: 5,
    densityPer100: 1,
    minAbsolute: 5,
    maxAbsolute: 80,
    spawnPadding: 5,
    spawnInterval: 3.5,
    minDistBetweenItems: 2.5,
    minDistFromPlayer: 7,
    maxPlacementAttempts: 30,
    /**
     * Independent "the player specifically must be able to find food" floor,
     * on top of the zone-wide density/spawnInterval above. That interval only
     * replaces one eaten item at a time regardless of how many mouths are
     * drawing the pool down (bots now compete for the same food), so a busy
     * area can go empty around the player even while the wider zone is at
     * capacity. Checked on its own cadence (guaranteedCheckInterval) so bot
     * competition can't starve it out.
     */
    guaranteedRadius: 14,        // world-units — the player should essentially never find zero food this close
    guaranteedMinCount: 2,       // minimum food items expected within guaranteedRadius of the player
    guaranteedCheckInterval: 1.0,
};

/**
 * Single source of truth for which values can ever appear as food, and how
 * often — used by every real on-screen food spawn in the boundless world
 * (LevelManager) AND by the idle NPC roster's background feeding simulation
 * (NpcRoster), so a materialized/dematerialized NPC's growth always reflects
 * the same economy the player experiences. Weights must sum to 1.
 */
export const FOOD_VALUE_WEIGHTS: { value: number; weight: number }[] = [
    { value: 2, weight: 0.80 },
    { value: 4, weight: 0.15 },
    { value: 8, weight: 0.05 },
];

export function rollFoodValue(): number {
    const roll = Math.random();
    let cumulative = 0;
    for (const bucket of FOOD_VALUE_WEIGHTS) {
        cumulative += bucket.weight;
        if (roll < cumulative) return bucket.value;
    }
    return FOOD_VALUE_WEIGHTS[FOOD_VALUE_WEIGHTS.length - 1].value;
}

export function computeFoodCount(roomSize: number): number {
    const side = Math.max(0, roomSize - FOOD_CONFIG.spawnPadding * 2);
    const count = Math.floor(FOOD_CONFIG.densityPer100 * side * side / 100);
    return Math.max(FOOD_CONFIG.minAbsolute, Math.min(FOOD_CONFIG.maxAbsolute, count));
}

// ── Camera config ─────────────────────────────────────────────────────────────
export const CAMERA_CONFIG = {
    pitch: 45,
    minDistance: 10,
    maxDistance: 25,
    maxAtValue: 8192,
    followSpeed: 5,
    /** cameraZoom multiplier while the boot menu is up — starts close on the player, then eases out to 1.0 (via the existing camDist smoothing) once they hit "Tap to Start." */
    menuZoom: 0.45,
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
    };
}

export function linearRoomLabel(roomIndex: number): string {
    if (roomIndex === KING_ROOM_INDEX) return '♚ King';
    if (roomIndex > KING_ROOM_INDEX) return `Post-${roomIndex - KING_ROOM_INDEX}`;
    return `Room ${roomIndex + 1}`;
}
