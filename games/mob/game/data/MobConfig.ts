// MobConfig.ts
//
// Every number of a battle, in one place (refs/mob/mob_control_gameplay_and_web_mvp.pdf's starter values, then tuned).
// The arena is a 2D X/Z field: X across (-ARENA.halfWidth .. +), Z along it — the cannon at z = 0 at the near end,
// the enemy base far up the field at negative Z. "Forward" for the player's (blue) mobs is -Z; red mobs come down +Z.
//
// A battle is a BattleConfig: the shared TUNING plus a level (MobLevels.ts: its gates, walls, water, spinners, pushers,
// giant pads, enemy pressure). After the last level they repeat, a little harder each loop (battleConfig()).

import unitsFile from '../../ui/units.json';
import { SETTINGS } from './Settings';
/**
 * A level's field size (BattleConfig `width` x `length`): the default, the most there is room for, and the editor's
 * presets. It grows from the bottom centre: the cannon's end (z 0) and the middle (x 0) stay put, the sides move out
 * evenly and the base back, so a level's pieces keep their places.
 */
export const FIELD = {
    width: 10,
    length: 24,
    maxWidth: 20,
    maxLength: 60,
};

/** The field of the battle being played: set from its level by useField() before the battle and arena are built. */
export const ARENA = {
    /** Half the field's width (world units): 10 wide by default, as the brief. */
    halfWidth: FIELD.width / 2,
    /** Where the enemy base's front edge is (z): the field's length up from the cannon. */
    baseZ: -FIELD.length,
    /** The danger line: a red mob past it (z greater) loses the battle. Just in front of the cannon. */
    dangerZ: -0.6,
    /** How far the cannon slides either way (CANNON_MARGIN short of the side). */
    cannonRange: FIELD.width / 2 - 0.8,
};
const CANNON_MARGIN = 0.8;

/** A level's field size, its own or the default (clamped to what there's room for). */
export function fieldOf(config: BattleConfig): { width: number; length: number } {
    const clamp = (value: number | undefined, fallback: number, most: number) => Math.min(most, Math.max(4, value ?? fallback));
    return { width: clamp(config.width, FIELD.width, FIELD.maxWidth), length: clamp(config.length, FIELD.length, FIELD.maxLength) };
}

/** Sets ARENA to `config`'s field: call before building its Battle and Arena. */
export function useField(config: BattleConfig): void {
    const { width, length } = fieldOf(config);
    ARENA.halfWidth = width / 2;
    ARENA.baseZ = -length;
    ARENA.cannonRange = config.duel ? config.duel.cannonRange : width / 2 - CANNON_MARGIN;
}

/** The shared feel: speeds, sizes, the cannon. The debug panel's sliders change these live. */
export const TUNING = {
    /** Blue mobs a second at fire level 1, and how much each level adds (x level-1). */
    fireRate: 5,
    fireRatePerLevel: SETTINGS.upgrades.fire.perLevel,
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
    /** The Giant King's hits, as a share of a red giant's. */
    kingHp: 1.6,
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
    energyPerLevel: SETTINGS.upgrades.capacity.perLevel,
    /** Seconds to recharge from empty at recharge level 1, how much faster each level is, and the shortest it gets. */
    rechargeSeconds: 2,
    rechargePerLevel: SETTINGS.upgrades.recharge.perLevel,
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
    /** A viking hat (an attack barrier): the damage a mob does, times this (to reds, blocks and the base). */
    vikingDamage: 2,
    /** A pipe: how fast a mob goes through it (units a second, along the pipe). */
    pipeSpeed: 10,
    /** A grinder: the hits a second it takes off a giant or a truck on it (a plain mob goes at once), and how fast a
     *  standing one spins (turns a second). */
    grinderDps: 6,
    grinderSpin: 1.2,
};

/** A multiplier gate: a span across the field at a z; a mob crossing it becomes `value` mobs. */
export interface GateConfig {
    x: number;
    z: number;
    width: number;
    value: number;
    /** Slides side to side: how far either way (units) and how long a full swing takes (seconds). */
    swing?: { range: number; seconds: number };
    /** Locked: grey, barred and padlocked, it's a breakable with these hits across its span (both sides wear it down,
     *  as a brick block) and multiplies no one, nor swings; at zero it unlocks and works as a gate. Unset = open. */
    lock?: number;
    /** Whose it is (an arena's mirrored half: game/data/ArenaConfig): 'red' works for the reds coming down the field
     *  instead. Unset: the blues'. */
    team?: 'blue' | 'red';
}

/**
 * Something on the field that blocks the way: a polygon (`points`: its [x, z] corners in order round it — any outline,
 * built into a mesh as the level loads), a box (`width` across, `depth` along, centred on x, z) or a circle
 * (`radius`).
 * - `wall`: a raised grass block (lanes are long thin ones); mobs steer round it, sliding along its edges.
 * - `water`: a hole in the field (the sea shows through); the same for mobs. Boxes and circles only.
 * - `breakable`: a brick block mobs walk straight into: each one touching it is spent and takes one off its `hp` (a
 *   giant chips at it over time); at zero it shatters and the way is open — for both sides.
 * - `enemyWall`: invisible, and solid to the reds only (blues walk through it): where the enemy mustn't go. Reds steer
 *   round it as round a wall.
 */
export interface ObstacleConfig {
    kind: 'wall' | 'water' | 'breakable' | 'enemyWall';
    x?: number;
    z?: number;
    width?: number;
    depth?: number;
    radius?: number;
    points?: [number, number][];
    /** A breakable's hits. */
    hp?: number;
}

/**
 * A pipe (a tunnel): an end at (x, z) and one at (toX, toZ), joined by a pipe arching over the field. Each end opens
 * along the field: the one nearer the cannon towards it, the other towards the base. A plain mob walking into an
 * opening (blues into the near one, reds into the far one) goes through and comes out of the other, carrying on —
 * blues up the field, reds down it. Giants and the vehicles don't fit: the ends are solid to them.
 */
export interface PipeConfig {
    x: number;
    z: number;
    toX: number;
    toZ: number;
    /** Who can go through it: 'blue' (a blue pipe), 'red' (red), 'both' (purple; the default for a pipe with none set). The
     *  others steer round its ends. */
    team?: PipeTeam;
}
export type PipeTeam = 'blue' | 'red' | 'both';

/**
 * A pipe's shape (the battle's and the arena's): its opening's radius (the pipe's), how wide the way in is (`mouth`: a
 * mob walking into the opening this close to its middle goes in — a little wider than the pipe, so a crowd doesn't jam
 * it; nothing is drawn towards it), and how a mob that can't go in steers round an end (from `steer` before it, this
 * fast sideways), how far back from the opening the end's elbow goes (solid), and its hill over
 * the field: as high as `rise` of the distance between the ends, kept between `height` and `most`.
 */
export const PIPE = { radius: 0.75, body: 1.6, height: 3.6, rise: 0.35, most: 6, mouth: 1.1, steer: 2.2, steerSpeed: 3.5 };

/** A pipe's two ends: where each opening is and which way it opens (+1 towards the cannon, -1 towards the base). */
export function pipeEnds(pipe: PipeConfig): [{ x: number; z: number; facing: number }, { x: number; z: number; facing: number }] {
    const nearFirst = pipe.z >= pipe.toZ;
    return [{ x: pipe.x, z: pipe.z, facing: nearFirst ? 1 : -1 }, { x: pipe.toX, z: pipe.toZ, facing: nearFirst ? -1 : 1 }];
}

/**
 * The pipe's centre line, `samples` + 1 points [x, y, z] from the first end's opening to the other's, like a roller
 * coaster's hill: seen from above, a smooth curve leaving each opening straight back along the field (a cubic Bézier,
 * its handles a third of the way along); its height a smooth bump (flat at the openings, the pipe's radius up, its
 * top in the middle).
 */
export function pipePath(pipe: PipeConfig, samples = 96): [number, number, number][] {
    const [a, b] = pipeEnds(pipe);
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const handle = Math.max(PIPE.body, span / 3);
    const top = Math.min(PIPE.most, Math.max(PIPE.height, span * PIPE.rise));
    // Bézier: from a, back out of its opening; into b, arriving through its back (the way a mob leaves it).
    const p0 = [a.x, a.z];
    const p1 = [a.x, a.z - a.facing * handle];
    const p2 = [b.x, b.z - b.facing * handle];
    const p3 = [b.x, b.z];
    const points: [number, number, number][] = [];
    for (let k = 0; k <= samples; k++) {
        const t = k / samples;
        const u = 1 - t;
        const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
        const x = w0 * p0[0] + w1 * p1[0] + w2 * p2[0] + w3 * p3[0];
        const z = w0 * p0[1] + w1 * p1[1] + w2 * p2[1] + w3 * p3[1];
        // A raised cosine: level at both ends, rounded over the top.
        const y = PIPE.radius + (top - PIPE.radius) * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
        points.push([x, y, z]);
    }
    return points;
}

/** How far a mob goes through a pipe: along its centre line, from one opening to the other. */
export function pipeLength(pipe: PipeConfig): number {
    const points = pipePath(pipe);
    let length = 0;
    for (let k = 1; k < points.length; k++) {
        const [ax, ay, az] = points[k - 1];
        const [bx, by, bz] = points[k];
        length += Math.hypot(bx - ax, by - ay, bz - az);
    }
    return length;
}

/**
 * A grinder: a spiked roller lying on the field, `length` long and `thickness` across, centred on (x, z): `axis` 'x'
 * lies across the field (horizontal), 'z' along it (vertical). Anything touching it is ground up — a plain mob of
 * either side at once, a giant or a truck TUNING.grinderDps hits a second; the car rolls over it. It stands spinning,
 * or with `move` rolls back and forth (`range` either way, a full trip in `seconds`): a horizontal one up and down the
 * field, a vertical one across it.
 */
export interface GrinderConfig {
    x: number;
    z: number;
    length: number;
    thickness: number;
    axis: 'x' | 'z';
    move?: { range: number; seconds: number };
}

/** A rotating cross (the references' big spinner): it shoves mobs aside, it doesn't kill. `speed`: turns a second. */
export interface SpinnerConfig {
    x: number;
    z: number;
    /** From the centre to an arm's tip. */
    length: number;
    arms: number;
    speed: number;
    /** Where in its turn it starts (turns: 0..1; an arena's mirrored copy turns the other way from half a turn). */
    phase?: number;
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
    /** What it gives (once each; they stack): `hp` — the helmet, hits x TUNING.helmetHp (the default); `attack` — the
     *  viking hat, the damage it does x TUNING.vikingDamage. */
    kind?: 'hp' | 'attack';
    /** Whose it is (an arena's mirrored half: game/data/ArenaConfig): 'red' works for the reds coming down the field
     *  instead. Unset: the blues'. */
    team?: 'blue' | 'red';
}
export interface PadConfig {
    kind?: HouseKind;
    x: number;
    z: number;
    width: number;
    depth: number;
    /** Blues per one it makes; unset: the unit's (the Units tab's: needOf). */
    need?: number;
    /** Whose it is (an arena's mirrored half: game/data/ArenaConfig): 'red' works for the reds: they walk in and its units come out
     *  of its near side, down the field. Unset: the blues'. */
    team?: 'blue' | 'red';
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
    /** An arena's cannon (its life): no building, its number over the cannon. Unset: a fort. */
    kind?: 'cannon';
}

/** An arena match's rules (BattleConfig.duel: game/data/ArenaConfig builds them). The enemy's cannon is at the far end
 *  of the field, firing reds down it, and it plays cards too; each side has its cannon's life and its towers. */
export interface DuelRules {
    /** The match's length: when it's up, the side with more life left wins. */
    seconds: number;
    /** How far either cannon slides from the middle, and the blues' cannon's row (z: up the field from a level's 0; the
     *  reds' is its mirror). */
    cannonRange: number;
    cannonZ: number;
    /** The comeback: the side behind by `behind` (a share of its life at the start) can boost its cannon's fire rate
     *  `rate` times for `seconds`, then waits `cooldown` seconds before it can again. */
    boost: { rate: number; seconds: number; cooldown: number; behind: number };
}

export interface BattleConfig {
    name: string;
    /** The field's size (FIELD: 10 x 24 when unset; it grows from the bottom centre). */
    width?: number;
    length?: number;
    /** What the level is about, for the debug panel's picker. */
    kind: string;
    gates: GateConfig[];
    obstacles?: ObstacleConfig[];
    spinners?: SpinnerConfig[];
    pushers?: PusherConfig[];
    pads?: PadConfig[];
    pushBlocks?: PushBlockConfig[];
    helmets?: HelmetConfig[];
    pipes?: PipeConfig[];
    grinders?: GrinderConfig[];
    /** Red mobs a second at the start, and at the end of the ramp (seconds). */
    redRate: number;
    redRateEnd: number;
    redRamp: number;
    /** A red giant comes out of the base this often (seconds; 0 = never). */
    redGiantEvery?: number;
    /** A boss level: once the enemy's HP left (all its targets') is down to this, it sends out the Giant King, once: a red
     *  giant in viking horns (a viking: double damage) with TUNING.kingHp times a red giant's hits. Unset: none. */
    kingAt?: number;
    /** One-hit blue impacts the base takes (a level with `targets` uses theirs instead). */
    baseHp: number;
    /** Several targets instead of the one base (all of them have to fall). */
    targets?: TargetConfig[];
    /** Coins for a win. */
    reward: number;
    /** An arena match (both sides play): its rules. The blues' own buildings are `blueTargets` (the reds' aim). */
    duel?: DuelRules;
    blueTargets?: TargetConfig[];
}

/** Each loss in a row on a level makes its next try this much easier, up to `most` (back to none on the next level):
 *  ui/settings.json `retry`. */
export const RETRY_EASE = { step: SETTINGS.retry.step, most: SETTINGS.retry.most };

/**
 * `config` made `ease` (0..1) easier: fewer reds a second, red giants less often, and a base / forts with fewer hits.
 * Its layout and reward are the same.
 */
export function easedConfig(config: BattleConfig, ease: number): BattleConfig {
    if (ease <= 0) return config;
    const keep = 1 - ease;
    return {
        ...config,
        redRate: config.redRate * keep,
        redRateEnd: config.redRateEnd * keep,
        redGiantEvery: config.redGiantEvery ? config.redGiantEvery / keep : config.redGiantEvery,
        baseHp: Math.max(1, Math.ceil(config.baseHp * keep)),
        targets: config.targets?.map((target) => ({ ...target, hp: Math.max(1, Math.ceil(target.hp * keep)) })),
    };
}

/** The cannon's upgrades (bought after a battle): fire rate (TUNING.fireRatePerLevel), energy capacity
 *  (TUNING.energyPerLevel) and recharge speed (TUNING.rechargePerLevel). Levels 1 to max; cost[level - 1] buys the next. */
export type UpgradeKind = 'fire' | 'capacity' | 'recharge';
/** Their names, levels and prices: ui/settings.json `upgrades` (what a level adds goes to TUNING, above). A level with no
 *  price set costs as much more than the last as that one did over the one before. */
const upgradeOf = (kind: UpgradeKind): { name: string; max: number; cost: number[] } => {
    const setting = SETTINGS.upgrades[kind];
    const max = Math.max(1, Math.floor(setting.max));
    const cost = setting.cost.slice(0, max - 1);
    while (cost.length < max - 1) {
        const last = cost[cost.length - 1] ?? 50;
        const before = cost[cost.length - 2] ?? last / 2;
        cost.push(Math.round(last + Math.max(1, last - before)));
    }
    return { name: setting.name, max, cost };
};
export const UPGRADES: Record<UpgradeKind, { name: string; max: number; cost: number[] }> = {
    fire: upgradeOf('fire'),
    capacity: upgradeOf('capacity'),
    recharge: upgradeOf('recharge'),
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
    /** Its body against the world (walls, holes, blocks, houses, the field's sides) as a share of its size (0.3 .. 1;
     *  unset: BODY_SHARE): smaller, so it doesn't wedge in gaps; it still fights and feeds houses at its full size. */
    body?: number;
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

/** A big unit's body against the world, as a share of its size, when units.json doesn't set one. */
export const BODY_SHARE = 0.65;
/** A unit's body share (UnitSettings.body, kept to 0.3 .. 1). */
export const bodyShare = (kind: HouseKind): number => Math.max(0.3, Math.min(1, UNITS[kind]?.body ?? BODY_SHARE));

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
