// MobConfig.ts
//
// Every number of a battle, in one place (refs/mob/mob_control_gameplay_and_web_mvp.pdf's starter values, then tuned).
// The arena is a 2D X/Z field: X across (-ARENA.halfWidth .. +), Z along it — the cannon at z = 0 at the near end,
// the enemy base far up the field at negative Z. "Forward" for the player's (blue) mobs is -Z; red mobs come down +Z.
//
// A battle is a BattleConfig: the shared TUNING plus one of the PRESETS (the same arena, other numbers). After the last
// preset they repeat, a little harder each loop (battleConfig()).

export const ARENA = {
    /** Half the field's width (world units): 10 wide, as the brief. */
    halfWidth: 5,
    /** Where the enemy base's front edge is (z). */
    baseZ: -24,
    /** The danger line: a red mob past it (z greater) loses the battle. Just in front of the cannon. */
    dangerZ: -0.6,
    /** How far the cannon slides either way. */
    cannonRange: 4.2,
};

/** The shared feel: speeds, sizes, the cannon. The debug panel's sliders change these live. */
export const TUNING = {
    /** Blue mobs a second at fire level 1, and how much each level adds (x level-1). */
    fireRate: 5,
    fireRatePerLevel: 0.22,
    /** Units a second. */
    blueSpeed: 4.2,
    redSpeed: 3.2,
    /** A mob's radius (world units): its spacing, and its reach in a fight (two radii). */
    radius: 0.4,
    /** The model's height on the field (applied live: the debug panel's Mob size). */
    mobHeight: 1.6,
    /** The most mobs alive at once (both teams): past it, the cannon waits and gates make fewer. */
    maxMobs: 520,
    /** How hard mobs push apart, and how far a red looks for a blue to run at. */
    separation: 7,
    seekRange: 3,
    /** Seconds a burst of red spawns lasts, and the pause between bursts (waves). */
    waveSeconds: 4,
    wavePause: 1.2,
    /** Seconds the battle runs before reds start (the cannon's first shots get a head start). */
    redDelay: 3,
};

/** A multiplier gate: a span across the field at a z; a mob crossing it becomes `value` mobs. */
export interface GateConfig {
    x: number;
    z: number;
    width: number;
    value: number;
    /** Slides side to side: how far either way (units) and how long a full swing takes (seconds). */
    swing?: { range: number; seconds: number };
}

export interface BattleConfig {
    name: string;
    gates: GateConfig[];
    /** Red mobs a second at the start, and at the end of the ramp (seconds). */
    redRate: number;
    redRateEnd: number;
    redRamp: number;
    /** One-hit blue impacts the base takes. */
    baseHp: number;
    /** Coins for a win. */
    reward: number;
}

/** Three presets, the same arena (the brief's "three parameter presets"). */
export const PRESETS: BattleConfig[] = [
    {
        name: 'Meadow',
        gates: [{ x: -2.45, z: -9, width: 3.6, value: 2 }, { x: 2.45, z: -9, width: 3.6, value: 3 }],
        redRate: 2.4, redRateEnd: 4.5, redRamp: 45, baseHp: 420, reward: 100,
    },
    {
        name: 'Bridge',
        gates: [{ x: -2.45, z: -9, width: 3.6, value: 2 }, { x: 2.45, z: -9, width: 3.6, value: 3 }],
        redRate: 3.2, redRateEnd: 5.6, redRamp: 50, baseHp: 580, reward: 120,
    },
    {
        name: 'Fortress',
        gates: [
            { x: -2.45, z: -8, width: 3.6, value: 2 },
            { x: 2.45, z: -8, width: 3.6, value: 3 },
            { x: 0, z: -14, width: 3, value: 2, swing: { range: 3, seconds: 5 } },
        ],
        redRate: 3.8, redRateEnd: 6.5, redRamp: 55, baseHp: 740, reward: 150,
    },
];

/** How much harder each loop through the presets gets (red rates and base HP). */
const LOOP_HARDER = 0.15;

/** Battle `index` (0-based, counting up forever): its preset, harder on each loop. */
export function battleConfig(index: number): BattleConfig {
    const preset = PRESETS[index % PRESETS.length];
    const loop = Math.floor(index / PRESETS.length);
    const harder = 1 + loop * LOOP_HARDER;
    return {
        ...preset,
        redRate: preset.redRate * harder,
        redRateEnd: preset.redRateEnd * harder,
        baseHp: Math.round(preset.baseHp * harder),
        reward: Math.round(preset.reward * harder),
    };
}

/** The cannon's fire-rate upgrade: levels 1 to MAX_FIRE_LEVEL, and what the next level costs (coins). */
export const MAX_FIRE_LEVEL = 5;
export const FIRE_UPGRADE_COST = [50, 100, 175, 275];

/** Team colours: the mobs, the cannon and the gates. */
export const COLORS = {
    blue: 0x3b8cff,
    red: 0xff3d4f,
    gate: 0x4fb6ff,
    track: 0xe8a35c,
    grass: 0x6cc24a,
};
