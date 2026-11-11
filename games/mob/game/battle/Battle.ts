// Battle.ts
//
// One battle's rules, with no drawing (refs/mob's MVP, section 9): a 2D simulation on the X/Z plane, mobs in typed
// arrays (no rigid bodies, nothing allocated per frame), stepped at a fixed rate.
//
// - The cannon slides to where the player aims (`aimX`) and, while the player holds (`firing`), fires blue mobs
//   forward (-Z) at its fire rate. Each shot uses one energy; empty, it locks until it has fully recharged; let go
//   early, it tops up after a moment (TUNING.energy*, recharge*; the upgrades raise capacity and recharge speed).
// - The enemy's targets — one base, or several forts (BattleConfig.targets) — far up the field send red mobs down (+Z)
//   in waves, faster as the battle goes on, each until it falls;
//   each heads for its own lane across the field, so they come down the sides too, not only where the blues are. Some
//   levels also send red giants.
// - Mobs keep apart with a cheap push from neighbours (a uniform spatial grid); a red runs at a blue near it.
// - Walls and water holes (the level's obstacles: any polygon, boxes, circles — Shapes.ts) block everyone: a mob looks
//   a little ahead and, if it's about to run into one, slides along the nearest edge; anything still overlapping one is
//   pushed out. Breakable blocks are walked straight into: each mob touching one is spent and takes a hit off it (a
//   giant chips at it on a timer), and at zero it's gone. Spinners and pushers shove mobs with the bar's own speed —
//   they scatter, they don't kill.
// - A blue and a red that touch both go (the brief's "remove one blue and one red"); a giant crushes what it touches,
//   losing one of its hits for each.
// - A blue crossing an attack barrier gets a viking hat (once): the damage it does — to reds, blocks and the base —
//   times TUNING.vikingDamage, its hits as they were. The two stack; copies a gate makes keep both.
// - A blue crossing a helmet barrier gets a helmet (once): its hits times TUNING.helmetHp; copies a gate makes of it
//   wear one too.
// - A car can't be destroyed: it wears down the reds it touches (TUNING.carDps), pushed back by the crowd meanwhile.
// - A pipe: a plain mob walking into an opening (blues the near one, reds the far one) is
//   gone from the field for as long as the pipe takes it (TUNING.pipeSpeed), then comes out of the other, as it went
//   in (hits, helmet, hat, gates crossed). Its ends' elbows are solid: anything else is pushed out of them.
// - A grinder (a spiked roller) grinds up what touches it: a plain mob of either side at once, a giant or a truck
//   TUNING.grinderDps hits a second; the car rolls over. A moving one rolls back and forth.
// - A locked gate (`lock` hits) is a breakable across its span till it's worn down (a Block with its `gate`): then it
//   unlocks and works as any gate.
// - A blue crossing a gate's line inside its span becomes `value` mobs, spread round it; each mob remembers the gates it
//   has crossed (a bit each), and so do its copies, so a gate never multiplies the same crowd twice. Giants don't use
//   gates.
// - A house takes in the plain blues that walk into it; every `need` of them makes what it makes (a giant, a truck, or
//   a gold saucer), out of its far side. Reds and giants go round it. A saucer isn't a mob: it flies over everything
//   to the enemy's main building, sucking up the plain reds it passes over, and crashes into it.
// - A PUSH block fills a lane: blues pressing its near face push it up the field, reds pressing its far face push it
//   back, the side with more mobs on it winning (TUNING.push*). Shoved out at either end, it drops away.
// - A boss level (`kingAt`): once the enemy's HP left is down to that, it sends out the Giant King, once a match: a red
//   giant in viking horns (double damage, TUNING.kingHp times the hits).
// - A blue reaching a target takes one HP off it (a giant, TUNING.giantDamage); blues head for the nearest one still
//   standing. Every target down: won. A red past the danger line: lost.
//
// An arena match (config.duel: game/data/ArenaConfig builds one) is both sides playing: the reds come out of a second
// cannon at the far end (`red`, aimed and fired as the blues' is, by a robot), play cards (spawnUnit's `team`), and have
// their own gates, houses and barriers (a piece's `team`); they march down as the blues march up (no lanes, no chasing)
// and hit the blues' buildings (`blueTargets`). A side whose cannon falls, or all of whose buildings do, loses; when the
// time's up (duel.seconds), the side with more life left wins.
//
// Events (shots, hits, gate crossings, giants, the end) go to `events`, for the view's effects and the HUD.

import { GrinderConfig, PIPE, PipeConfig, pipeEnds, pipeLength } from '../data/MobConfig';
import { CardKind, SETTINGS } from '../data/Settings';
import { ARENA, BattleConfig, DuelRules, FIELD, GateConfig, HelmetConfig, ObstacleConfig, PadConfig, PushBlockConfig, PusherConfig, SpinnerConfig, TUNING, UNITS, bodyShare, carHp, needOf } from '../data/MobConfig';
import { Contact, Shape, boxShape, circleShape, polygonShape, shapeCentre, touch } from './Shapes';

export const BLUE = 0;
export const RED = 1;

/** Room in the arrays (the population is capped lower, by TUNING.maxMobs). */
const CAPACITY = 1200;
/** The spatial grid: cell size (units) and the area it covers (a little past the biggest field there can be). */
const CELL = 0.7;
const GRID_MIN_X = -FIELD.maxWidth / 2 - 1;
const GRID_MIN_Z = -FIELD.maxLength - 3;
const GRID_COLS = Math.ceil((FIELD.maxWidth + 2) / CELL);
const GRID_ROWS = Math.ceil((-GRID_MIN_Z + 2) / CELL);
/** Where blue mobs leave the cannon, and how wide the muzzle spreads them. */
const MUZZLE_Z = -1.1;
const MUZZLE_SPREAD = 0.35;
/** The usual base (a level with no `targets`): its half width. Reds come out of a target's front, this far out. */
export const BASE_HALF_WIDTH = 2.2;
const RED_SPAWN_OUT = 1.4;
/** Blues this close to the base (z: HOMING_FROM past its line) steer towards it, this hard. */
const HOMING_FROM = 10;
const HOMING_PULL = 0.45;
/** Reds fan out to lanes this far in from either side, drifting there this hard (share of the gap a unit). */
const RED_LANE_MARGIN = 0.8;
const redLaneSpread = (): number => ARENA.halfWidth - RED_LANE_MARGIN;
const RED_LANE_PULL = 0.35;
/** How a gate spreads the copies it makes (units across, and back). */
const GATE_SPREAD = 0.34;
const GATE_DEPTH = 0.45;
/** How fast the cannon follows the aim (per second, of the distance). */
const CANNON_FOLLOW = 18;
/** An arena match: how far past its cannon's line a mob still hits it (the cannon's open, the last tower): the ones
 *  further on when it opened went by it, and don't (else every one between it and the towers hit it at once). */
const CANNON_DEPTH = 1;
/** How far (z) a unit a house makes may come out past its far side, at random (with a random x along it). */
const SPAWN_JITTER = 0.8;
/** A special unit out of a cannon comes with a shockwave from the cannon's centre: the foes within `radius` of it — a plain one's gone, a big
 *  one loses `bigDamage` hits. */
export const SHOCKWAVE = { radius: 4, bigDamage: 3 };
/** The field clearing out after a battle: how long before the first mob goes (seconds), the spread over which they
 *  all go, and how long each one takes to shrink away. */
const CLEAR_OUT = { start: 0.5, spread: 1.6, seconds: 0.25 };
/** How far ahead a mob looks for a wall or hole (units), and how hard it turns away. */
const LOOK_AHEAD = 1.5;
/** Where it looks, nearest first: a thin part of a wall (a point) would be missed looking only far ahead, past it. */
const LOOK_STEPS = [0.2, 0.6, 1];
/**
 * Going round something head-on (both ways along about as good), a mob keeps the way it chose (for this long after it
 * last touched): choosing afresh each step, it'd turn back and forth there. If it's barely moving for STUCK_SECONDS while
 * going round (under STUCK_SPEED of its speed: pressed into a corner), it tries the other way.
 */
const SLIDE_MEMORY = 0.8;
const STUCK_SECONDS = 0.6;
const STUCK_SPEED = 0.25;
const AVOID_TURN = 1.4;
/** Below this (the cosine between the way it wants to go and an edge), a mob meets a block head-on. */
const HEAD_ON = 0.35;
/** How far to the side a red steering round something moves its lane. */
const LANE_SHIFT = 2;
/** Every gate bit set: a giant never uses a gate. */
const ALL_GATES = 0xff;
/** A locked gate's breakable: this deep (along z), across the gate's span. */
const LOCK_DEPTH = 0.6;

export interface BattleEvents {
    fire?(x: number): void;
    gate?(gate: number, x: number, z: number, made: number): void;
    clash?(x: number, z: number, big: boolean): void;
    /** `special`: a giant, truck, rammer or saucer hit it (not a plain mob, helmet or no). */
    baseHit?(x: number, z: number, hpLeft: number, damage: number, target: number, special: boolean): void;
    /** A target fell (the battle's won once they all have). */
    targetDown?(target: number): void;
    pad?(pad: number, count: number): void;
    /** A boss level's Giant King came out at (x, z). */
    king?(x: number, z: number): void;
    /** A PUSH block was pushed out at its far stop: the lane is open. */
    pushCleared?(block: number): void;
    blockHit?(block: number, hpLeft: number, x: number, z: number): void;
    blockBroken?(block: number): void;
    /** A mob was ground up by a grinder at (x, z) (`big`: a giant or a truck worn out on it). */
    ground?(x: number, z: number, team: number, big: boolean): void;
    /** A mob went into pipe `pipe` at end `end` (0: x, z; 1: toX, toZ), and one came out of it at `end`. */
    pipeIn?(pipe: number, end: number, team: number): void;
    pipeOut?(pipe: number, end: number, team: number): void;
    /** A locked gate was worn down (its block `block` broke): it works now. */
    gateUnlocked?(gate: number, block: number): void;
    /** A bomb went off at (x, z), `team`'s, `radius` wide. */
    explode?(team: number, x: number, z: number, radius: number): void;
    /** A special unit came out at (x, z): `kind` its big kind (-1: the saucer); `card`: a character card's batch. */
    giant?(team: number, x: number, z: number, kind: number, card?: CardKind): void;
    /** A special unit's landing shockwave at (x, z), `team`'s, `radius` wide; `x`, `z` of each foe it knocked out. */
    shockwave?(team: number, x: number, z: number, radius: number): void;
    knocked?(x: number, z: number, team: number): void;
    /** A gold saucer sucked up a red at (x, z), and one crashed into target `target`. */
    suck?(x: number, z: number): void;
    /** A blue got a helmet at (x, z). */
    helmet?(x: number, z: number, kind: 'hp' | 'attack'): void;
    saucerHit?(target: number, x: number, z: number): void;
    /** A mob vanished as the field cleared out after the battle. */
    vanish?(x: number, z: number, team: number): void;
    won?(): void;
    /** The cannon ran out of energy (it locks until full). */
    empty?(): void;
    lost?(): void;
    /** An arena match: the reds' cannon fired (at x); one of the blues' buildings was hit, or fell; the time ran out
     *  with both sides' life the same. */
    redFire?(x: number): void;
    ownHit?(x: number, z: number, hpLeft: number, damage: number, target: number, special: boolean): void;
    ownDown?(target: number): void;
    draw?(): void;
    /** An arena match: a side's towers have all fallen, its cannon's open to hits (`team`: whose). */
    exposed?(team: number): void;
}

/** A cannon: where it's aimed and is, whether it's held, its energy, its upgrades (the blues' is the Battle itself, the
 *  reds' in an arena match `Battle.red`). */
export interface Cannon {
    aimX: number;
    cannonX: number;
    firing: boolean;
    /** Shots left (-1: not started, full), and whether it's locked until full (it ran dry). */
    energy: number;
    overheated: boolean;
    capped: boolean;
    /** Seconds since it last fired, and the shots due (a share of one). */
    idle: number;
    fireDue: number;
    fireLevel: number;
    capacityLevel: number;
    rechargeLevel: number;
    /** An arena match: its towers are all down, it's on its cannon, which fires faster (the comeback). */
    boosted?: boolean;
}

export interface Gate extends GateConfig {
    /** Where it is now (it may swing). */
    nowX: number;
    /** Still locked (its block stands): it multiplies no one and doesn't swing. */
    locked: boolean;
    /** When its swing started (a locked one's: when it unlocked, so it sets off from where it stood). */
    swingFrom: number;
}

export interface Pusher extends PusherConfig {
    nowX: number;
    /** Its speed across (units a second): what it shoves with. */
    speedX: number;
}

export interface Pad extends PadConfig {
    /** Blues taken in towards the next giant. */
    count: number;
    /** The house's footprint (reds and giants steer round it). */
    shape: Shape;
    /** Which of its sides are wide enough to get past, by mob radius (openSides()). */
    open: Map<number, { left: boolean; right: boolean }>;
}

export interface PushBlock extends PushBlockConfig {
    /** Where its centre is now (z), and how fast it's sliding (units a second, + = towards the cannon). */
    nowZ: number;
    speed: number;
    /** Weight pressing it this step: blues on its near face, reds on its far face. */
    blues: number;
    reds: number;
    /** False once it's been pushed out at its far stop. */
    alive: boolean;
}

/** What a mob is (Battle.big): a plain one, a giant, a truck. */
export const PLAIN = 0;
export const GIANT = 1;
export const TRUCK = 2;
export const CAR = 3;

/** A gold saucer in flight: where it is, the target it's after, and whether it's still flying. */
export interface Saucer {
    x: number;
    z: number;
    target: number;
    alive: boolean;
    /** Seconds since it took off (the view lifts it up). */
    age: number;
    /** Reds it has sucked up. */
    sucked: number;
    /** What it takes off its target when it gets there (a card's level's; unset: TUNING.saucerDamage). */
    damage?: number;
    /** Whose it is (an arena match's reds have them too): unset, the blues'. */
    team?: number;
}

/** A unit's own stats (a card's, at its level): its hits and the most it takes off a building. */
export interface UnitStats { hp?: number; damage?: number }

/**
 * A unit's look (which model draws it: `look`), apart from how it behaves (`big`): the crowd's mob (0), or a card's
 * character (CharacterView): the skeleton minions (plain units, a batch of them, more hits) and warriors (giants:
 * bigger, quicker, their own hits).
 */
export const LOOK = { mob: 0, minion: 1, warrior: 2, golem: 3, bomb: 4, bat: 5, turtle: 6 } as const;

/**
 * The turtle (the spiked shell): it can't be destroyed, its hit (its card's damage) knocks out what it touches, it never
 * hurts a building (one it reaches, it crumbles away at), and it's very slow, walking `walk` seconds then stopping
 * `stop` (each its own beat).
 */
export const TURTLE = { walk: 2.2, stop: 1.3 };
/** Whether a turtle at its point `phase` (0..1) in its walk-stop cycle is walking at battle time `time`. */
export function turtleWalking(time: number, phase: number): boolean {
    const cycle = TURTLE.walk + TURTLE.stop;
    return (time + phase * cycle) % cycle < TURTLE.walk;
}
/** The crowd's giants in another colour (TINT: the armoured one green, the viking orange), the player's side only. */
export const TINT = { none: 0, green: 1, orange: 2 } as const;
/** The character cards: the look each makes, how it behaves (big), how much quicker than its kind it goes, and how far
 *  apart a batch lands round the cannon's front. */
export const CHARACTER_CARDS: Partial<Record<CardKind, { look: number; big: number; speed: number; spread: number; fly?: boolean; helmet?: boolean; viking?: boolean; tint?: number }>> = {
    skeletons: { look: LOOK.minion, big: 0, speed: 1, spread: 1.3 },
    warriors: { look: LOOK.warrior, big: 1, speed: 1.7, spread: 1.4 },
    golem: { look: LOOK.golem, big: 1, speed: 0.7, spread: 0 },
    bomb: { look: LOOK.bomb, big: 1, speed: 1.2, spread: 0 },
    // Flying: over the ground units, the walls, blocks, houses, spinners, grinders and pipes (FLY).
    bats: { look: LOOK.bat, big: 0, speed: 2.1, spread: 1.2, fly: true },
    turtle: { look: LOOK.turtle, big: 1, speed: 0.45, spread: 0 },
    // The crowd's giant in its helmet (armoured: slow, sturdy) or its viking hat (its hits harder).
    'giant-green': { look: LOOK.mob, big: 1, speed: 0.75, spread: 0, helmet: true, tint: TINT.green },
    'giant-viking': { look: LOOK.mob, big: 1, speed: 1.05, spread: 0, viking: true, tint: TINT.orange },
};

/** The bomb (the stone monster): when it falls (or hits a building), it goes off — every foe within `radius` takes its
 *  card's damage (a plain one's gone; a big one loses that many hits, times `bigShare`), and each enemy building in reach
 *  takes it times `buildingShare`. */
export const BOMB = { radius: 3.2, bigShare: 0.5, buildingShare: 0.6 };

/** An enemy target as the battle has it: where its front is, its half width, its hits. */
export interface Target {
    x: number;
    z: number;
    halfWidth: number;
    hp: number;
    hpMax: number;
    alive: boolean;
    /** An arena's cannon (its life), not a fort. */
    kind?: 'cannon';
    /** An arena's cannon while its towers stand: nothing can hit it (it isn't aimed at either). */
    shielded?: boolean;
}

/** A grinder as the battle has it: where its middle is now, and how fast it's moving (units a second, along its move). */
export interface Grinder extends GrinderConfig {
    nowX: number;
    nowZ: number;
    speed: number;
}

/** A pipe as the battle has it: its ends (where each opening is, which way it opens) and how long going through takes. */
export interface Pipe extends PipeConfig {
    ends: ReturnType<typeof pipeEnds>;
    seconds: number;
}

/** A mob in a pipe: when it comes out, of which pipe and end, and what it was. */
interface InPipe { due: number; pipe: number; end: number; team: number; hp: number; helmet: number; viking: number; crossed: number }

/** An obstacle as the battle has it: its shape, and for a breakable, its hits left (gone at 0). */
export interface Block {
    config: ObstacleConfig;
    shape: Shape;
    breakable: boolean;
    /** An enemy wall: solid to reds only (ObstacleConfig `enemyWall`). */
    redOnly?: boolean;
    hp: number;
    hpMax: number;
    alive: boolean;
    /** Where its middle is (its label, its pieces flying). */
    centreX: number;
    centreZ: number;
    /** A locked gate's block: that gate's index (it unlocks when this breaks). */
    gate?: number;
}

/** An obstacle config's shape: its polygon, circle or box. */
export function obstacleShape(o: ObstacleConfig): Shape {
    if (o.points && o.points.length >= 3) return polygonShape(o.points);
    if (o.radius !== undefined) return circleShape(o.x ?? 0, o.z ?? 0, o.radius);
    return boxShape(o.x ?? 0, o.z ?? 0, o.width ?? 1, o.depth ?? 1);
}

export class Battle {
    public readonly x = new Float32Array(CAPACITY);
    public readonly z = new Float32Array(CAPACITY);
    /** Facing (radians round Y, 0 = towards -Z), for the view. */
    public readonly heading = new Float32Array(CAPACITY);
    public readonly team = new Uint8Array(CAPACITY);
    /** 1 for a giant. */
    public readonly big = new Uint8Array(CAPACITY);
    /** Which model draws each (LOOK), and how much quicker than its kind it goes. */
    public readonly look = new Uint8Array(CAPACITY);
    private readonly speedMul = new Float32Array(CAPACITY);
    /** Flying (the bats): over the ground and what's on it (FLY); a giant's colour of its own (TINT). */
    public readonly fly = new Uint8Array(CAPACITY);
    public readonly tint = new Uint8Array(CAPACITY);
    /** Hits left (1 for a plain mob). */
    public readonly hp = new Float32Array(CAPACITY);
    /** Seconds since it appeared (the view pops new ones in), and its own step in the run cycle. */
    public readonly age = new Float32Array(CAPACITY);
    public readonly phase = new Float32Array(CAPACITY);
    /** 1 for a mob wearing a helmet (from a helmet barrier). */
    public readonly helmet = new Uint8Array(CAPACITY);
    /** 1 for a mob wearing a viking hat (from an attack barrier): it does TUNING.vikingDamage times the damage. */
    public readonly viking = new Uint8Array(CAPACITY);
    /** Once the battle's over, how far each mob is through vanishing (0..1; the view shrinks it). */
    public readonly leaving = new Float32Array(CAPACITY);
    private readonly gatesCrossed = new Uint8Array(CAPACITY);
    private readonly dead = new Uint8Array(CAPACITY);
    private readonly prevZ = new Float32Array(CAPACITY);
    private readonly vx = new Float32Array(CAPACITY);
    private readonly vz = new Float32Array(CAPACITY);
    /** Going round something: the way it chose (unit), for how much longer it keeps it, and how long it's been stuck. */
    private readonly slideX = new Float32Array(CAPACITY);
    private readonly slideZ = new Float32Array(CAPACITY);
    private readonly slideFor = new Float32Array(CAPACITY);
    private readonly stuckFor = new Float32Array(CAPACITY);
    /** Where it was a step ago, after everything pushed it (how far it really got). */
    private readonly lastX = new Float32Array(CAPACITY);
    private readonly lastZ = new Float32Array(CAPACITY);
    /** A red's lane: the x it drifts towards on its way down. */
    private readonly lane = new Float32Array(CAPACITY);
    /** A giant's time to its next chip at a breakable. */
    private readonly chip = new Float32Array(CAPACITY);
    /** The most a big one takes off a building (a card's unit's own; 0: its kind's, TUNING). */
    private readonly unitDamage = new Float32Array(CAPACITY);
    private readonly contactOut: Contact = { x: 0, z: 0, nx: 0, nz: 0, tx: 0, tz: 0 };
    /** Mobs alive: indices 0 .. count-1. */
    public count = 0;

    private readonly cellHead = new Int32Array(GRID_COLS * GRID_ROWS);
    private readonly cellNext = new Int32Array(CAPACITY);
    /** Whether each mob turns to face the way it's going (`heading`): only the views read it, so the level grader's
     *  robots (game/sim/Grading) turn it off. */
    public faces = true;
    /** fight()'s grid of the reds alone. */
    private readonly redHead = new Int32Array(GRID_COLS * GRID_ROWS);
    private readonly redNext = new Int32Array(CAPACITY);

    public readonly gates: Gate[];
    public readonly blocks: Block[];
    public readonly pipes: Pipe[];
    public readonly grinders: Grinder[];
    /** The mobs in the pipes now. */
    private inPipes: InPipe[] = [];
    /** This step's length (for what's worked out per mob in usePipes). */
    private stepDt = 0;
    public readonly spinners: readonly SpinnerConfig[];
    public readonly pushers: Pusher[];
    public readonly pads: Pad[];
    public readonly pushBlocks: PushBlock[];
    public readonly saucers: Saucer[] = [];
    public readonly helmets: readonly HelmetConfig[];
    public readonly targets: Target[];
    /** An arena match's rules (else undefined); the blues' own buildings (the reds' aim; none outside a match); the
     *  reds' cannon (only fired in a match). */
    public readonly duel: DuelRules | undefined;
    public readonly blueTargets: Target[];
    public readonly red: Cannon = { aimX: 0, cannonX: 0, firing: true, energy: -1, overheated: false, capped: false, idle: 0, fireDue: 0, fireLevel: 1, capacityLevel: 1, rechargeLevel: 1 };
    /** Where the player aims (x), and where the cannon is. */
    public aimX = 0;
    public cannonX = 0;
    public time = 0;
    /** 'playing' until the base falls ('won') or a red breaks through ('lost'); an arena match can end in a 'draw'. */
    public state: 'playing' | 'won' | 'lost' | 'draw' = 'playing';
    /** The most mobs alive at once, this battle. */
    public peak = 0;
    /** The cannon's fire-rate level (MobSave). */
    public fireLevel = 1;
    /** The energy upgrades' levels (MobSave). */
    public capacityLevel = 1;
    public rechargeLevel = 1;
    /** Whether the player is holding (the cannon fires only then). The headless tools leave it on. */
    public firing = true;
    /** Shots left, and whether it's locked until full (it ran dry). */
    public energy = -1;
    public overheated = false;
    /** The cannon wanted to fire but the field's full (TUNING.maxMobs): nothing came out, nothing was spent. */
    public capped = false;
    /** (The Cannon's: seconds since it last fired.) */
    public idle = 0;
    /** How close the nearest red is to the danger line (0 far .. 1 on it): the view's warning. */
    public danger = 0;
    /** Giants this battle (made by pads or the base) and the mobs they took out: how much each one is worth. */
    public readonly giantStats = { blue: 0, blueKills: 0, red: 0, redKills: 0 };

    /** When the battle ended (its time; -1 while playing): the field clears out after it. */
    private endedAt = -1;
    /** An arena match ended on the clock (not a cannon falling). */
    public timedOut = false;
    /** An arena match: the reds' cannon's fire rate, times this (a new player's first matches: much slower). */
    public redFireScale = 1;
    /** (The Cannon's: shots due.) */
    public fireDue = 0;
    private redDue = 0;
    private redGiantDue = 0;
    /** The Giant King's been sent out (once a match). */
    private kingSent = false;

    public constructor(public readonly config: BattleConfig, public events: BattleEvents = {}) {
        this.gates = config.gates.map((gate) => ({ ...gate, nowX: gate.x, locked: (gate.lock ?? 0) > 0, swingFrom: 0 }));
        this.helmets = config.helmets ?? [];
        this.grinders = (config.grinders ?? []).map((grinder) => ({ ...grinder, nowX: grinder.x, nowZ: grinder.z, speed: 0 }));
        this.pipes = (config.pipes ?? []).map((pipe) => ({ ...pipe, ends: pipeEnds(pipe), seconds: pipeLength(pipe) / TUNING.pipeSpeed }));
        this.blocks = (config.obstacles ?? []).map((o) => {
            const shape = obstacleShape(o);
            const [centreX, centreZ] = shapeCentre(shape);
            const breakable = o.kind === 'breakable';
            const hp = breakable ? o.hp ?? 40 : 0;
            return { config: o, shape, breakable, hp, hpMax: hp, alive: true, centreX, centreZ, redOnly: o.kind === 'enemyWall' };
        });
        // Each locked gate's breakable, after the obstacles' (so theirs keep their indices).
        this.gates.forEach((gate, g) => {
            if (!gate.locked) return;
            const o: ObstacleConfig = { kind: 'breakable', x: gate.x, z: gate.z, width: gate.width, depth: LOCK_DEPTH, hp: gate.lock };
            this.blocks.push({ config: o, shape: obstacleShape(o), breakable: true, hp: gate.lock!, hpMax: gate.lock!, alive: true, centreX: gate.x, centreZ: gate.z, gate: g });
        });
        this.spinners = config.spinners ?? [];
        this.pushers = (config.pushers ?? []).map((pusher) => ({ ...pusher, nowX: pusher.x, speedX: 0 }));
        this.pads = (config.pads ?? []).map((pad) => ({ ...pad, need: needOf(pad), count: 0, shape: boxShape(pad.x, pad.z, pad.width, pad.depth), open: new Map() }));
        this.pushBlocks = (config.pushBlocks ?? []).map((block) => ({ ...block, nowZ: block.z, speed: 0, blues: 0, reds: 0, alive: true }));
        this.targets = (config.targets ?? [{ x: 0, hp: config.baseHp, width: BASE_HALF_WIDTH * 2 }]).map((target) => ({
            x: target.x, z: target.z ?? ARENA.baseZ, halfWidth: (target.width ?? BASE_HALF_WIDTH * 2) / 2,
            hp: target.hp, hpMax: target.hp, alive: true,
        }));
        this.redGiantDue = config.redGiantEvery ?? 0;
        this.duel = config.duel;
        this.cannonZ = config.duel?.cannonZ ?? 0;
        this.hasRedPads = this.pads.some((pad) => pad.team === 'red');
        this.blueTargets = (config.blueTargets ?? []).map((target) => ({
            x: target.x, z: target.z ?? ARENA.dangerZ, halfWidth: (target.width ?? BASE_HALF_WIDTH * 2) / 2,
            hp: target.hp, hpMax: target.hp, alive: true, kind: target.kind,
        }));
        this.targets.forEach((target, k) => { target.kind = config.targets?.[k]?.kind; });
        // A match's cannons are shielded while their towers stand.
        if (this.duel) this.shield();
    }

    /** An arena match: the blues' buildings' life left, and at the start. */
    public get ownHp(): number {
        return this.blueTargets.reduce((sum, target) => sum + Math.max(0, target.hp), 0);
    }

    public get ownHpMax(): number {
        return this.blueTargets.reduce((sum, target) => sum + target.hpMax, 0);
    }

    /**
     * An arena match: each cannon shielded while any of its side's towers stands; the moment the last falls, it's open
     * (`exposed`: whose).
     */
    private shield(): void {
        for (const [list, team] of [[this.targets, RED], [this.blueTargets, BLUE]] as [Target[], number][]) {
            const towers = list.some((target) => target.kind !== 'cannon' && target.alive);
            for (const target of list) {
                if (target.kind !== 'cannon') continue;
                const was = target.shielded;
                target.shielded = towers;
                if (was && !towers) this.events.exposed?.(team);
            }
            this.cannonOf(team).boosted = !towers;
        }
    }

    /** The cannon of `team`. */
    public cannonOf(team: number): Cannon {
        return team === BLUE ? this : this.red;
    }


    /** An arena match: seconds left (0 once it's up). */
    public get timeLeft(): number {
        return this.duel ? Math.max(0, this.duel.seconds - this.time) : 0;
    }

    /** z mirrored across the middle of the field (the reds' end for the blues'). */
    private mirrorZ(z: number): number {
        return ARENA.baseZ - z;
    }

    /** A boss level's Giant King, once the enemy's down to `kingAt`: out of a target still standing. */
    private sendKing(): void {
        const at = this.config.kingAt;
        if (this.kingSent || !at || this.baseHp > at || this.baseHp <= 0) return;
        const target = this.someTarget();
        if (!target) return;
        this.kingSent = true;
        const x = target.x;
        const z = target.z + RED_SPAWN_OUT + 0.5;
        const i = this.add(RED, x, z, 0, GIANT);
        if (i < 0) return;
        this.hp[i] *= TUNING.kingHp;
        this.viking[i] = 1;
        this.events.king?.(x, z);
    }

    /** All the targets' HP left, and at the start. */
    public get baseHp(): number {
        return this.targets.reduce((sum, target) => sum + Math.max(0, target.hp), 0);
    }

    public get baseHpMax(): number {
        return this.targets.reduce((sum, target) => sum + target.hpMax, 0);
    }

    /** Debug: a blue giant, truck or gold saucer, as if a house had just made it (from the cannon). */
    /**
     * A unit out of the cannon (a card that's charged): a giant, a truck, the gold UFO, a car, with its own `stats` (the
     * card's level's hits and damage; a car with no hits set can't be destroyed).
     */
    public spawnUnit(kind: CardKind, stats: UnitStats = {}, team: number = BLUE): void {
        const character = CHARACTER_CARDS[kind];
        if (character) {
            this.spawnBatch(kind, character, stats, team);
            return;
        }
        if (team === RED) {
            this.spawnRedUnit(kind as 'giant' | 'truck' | 'saucer' | 'car', stats);
            return;
        }
        if (kind === 'saucer') {
            const target = this.mainTarget();
            if (target >= 0) this.saucers.push({ x: this.cannonX, z: this.cannonZ - 2, target, alive: true, age: 0, sucked: 0, damage: stats.damage });
            this.events.giant?.(BLUE, this.cannonX, this.cannonZ - 2, -1);
            return;
        }
        const mob = kind === 'truck' ? TRUCK : kind === 'car' ? CAR : GIANT;
        const x = this.cannonX + (Math.random() * 2 - 1) * 1.2;
        const z = this.cannonZ + (-2.5 - Math.random() * SPAWN_JITTER);
        const i = this.add(BLUE, x, z, ALL_GATES, mob);
        if (i < 0) return;
        if (stats.hp !== undefined) this.hp[i] = stats.hp > 0 ? stats.hp : Infinity;
        if (stats.damage !== undefined) this.unitDamage[i] = stats.damage;
        this.events.giant?.(BLUE, x, z, mob);
        this.shockwave(BLUE, this.cannonX, this.cannonZ);
    }

    /** An arena match's reds playing a card: out of their cannon, down the field. */
    /**
     * A character card's batch (its settings' `count`: the skeletons' eight, the warriors' two) out of `team`'s cannon,
     * spread round its front, each with the card's hits and damage, its look and speed; one shockwave for the lot.
     */
    private spawnBatch(kind: CardKind, character: NonNullable<(typeof CHARACTER_CARDS)[CardKind]>, stats: UnitStats, team: number): void {
        const count = Math.max(1, Math.round(SETTINGS.cards[kind].count ?? 1));
        const red = team === RED;
        const c = this.cannonOf(team);
        const front = this.cannonZ - 2.6;
        let first = -1;
        for (let k = 0; k < count; k++) {
            // A ring round the middle one (a pair side by side).
            const angle = (k / count) * Math.PI * 2 + Math.random() * 0.3;
            const reach = count > 2 ? character.spread * (k === 0 ? 0 : 0.55 + 0.45 * (k % 2)) : character.spread * 0.5;
            const x = c.cannonX + (count > 2 ? Math.cos(angle) * reach : (k - 0.5) * 2 * reach);
            const zOff = count > 2 ? Math.sin(angle) * reach * 0.6 : 0;
            const z = red ? this.mirrorZ(front + zOff) : front + zOff;
            const i = this.add(team, Math.max(-ARENA.halfWidth + 0.4, Math.min(ARENA.halfWidth - 0.4, x)), z, ALL_GATES, character.big);
            if (i < 0) break;
            if (first < 0) first = i;
            this.look[i] = character.look;
            this.speedMul[i] = character.speed;
            this.fly[i] = character.fly ? 1 : 0;
            this.tint[i] = team === BLUE ? character.tint ?? TINT.none : TINT.none;
            if (character.helmet) this.helmet[i] = 1;
            if (character.viking) this.viking[i] = 1;
            if (stats.hp !== undefined) this.hp[i] = stats.hp > 0 ? stats.hp : Infinity;
            if (stats.damage !== undefined) this.unitDamage[i] = stats.damage;
        }
        if (first < 0) return;
        this.events.giant?.(team, c.cannonX, red ? this.mirrorZ(front) : front, character.big, kind);
        this.shockwave(team, c.cannonX, red ? this.mirrorZ(this.cannonZ) : this.cannonZ);
    }

    private spawnRedUnit(kind: 'giant' | 'truck' | 'saucer' | 'car', stats: UnitStats): void {
        const c = this.red;
        if (kind === 'saucer') {
            const target = this.mainOf(this.blueTargets);
            const z = this.mirrorZ(this.cannonZ - 2);
            if (target >= 0) this.saucers.push({ x: c.cannonX, z, target, alive: true, age: 0, sucked: 0, damage: stats.damage, team: RED });
            this.events.giant?.(RED, c.cannonX, z, -1);
            return;
        }
        const mob = kind === 'truck' ? TRUCK : kind === 'car' ? CAR : GIANT;
        const x = c.cannonX + (Math.random() * 2 - 1) * 1.2;
        const z = this.mirrorZ(this.cannonZ - 2.5 - Math.random() * SPAWN_JITTER);
        const i = this.add(RED, x, z, ALL_GATES, mob);
        if (i < 0) return;
        if (stats.hp !== undefined) this.hp[i] = stats.hp > 0 ? stats.hp : Infinity;
        if (stats.damage !== undefined) this.unitDamage[i] = stats.damage;
        this.events.giant?.(RED, x, z, mob);
        this.shockwave(RED, c.cannonX, this.mirrorZ(this.cannonZ));
    }

    /** Each bomb that fell this step (not one vanishing as the field clears out after the battle) goes off. */
    private detonate(): void {
        if (this.state !== 'playing') return;
        for (let i = 0; i < this.count; i++) {
            if (!this.dead[i] || this.look[i] !== LOOK.bomb || this.leaving[i] > 0) continue;
            // (Once: it's gone at the end of the step.)
            this.look[i] = LOOK.mob;
            this.explodeAt(this.team[i], this.x[i], this.z[i], this.unitDamage[i] || TUNING.giantDamage);
        }
    }

    /** A blast at (x, z): `team`'s foes in BOMB.radius hurt or gone, their buildings in reach hit. */
    private explodeAt(team: number, x: number, z: number, damage: number): void {
        const reach = BOMB.radius * BOMB.radius;
        for (let j = 0; j < this.count; j++) {
            if (this.dead[j] || this.leaving[j] > 0 || this.team[j] === team) continue;
            const dx = this.x[j] - x;
            const dz = this.z[j] - z;
            if (dx * dx + dz * dz > reach) continue;
            if (this.big[j]) {
                this.hp[j] -= damage * BOMB.bigShare;
                if (this.hp[j] > 0) continue;
            }
            this.dead[j] = 1;
            this.events.knocked?.(this.x[j], this.z[j], this.team[j]);
        }
        // The buildings: the reds' for a blue bomb, the blues' (an arena match) for a red one.
        const hit = Math.round(damage * BOMB.buildingShare);
        if (team === BLUE) {
            this.targets.forEach((target, k) => {
                if (target.alive && !target.shielded && Math.abs(target.x - x) <= target.halfWidth + BOMB.radius && Math.abs(target.z - z) <= BOMB.radius) this.damageTarget(k, hit, x, z, true);
            });
        } else if (this.duel) {
            this.blueTargets.forEach((target, k) => {
                if (target.alive && !target.shielded && Math.abs(target.x - x) <= target.halfWidth + BOMB.radius && Math.abs(target.z - z) <= BOMB.radius) this.damageOwn(k, hit, x, z, true);
            });
        }
        this.events.explode?.(team, x, z, BOMB.radius);
    }

    /** `team`'s special unit landed at (x, z): the foes round it knocked out (a big one hurt). */
    private shockwave(team: number, x: number, z: number): void {
        const reach = SHOCKWAVE.radius * SHOCKWAVE.radius;
        for (let j = 0; j < this.count; j++) {
            if (this.dead[j] || this.leaving[j] > 0 || this.team[j] === team) continue;
            const dx = this.x[j] - x;
            const dz = this.z[j] - z;
            if (dx * dx + dz * dz > reach) continue;
            if (this.big[j]) {
                this.hp[j] -= SHOCKWAVE.bigDamage;
                if (this.hp[j] > 0) continue;
            }
            this.dead[j] = 1;
            this.events.knocked?.(this.x[j], this.z[j], this.team[j]);
        }
        this.events.shockwave?.(team, x, z, SHOCKWAVE.radius);
    }

    public debugSpawn(kind: CardKind): void {
        if (CHARACTER_CARDS[kind]) {
            this.spawnUnit(kind, {});
            return;
        }
        if (kind === 'saucer') {
            const target = this.mainTarget();
            if (target >= 0) this.saucers.push({ x: this.cannonX, z: -2, target, alive: true, age: 0, sucked: 0 });
            this.events.giant?.(BLUE, this.cannonX, -2, -1);
            return;
        }
        const mob = kind === 'truck' ? TRUCK : kind === 'car' ? CAR : GIANT;
        const x = this.cannonX + (Math.random() * 2 - 1) * 1.2;
        const z = -2.5 - Math.random() * SPAWN_JITTER;
        if (this.add(BLUE, x, z, ALL_GATES, mob) >= 0) this.events.giant?.(BLUE, x, z, mob);
    }

    /** Debug: every target down (the battle won). */
    public destroyAll(): void {
        for (const target of this.targets) {
            target.hp = 0;
            target.alive = false;
        }
        if (this.state === 'playing') {
            this.state = 'won';
            this.events.won?.();
        }
    }

    /** A target still standing, picked at random (where the next red comes from). */
    private someTarget(): Target | undefined {
        const standing = this.targets.filter((target) => target.alive);
        return standing[Math.floor(Math.random() * standing.length)];
    }

    /** The standing target nearest x (where a blue heads), if any. */
    private nearestTarget(x: number): Target | undefined {
        let best: Target | undefined;
        for (const target of this.targets) {
            if (target.alive && (!best || Math.abs(target.x - x) < Math.abs(best.x - x))) best = target;
        }
        return best;
    }

    public get blueCount(): number {
        let n = 0;
        for (let i = 0; i < this.count; i++) if (this.team[i] === BLUE) n++;
        return n;
    }

    /** Blue mobs a second, at the current fire level. */
    public get fireRate(): number {
        return this.fireRateOf(this);
    }

    /** A cannon's shots a second, shots held and seconds to recharge from empty, at its levels. */
    public fireRateOf(c: Cannon): number {
        const rate = TUNING.fireRate * (1 + TUNING.fireRatePerLevel * (c.fireLevel - 1)) * (c === this.red ? this.redFireScale : 1);
        // An arena match: a side down to its cannon fires faster.
        return c.boosted && this.duel ? rate * this.duel.boost.rate : rate;
    }

    public energyMaxOf(c: Cannon): number {
        return TUNING.energyCapacity + TUNING.energyPerLevel * (c.capacityLevel - 1);
    }

    public rechargeSecondsOf(c: Cannon): number {
        return Math.max(TUNING.rechargeMin, TUNING.rechargeSeconds - TUNING.rechargePerLevel * (c.rechargeLevel - 1));
    }

    /** The reds' rate right now (0 before they start, or once the base has fallen). */
    public get redRate(): number {
        const since = this.time - TUNING.redDelay;
        if (since < 0 || this.baseHp <= 0) return 0;
        const ramp = Math.min(1, since / Math.max(1, this.config.redRamp));
        return this.config.redRate + (this.config.redRateEnd - this.config.redRate) * ramp;
    }

    /** A spinner's turn now (radians). */
    public spinnerAngle(spinner: SpinnerConfig): number {
        return (this.time * spinner.speed + (spinner.phase ?? 0)) * Math.PI * 2;
    }

    /** Its size (its hurt box): what it fights with, what the crowd keeps clear of, what walks into a house. */
    /** Whether the mob slideAround() is steering is a blue (enemy walls aren't in its way), and a big one. */
    private movingBlue = false;
    private movingBig = false;
    /** The blues' cannon's row (z): 0, but up the field in an arena match (its mirror the reds'). */
    public cannonZ = 0;
    /** Some houses are the reds' (an arena match): a house then blocks plain blues too (theirs, not their own). */
    private hasRedPads = false;

    /** Whether a house is solid to a mob: to the other side's, and to any big one (its own side's plain mobs walk in). */
    private padBlocks(pad: Pad, blue: boolean, big: boolean): boolean {
        return big || (pad.team === 'red') === blue;
    }
    /** collide()'s spinner arm directions this step (one per spinner, reused). */
    private spinArms: { ax: number[]; az: number[] }[] = [];

    public radiusOf(i: number): number {
        const kind = this.big[i];
        return TUNING.radius * (kind === TRUCK ? TUNING.truckScale : kind === CAR ? TUNING.carScale : kind ? TUNING.giantScale : 1);
    }

    /** Its body against the world (its hit box): the field's sides, walls, holes, blocks, houses, PUSH blocks, sliding
     *  bars, spinners and pipes. A big one's is smaller than it looks (ui/units.json `body`: bodyShare), so it slips
     *  through a gap its looks would wedge in. */
    public bodyOf(i: number): number {
        const kind = this.big[i];
        return this.radiusOf(i) * (kind === TRUCK ? bodyShare('truck') : kind === CAR ? bodyShare('car') : kind ? bodyShare('giant') : 1);
    }

    /** Whether one with body `r` fits at (x, z) on the field as it is now (the field's sides, walls, holes, blocks
     *  standing, PUSH blocks, and the houses when `houses`: solid to reds and giants) — the editor's gap check. */
    public fitsAt(x: number, z: number, r: number, houses: boolean, red = false): boolean {
        if (Math.abs(x) > ARENA.halfWidth - r) return false;
        for (const block of this.blocks) if (block.alive && (red || !block.redOnly) && touch(block.shape, x, z, r, this.contactOut)) return false;
        if (houses && SETTINGS.housesBlockReds) {
            for (const pad of this.pads) {
                if (this.passable(pad, r) && Math.abs(x - pad.x) < pad.width / 2 + r && Math.abs(z - pad.z) < pad.depth / 2 + r) return false;
            }
        }
        for (const block of this.pushBlocks) {
            if (block.alive && Math.abs(x - block.x) < block.width / 2 + r && Math.abs(z - block.nowZ) < block.depth / 2 + r) return false;
        }
        for (const pipe of this.pipes) {
            for (const end of pipe.ends) {
                const ahead = (z - end.z) * end.facing;
                if (Math.abs(x - end.x) < PIPE.radius + r && ahead < 0 && ahead > -PIPE.body - r) return false;
            }
        }
        return true;
    }

    public step(dt: number): void {
        this.time += dt;
        this.cannonX += (this.aimX - this.cannonX) * Math.min(1, CANNON_FOLLOW * dt);
        if (this.duel) {
            this.red.cannonX += (this.red.aimX - this.red.cannonX) * Math.min(1, CANNON_FOLLOW * dt);
            // Each cannon's life is hit on the cannon: it goes where the cannon is.
            for (const target of this.targets) if (target.kind === 'cannon') target.x = this.red.cannonX;
            for (const target of this.blueTargets) if (target.kind === 'cannon') target.x = this.cannonX;
        }
        for (const gate of this.gates) {
            gate.nowX = gate.x + (gate.swing && !gate.locked ? Math.sin(((this.time - gate.swingFrom) / gate.swing.seconds) * Math.PI * 2) * gate.swing.range : 0);
        }
        for (const grinder of this.grinders) {
            if (!grinder.move) continue;
            // A horizontal one rolls up and down the field, a vertical one across it.
            const angle = (this.time / grinder.move.seconds) * Math.PI * 2;
            const offset = Math.sin(angle) * grinder.move.range;
            grinder.speed = Math.cos(angle) * grinder.move.range * ((Math.PI * 2) / grinder.move.seconds);
            if (grinder.axis === 'x') grinder.nowZ = grinder.z + offset;
            else grinder.nowX = grinder.x + offset;
        }
        for (const pusher of this.pushers) {
            const angle = (this.time / pusher.seconds + (pusher.phase ?? 0)) * Math.PI * 2;
            pusher.nowX = pusher.x + Math.sin(angle) * pusher.range;
            pusher.speedX = Math.cos(angle) * pusher.range * ((Math.PI * 2) / pusher.seconds);
        }
        this.slidePushBlocks(dt);
        if (this.state === 'playing') {
            this.fire(dt);
            // A match: the reds fire as the blues do (no waves).
            if (this.duel) this.fireFrom(this.red, RED, dt);
            else this.spawnReds(dt);
        }
        this.move(dt);
        this.collide(dt);
        this.useGrinders(dt);
        this.fight(dt);
        this.crossHelmets();
        this.crossGates();
        this.usePipes(dt);
        this.feedPads();
        this.flySaucers(dt);
        this.hitBase();
        if (this.duel) this.checkDuel();
        else this.checkBreakthrough();
        this.clearOut(dt);
        this.detonate();
        this.compact();
        if (this.count > this.peak) this.peak = this.count;
    }

    /** After the battle: every mob vanishes, a few at a time (each at its own moment, by its phase) — not all at once. */
    private clearOut(dt: number): void {
        if (this.state === 'playing') return;
        if (this.endedAt < 0) this.endedAt = this.time;
        const since = this.time - this.endedAt;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || since < CLEAR_OUT.start + this.phase[i] * CLEAR_OUT.spread) continue;
            this.leaving[i] += dt / CLEAR_OUT.seconds;
            if (this.leaving[i] >= 1) {
                this.dead[i] = 1;
                this.events.vanish?.(this.x[i], this.z[i], this.team[i]);
            }
        }
    }

    // ------------------------------------------------------------------ spawning

    /** A new mob (`kind`: PLAIN, GIANT or TRUCK); its index, or -1 when the field's full. */
    private add(team: number, x: number, z: number, crossed: number, kind: number = PLAIN): number {
        const big = kind !== PLAIN;
        if (this.count >= Math.min(CAPACITY, TUNING.maxMobs)) return -1;
        const i = this.count++;
        this.x[i] = x;
        this.z[i] = z;
        this.prevZ[i] = z;
        this.team[i] = team;
        this.big[i] = kind;
        this.hp[i] = kind === TRUCK ? TUNING.truckHp : kind === CAR ? carHp() : big ? (team === BLUE || this.duel ? TUNING.blueGiantHp : TUNING.redGiantHp) : 1;
        this.helmet[i] = 0;
        this.viking[i] = 0;
        this.chip[i] = 0;
        this.unitDamage[i] = 0;
        this.look[i] = LOOK.mob;
        this.speedMul[i] = 1;
        this.fly[i] = 0;
        this.tint[i] = TINT.none;
        if (big) {
            if (team === BLUE) this.giantStats.blue++;
            else this.giantStats.red++;
        }
        this.heading[i] = team === BLUE ? 0 : Math.PI;
        this.age[i] = 0;
        this.phase[i] = Math.random();
        this.leaving[i] = 0;
        this.gatesCrossed[i] = big ? ALL_GATES : crossed;
        this.dead[i] = 0;
        this.vx[i] = 0;
        this.vz[i] = 0;
        this.slideFor[i] = 0;
        this.stuckFor[i] = 0;
        this.lastX[i] = x;
        this.lastZ[i] = z;
        this.lane[i] = (Math.random() * 2 - 1) * redLaneSpread();
        return i;
    }

    /** Shots the cannon holds, at its capacity level. */
    public get energyMax(): number {
        return this.energyMaxOf(this);
    }

    /** Seconds to recharge from empty, at its recharge level. */
    public get rechargeSeconds(): number {
        return this.rechargeSecondsOf(this);
    }

    private fire(dt: number): void {
        this.fireFrom(this, BLUE, dt);
    }

    /** Cannon `c` (the blues', or an arena match's reds' at the far end, firing down the field), held or not. */
    private fireFrom(c: Cannon, team: number, dt: number): void {
        const max = this.energyMaxOf(c);
        if (c.energy < 0) c.energy = max;
        const shooting = c.firing && !c.overheated && c.energy >= 1;
        c.capped = false;
        if (!shooting) {
            // Recharging: straight away once it's run dry (and locked until full), else after a short pause.
            c.fireDue = 0;
            c.idle += dt;
            if (c.overheated || c.idle >= TUNING.rechargeDelay) c.energy = Math.min(max, c.energy + (max / this.rechargeSecondsOf(c)) * dt);
            if (c.overheated && c.energy >= max) c.overheated = false;
            return;
        }
        c.idle = 0;
        c.fireDue += this.fireRateOf(c) * dt;
        const muzzle = team === BLUE ? this.cannonZ + MUZZLE_Z : this.mirrorZ(this.cannonZ + MUZZLE_Z);
        while (c.fireDue >= 1 && c.energy >= 1) {
            // The field's full: it waits (a shot that can't come out isn't spent).
            if (this.add(team, c.cannonX + (Math.random() - 0.5) * MUZZLE_SPREAD, muzzle, 0) < 0) {
                c.capped = true;
                c.fireDue = Math.min(c.fireDue, 1);
                break;
            }
            c.fireDue -= 1;
            c.energy -= 1;
            if (team === BLUE) this.events.fire?.(c.cannonX);
            else this.events.redFire?.(c.cannonX);
        }
        if (c.energy < 1) {
            c.overheated = true;
            if (team === BLUE) this.events.empty?.();
        }
    }

    /** Waves: reds come for TUNING.waveSeconds, then a TUNING.wavePause breather — at the same average rate. Giants on their own clock. */
    private spawnReds(dt: number): void {
        this.sendKing();
        const rate = this.redRate;
        if (rate <= 0) return;
        const every = this.config.redGiantEvery ?? 0;
        if (every > 0) {
            this.redGiantDue -= dt;
            if (this.redGiantDue <= 0) {
                this.redGiantDue = every;
                const target = this.someTarget();
                if (target) {
                    const x = target.x + (Math.random() - 0.5) * target.halfWidth * 1.4;
                    const z = target.z + RED_SPAWN_OUT + 0.5;
                    if (this.add(RED, x, z, 0, GIANT) >= 0) this.events.giant?.(RED, x, z, GIANT);
                }
            }
        }
        const cycle = TUNING.waveSeconds + TUNING.wavePause;
        const inWave = (this.time - TUNING.redDelay) % cycle < TUNING.waveSeconds;
        if (!inWave) return;
        this.redDue += rate * (cycle / TUNING.waveSeconds) * dt;
        while (this.redDue >= 1) {
            this.redDue -= 1;
            const target = this.someTarget();
            if (!target) break;
            this.add(RED, target.x + (Math.random() - 0.5) * target.halfWidth * 1.45, target.z + RED_SPAWN_OUT + Math.random() * 0.4, 0);
        }
    }

    // ------------------------------------------------------------------ the grid

    private buildGrid(): void {
        this.cellHead.fill(-1);
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i]) continue;
            const c = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((this.x[i] - GRID_MIN_X) / CELL)));
            const r = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((this.z[i] - GRID_MIN_Z) / CELL)));
            const cell = r * GRID_COLS + c;
            this.cellNext[i] = this.cellHead[cell];
            this.cellHead[cell] = i;
        }
    }

    /** Calls `visit` for every live mob within `cells` cells round (x, z). */
    private forNear(x: number, z: number, cells: number, visit: (j: number) => void): void {
        const c0 = Math.floor((x - GRID_MIN_X) / CELL);
        const r0 = Math.floor((z - GRID_MIN_Z) / CELL);
        for (let r = r0 - cells; r <= r0 + cells; r++) {
            if (r < 0 || r >= GRID_ROWS) continue;
            for (let c = c0 - cells; c <= c0 + cells; c++) {
                if (c < 0 || c >= GRID_COLS) continue;
                for (let j = this.cellHead[r * GRID_COLS + c]; j >= 0; j = this.cellNext[j]) if (!this.dead[j]) visit(j);
            }
        }
    }

    /** Cells to search round mob i to reach any mob it could touch. */
    private reachCells(i: number): number {
        return this.big[i] ? 2 : 1;
    }

    // ------------------------------------------------------------------ movement

    /**
     * About to run into a solid obstacle (a wall or water — not a breakable, which it walks into)? Then the way along its
     * nearest edge that's closest to where it wants to go, nudged out from it; else null. Reuses `contactOut`.
     */
    private slideAround(x: number, z: number, dx: number, dz: number, r: number, houses: boolean, keepX = 0, keepZ = 0): Contact | null {
        const c = this.contactOut;
        let hit: Shape | null = null;
        let open = 0;
        for (const step of LOOK_STEPS) {
            const ahead = LOOK_AHEAD * step;
            for (const block of this.blocks) {
                if (!block.alive || block.breakable || (block.redOnly && this.movingBlue)) continue;
                // (Kept on the field: else a wall reaching the field's side steers it along its edge there, into the wall.)
                if (touch(block.shape, x + dx * ahead, z + dz * ahead, r, c, ARENA.halfWidth - r)) {
                    hit = block.shape;
                    break;
                }
            }
            if (!hit && houses) {
                for (const pad of this.pads) {
                    if (!this.padBlocks(pad, this.movingBlue, this.movingBig)) continue;
                    const sides = this.openSides(pad, r);
                    if (!sides.left && !sides.right) continue;
                    if (touch(pad.shape, x + dx * ahead, z + dz * ahead, r, c)) {
                        hit = pad.shape;
                        // Only one side to go round: that one (-1 left, +1 right).
                        open = sides.left && sides.right ? 0 : sides.left ? -1 : 1;
                        break;
                    }
                }
            }
            if (hit) break;
        }
        if (!hit) return null;
        // Head-on, and already going round: the same way as it was.
        if (open === 0 && (keepX !== 0 || keepZ !== 0) && Math.abs(c.tx * dx + c.tz * dz) < HEAD_ON) {
            if (c.tx * keepX + c.tz * keepZ < 0) {
                c.tx = -c.tx;
                c.tz = -c.tz;
            }
            return c;
        }
        // Along the edge, whichever way is nearer the wanted direction — but head-on (both ways about as good, which
        // flips frame to frame and leaves it stuck), round the nearer end: away from the shape's middle.
        const along = c.tx * dx + c.tz * dz;
        const choice = open !== 0
            ? c.tx * open + (Math.abs(c.tx) < 0.3 ? along : 0)
            : Math.abs(along) < HEAD_ON
                ? c.tx * (x - (hit.minX + hit.maxX) / 2) + c.tz * (z - (hit.minZ + hit.maxZ) / 2)
                : along;
        if (choice < 0) {
            c.tx = -c.tx;
            c.tz = -c.tz;
        }
        return c;
    }

    /**
     * Which sides of a house one of radius `r` can get past: a strip that wide down each side, clear of the field's edge
     * and of every wall, hole or breakable (worked out once per house and size).
     */
    private openSides(pad: Pad, r: number): { left: boolean; right: boolean } {
        const key = Math.round(r * 100);
        let sides = pad.open.get(key);
        if (sides) return sides;
        const hw = pad.width / 2;
        const hd = pad.depth / 2;
        const fits = (side: number): boolean => {
            const x = pad.x + side * (hw + r + 0.05);
            if (Math.abs(x) > ARENA.halfWidth - r) return false;
            for (let z = pad.z - hd - r; z <= pad.z + hd + r; z += 0.25) {
                for (const block of this.blocks) if (!block.redOnly && touch(block.shape, x, z, r, this.contactOut)) return false;
            }
            return true;
        };
        sides = { left: fits(-1), right: fits(1) };
        pad.open.set(key, sides);
        return sides;
    }

    /** Whether a house blocks one of radius `r` (it does when there's a way round it). */
    private passable(pad: Pad, r: number): boolean {
        const sides = this.openSides(pad, r);
        return sides.left || sides.right;
    }

    /** The PUSH blocks slide by last step's pressure: the lead (blues minus reds) times TUNING.pushPerMob, capped. */
    private slidePushBlocks(dt: number): void {
        this.pushBlocks.forEach((block, b) => {
            if (!block.alive) return;
            const lead = block.blues - block.reds;
            block.blues = 0;
            block.reds = 0;
            // + towards the cannon: reds' lead pushes it down the field, blues' up it.
            const wanted = Math.max(-TUNING.pushMaxSpeed, Math.min(TUNING.pushMaxSpeed, -lead * TUNING.pushPerMob));
            block.speed += (wanted - block.speed) * Math.min(1, dt * 6);
            block.nowZ += block.speed * dt;
            // Shoved out either end: it drops away and the lane is open (both ways).
            if (block.nowZ <= block.far || block.nowZ >= block.near) {
                block.nowZ = Math.max(block.far, Math.min(block.near, block.nowZ));
                block.alive = false;
                this.events.pushCleared?.(b);
            }
        });
    }

    private move(dt: number): void {
        this.buildGrid();
        const seek = TUNING.seekRange;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i]) continue;
            this.age[i] += dt;
            const x = this.x[i];
            const z = this.z[i];
            const blue = this.team[i] === BLUE;
            const radius = this.radiusOf(i);
            // Where it wants to go.
            let dx = 0;
            let dz = blue ? -1 : 1;
            if (blue && z < ARENA.baseZ + HOMING_FROM) {
                const target = this.nearestTarget(x);
                if (target) dx = Math.max(-0.9, Math.min(0.9, (target.x - x) * HOMING_PULL));
            }
            if (!blue && this.duel) {
                // A match's reds march down as the blues march up: straight, then for the blues' nearest building.
                if (z > this.mirrorZ(ARENA.baseZ + HOMING_FROM)) {
                    const target = this.nearestOf(this.blueTargets, x);
                    if (target) dx = Math.max(-0.9, Math.min(0.9, (target.x - x) * HOMING_PULL));
                }
            } else if (!blue) dx = Math.max(-0.8, Math.min(0.8, (this.lane[i] - x) * RED_LANE_PULL));
            // (A match's reds don't run at the blues: the blues don't at them.)
            const chase = !blue && !this.duel;
            let pushX = 0;
            let pushZ = 0;
            let nearestFoe = -1;
            let nearestDistance = seek * seek;
            // The mobs round it (forNear's cells in its order, written out: this runs for every mob every step).
            const cells = this.reachCells(i);
            const c0 = Math.floor((x - GRID_MIN_X) / CELL);
            const r0 = Math.floor((z - GRID_MIN_Z) / CELL);
            const bigI = this.big[i];
            for (let row = Math.max(0, r0 - cells); row <= r0 + cells && row < GRID_ROWS; row++) {
                for (let col = Math.max(0, c0 - cells); col <= c0 + cells && col < GRID_COLS; col++) {
                    for (let j = this.cellHead[row * GRID_COLS + col]; j >= 0; j = this.cellNext[j]) {
                        if (this.dead[j] || j === i) continue;
                        const ox = x - this.x[j];
                        const oz = z - this.z[j];
                        const d2 = ox * ox + oz * oz;
                        // (Flying over the ground's crowd, and it under the flyers.)
                        if (this.fly[i] !== this.fly[j]) continue;
                        const space = radius + this.radiusOf(j);
                        if (d2 < space * space && d2 > 1e-6) {
                            const d = Math.sqrt(d2);
                            // A giant barely gets pushed by plain mobs; they get pushed off it hard.
                            const weight = this.big[j] && !bigI ? 2 : bigI && !this.big[j] ? 0.25 : 1;
                            const strength = ((space - d) / space) * weight;
                            pushX += (ox / d) * strength;
                            pushZ += (oz / d) * strength;
                        }
                        if (chase && this.team[j] === BLUE && d2 < nearestDistance) {
                            nearestDistance = d2;
                            nearestFoe = j;
                        }
                    }
                }
            }
            // A red runs at the nearest blue it can see (the grid only reaches a cell or so: far ones come by the
            // straight march).
            if (nearestFoe >= 0) {
                const tx = this.x[nearestFoe] - x;
                const tz = this.z[nearestFoe] - z;
                const d = Math.sqrt(tx * tx + tz * tz) || 1;
                dx += (tx / d) * 0.9;
                dz += (tz / d) * 0.9;
            }
            let length = Math.sqrt(dx * dx + dz * dz) || 1;
            // How far it really got last step, after the crowd and the walls pushed it.
            const mx = x - this.lastX[i];
            const mz = z - this.lastZ[i];
            const moved = Math.sqrt(mx * mx + mz * mz) / Math.max(dt, 1e-4);
            this.lastX[i] = x;
            this.lastZ[i] = z;
            const remembering = this.slideFor[i] > 0;
            // A wall or hole ahead: slide along its edge instead (and a little away from it).
            this.movingBlue = blue;
            this.movingBig = !!this.big[i];
            const slide = this.fly[i] ? null : this.slideAround(x, z, dx / length, dz / length, this.bodyOf(i), SETTINGS.housesBlockReds && (!blue || !!this.big[i] || this.hasRedPads),
                remembering ? this.slideX[i] : 0, remembering ? this.slideZ[i] : 0);
            this.slideFor[i] = Math.max(0, this.slideFor[i] - dt);
            if (slide) {
                const kindNow = this.big[i];
                const speedNow = (blue || this.duel ? TUNING.blueSpeed : TUNING.redSpeed) * (kindNow === TRUCK ? TUNING.truckSpeed : kindNow === CAR ? TUNING.carSpeed : kindNow ? TUNING.giantSpeed : 1) * this.speedMul[i];
                // Going round but getting nowhere (pressed into a corner): the other way round.
                this.stuckFor[i] = moved < speedNow * STUCK_SPEED ? this.stuckFor[i] + dt : 0;
                if (this.stuckFor[i] > STUCK_SECONDS) {
                    this.stuckFor[i] = 0;
                    slide.tx = -slide.tx;
                    slide.tz = -slide.tz;
                }
                this.slideX[i] = slide.tx;
                this.slideZ[i] = slide.tz;
                this.slideFor[i] = SLIDE_MEMORY;
                dx = slide.tx * AVOID_TURN + slide.nx * 0.35;
                dz = slide.tz * AVOID_TURN + slide.nz * 0.35;
                length = Math.sqrt(dx * dx + dz * dz) || 1;
                // A red steering round something takes the side it's going round as its lane: else the pull back to its
                // old lane (through the obstacle) drags it straight back in front of it, and it hovers there.
                if (!blue && Math.abs(slide.tx) > 0.3) this.lane[i] = Math.max(-redLaneSpread(), Math.min(redLaneSpread(), x + Math.sign(slide.tx) * LANE_SHIFT));
            }
            const kind = this.big[i];
            const walking = this.look[i] !== LOOK.turtle || turtleWalking(this.time, this.phase[i]);
            const speed = walking ? (blue || this.duel ? TUNING.blueSpeed : TUNING.redSpeed) * (kind === TRUCK ? TUNING.truckSpeed : kind === CAR ? TUNING.carSpeed : kind ? TUNING.giantSpeed : 1) * this.speedMul[i] : 0;
            const targetVx = (dx / length) * speed + pushX * TUNING.separation;
            const targetVz = (dz / length) * speed + pushZ * TUNING.separation * 0.5;
            // A little inertia, so the crowd flows rather than jitters (and a shove carries on for a moment).
            const blend = Math.min(1, dt * 10);
            this.vx[i] += (targetVx - this.vx[i]) * blend;
            this.vz[i] += (targetVz - this.vz[i]) * blend;
            this.prevZ[i] = z;
            this.x[i] = x + this.vx[i] * dt;
            this.z[i] = z + this.vz[i] * dt;
            if (this.faces && Math.abs(this.vx[i]) + Math.abs(this.vz[i]) > 0.2) {
                const target = Math.atan2(-this.vx[i], -this.vz[i]);
                let delta = target - this.heading[i];
                delta = Math.atan2(Math.sin(delta), Math.cos(delta));
                this.heading[i] += delta * Math.min(1, dt * 12);
            }
        }
    }

    /** Out of whatever it overlaps: the field's sides, walls and holes, spinners' arms and pushers (those shove). */
    private collide(dt: number): void {
        const shove = TUNING.shove;
        // Each spinner's arms this step (their directions: the same for every mob).
        const arm = TUNING.radius * 0.9;
        while (this.spinArms.length < this.spinners.length) this.spinArms.push({ ax: [], az: [] });
        for (let k = 0; k < this.spinners.length; k++) {
            const spinner = this.spinners[k];
            const base = this.spinnerAngle(spinner);
            const arms = this.spinArms[k];
            arms.ax.length = arms.az.length = spinner.arms;
            for (let a = 0; a < spinner.arms; a++) {
                const angle = base + (a / spinner.arms) * Math.PI * 2;
                arms.ax[a] = Math.sin(angle);
                arms.az[a] = Math.cos(angle);
            }
        }
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i]) continue;
            const r = this.bodyOf(i);
            const wallX = ARENA.halfWidth - r;
            let x = Math.max(-wallX, Math.min(wallX, this.x[i]));
            let z = Math.max(ARENA.baseZ - 0.5, this.z[i]);
            // A match's field ends behind the blues' buildings too.
            if (this.duel) z = Math.min(-ARENA.dangerZ, z);
            // Flying: over the blocks, houses, spinners and pushers.
            if (this.fly[i]) {
                this.x[i] = x;
                this.z[i] = z;
                continue;
            }
            for (let b = 0; b < this.blocks.length; b++) {
                const block = this.blocks[b];
                // Out the way that keeps it on the field (else the field's side pushes it back in, each step: stuck).
                if (!block.alive || (block.redOnly && this.team[i] === BLUE) || !touch(block.shape, x, z, r, this.contactOut, wallX)) continue;
                if (block.breakable && this.hitBreakable(i, b, dt)) break;
                x = this.contactOut.x;
                z = this.contactOut.z;
            }
            if (this.dead[i]) continue;
            const blue = this.team[i] === BLUE;
            // Houses: solid to reds and giants (plain blues walking in are taken in: feedPads), unless the settings have
            // them walk over (ui/settings.json housesBlockReds).
            if (SETTINGS.housesBlockReds && (!blue || this.big[i] || this.hasRedPads)) {
                for (const pad of this.pads) {
                    if (!this.padBlocks(pad, blue, !!this.big[i])) continue;
                    // Only where there's a way round it for one this size (else it'd wedge there: it walks through).
                    if (!this.passable(pad, r)) continue;
                    [x, z] = this.outOfBox(x, z, r, pad.x, pad.z, pad.width / 2, pad.depth / 2);
                }
            }
            // PUSH blocks: solid to everyone; a mob pressing the face its side pushes counts towards the shove.
            for (const block of this.pushBlocks) {
                if (!block.alive) continue;
                const [nx, nz] = this.outOfBox(x, z, r, block.x, block.nowZ, block.width / 2, block.depth / 2);
                if (nz !== z) {
                    const weight = this.big[i] ? TUNING.pushGiantWeight * (this.big[i] === TRUCK ? 1.5 : 1) : 1;
                    if (blue && nz > block.nowZ) block.blues += weight;
                    else if (!blue && nz < block.nowZ) block.reds += weight;
                    if (blue ? nz > block.nowZ : nz < block.nowZ) {
                        // Pressing it: it soaks up the push.
                        this.vz[i] = 0;
                    }
                }
                x = nx;
                z = nz;
            }
            for (const pusher of this.pushers) {
                const [nx, nz] = this.outOfBox(x, z, r, pusher.nowX, pusher.z, pusher.width / 2, pusher.depth / 2);
                if (nx !== x || nz !== z) {
                    // Carried along with the bar, and knocked the way it's going.
                    this.vx[i] += pusher.speedX * 0.6 + Math.sign(nx - x) * shove * 0.4;
                    this.vz[i] += Math.sign(nz - z) * shove * 0.4;
                    x = nx;
                    z = nz;
                }
            }
            for (let k = 0; k < this.spinners.length; k++) {
                const spinner = this.spinners[k];
                // Out of reach of the whole spinner (its centre further than an arm's length and the touch): no arm can
                // reach it (a little spare, so rounding never skips one that would).
                const far = spinner.length + arm + r + 0.01;
                const cx = x - spinner.x;
                const cz = z - spinner.z;
                if (cx * cx + cz * cz > far * far) continue;
                const { ax: armX, az: armZ } = this.spinArms[k];
                for (let a = 0; a < spinner.arms; a++) {
                    const ax = armX[a];
                    const az = armZ[a];
                    // Closest point on the arm (centre to tip) to the mob.
                    const along = Math.max(0, Math.min(spinner.length, (x - spinner.x) * ax + (z - spinner.z) * az));
                    const px = spinner.x + ax * along;
                    const pz = spinner.z + az * along;
                    const ox = x - px;
                    const oz = z - pz;
                    const reach = arm + r;
                    const d2 = ox * ox + oz * oz;
                    if (d2 >= reach * reach) continue;
                    const d = Math.sqrt(d2) || 1e-3;
                    x = px + (ox / d) * reach;
                    z = pz + (oz / d) * reach;
                    // The bar's own speed there (it turns), plus a knock away from it.
                    const tangential = spinner.speed * Math.PI * 2 * along;
                    this.vx[i] += (az * tangential + (ox / d) * shove) * 0.5;
                    this.vz[i] += (-ax * tangential + (oz / d) * shove) * 0.5;
                }
            }
            this.x[i] = x;
            this.z[i] = z;
        }
    }

    /**
     * Mob i against breakable b: a plain mob is spent and takes one hit off it; a giant takes one every
     * TUNING.giantChipSeconds, losing one of its own. Returns whether mob i is gone (nothing more to do for it).
     */
    private hitBreakable(i: number, b: number, dt: number): boolean {
        const block = this.blocks[b];
        if (this.big[i]) {
            this.chip[i] -= dt;
            if (this.chip[i] > 0) return false;
            this.chip[i] = TUNING.giantChipSeconds;
            // A car chips without wearing out.
            if (this.big[i] !== CAR) this.hp[i] -= 1;
            if (this.hp[i] <= 0) this.dead[i] = 1;
        } else {
            this.dead[i] = 1;
        }
        block.hp -= this.attackOf(i);
        this.events.blockHit?.(b, block.hp, this.x[i], this.z[i]);
        if (block.hp <= 0) {
            block.alive = false;
            if (block.gate !== undefined) {
                this.gates[block.gate].locked = false;
                this.gates[block.gate].swingFrom = this.time;
                this.events.gateUnlocked?.(block.gate, b);
            } else {
                this.events.blockBroken?.(b);
            }
        }
        return !!this.dead[i];
    }

    /** (x, z) pushed out of a box (centre bx, bz; half sizes hw, hd) grown by r, along the shortest way. */
    private outOfBox(x: number, z: number, r: number, bx: number, bz: number, hw: number, hd: number): [number, number] {
        const ox = x - bx;
        const oz = z - bz;
        const px = hw + r - Math.abs(ox);
        const pz = hd + r - Math.abs(oz);
        if (px <= 0 || pz <= 0) return [x, z];
        if (px < pz) return [bx + Math.sign(ox || 1) * (hw + r), z];
        return [x, bz + Math.sign(oz || 1) * (hd + r)];
    }

    // ------------------------------------------------------------------ contact

    /** A blue and a red touching: a plain mob is gone at once, a giant loses a hit. */
    private contact(i: number, j: number): void {
        const x = (this.x[i] + this.x[j]) / 2;
        const z = (this.z[i] + this.z[j]) / 2;
        const big = !!(this.big[i] || this.big[j]);
        // Each takes the other's hit (a viking hat's is bigger).
        const fromJ = this.attackOf(j);
        this.hp[j] -= this.attackOf(i);
        this.hp[i] -= fromJ;
        if (this.hp[i] <= 0) this.dead[i] = 1;
        if (this.hp[j] <= 0) this.dead[j] = 1;
        // A giant's tally: the plain mob it just took out.
        if (this.big[i] && !this.big[j] && this.dead[j]) this.giantStats.blueKills++;
        if (this.big[j] && !this.big[i] && this.dead[i]) this.giantStats.redKills++;
        this.events.clash?.(x, z, big);
    }

    private fight(dt: number): void {
        // The whole grid (flySaucers searches it later this step), and one of the reds alone: a blue looks only for
        // reds, and in the thick of a crowd most of what's round it is other blues. Built the same way, the reds come
        // up in the same order as in the whole grid.
        this.buildGrid();
        this.redHead.fill(-1);
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.team[i] !== RED) continue;
            const c = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((this.x[i] - GRID_MIN_X) / CELL)));
            const r = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((this.z[i] - GRID_MIN_Z) / CELL)));
            const cell = r * GRID_COLS + c;
            this.redNext[i] = this.redHead[cell];
            this.redHead[cell] = i;
        }
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.team[i] !== BLUE) continue;
            const ri = this.radiusOf(i);
            const car = this.big[i] === CAR;
            // The reds round it (forNear's cells in its order, written out: this runs for every blue every step).
            const cells = this.reachCells(i) + 1;
            const c0 = Math.floor((this.x[i] - GRID_MIN_X) / CELL);
            const r0 = Math.floor((this.z[i] - GRID_MIN_Z) / CELL);
            search: for (let row = Math.max(0, r0 - cells); row <= r0 + cells && row < GRID_ROWS; row++) {
                for (let col = Math.max(0, c0 - cells); col <= c0 + cells && col < GRID_COLS; col++) {
                    for (let j = this.redHead[row * GRID_COLS + col]; j >= 0; j = this.redNext[j]) {
                        if (this.dead[j]) continue;
                        if (this.fly[i] !== this.fly[j] && !(this.fly[i] ? this.big[j] && this.big[j] !== CAR : this.big[i] && !car)) continue;
                        // A car reaches a little past its body (it's pushing them).
                        const reach = (ri + this.radiusOf(j)) * (car || this.big[j] === CAR ? 1.08 : 0.95);
                        const ox = this.x[i] - this.x[j];
                        const oz = this.z[i] - this.z[j];
                        if (ox * ox + oz * oz >= reach * reach) continue;
                        // A match's red car wears down the blues it touches (as a blue one does reds); two cars, each other.
                        if (car && this.big[j] === CAR) {
                            this.grind(j, dt);
                            this.grind(i, dt);
                        } else if (car) this.grind(j, dt);
                        else if (this.big[j] === CAR) this.grind(i, dt);
                        else this.contact(i, j);
                        // Gone: nothing more it can hit.
                        if (this.dead[i]) break search;
                    }
                }
            }
        }
    }

    /** A car wearing red j down: TUNING.carDps hits a second, gone at zero. */
    private grind(j: number, dt: number): void {
        this.hp[j] -= TUNING.carDps * dt;
        if (this.hp[j] > 0) return;
        this.dead[j] = 1;
        this.events.clash?.(this.x[j], this.z[j], !!this.big[j]);
    }

    /** Blues going through a barrier get what it gives, once each: a helmet (their hits times TUNING.helmetHp) or a
     *  viking hat (their damage times TUNING.vikingDamage). */
    private crossHelmets(): void {
        for (const barrier of this.helmets) {
            const half = barrier.width / 2;
            const attack = barrier.kind === 'attack';
            const worn = attack ? this.viking : this.helmet;
            // A red one (an arena match's): for reds crossing it on their way down.
            const red = barrier.team === 'red';
            const team = red ? RED : BLUE;
            for (let i = 0; i < this.count; i++) {
                // (Not a card's character: it has no helmet or hat to wear.)
                if (this.dead[i] || this.team[i] !== team || worn[i] || this.big[i] === CAR || this.look[i] !== LOOK.mob) continue;
                const crossed = red ? this.prevZ[i] < barrier.z && this.z[i] >= barrier.z : this.prevZ[i] > barrier.z && this.z[i] <= barrier.z;
                if (!crossed || Math.abs(this.x[i] - barrier.x) > half) continue;
                worn[i] = 1;
                if (!attack) this.hp[i] *= TUNING.helmetHp;
                this.events.helmet?.(this.x[i], this.z[i], attack ? 'attack' : 'hp');
            }
        }
    }

    /** Mobs touching a grinder: a plain one's gone, a giant or a truck wears down; the car and the saucers aren't hurt. */
    private useGrinders(dt: number): void {
        if (!this.grinders.length) return;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.leaving[i] > 0 || this.big[i] === CAR || this.fly[i]) continue;
            const r = this.radiusOf(i) * 0.7;
            for (const grinder of this.grinders) {
                const across = grinder.axis === 'x' ? grinder.length / 2 : grinder.thickness / 2;
                const along = grinder.axis === 'x' ? grinder.thickness / 2 : grinder.length / 2;
                if (Math.abs(this.x[i] - grinder.nowX) > across + r || Math.abs(this.z[i] - grinder.nowZ) > along + r) continue;
                if (this.big[i] === PLAIN) {
                    this.dead[i] = 1;
                } else {
                    this.hp[i] -= TUNING.grinderDps * dt;
                    if (this.hp[i] <= 0) this.dead[i] = 1;
                }
                if (this.dead[i]) this.events.ground?.(this.x[i], this.z[i], this.team[i], this.big[i] !== PLAIN);
                break;
            }
        }
    }

    /**
     * The pipes: plain mobs walking into an opening are taken in (off the field till they come out of the other end);
     * anything walking into an end's elbow slides round it; and those due come out, a little in front of their
     * opening, carrying on.
     */
    private usePipes(dt: number): void {
        if (!this.pipes.length) return;
        this.stepDt = dt;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.leaving[i] > 0 || this.fly[i]) continue;
            const plain = this.big[i] === PLAIN;
            // Blues walk up the field (-z), reds down it: each goes into the openings facing it.
            const travel = this.team[i] === BLUE ? -1 : 1;
            for (let p = 0; p < this.pipes.length && !this.dead[i]; p++) {
                const pipe = this.pipes[p];
                for (let e = 0; e < 2; e++) {
                    const end = pipe.ends[e];
                    const across = this.x[i] - end.x;
                    // How far in front of the opening (negative: behind it, in the elbow).
                    const ahead = (this.z[i] - end.z) * end.facing;
                    const r = this.bodyOf(i);
                    const allowed = pipe.team === undefined || pipe.team === 'both' || (pipe.team === 'blue') === (this.team[i] === BLUE);
                    const goingIn = plain && allowed && travel === -end.facing;
                    if (!goingIn && Math.abs(across) < PIPE.radius + r + 0.2) {
                        // Not for it: the end is solid, opening and all. Steering round it as it comes, out sideways
                        // once at it (so it slides past, never stuck pushing on it).
                        const side = across >= 0 ? 1 : -1;
                        const before = travel === -end.facing ? ahead - PIPE.radius : -ahead - PIPE.body;
                        // Pushed out only if it's actually in it: the steering band's extra beside it would pull one leaving
                        // sideways back against it every step, and pinned there it can't get round whatever's past it.
                        if (ahead > -PIPE.body - r && ahead < PIPE.radius + r) {
                            if (Math.abs(across) < PIPE.radius + r) this.x[i] = end.x + side * (PIPE.radius + r + 0.02);
                            continue;
                        }
                        if (before > 0 && before < PIPE.steer) this.x[i] += side * PIPE.steerSpeed * this.stepDt * (1 - before / PIPE.steer);
                        continue;
                    }
                    if (ahead < -0.25 && ahead > -PIPE.body - r && Math.abs(across) < PIPE.radius + r) {
                        // In the elbow (from behind it or its side): out sideways, so it slides round and carries on
                        // (pushed back the way it came, it would walk into it again and again).
                        this.x[i] = end.x + (across >= 0 ? 1 : -1) * (PIPE.radius + r + 0.02);
                        continue;
                    }
                    // In: walking into the opening, anywhere across the way in (a little wider than the pipe).
                    if (goingIn && ahead >= -0.25 && ahead < PIPE.radius && Math.abs(across) < PIPE.mouth) {
                        this.inPipes.push({ due: this.time + pipe.seconds, pipe: p, end: 1 - e, team: this.team[i], hp: this.hp[i], helmet: this.helmet[i], viking: this.viking[i], crossed: this.gatesCrossed[i] });
                        this.dead[i] = 1;
                        this.events.pipeIn?.(p, e, this.team[i]);
                        break;
                    }
                }
            }
        }
        if (!this.inPipes.length) return;
        this.inPipes = this.inPipes.filter((mob) => {
            if (mob.due > this.time) return true;
            const end = this.pipes[mob.pipe].ends[mob.end];
            const j = this.add(mob.team, end.x + (Math.random() - 0.5) * PIPE.radius * 0.6, end.z + end.facing * (PIPE.radius + TUNING.radius + 0.1), mob.crossed);
            // The field's full: it waits in the pipe.
            if (j < 0) return true;
            this.hp[j] = mob.hp;
            this.helmet[j] = mob.helmet;
            this.viking[j] = mob.viking;
            this.heading[j] = end.facing > 0 ? Math.PI : 0;
            this.events.pipeOut?.(mob.pipe, mob.end, mob.team);
            return false;
        });
    }

    /** The damage mob i does with a hit: 1, times TUNING.vikingDamage with a viking hat. */
    private attackOf(i: number): number {
        if (this.look[i] === LOOK.turtle) return this.unitDamage[i] || 3;
        return this.viking[i] ? TUNING.vikingDamage : 1;
    }

    private crossGates(): void {
        const before = this.count;
        for (let g = 0; g < this.gates.length; g++) {
            const gate = this.gates[g];
            if (gate.locked) continue;
            const bit = 1 << g;
            const half = gate.width / 2;
            // A red one (an arena match's): it multiplies reds crossing it on their way down.
            const red = gate.team === 'red';
            const team = red ? RED : BLUE;
            const back = red ? -1 : 1;
            for (let i = 0; i < before; i++) {
                if (this.dead[i] || this.team[i] !== team || this.gatesCrossed[i] & bit) continue;
                if (red ? !(this.prevZ[i] < gate.z && this.z[i] >= gate.z) : !(this.prevZ[i] > gate.z && this.z[i] <= gate.z)) continue;
                if (Math.abs(this.x[i] - gate.nowX) > half) continue;
                this.gatesCrossed[i] |= bit;
                const crossed = this.gatesCrossed[i];
                let made = 0;
                // The copies, spread across and a little behind the one that crossed (inside the gate's span).
                for (let k = 1; k < gate.value; k++) {
                    const side = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
                    const cx = Math.max(gate.nowX - half, Math.min(gate.nowX + half, this.x[i] + side * GATE_SPREAD + (Math.random() - 0.5) * 0.1));
                    const j = this.add(team, cx, this.z[i] + back * Math.random() * GATE_DEPTH, crossed);
                    if (j < 0) break;
                    // A copy of a helmeted mob wears one too (and a viking hat).
                    if (this.helmet[i]) {
                        this.helmet[j] = 1;
                        this.hp[j] = TUNING.helmetHp;
                    }
                    this.viking[j] = this.viking[i];
                    this.vz[j] = this.vz[i];
                    this.prevZ[j] = gate.z - back * 0.01;
                    made++;
                }
                if (made) this.events.gate?.(g, this.x[i], gate.z, made);
            }
        }
    }

    /** Plain blues walking into a house are taken in; each `need` of them comes out its far door as a giant. */
    private feedPads(): void {
        const reach = TUNING.radius * 0.6;
        this.pads.forEach((pad, p) => {
            const hw = pad.width / 2 + reach;
            const hd = pad.depth / 2 + reach;
            // A red one (an arena match's): reds walk in, its units come out of its near side, down the field.
            const team = pad.team === 'red' ? RED : BLUE;
            const out = team === RED ? 1 : -1;
            let fed = false;
            for (let i = 0; i < this.count; i++) {
                // Only the crowd's own mobs feed a house (a card's skeletons walk past it).
                if (this.dead[i] || this.team[i] !== team || this.big[i] || this.look[i] !== LOOK.mob) continue;
                if (Math.abs(this.x[i] - pad.x) > hw || Math.abs(this.z[i] - pad.z) > hd) continue;
                this.dead[i] = 1;
                pad.count++;
                fed = true;
                if (pad.count >= pad.need) {
                    pad.count -= pad.need;
                    const kind = pad.kind ?? 'giant';
                    if (kind === 'saucer') {
                        const target = team === RED ? this.mainOf(this.blueTargets) : this.mainTarget();
                        if (target >= 0) {
                            this.saucers.push({ x: pad.x, z: pad.z + out * hd, target, alive: true, age: 0, sucked: 0, ...(team === RED ? { team } : {}) });
                            this.events.giant?.(team, pad.x, pad.z + out * hd, -1);
                        }
                    } else {
                        const mob = kind === 'car' ? CAR : GIANT;
                        const size = TUNING.radius * (mob === CAR ? TUNING.carScale : TUNING.giantScale);
                        const gz = team === RED ? pad.z + hd + size : pad.z - hd - size;
                        // Out somewhere along its far side (not all on one spot: they'd pile up on whatever is in front).
                        const radius = TUNING.radius * (mob === CAR ? TUNING.carScale : TUNING.giantScale);
                        const spread = Math.max(0, pad.width / 2 - radius * 0.5);
                        const gx = pad.x + (Math.random() * 2 - 1) * spread;
                        const jz = gz + out * Math.random() * SPAWN_JITTER;
                        const j = this.add(team, gx, jz, ALL_GATES, mob);
                        if (j >= 0) {
                            // A bomb: the bomb card's unit (its look, its pace), with the house's hits and blast.
                            const bomb = kind === 'bomb' ? CHARACTER_CARDS.bomb : undefined;
                            if (bomb) {
                                this.look[j] = bomb.look;
                                this.speedMul[j] = bomb.speed;
                                this.hp[j] = UNITS.bomb.hp ?? this.hp[j];
                                this.unitDamage[j] = UNITS.bomb.damage;
                            }
                            this.events.giant?.(team, gx, jz, mob, bomb ? 'bomb' : undefined);
                        }
                    }
                }
            }
            if (fed) this.events.pad?.(p, pad.count);
        });
    }

    private hitBase(): void {
        if (this.state === 'lost') return;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.team[i] !== BLUE) continue;
            const r = this.radiusOf(i);
            for (let k = 0; k < this.targets.length; k++) {
                const target = this.targets[k];
                if (!target.alive || target.shielded || this.z[i] - r > target.z + 0.15 || Math.abs(this.x[i] - target.x) > target.halfWidth + r) continue;
                if (target.kind === 'cannon' && this.z[i] + r < target.z - CANNON_DEPTH) continue;
                this.dead[i] = 1;
                if (this.look[i] === LOOK.turtle) {
                    this.events.vanish?.(this.x[i], this.z[i], this.team[i]);
                    break;
                }
                const kind = this.big[i];
                const most = this.unitDamage[i] || (kind === TRUCK ? TUNING.truckDamage : kind === CAR ? TUNING.carDamage : TUNING.giantDamage);
                const damage = (kind ? Math.min(most, Math.ceil(this.hp[i])) : this.unitDamage[i] || 1) * this.attackOf(i);
                this.damageTarget(k, damage, this.x[i], this.z[i], kind !== PLAIN);
                break;
            }
        }
        if (this.duel) this.hitOwn();
    }

    /** The damage mob i does to a building it reaches: 1 for a plain one; a big one's most, as far as its hits go. */
    private impactOf(i: number): number {
        const kind = this.big[i];
        const most = this.unitDamage[i] || (kind === TRUCK ? TUNING.truckDamage : kind === CAR ? TUNING.carDamage : TUNING.giantDamage);
        return (kind ? Math.min(most, Math.ceil(this.hp[i])) : this.unitDamage[i] || 1) * this.attackOf(i);
    }

    /**
     * An arena match: reds reaching the blues' buildings (their front, across their width), and anything that's got
     * past the buildings' line at either end (between two of them) hits the nearest one standing there.
     */
    private hitOwn(): void {
        if (this.state !== 'playing') return;
        const behind = -ARENA.dangerZ - 0.4;
        // A side down to its cannon: a mob past its line missed it, and is gone.
        const blueCannon = this.openCannon(this.blueTargets);
        const redCannon = this.openCannon(this.targets);
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.leaving[i] > 0) continue;
            const r = this.radiusOf(i);
            const x = this.x[i];
            const z = this.z[i];
            const red = this.team[i] === RED;
            if (red ? blueCannon && z - r > blueCannon.z + CANNON_DEPTH : redCannon && z + r < redCannon.z - CANNON_DEPTH) {
                this.dead[i] = 1;
                this.events.vanish?.(x, z, this.team[i]);
                continue;
            }
            if (red) {
                let k = this.blueTargets.findIndex((target) => target.alive && !target.shielded && z + r >= target.z - 0.15 && Math.abs(x - target.x) <= target.halfWidth + r
                    && (target.kind !== 'cannon' || z - r <= target.z + CANNON_DEPTH));
                if (k < 0 && z >= behind) k = this.blueTargets.indexOf(this.nearestOf(this.blueTargets, x, true)!);
                if (k < 0) continue;
                this.dead[i] = 1;
                if (this.look[i] === LOOK.turtle) this.events.vanish?.(x, z, this.team[i]);
                else this.damageOwn(k, this.impactOf(i), x, z, this.big[i] !== PLAIN);
            } else if (z <= this.mirrorZ(behind)) {
                const k = this.targets.indexOf(this.nearestOf(this.targets, x, true)!);
                if (k < 0) continue;
                this.dead[i] = 1;
                if (this.look[i] === LOOK.turtle) this.events.vanish?.(x, z, this.team[i]);
                else this.damageTarget(k, this.impactOf(i), x, z, this.big[i] !== PLAIN);
            }
        }
    }

    /** An arena match: the blues' building k takes `damage`; their cannon, or the last of them, falling loses. */
    private damageOwn(k: number, damage: number, x: number, z: number, special: boolean): void {
        const target = this.blueTargets[k];
        if (!target.alive || target.shielded) return;
        target.hp = Math.max(0, target.hp - damage);
        this.events.ownHit?.(x, z, this.ownHp, damage, k, special);
        if (target.hp > 0) return;
        target.alive = false;
        this.events.ownDown?.(k);
        this.shield();
        if (this.state === 'playing' && (target.kind === 'cannon' || this.blueTargets.every((other) => !other.alive))) {
            this.state = 'lost';
            this.events.lost?.();
        }
    }

    /** An arena match's clock: at the end, the side with more life left wins (the same: a draw). */
    private checkDuel(): void {
        this.danger = 0;
        if (this.state !== 'playing' || this.time < this.duel!.seconds) return;
        const own = this.ownHp;
        const theirs = this.baseHp;
        this.timedOut = true;
        this.state = own > theirs ? 'won' : own < theirs ? 'lost' : 'draw';
        // The side behind is beaten: its cannon's life runs out (the bars read it).
        if (this.state !== 'draw') {
            for (const target of this.state === 'won' ? this.targets : this.blueTargets) {
                if (target.kind !== 'cannon') continue;
                target.hp = 0;
                target.alive = false;
            }
        }
        if (this.state === 'won') this.events.won?.();
        else if (this.state === 'lost') this.events.lost?.();
        else this.events.draw?.();
    }

    /** `list`'s cannon, if it's all that stands (its towers down): the last tower. */
    private openCannon(list: readonly Target[]): Target | undefined {
        let cannon: Target | undefined;
        for (const target of list) {
            if (!target.alive) continue;
            if (target.kind !== 'cannon') return undefined;
            cannon = target;
        }
        return cannon;
    }

    /** The standing building in `list` nearest x, if any (`towers`: not a cannon). */
    private nearestOf(list: readonly Target[], x: number, towers = false): Target | undefined {
        let best: Target | undefined;
        for (const target of list) {
            if (towers && target.kind === 'cannon') continue;
            if (target.alive && !target.shielded && (!best || Math.abs(target.x - x) < Math.abs(best.x - x))) best = target;
        }
        return best;
    }

    /** Target k takes `damage` (hit at x, z): falls at zero, and the battle's won when they all have. */
    private damageTarget(k: number, damage: number, x: number, z: number, special: boolean): void {
        const target = this.targets[k];
        if (!target.alive || target.shielded) return;
        target.hp = Math.max(0, target.hp - damage);
        this.events.baseHit?.(x, z, this.baseHp, damage, k, special);
        if (target.hp > 0) return;
        target.alive = false;
        this.events.targetDown?.(k);
        if (this.duel) this.shield();
        // (A match: their cannon falling is enough.)
        if (this.state === 'playing' && ((this.duel && target.kind === 'cannon') || this.targets.every((other) => !other.alive))) {
            this.state = 'won';
            this.events.won?.();
        }
    }

    /** The enemy's main building: the standing target that started with the most hits (-1 if none stands). */
    private mainTarget(): number {
        return this.mainOf(this.targets);
    }

    /** The standing building in `list` that started with the most hits (-1 if none stands). */
    private mainOf(list: readonly Target[]): number {
        let best = -1;
        list.forEach((target, k) => {
            if (target.alive && !target.shielded && (best < 0 || target.hpMax > list[best].hpMax)) best = k;
        });
        return best;
    }

    /** Saucers fly straight at their building (a new one if theirs fell), sucking up plain reds under them, and crash in. */
    private flySaucers(dt: number): void {
        const reach = TUNING.saucerSuck;
        for (const saucer of this.saucers) {
            if (!saucer.alive) continue;
            saucer.age += dt;
            // A red one (an arena match's) is after the blues' buildings, and sucks up blues.
            const red = saucer.team === RED;
            const list = red ? this.blueTargets : this.targets;
            if (!list[saucer.target]?.alive) saucer.target = this.mainOf(list);
            const target = list[saucer.target];
            if (!target) {
                saucer.alive = false;
                continue;
            }
            const tz = target.z + (red ? 1 : -1);
            const dx = target.x - saucer.x;
            const dz = tz - saucer.z;
            const distance = Math.hypot(dx, dz);
            const step = TUNING.saucerSpeed * dt;
            if (distance <= step) {
                saucer.alive = false;
                if (red) {
                    this.damageOwn(saucer.target, saucer.damage ?? TUNING.saucerDamage, target.x, target.z, true);
                    continue;
                }
                this.events.saucerHit?.(saucer.target, target.x, target.z);
                this.damageTarget(saucer.target, saucer.damage ?? TUNING.saucerDamage, target.x, target.z, true);
                continue;
            }
            saucer.x += (dx / distance) * step;
            saucer.z += (dz / distance) * step;
            const prey = red ? BLUE : RED;
            this.forNear(saucer.x, saucer.z, Math.ceil(reach / CELL), (j) => {
                if (this.team[j] !== prey || this.big[j] || this.dead[j]) return;
                if (Math.hypot(this.x[j] - saucer.x, this.z[j] - saucer.z) > reach) return;
                this.dead[j] = 1;
                saucer.sucked++;
                this.events.suck?.(this.x[j], this.z[j]);
            });
        }
        for (let s = this.saucers.length - 1; s >= 0; s--) if (!this.saucers[s].alive) this.saucers.splice(s, 1);
    }

    private checkBreakthrough(): void {
        let nearest = -Infinity;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.team[i] !== RED) continue;
            if (this.z[i] > nearest) nearest = this.z[i];
            if (this.state === 'playing' && this.z[i] >= ARENA.dangerZ) {
                this.state = 'lost';
                this.events.lost?.();
            }
        }
        // 0 while every red is past halfway up the field, 1 at the line.
        this.danger = nearest === -Infinity ? 0 : Math.max(0, Math.min(1, 1 - (ARENA.dangerZ - nearest) / (-ARENA.baseZ / 2)));
    }

    /** Dead mobs out: the last live one moves into each hole. */
    private compact(): void {
        let i = 0;
        while (i < this.count) {
            if (!this.dead[i]) {
                i++;
                continue;
            }
            const last = --this.count;
            if (i !== last) this.copy(last, i);
            this.dead[last] = 0;
        }
    }

    private copy(from: number, to: number): void {
        this.x[to] = this.x[from];
        this.z[to] = this.z[from];
        this.heading[to] = this.heading[from];
        this.team[to] = this.team[from];
        this.big[to] = this.big[from];
        this.hp[to] = this.hp[from];
        this.age[to] = this.age[from];
        this.phase[to] = this.phase[from];
        this.helmet[to] = this.helmet[from];
        this.viking[to] = this.viking[from];
        this.leaving[to] = this.leaving[from];
        this.gatesCrossed[to] = this.gatesCrossed[from];
        this.dead[to] = this.dead[from];
        this.prevZ[to] = this.prevZ[from];
        this.vx[to] = this.vx[from];
        this.vz[to] = this.vz[from];
        this.slideX[to] = this.slideX[from];
        this.slideZ[to] = this.slideZ[from];
        this.slideFor[to] = this.slideFor[from];
        this.stuckFor[to] = this.stuckFor[from];
        this.lastX[to] = this.lastX[from];
        this.lastZ[to] = this.lastZ[from];
        this.lane[to] = this.lane[from];
        this.chip[to] = this.chip[from];
        this.unitDamage[to] = this.unitDamage[from];
        this.look[to] = this.look[from];
        this.speedMul[to] = this.speedMul[from];
        this.fly[to] = this.fly[from];
        this.tint[to] = this.tint[from];
    }
}
