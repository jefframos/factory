// Battle.ts
//
// One battle's rules, with no drawing (refs/mob's MVP, section 9): a 2D simulation on the X/Z plane, mobs in typed
// arrays (no rigid bodies, nothing allocated per frame), stepped at a fixed rate.
//
// - The cannon slides to where the player aims (`aimX`) and fires blue mobs forward (-Z) at its fire rate.
// - The enemy base, far up the field, sends red mobs down (+Z) in waves, faster as the battle goes on, until it falls;
//   each heads for its own lane across the field, so they come down the sides too, not only where the blues are.
// - Mobs keep apart with a cheap push from neighbours (a uniform spatial grid); a red runs at a blue near it.
// - A blue and a red that touch both go (the brief's "remove one blue and one red").
// - A blue crossing a gate's line inside its span becomes `value` mobs, spread round it; each mob remembers the gates it
//   has crossed (a bit each), and so do its copies, so a gate never multiplies the same crowd twice.
// - A blue reaching the base takes one HP off it; at zero: won. A red past the danger line: lost.
//
// Events (hits, gate crossings, the end) go to `events`, for the view's effects and the HUD.

import { ARENA, BattleConfig, GateConfig, TUNING } from '../data/MobConfig';

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
/** The base: its half width, and its middle (x). Reds come out of its front. */
export const BASE_HALF_WIDTH = 2.2;
export const BASE_X = 0;
const RED_SPAWN_Z = ARENA.baseZ + 1.4;
const RED_SPAWN_SPREAD = 3.2;
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

export interface BattleEvents {
    gate?(gate: number, x: number, z: number, made: number): void;
    clash?(x: number, z: number): void;
    baseHit?(x: number, z: number, hpLeft: number): void;
    won?(): void;
    lost?(): void;
}

export interface Gate extends GateConfig {
    /** Where it is now (it may swing). */
    nowX: number;
}

export class Battle {
    public readonly x = new Float32Array(CAPACITY);
    public readonly z = new Float32Array(CAPACITY);
    /** Facing (radians round Y, 0 = towards -Z), for the view. */
    public readonly heading = new Float32Array(CAPACITY);
    public readonly team = new Uint8Array(CAPACITY);
    /** Seconds since it appeared (the view pops new ones in), and its own step in the run cycle. */
    public readonly age = new Float32Array(CAPACITY);
    public readonly phase = new Float32Array(CAPACITY);
    private readonly gatesCrossed = new Uint8Array(CAPACITY);
    private readonly dead = new Uint8Array(CAPACITY);
    private readonly prevZ = new Float32Array(CAPACITY);
    private readonly vx = new Float32Array(CAPACITY);
    private readonly vz = new Float32Array(CAPACITY);
    /** A red's lane: the x it drifts towards on its way down (they fan out over the whole field). */
    private readonly lane = new Float32Array(CAPACITY);
    /** Mobs alive: indices 0 .. count-1. */
    public count = 0;

    private readonly cellHead = new Int32Array(GRID_COLS * GRID_ROWS);
    private readonly cellNext = new Int32Array(CAPACITY);

    public readonly gates: Gate[];
    public baseHp: number;
    public readonly baseHpMax: number;
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

    private fireDue = 0;
    private redDue = 0;

    public constructor(public readonly config: BattleConfig, public events: BattleEvents = {}) {
        this.gates = config.gates.map((gate) => ({ ...gate, nowX: gate.x }));
        this.baseHp = config.baseHp;
        this.baseHpMax = config.baseHp;
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

    public step(dt: number): void {
        this.time += dt;
        this.cannonX += (this.aimX - this.cannonX) * Math.min(1, CANNON_FOLLOW * dt);
        for (const gate of this.gates) {
            gate.nowX = gate.x + (gate.swing ? Math.sin((this.time / gate.swing.seconds) * Math.PI * 2) * gate.swing.range : 0);
        }
        if (this.state === 'playing') {
            this.fire(dt);
            this.spawnReds(dt);
        }
        this.move(dt);
        this.fight();
        this.crossGates();
        this.hitBase();
        this.checkBreakthrough();
        this.compact();
        if (this.count > this.peak) this.peak = this.count;
    }

    // ------------------------------------------------------------------ spawning

    private add(team: number, x: number, z: number, crossed: number): number {
        if (this.count >= Math.min(CAPACITY, TUNING.maxMobs)) return -1;
        const i = this.count++;
        this.x[i] = x;
        this.z[i] = z;
        this.prevZ[i] = z;
        this.team[i] = team;
        this.heading[i] = team === BLUE ? 0 : Math.PI;
        this.age[i] = 0;
        this.phase[i] = Math.random();
        this.gatesCrossed[i] = crossed;
        this.dead[i] = 0;
        this.vx[i] = 0;
        this.vz[i] = 0;
        this.lane[i] = (Math.random() * 2 - 1) * RED_LANE_SPREAD;
        return i;
    }

    private fire(dt: number): void {
        this.fireDue += this.fireRate * dt;
        while (this.fireDue >= 1) {
            this.fireDue -= 1;
            this.add(BLUE, this.cannonX + (Math.random() - 0.5) * MUZZLE_SPREAD, MUZZLE_Z, 0);
        }
    }

    /** Waves: reds come for TUNING.waveSeconds, then a TUNING.wavePause breather — at the same average rate. */
    private spawnReds(dt: number): void {
        const rate = this.redRate;
        if (rate <= 0) return;
        const cycle = TUNING.waveSeconds + TUNING.wavePause;
        const inWave = (this.time - TUNING.redDelay) % cycle < TUNING.waveSeconds;
        if (!inWave) return;
        this.redDue += rate * (cycle / TUNING.waveSeconds) * dt;
        while (this.redDue >= 1) {
            this.redDue -= 1;
            this.add(RED, BASE_X + (Math.random() - 0.5) * RED_SPAWN_SPREAD, RED_SPAWN_Z + Math.random() * 0.4, 0);
        }
    }

    // ------------------------------------------------------------------ movement

    private cellOf(x: number, z: number): number {
        const c = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((x - GRID_MIN_X) / CELL)));
        const r = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((z - GRID_MIN_Z) / CELL)));
        return r * GRID_COLS + c;
    }

    private buildGrid(): void {
        this.cellHead.fill(-1);
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i]) continue;
            const cell = this.cellOf(this.x[i], this.z[i]);
            this.cellNext[i] = this.cellHead[cell];
            this.cellHead[cell] = i;
        }
    }

    /** Calls `visit` for every live mob in the 3 x 3 cells round (x, z). */
    private forNear(x: number, z: number, visit: (j: number) => void): void {
        const c0 = Math.floor((x - GRID_MIN_X) / CELL);
        const r0 = Math.floor((z - GRID_MIN_Z) / CELL);
        for (let r = r0 - 1; r <= r0 + 1; r++) {
            if (r < 0 || r >= GRID_ROWS) continue;
            for (let c = c0 - 1; c <= c0 + 1; c++) {
                if (c < 0 || c >= GRID_COLS) continue;
                for (let j = this.cellHead[r * GRID_COLS + c]; j >= 0; j = this.cellNext[j]) if (!this.dead[j]) visit(j);
            }
        }
    }

    private move(dt: number): void {
        this.buildGrid();
        const radius = TUNING.radius;
        const space = radius * 2;
        const seek = TUNING.seekRange;
        const wallX = ARENA.halfWidth - radius;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i]) continue;
            this.age[i] += dt;
            const x = this.x[i];
            const z = this.z[i];
            const blue = this.team[i] === BLUE;
            // Where it wants to go.
            let dx = 0;
            let dz = blue ? -1 : 1;
            if (blue && z < HOMING_FROM) dx = Math.max(-0.9, Math.min(0.9, (BASE_X - x) * HOMING_PULL));
            if (!blue) dx = Math.max(-0.8, Math.min(0.8, (this.lane[i] - x) * RED_LANE_PULL));
            let pushX = 0;
            let pushZ = 0;
            let nearestBlue = -1;
            let nearestDistance = seek * seek;
            this.forNear(x, z, (j) => {
                if (j === i) return;
                const ox = x - this.x[j];
                const oz = z - this.z[j];
                const d2 = ox * ox + oz * oz;
                if (d2 < space * space && d2 > 1e-6) {
                    const d = Math.sqrt(d2);
                    const strength = (space - d) / space;
                    pushX += (ox / d) * strength;
                    pushZ += (oz / d) * strength;
                }
                if (!blue && this.team[j] === BLUE && d2 < nearestDistance) {
                    nearestDistance = d2;
                    nearestBlue = j;
                }
            });
            // A red runs at the nearest blue it can see (the grid only reaches a cell or so: far ones come by the
            // straight march).
            if (nearestBlue >= 0) {
                const tx = this.x[nearestBlue] - x;
                const tz = this.z[nearestBlue] - z;
                const d = Math.sqrt(tx * tx + tz * tz) || 1;
                dx += (tx / d) * 0.9;
                dz += (tz / d) * 0.9;
            }
            const length = Math.sqrt(dx * dx + dz * dz) || 1;
            const speed = blue ? TUNING.blueSpeed : TUNING.redSpeed;
            const targetVx = (dx / length) * speed + pushX * TUNING.separation;
            const targetVz = (dz / length) * speed + pushZ * TUNING.separation * 0.5;
            // A little inertia, so the crowd flows rather than jitters.
            const blend = Math.min(1, dt * 10);
            this.vx[i] += (targetVx - this.vx[i]) * blend;
            this.vz[i] += (targetVz - this.vz[i]) * blend;
            this.prevZ[i] = z;
            this.x[i] = Math.max(-wallX, Math.min(wallX, x + this.vx[i] * dt));
            this.z[i] = Math.max(ARENA.baseZ - 0.5, z + this.vz[i] * dt);
            if (Math.abs(this.vx[i]) + Math.abs(this.vz[i]) > 0.2) {
                const target = Math.atan2(-this.vx[i], -this.vz[i]);
                let turn = target - this.heading[i];
                turn = Math.atan2(Math.sin(turn), Math.cos(turn));
                this.heading[i] += turn * Math.min(1, dt * 12);
            }
        }
    }

    // ------------------------------------------------------------------ contact

    private fight(): void {
        this.buildGrid();
        const reach = TUNING.radius * 2 * 0.95;
        const reach2 = reach * reach;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.team[i] !== BLUE) continue;
            const x = this.x[i];
            const z = this.z[i];
            let foe = -1;
            this.forNear(x, z, (j) => {
                if (foe >= 0 || this.team[j] !== RED) return;
                const ox = x - this.x[j];
                const oz = z - this.z[j];
                if (ox * ox + oz * oz < reach2) foe = j;
            });
            if (foe >= 0) {
                this.dead[i] = 1;
                this.dead[foe] = 1;
                this.events.clash?.((x + this.x[foe]) / 2, (z + this.z[foe]) / 2);
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
                    this.vz[j] = this.vz[i];
                    this.prevZ[j] = gate.z - 0.01;
                    made++;
                }
                if (made) this.events.gate?.(g, this.x[i], gate.z, made);
            }
        }
    }

    private hitBase(): void {
        if (this.baseHp <= 0) return;
        const front = ARENA.baseZ + 0.15;
        for (let i = 0; i < this.count; i++) {
            if (this.dead[i] || this.team[i] !== BLUE) continue;
            if (this.z[i] > front || Math.abs(this.x[i] - BASE_X) > BASE_HALF_WIDTH + TUNING.radius) continue;
            this.dead[i] = 1;
            this.baseHp = Math.max(0, this.baseHp - 1);
            this.events.baseHit?.(this.x[i], this.z[i], this.baseHp);
            if (this.baseHp === 0) {
                if (this.state === 'playing') {
                    this.state = 'won';
                    this.events.won?.();
                }
                return;
            }
        }
    }

    private checkBreakthrough(): void {
        if (this.state !== 'playing') return;
        for (let i = 0; i < this.count; i++) {
            if (!this.dead[i] && this.team[i] === RED && this.z[i] >= ARENA.dangerZ) {
                this.state = 'lost';
                this.events.lost?.();
                return;
            }
        }
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
        this.age[to] = this.age[from];
        this.phase[to] = this.phase[from];
        this.gatesCrossed[to] = this.gatesCrossed[from];
        this.dead[to] = this.dead[from];
        this.prevZ[to] = this.prevZ[from];
        this.vx[to] = this.vx[from];
        this.vz[to] = this.vz[from];
        this.lane[to] = this.lane[from];
    }
}
