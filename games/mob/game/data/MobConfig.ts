// MobConfig.ts
//
// Every number of a battle, in one place (refs/mob/mob_control_gameplay_and_web_mvp.pdf's starter values, then tuned).
// The arena is a 2D X/Z field: X across (-ARENA.halfWidth .. +), Z along it — the cannon at z = 0 at the near end,
// the enemy base far up the field at negative Z. "Forward" for the player's (blue) mobs is -Z; red mobs come down +Z.
//
// A battle is a BattleConfig: the shared TUNING plus a level (MobLevels.ts: its gates, walls, water, spinners, pushers,
// giant pads, enemy pressure). After the last level they repeat, a little harder each loop (battleConfig()).

import unitsFile from '../../ui/units.json';
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
    mobHeight: 2.6,
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
    /** A giant: how many hits it takes (each mob it crushes costs one) — a red giant has to soak up a lot of a stream to
     *  feel like a threat — how much bigger it is (size and reach), how much slower, and how much a blue giant takes off
     *  the base. */
    blueGiantHp: 40,
    redGiantHp: 80,
    giantScale: 2.2,
    giantSpeed: 0.62,
    giantDamage: 30,
    /** How hard a spinner or pusher shoves a mob it hits (units a second, on top of moving it out). */
    shove: 9,
    /** A giant against a breakable: one hit off both every this long (seconds). */
    giantChipSeconds: 0.12,
    /** A PUSH block: how fast it slides per mob of lead pressing it (units a second), its top speed, and how many
     *  mobs a giant pushes like. */
    pushPerMob: 0.05,
    pushMaxSpeed: 1.4,
    pushGiantWeight: 6,
    /** The cannon's energy: shots it holds at energy level 1, and how many more each level adds. Each shot uses one;
     *  empty, the cannon locks until it has fully recharged. */
    energyCapacity: 40,
    energyPerLevel: 10,
    /** Seconds to recharge from empty at recharge level 1, how much faster each level is, and the shortest it gets. */
    rechargeSeconds: 2,
    rechargePerLevel: 0.25,
    rechargeMin: 1,
    /** After letting go (not empty), seconds before it starts topping up. */
    rechargeDelay: 0.35,
    /** A truck (from a truck garage): its hits, size (radius, x a mob's), speed (x a blue's), and what it takes off a
     *  building. It ploughs through like a giant, faster and tougher. */
    truckHp: 60,
    truckScale: 2.4,
    truckSpeed: 0.85,
    truckDamage: 45,
    /** A gold saucer (from the gold house): its speed (units a second), how far round it sucks up plain reds on its way,
     *  and what it takes off the enemy's main building when it crashes into it. */
    saucerSpeed: 3.2,
    saucerSuck: 1.7,
    saucerDamage: 90,
    /** A car (from a car garage): it can't be destroyed. Its size (radius, x a mob's), speed (x a blue's), the hits a
     *  second it takes off each red it's touching (so a plain red goes almost at once, a red giant holds it back a while,
     *  pushing it), and what it takes off a building when it gets there (then it's gone). */
    carScale: 2.1,
    carSpeed: 0.75,
    carDps: 3.5,
    carDamage: 35,
    /** A helmet barrier: each blue going through gets a helmet, its hits times this (giants too), once. */
    helmetHp: 2,
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

/**
 * Something on the field that blocks the way: a polygon (`points`: its [x, z] corners in order round it — any outline,
 * built into a mesh as the level loads), a box (`width` across, `depth` along, centred on x, z) or a circle
 * (`radius`).
 * - `wall`: a raised grass block (lanes are long thin ones); mobs steer round it, sliding along its edges.
 * - `water`: a hole in the field (the sea shows through); the same for mobs. Boxes and circles only.
 * - `breakable`: a brick block mobs walk straight into: each one touching it is spent and takes one off its `hp` (a
 *   giant chips at it over time); at zero it shatters and the way is open — for both sides.
 */
export interface ObstacleConfig {
    kind: 'wall' | 'water' | 'breakable';
    x?: number;
    z?: number;
    width?: number;
    depth?: number;
    radius?: number;
    points?: [number, number][];
    /** A breakable's hits. */
    hp?: number;
}

/** A rotating cross (the references' big spinner): it shoves mobs aside, it doesn't kill. `speed`: turns a second. */
export interface SpinnerConfig {
    x: number;
    z: number;
    /** From the centre to an arm's tip. */
    length: number;
    arms: number;
    speed: number;
}

/** A bar sliding across the field, sweeping mobs along: `width` x `depth`, swinging `range` either way of x. */
export interface PusherConfig {
    x: number;
    z: number;
    width: number;
    depth: number;
    range: number;
    seconds: number;
    /** Where in its swing it starts (0..1), so two pushers can move out of step. */
    phase?: number;
}

/**
 * A PUSH block: a heavy block filling a lane (`width` across, `depth` along), starting centred on x, z. Blues pressing
 * its near face push it up the field (-Z), reds pressing its far face push it back; the side with more mobs on it wins,
 * faster the bigger the lead. It slides between `far` and `near` (its centre's z); shoved out at either end it drops
 * away and the lane is open — for the blues at `far`, for the reds at `near`.
 */
export interface PushBlockConfig {
    x: number;
    z: number;
    width: number;
    depth: number;
    far: number;
    near: number;
}

/**
 * A house: blue mobs walking into it are taken in; every `need` of them makes one of what it makes (`kind`), sent out
 * of its far side. Reds and giants go round it.
 * - `giant` (the default; the blue home): a blue giant.
 * - `truck` (the blue barracks): a truck, a fast tough giant.
 * - `car` (the car garage): a car, which can't be destroyed: it pushes into the reds, wearing them down (TUNING.car*).
 * - `saucer` (the gold house): a gold saucer, flying straight at the enemy's main building, sucking up plain reds on its
 *   way, crashing into it for TUNING.saucerDamage.
 */
export type HouseKind = 'giant' | 'truck' | 'saucer' | 'car';

/** A helmet barrier: a span across the field at a z (`width` wide, centred on x); blues going through get a helmet. */
export interface HelmetConfig {
    x: number;
    z: number;
    width: number;
}
export interface PadConfig {
    kind?: HouseKind;
    x: number;
    z: number;
    width: number;
    depth: number;
    /** Blues per one it makes; unset: the unit's (the Units tab's: needOf). */
    need?: number;
}

/**
 * An enemy target: a fort at `x` across (its front at `z`, default the usual base line), `width` wide, taking `hp`
 * one-hit impacts. Each sends red mobs while it stands; the battle's won when every one has fallen.
 */
export interface TargetConfig {
    x: number;
    hp: number;
    width?: number;
    z?: number;
}

export interface BattleConfig {
    name: string;
    /** What the level is about, for the debug panel's picker. */
    kind: string;
    gates: GateConfig[];
    obstacles?: ObstacleConfig[];
    spinners?: SpinnerConfig[];
    pushers?: PusherConfig[];
    pads?: PadConfig[];
    pushBlocks?: PushBlockConfig[];
    helmets?: HelmetConfig[];
    /** Red mobs a second at the start, and at the end of the ramp (seconds). */
    redRate: number;
    redRateEnd: number;
    redRamp: number;
    /** A red giant comes out of the base this often (seconds; 0 = never). */
    redGiantEvery?: number;
    /** One-hit blue impacts the base takes (a level with `targets` uses theirs instead). */
    baseHp: number;
    /** Several targets instead of the one base (all of them have to fall). */
    targets?: TargetConfig[];
    /** Coins for a win. */
    reward: number;
}

/** The cannon's upgrades (bought after a battle): fire rate (TUNING.fireRatePerLevel), energy capacity
 *  (TUNING.energyPerLevel) and recharge speed (TUNING.rechargePerLevel). Levels 1 to max; cost[level - 1] buys the next. */
export type UpgradeKind = 'fire' | 'capacity' | 'recharge';
export const UPGRADES: Record<UpgradeKind, { name: string; max: number; cost: number[] }> = {
    fire: { name: 'FIRE RATE', max: 5, cost: [50, 100, 175, 275] },
    capacity: { name: 'ENERGY', max: 5, cost: [60, 120, 200, 300] },
    recharge: { name: 'RECHARGE', max: 5, cost: [60, 120, 200, 300] },
};

/**
 * The upgrades — what each house makes (giant, truck, UFO, car) — as set in the editor's Units tab (ui/units.json):
 * colours (`color`: the giant's body; `tint`: over the giant's building or the vehicle's own texture, white = as it is;
 * `wall` / `roof`: the plain houses), `need`: blues to charge one (a level's house can set its own), `hp`: hits it
 * takes (the car's 0: nothing stops it), `damage`: the most it takes off the enemy's building (the UFO: what it does).
 */
export interface UnitSettings {
    /** How its house is drawn: `model` (its building, props/<…>.glb; the car has none: a house), `house` (the plain
     *  house made in the game), `pad` (a coloured rectangle on the floor, `pad`). */
    style?: 'model' | 'house' | 'pad';
    pad?: string;
    color?: string;
    tint: string;
    wall?: string;
    roof?: string;
    /** Blues per one it makes; unset: the unit's (the Units tab's: needOf). */
    need?: number;
    hp?: number;
    damage: number;
}
export const UNITS = unitsFile as Record<HouseKind, UnitSettings>;

const hex = (colour: string | undefined, fallback: number): number => (colour ? parseInt(colour.replace('#', ''), 16) : fallback);

/** The upgrades' colours, as numbers (from UNITS) — the debug panel's Colours folder changes these live. */
export const UNIT_COLORS = {
    giant: hex(UNITS.giant.color, 0x1366ff),
    giantHouse: hex(UNITS.giant.tint, 0xffffff),
    giantWall: hex(UNITS.giant.wall, 0xe8f1ff),
    giantRoof: hex(UNITS.giant.roof, 0x3d6dff),
    truck: hex(UNITS.truck.tint, 0xffffff),
    truckWall: hex(UNITS.truck.wall, 0xcfe0ff),
    truckRoof: hex(UNITS.truck.roof, 0x1f4fbf),
    ufo: hex(UNITS.saucer.tint, 0xffffff),
    ufoWall: hex(UNITS.saucer.wall, 0xffe27a),
    ufoRoof: hex(UNITS.saucer.roof, 0xffb31a),
    car: hex(UNITS.car.tint, 0xffffff),
    carWall: hex(UNITS.car.wall, 0xffe3d6),
    carRoof: hex(UNITS.car.roof, 0xff6a3d),
};

// The units' hits and damage, from the editor (TUNING keeps the names the battle reads).
TUNING.blueGiantHp = UNITS.giant.hp ?? TUNING.blueGiantHp;
TUNING.giantDamage = UNITS.giant.damage;
TUNING.truckHp = UNITS.truck.hp ?? TUNING.truckHp;
TUNING.truckDamage = UNITS.truck.damage;
TUNING.saucerDamage = UNITS.saucer.damage;
TUNING.carDamage = UNITS.car.damage;

/** How a unit's house is drawn (the Units tab's; the giant's building and the others' plain houses unless set). */
export const houseStyle = (kind: HouseKind): 'model' | 'house' | 'pad' => UNITS[kind].style ?? (kind === 'giant' ? 'model' : 'house');

/** A unit's floor-pad colour (the `pad` house style), as a number. */
export const padColor = (kind: HouseKind): number => hex(UNITS[kind].pad ?? UNITS[kind].roof, 0x3d6dff);

/** A car's hits: the Units tab's, or (0) nothing stops it. */
export const carHp = (): number => (UNITS.car.hp && UNITS.car.hp > 0 ? UNITS.car.hp : Infinity);

/** A house's blues to charge one: its own (the level's), else its unit's (the Units tab). */
export const needOf = (pad: { kind?: HouseKind; need?: number }): number => pad.need ?? UNITS[pad.kind ?? 'giant'].need;

/** Team colours: the mobs, the cannon and the gates. */
export const COLORS = {
    blue: 0x3b8cff,
    red: 0xff3d4f,
    gate: 0x4fb6ff,
    track: 0xe8a35c,
    grass: 0x6cc24a,
};
