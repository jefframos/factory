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
// - A blue crossing a helmet barrier gets a helmet (once): its hits times TUNING.helmetHp; copies a gate makes of it
//   wear one too.
// - A car can't be destroyed: it wears down the reds it touches (TUNING.carDps), pushed back by the crowd meanwhile.
// - A blue crossing a gate's line inside its span becomes `value` mobs, spread round it; each mob remembers the gates it
//   has crossed (a bit each), and so do its copies, so a gate never multiplies the same crowd twice. Giants don't use
//   gates.
// - A house takes in the plain blues that walk into it; every `need` of them makes what it makes (a giant, a truck, or
//   a gold saucer), out of its far side. Reds and giants go round it. A saucer isn't a mob: it flies over everything
//   to the enemy's main building, sucking up the plain reds it passes over, and crashes into it.
// - A PUSH block fills a lane: blues pressing its near face push it up the field, reds pressing its far face push it
//   back, the side with more mobs on it winning (TUNING.push*). Shoved out at either end, it drops away.
// - A blue reaching a target takes one HP off it (a giant, TUNING.giantDamage); blues head for the nearest one still
//   standing. Every target down: won. A red past the danger line: lost.
//
// Events (shots, hits, gate crossings, giants, the end) go to `events`, for the view's effects and the HUD.

import { ARENA, BattleConfig, GateConfig, HelmetConfig, ObstacleConfig, PadConfig, PushBlockConfig, PusherConfig, SpinnerConfig, TUNING, carHp, needOf } from '../data/MobConfig';
import { Contact, Shape, boxShape, circleShape, polygonShape, shapeCentre, touch } from './Shapes';

export const BLUE = 0;
export const RED = 1;

/** Room in the arrays (the population is capped lower, by TUNING.maxMobs). */
const CAPACITY = 1200;
/** The spatial grid: cell size (units) and the area it covers (a little past the field). */
const CELL = 0.7;
const GRID_MIN_X = -ARENA.halfWidth - 1;
const GRID_MIN_Z = ARENA.baseZ - 3;
const GRID_COLS = Math.ceil((ARENA.halfWidth * 2 + 2) / CELL);
const GRID_ROWS = Math.ceil((-GRID_MIN_Z + 2) / CELL);
/** Where blue mobs leave the cannon, and how wide the muzzle spreads them. */
const MUZZLE_Z = -1.1;
const MUZZLE_SPREAD = 0.35;
/** The usual base (a level with no `targets`): its half width. Reds come out of a target's front, this far out. */
export const BASE_HALF_WIDTH = 2.2;
const RED_SPAWN_OUT = 1.4;
/** Blues this close to the base (z) steer towards it, this hard. */
const HOMING_FROM = ARENA.baseZ + 10;
const HOMING_PULL = 0.45;
/** Reds fan out to lanes this far either side, drifting there this hard (share of the gap a unit). */
const RED_LANE_SPREAD = ARENA.halfWidth - 0.8;
const RED_LANE_PULL = 0.35;
/** How a gate spreads the copies it makes (units across, and back). */
const GATE_SPREAD = 0.34;
const GATE_DEPTH = 0.45;
/** How fast the cannon follows the aim (per second, of the distance). */
const CANNON_FOLLOW = 18;
/** How far (z) a unit a house makes may come out past its far side, at random (with a random x along it). */
const SPAWN_JITTER = 0.8;
/** The field clearing out after a battle: how long before the first mob goes (seconds), the spread over which they
 *  all go, and how long each one takes to shrink away. */
const CLEAR_OUT = { start: 0.5, spread: 1.6, seconds: 0.25 };
/** How far ahead a mob looks for a wall or hole (units), and how hard it turns away. */
const LOOK_AHEAD = 1.5;
const AVOID_TURN = 1.4;
/** Below this (the cosine between the way it wants to go and an edge), a mob meets a block head-on. */
const HEAD_ON = 0.35;
/** How far to the side a red steering round something moves its lane. */
const LANE_SHIFT = 2;
/** Every gate bit set: a giant never uses a gate. */
const ALL_GATES = 0xff;

export interface BattleEvents {
    fire?(x: number): void;
    gate?(gate: number, x: number, z: number, made: number): void;
    clash?(x: number, z: number, big: boolean): void;
    baseHit?(x: number, z: number, hpLeft: number, damage: number, target: number): void;
    /** A target fell (the battle's won once they all have). */
    targetDown?(target: number): void;
    pad?(pad: number, count: number): void;
    /** A PUSH block was pushed out at its far stop: the lane is open. */
    pushCleared?(block: number): void;
    blockHit?(block: number, hpLeft: number, x: number, z: number): void;
    blockBroken?(block: number): void;
    giant?(team: number, x: number, z: number, kind: number): void;
    /** A gold saucer sucked up a red at (x, z), and one crashed into target `target`. */
    suck?(x: number, z: number): void;
    /** A blue got a helmet at (x, z). */
    helmet?(x: number, z: number): void;
    saucerHit?(target: number, x: number, z: number): void;
    /** A mob vanished as the field cleared out after the battle. */
    vanish?(x: number, z: number, team: number): void;
    won?(): void;
    /** The cannon ran out of energy (it locks until full). */
    empty?(): void;
    lost?(): void;
}

export interface Gate extends GateConfig {
    /** Where it is now (it may swing). */
    nowX: number;
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
}

/** An enemy target as the battle has it: where its front is, its half width, its hits. */
export interface Target {
    x: number;
    z: number;
    halfWidth: number;
    hp: number;
    hpMax: number;
    alive: boolean;
}

/** An obstacle as the battle has it: its shape, and for a breakable, its hits left (gone at 0). */
export interface Block {
    config: ObstacleConfig;
    shape: Shape;
    breakable: boolean;
    hp: number;
    hpMax: number;
    alive: boolean;
    /** Where its middle is (its label, its pieces flying). */
    centreX: number;
    centreZ: number;
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
    /** Hits left (1 for a plain mob). */
    public readonly hp = new Float32Array(CAPACITY);
    /** Seconds since it appeared (the view pops new ones in), and its own step in the run cycle. */
    public readonly age = new Float32Array(CAPACITY);
    public readonly phase = new Float32Array(CAPACITY);
    /** 1 for a mob wearing a helmet (from a helmet barrier). */
    public readonly helmet = new Uint8Array(CAPACITY);
    /** Once the battle's over, how far each mob is through vanishing (0..1; the view shrinks it). */
    public readonly leaving = new Float32Array(CAPACITY);
    private readonly gatesCrossed = new Uint8Array(CAPACITY);
    private readonly dead = new Uint8Array(CAPACITY);
    private readonly prevZ = new Float32Array(CAPACITY);
    private readonly vx = new Float32Array(CAPACITY);
    private readonly vz = new Float32Array(CAPACITY);
    /** A red's lane: the x it drifts towards on its way down. */
    private readonly lane = new Float32Array(CAPACITY);
    /** A giant's time to its next chip at a breakable. */
    private readonly chip = new Float32Array(CAPACITY);
    private readonly contactOut: Contact = { x: 0, z: 0, nx: 0, nz: 0, tx: 0, tz: 0 };
    /** Mobs alive: indices 0 .. count-1. */
    public count = 0;

    private readonly cellHead = new Int32Array(GRID_COLS * GRID_ROWS);
    private readonly cellNext = new Int32Array(CAPACITY);

    public readonly gates: Gate[];
    public readonly blocks: Block[];
    public readonly spinners: readonly SpinnerConfig[];
    public readonly pushers: Pusher[];
    public readonly pads: Pad[];
    public readonly pushBlocks: PushBlock[];
    public readonly saucers: Saucer[] = [];
    public readonly helmets: readonly HelmetConfig[];
    public readonly targets: Target[];
    /** Where the player aims (x), and where the cannon is. */
    public aimX = 0;
    public cannonX = 0;
    public time = 0;
    /** 'playing' until the base falls ('won') or a red breaks through ('lost'). */
    public state: 'playing' | 'won' | 'lost' = 'playing';
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
    private idle = 0;
    /** How close the nearest red is to the danger line (0 far .. 1 on it): the view's warning. */
    public danger = 0;
    /** Giants this battle (made by pads or the base) and the mobs they took out: how much each one is worth. */
    public readonly giantStats = { blue: 0, blueKills: 0, red: 0, redKills: 0 };

    /** When the battle ended (its time; -1 while playing): the field clears out after it. */
    private endedAt = -1;
    private fireDue = 0;
    private redDue = 0;
    private redGiantDue = 0;

    public constructor(public readonly config: BattleConfig, public events: BattleEvents = {}) {
        this.gates = config.gates.map((gate) => ({ ...gate, nowX: gate.x }));
        this.helmets = config.helmets ?? [];
        this.blocks = (config.obstacles ?? []).map((o) => {
            const shape = obstacleShape(o);
            const [centreX, centreZ] = shapeCentre(shape);
            const breakable = o.kind === 'breakable';
            const hp = breakable ? o.hp ?? 40 : 0;
            return { config: o, shape, breakable, hp, hpMax: hp, alive: true, centreX, centreZ };
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
    }

    /** All the targets' HP left, and at the start. */
    public get baseHp(): number {
        return this.targets.reduce((sum, target) => sum + Math.max(0, target.hp), 0);
    }

    public get baseHpMax(): number {
        return this.targets.reduce((sum, target) => sum + target.hpMax, 0);
    }

    /** Debug: a blue giant, truck or gold saucer, as if a house had just made it (from the cannon). */
    public debugSpawn(kind: 'giant' | 'truck' | 'saucer' | 'car'): void {
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
        return TUNING.fireRate * (1 + TUNING.fireRatePerLevel * (this.fireLevel - 1));
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
        return this.time * spinner.speed * Math.PI * 2;
    }

    public radiusOf(i: number): number {
        const kind = this.big[i];
        return TUNING.radius * (kind === TRUCK ? TUNING.truckScale : kind === CAR ? TUNING.carScale : kind ? TUNING.giantScale : 1);
    }

    public step(dt: number): void {
        this.time += dt;
        this.cannonX += (this.aimX - this.cannonX) * Math.min(1, CANNON_FOLLOW * dt);
        for (const gate of this.gates) {
            gate.nowX = gate.x + (gate.swing ? Math.sin((this.time / gate.swing.seconds) * Math.PI * 2) * gate.swing.range : 0);
        }
        for (const pusher of this.pushers) {
            const angle = (this.time / pusher.seconds + (pusher.phase ?? 0)) * Math.PI * 2;
            pusher.nowX = pusher.x + Math.sin(angle) * pusher.range;
            pusher.speedX = Math.cos(angle) * pusher.range * ((Math.PI * 2) / pusher.seconds);
        }
        this.slidePushBlocks(dt);
        if (this.state === 'playing') {
            this.fire(dt);
            this.spawnReds(dt);
        }
        this.move(dt);
        this.collide(dt);
        this.fight(dt);
        this.crossHelmets();
        this.crossGates();
        this.feedPads();
        this.flySaucers(dt);
        this.hitBase();
        this.checkBreakthrough();
        this.clearOut(dt);
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
        this.hp[i] = kind === TRUCK ? TUNING.truckHp : kind === CAR ? carHp() : big ? (team === BLUE ? TUNING.blueGiantHp : TUNING.redGiantHp) : 1;
        this.helmet[i] = 0;
        this.chip[i] = 0;
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
        this.lane[i] = (Math.random() * 2 - 1) * RED_LANE_SPREAD;
        return i;
    }

    /** Shots the cannon holds, at its capacity level. */
    public get energyMax(): number {
        return TUNING.energyCapacity + TUNING.energyPerLevel * (this.capacityLevel - 1);
    }

    /** Seconds to recharge from empty, at its recharge level. */
    public get rechargeSeconds(): number {
        return Math.max(TUNING.rechargeMin, TUNING.rechargeSeconds - TUNING.rechargePerLevel * (this.rechargeLevel - 1));
    }

    private fire(dt: number): void {
        const max = this.energyMax;
        if (this.energy < 0) this.energy = max;
        const shooting = this.firing && !this.overheated && this.energy >= 1;
        if (!shooting) {
            // Recharging: straight away once it's run dry (and locked until full), else after a short pause.
            this.fireDue = 0;
            this.idle += dt;
            if (this.overheated || this.idle >= TUNING.rechargeDelay) this.energy = Math.min(max, this.energy + (max / this.rechargeSeconds) * dt);
            if (this.overheated && this.energy >= max) this.overheated = false;
            return;
        }
        this.idle = 0;
        this.fireDue += this.fireRate * dt;
        while (this.fireDue >= 1 && this.energy >= 1) {
            this.fireDue -= 1;
            this.energy -= 1;
            if (this.add(BLUE, this.cannonX + (Math.random() - 0.5) * MUZZLE_SPREAD, MUZZLE_Z, 0) >= 0) this.events.fire?.(this.cannonX);
        }
        if (this.energy < 1) {
            this.overheated = true;
            this.events.empty?.();
        }
    }

    /** Waves: reds come for TUNING.waveSeconds, then a TUNING.wavePause breather — at the same average rate. Giants on their own clock. */
    private spawnReds(dt: number): void {
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
    private slideAround(x: number, z: number, dx: number, dz: number, r: number, houses: boolean): Contact | null {
        const ahead = LOOK_AHEAD;
        const c = this.contactOut;
        let hit: Shape | null = null;
        for (const block of this.blocks) {
            if (!block.alive || block.breakable) continue;
            if (touch(block.shape, x + dx * ahead, z + dz * ahead, r, c)) {
                hit = block.shape;
                break;
            }
        }
        let open = 0;
        if (!hit && houses) {
            for (const pad of this.pads) {
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
        if (!hit) return null;
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
                for (const block of this.blocks) if (touch(block.shape, x, z, r, this.contactOut)) return false;
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
            if (blue && z < HOMING_FROM) {
                const target = this.nearestTarget(x);
                if (target) dx = Math.max(-0.9, Math.min(0.9, (target.x - x) * HOMING_PULL));
            }
            if (!blue) dx = Math.max(-0.8, Math.min(0.8, (this.lane[i] - x) * RED_LANE_PULL));
            let pushX = 0;
            let pushZ = 0;
            let nearestFoe = -1;
            let nearestDistance = seek * seek;
            this.forNear(x, z, this.reachCells(i), (j) => {
                if (j === i) return;
                const ox = x - this.x[j];
                const oz = z - this.z[j];
                const d2 = ox * ox + oz * oz;
                const space = radius + this.radiusOf(j);
                if (d2 < space * space && d2 > 1e-6) {
                    const d = Math.sqrt(d2);
                    // A giant barely gets pushed by plain mobs; they get pushed off it hard.
                    const weight = this.big[j] && !this.big[i] ? 2 : this.big[i] && !this.big[j] ? 0.25 : 1;
                    const strength = ((space - d) / space) * weight;
                    pushX += (ox / d) * strength;
                    pushZ += (oz / d) * strength;
                }
                if (!blue && this.team[j] === BLUE && d2 < nearestDistance) {
                    nearestDistance = d2;
                    nearestFoe = j;
                }
            });
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
            // A wall or hole ahead: slide along its edge instead (and a little away from it).
            const slide = this.slideAround(x, z, dx / length, dz / length, radius, !blue || !!this.big[i]);
            if (slide) {
                dx = slide.tx * AVOID_TURN + slide.nx * 0.35;
                dz = slide.tz * AVOID_TURN + slide.nz * 0.35;
                length = Math.sqrt(dx * dx + dz * dz) || 1;
                // A red steering round something takes the side it's going round as its lane: else the pull back to its
                // old lane (through the obstacle) drags it straight back in front of it, and it hovers there.
                if (!blue && Math.abs(slide.tx) > 0.3) this.lane[i] = Math.max(-RED_LANE_SPREAD, Math.min(RED_LANE_SPREAD, x + Math.sign(slide.tx) * LANE_SHIFT));
            }
            const kind = this.big[i];
            const speed = (blue ? TUNING.blueSpeed : TUNING.redSpeed) * (kind === TRUCK ? TUNING.truckSpeed : kind === CAR ? TUNING.carSpeed : kind ? TUNING.giantSpeed : 1);
            const targetVx = (dx / length) * speed + pushX * TUNING.separation;
            const targetVz = (dz / length) * speed + pushZ * TUNING.separation * 0.5;
            // A little inertia, so the crowd flows rather than jitters (and a shove carries on for a moment).
            const blend = Math.min(1, dt * 10);
            this.vx[i] += (targetVx - this.vx[i]) * blend;
            this.vz[i] += (targetVz - this.vz[i]) * blend;
            this.prevZ[i] = z;
            this.x[i] = x + this.vx[i] * dt;
            this.z[i] = z + this.vz[i] * dt;
            if (Math.abs(this.vx[i]) + Math.abs(this.vz[i]) > 0.2) {
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
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i]) continue;
            const r = this.radiusOf(i);
            const wallX = ARENA.halfWidth - r;
            let x = Math.max(-wallX, Math.min(wallX, this.x[i]));
            let z = Math.max(ARENA.baseZ - 0.5, this.z[i]);
            for (let b = 0; b < this.blocks.length; b++) {
                const block = this.blocks[b];
                if (!block.alive || !touch(block.shape, x, z, r, this.contactOut)) continue;
                if (block.breakable && this.hitBreakable(i, b, dt)) break;
                x = this.contactOut.x;
                z = this.contactOut.z;
            }
            if (this.dead[i]) continue;
            const blue = this.team[i] === BLUE;
            // Houses: solid to reds and giants (plain blues walking in are taken in: feedPads).
            if (!blue || this.big[i]) {
                for (const pad of this.pads) {
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
            for (const spinner of this.spinners) {
                const base = this.spinnerAngle(spinner);
                const arm = TUNING.radius * 0.9;
                for (let a = 0; a < spinner.arms; a++) {
                    const angle = base + (a / spinner.arms) * Math.PI * 2;
                    const ax = Math.sin(angle);
                    const az = Math.cos(angle);
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
        block.hp -= 1;
        this.events.blockHit?.(b, block.hp, this.x[i], this.z[i]);
        if (block.hp <= 0) {
            block.alive = false;
            this.events.blockBroken?.(b);
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
        this.hp[i] -= 1;
        this.hp[j] -= 1;
        if (this.hp[i] <= 0) this.dead[i] = 1;
        if (this.hp[j] <= 0) this.dead[j] = 1;
        // A giant's tally: the plain mob it just took out.
        if (this.big[i] && !this.big[j] && this.dead[j]) this.giantStats.blueKills++;
        if (this.big[j] && !this.big[i] && this.dead[i]) this.giantStats.redKills++;
        this.events.clash?.(x, z, big);
    }

    private fight(dt: number): void {
        this.buildGrid();
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.team[i] !== BLUE) continue;
            const ri = this.radiusOf(i);
            const car = this.big[i] === CAR;
            this.forNear(this.x[i], this.z[i], this.reachCells(i) + 1, (j) => {
                if (this.dead[i] || this.dead[j] || this.team[j] !== RED) return;
                // A car reaches a little past its body (it's pushing them).
                const reach = (ri + this.radiusOf(j)) * (car ? 1.08 : 0.95);
                const ox = this.x[i] - this.x[j];
                const oz = this.z[i] - this.z[j];
                if (ox * ox + oz * oz >= reach * reach) return;
                if (car) this.grind(j, dt);
                else this.contact(i, j);
            });
        }
    }

    /** A car wearing red j down: TUNING.carDps hits a second, gone at zero. */
    private grind(j: number, dt: number): void {
        this.hp[j] -= TUNING.carDps * dt;
        if (this.hp[j] > 0) return;
        this.dead[j] = 1;
        this.events.clash?.(this.x[j], this.z[j], !!this.big[j]);
    }

    /** Blues going through a helmet barrier (no helmet yet) get one: their hits times TUNING.helmetHp. */
    private crossHelmets(): void {
        for (const barrier of this.helmets) {
            const half = barrier.width / 2;
            for (let i = 0; i < this.count; i++) {
                if (this.dead[i] || this.team[i] !== BLUE || this.helmet[i] || this.big[i] === CAR) continue;
                if (!(this.prevZ[i] > barrier.z && this.z[i] <= barrier.z) || Math.abs(this.x[i] - barrier.x) > half) continue;
                this.helmet[i] = 1;
                this.hp[i] *= TUNING.helmetHp;
                this.events.helmet?.(this.x[i], this.z[i]);
            }
        }
    }

    private crossGates(): void {
        const before = this.count;
        for (let g = 0; g < this.gates.length; g++) {
            const gate = this.gates[g];
            const bit = 1 << g;
            const half = gate.width / 2;
            for (let i = 0; i < before; i++) {
                if (this.dead[i] || this.team[i] !== BLUE || this.gatesCrossed[i] & bit) continue;
                if (!(this.prevZ[i] > gate.z && this.z[i] <= gate.z)) continue;
                if (Math.abs(this.x[i] - gate.nowX) > half) continue;
                this.gatesCrossed[i] |= bit;
                const crossed = this.gatesCrossed[i];
                let made = 0;
                // The copies, spread across and a little behind the one that crossed (inside the gate's span).
                for (let k = 1; k < gate.value; k++) {
                    const side = (k % 2 === 1 ? 1 : -1) * Math.ceil(k / 2);
                    const cx = Math.max(gate.nowX - half, Math.min(gate.nowX + half, this.x[i] + side * GATE_SPREAD + (Math.random() - 0.5) * 0.1));
                    const j = this.add(BLUE, cx, this.z[i] + Math.random() * GATE_DEPTH, crossed);
                    if (j < 0) break;
                    // A copy of a helmeted mob wears one too.
                    if (this.helmet[i]) {
                        this.helmet[j] = 1;
                        this.hp[j] = TUNING.helmetHp;
                    }
                    this.vz[j] = this.vz[i];
                    this.prevZ[j] = gate.z - 0.01;
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
            let fed = false;
            for (let i = 0; i < this.count; i++) {
                if (this.dead[i] || this.team[i] !== BLUE || this.big[i]) continue;
                if (Math.abs(this.x[i] - pad.x) > hw || Math.abs(this.z[i] - pad.z) > hd) continue;
                this.dead[i] = 1;
                pad.count++;
                fed = true;
                if (pad.count >= pad.need) {
                    pad.count -= pad.need;
                    const kind = pad.kind ?? 'giant';
                    if (kind === 'saucer') {
                        const target = this.mainTarget();
                        if (target >= 0) {
                            this.saucers.push({ x: pad.x, z: pad.z - hd, target, alive: true, age: 0, sucked: 0 });
                            this.events.giant?.(BLUE, pad.x, pad.z - hd, -1);
                        }
                    } else {
                        const mob = kind === 'truck' ? TRUCK : kind === 'car' ? CAR : GIANT;
                        const gz = pad.z - hd - TUNING.radius * (mob === TRUCK ? TUNING.truckScale : mob === CAR ? TUNING.carScale : TUNING.giantScale);
                        // Out somewhere along its far side (not all on one spot: they'd pile up on whatever is in front).
                        const radius = TUNING.radius * (mob === TRUCK ? TUNING.truckScale : mob === CAR ? TUNING.carScale : TUNING.giantScale);
                        const spread = Math.max(0, pad.width / 2 - radius * 0.5);
                        const gx = pad.x + (Math.random() * 2 - 1) * spread;
                        const jz = gz - Math.random() * SPAWN_JITTER;
                        if (this.add(BLUE, gx, jz, ALL_GATES, mob) >= 0) this.events.giant?.(BLUE, gx, jz, mob);
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
                if (!target.alive || this.z[i] - r > target.z + 0.15 || Math.abs(this.x[i] - target.x) > target.halfWidth + r) continue;
                this.dead[i] = 1;
                const kind = this.big[i];
                const most = kind === TRUCK ? TUNING.truckDamage : kind === CAR ? TUNING.carDamage : TUNING.giantDamage;
                const damage = kind ? Math.min(most, Math.ceil(this.hp[i])) : 1;
                this.damageTarget(k, damage, this.x[i], this.z[i]);
                break;
            }
        }
    }

    /** Target k takes `damage` (hit at x, z): falls at zero, and the battle's won when they all have. */
    private damageTarget(k: number, damage: number, x: number, z: number): void {
        const target = this.targets[k];
        if (!target.alive) return;
        target.hp = Math.max(0, target.hp - damage);
        this.events.baseHit?.(x, z, this.baseHp, damage, k);
        if (target.hp > 0) return;
        target.alive = false;
        this.events.targetDown?.(k);
        if (this.state === 'playing' && this.targets.every((other) => !other.alive)) {
            this.state = 'won';
            this.events.won?.();
        }
    }

    /** The enemy's main building: the standing target that started with the most hits (-1 if none stands). */
    private mainTarget(): number {
        let best = -1;
        this.targets.forEach((target, k) => {
            if (target.alive && (best < 0 || target.hpMax > this.targets[best].hpMax)) best = k;
        });
        return best;
    }

    /** Saucers fly straight at their building (a new one if theirs fell), sucking up plain reds under them, and crash in. */
    private flySaucers(dt: number): void {
        const reach = TUNING.saucerSuck;
        for (const saucer of this.saucers) {
            if (!saucer.alive) continue;
            saucer.age += dt;
            if (!this.targets[saucer.target]?.alive) saucer.target = this.mainTarget();
            const target = this.targets[saucer.target];
            if (!target) {
                saucer.alive = false;
                continue;
            }
            const tz = target.z - 1;
            const dx = target.x - saucer.x;
            const dz = tz - saucer.z;
            const distance = Math.hypot(dx, dz);
            const step = TUNING.saucerSpeed * dt;
            if (distance <= step) {
                saucer.alive = false;
                this.events.saucerHit?.(saucer.target, target.x, target.z);
                this.damageTarget(saucer.target, TUNING.saucerDamage, target.x, target.z);
                continue;
            }
            saucer.x += (dx / distance) * step;
            saucer.z += (dz / distance) * step;
            this.forNear(saucer.x, saucer.z, Math.ceil(reach / CELL), (j) => {
                if (this.team[j] !== RED || this.big[j] || this.dead[j]) return;
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
        this.leaving[to] = this.leaving[from];
        this.gatesCrossed[to] = this.gatesCrossed[from];
        this.dead[to] = this.dead[from];
        this.prevZ[to] = this.prevZ[from];
        this.vx[to] = this.vx[from];
        this.vz[to] = this.vz[from];
        this.lane[to] = this.lane[from];
        this.chip[to] = this.chip[from];
    }
}
