// gap-check.ts — where a level's big units (giants, trucks, cars, red giants) can get stuck, for the editor's Check gaps.
//
//   node <bundle> --level <file.json>     (the editor's server bundles and runs it: gap-run.mjs) → JSON on stdout
//
// Two things, both with the battle's own collision (Battle.fitsAt / bodyOf, so what it finds is what the game does):
// - a map of the field (GRID.step cells): where each unit's body fits, and where a plain mob's does — a spot plain mobs
//   get through and a unit doesn't is a gap too narrow for it; the editor also marks where it only just fits (tight);
// - test runs: one unit at a time, alone on the field (no reds, the cannon not firing), walked up it from the cannon at
//   several places across it and out of each of its houses (red giants down it from the far end), its trail kept, and
//   any spot it stalls (hardly moving for STALL.window seconds, not chipping a block) marked with how long it was there.
// Moving things (sliding bars, spinners, swinging gates) aren't in the map; the runs have them as they move.

import fs from 'fs';
import { BLUE, Battle, GIANT, RED } from '../game/battle/Battle';
import { ARENA, BattleConfig, TUNING, bodyShare, useField } from '../game/data/MobConfig';
import { seeded } from '../game/sim/Grading';

const GRID = { step: 0.2 };
const RUN = { dt: 1 / 30, seconds: 45, sample: 0.25, across: 9, perHouse: 3 };
/** Stalled: moved less than `distance` in `window` seconds; given up on after `giveUp` seconds stalled in a row. */
const STALL = { window: 2, distance: 0.35, giveUp: 6 };

type UnitId = 'giant' | 'truck' | 'car' | 'redGiant';
const MOB: Record<UnitId, number> = { giant: GIANT, truck: 2, car: 3, redGiant: GIANT };

interface Run {
    unit: UnitId;
    from: 'cannon' | 'house' | 'far end';
    trail: [number, number][];
    /** Where it stalled: x, z, seconds there. */
    stalls: [number, number, number][];
    end: 'target' | 'through' | 'died' | 'stuck' | 'timeout';
}

const args = process.argv.slice(2);
const levelPath = args[args.indexOf('--level') + 1];
const level = JSON.parse(fs.readFileSync(levelPath, 'utf8')) as BattleConfig;
const round = (n: number): number => Math.round(n * 100) / 100;

/** The level with nothing coming at it and buildings that don't fall (so a run is just the unit walking). */
const quiet = (config: BattleConfig): BattleConfig => ({
    ...config,
    redRate: 0,
    redRateEnd: 0,
    redGiantEvery: 0,
    baseHp: 1e9,
    targets: config.targets?.map((t) => ({ ...t, hp: 1e9 })),
});

function newBattle(seed: number): Battle {
    Math.random = seeded(seed);
    useField(level);
    const battle = new Battle(quiet(level), {});
    battle.firing = false;
    return battle;
}

/** The map: rows (far end first) of '1' fits / '0' doesn't, for plain mobs and each unit's body. */
function fieldMap(): { x0: number; z0: number; nx: number; nz: number; step: number; rows: Record<string, string[]> } {
    const battle = newBattle(1);
    const nx = Math.floor((ARENA.halfWidth * 2) / GRID.step) + 1;
    const z0 = ARENA.baseZ;
    const nz = Math.floor(-z0 / GRID.step) + 1;
    const x0 = -ARENA.halfWidth;
    const bodies: Record<string, [number, boolean, boolean?]> = {
        plain: [TUNING.radius, false],
        redPlain: [TUNING.radius, false, true],
        redGiant: [TUNING.radius * TUNING.giantScale * bodyShare('giant'), true, true],
        giant: [TUNING.radius * TUNING.giantScale * bodyShare('giant'), true],
        truck: [TUNING.radius * TUNING.truckScale * bodyShare('truck'), true],
        car: [TUNING.radius * TUNING.carScale * bodyShare('car'), true],
    };
    const rows: Record<string, string[]> = {};
    for (const [id, [r, houses, red]] of Object.entries(bodies)) {
        rows[id] = [];
        for (let j = 0; j < nz; j++) {
            let row = '';
            for (let i = 0; i < nx; i++) row += battle.fitsAt(x0 + i * GRID.step, z0 + j * GRID.step, r, houses, !!red) ? '1' : '0';
            rows[id].push(row);
        }
    }
    return { x0, z0, nx, nz, step: GRID.step, rows };
}

/** Whether mob i is chipping a breakable (meant to stand there a while). */
function chipping(battle: Battle, i: number): boolean {
    const blocks = (battle as unknown as { blocks: { alive: boolean; breakable?: boolean; shape: { minX: number; maxX: number; minZ: number; maxZ: number } }[] }).blocks;
    const r = battle.bodyOf(i) + 0.3;
    const x = battle.x[i];
    const z = battle.z[i];
    return blocks.some((b) => b.alive && b.breakable && x > b.shape.minX - r && x < b.shape.maxX + r && z > b.shape.minZ - r && z < b.shape.maxZ + r);
}

/** One unit walked from (x, z) till it's at a target / past the line, gone, stuck or out of time. */
function run(unit: UnitId, from: Run['from'], x: number, z: number, seed: number): Run {
    const battle = newBattle(seed);
    const team = unit === 'redGiant' ? RED : BLUE;
    const add = (battle as unknown as { add: (team: number, x: number, z: number, crossed: number, kind: number) => number }).add.bind(battle);
    const first = add(team, x, z, team === BLUE ? 0xff : 0, MOB[unit]);
    if (unit === 'redGiant') (battle as unknown as { lane: Float32Array }).lane[first] = x;
    // Where it is in the battle's arrays (they're compacted as mobs go: it's the only big one of its team).
    const find = (): number => {
        for (let k = 0; k < battle.count; k++) if (battle.team[k] === team && battle.big[k] === MOB[unit] && battle.leaving[k] <= 0) return k;
        return -1;
    };
    let lastZ = z;
    const out: Run = { unit, from, trail: [[round(x), round(z)]], stalls: [], end: 'timeout' };
    const history: [number, number][] = [[x, z]];
    const perWindow = Math.round(STALL.window / RUN.sample);
    let stalled = 0;
    let next = RUN.sample;
    for (let t = 0; t < RUN.seconds; t += RUN.dt) {
        battle.step(RUN.dt);
        if (battle.state !== 'playing') {
            out.end = 'through';
            break;
        }
        const i = find();
        if (i < 0) {
            out.end = team === BLUE && lastZ < ARENA.baseZ + 4 ? 'target' : 'died';
            break;
        }
        lastZ = battle.z[i];
        if (t < next) continue;
        next += RUN.sample;
        const px = battle.x[i];
        const pz = battle.z[i];
        out.trail.push([round(px), round(pz)]);
        history.push([px, pz]);
        if (history.length <= perWindow) continue;
        const [hx, hz] = history[history.length - 1 - perWindow];
        const still = Math.hypot(px - hx, pz - hz) < STALL.distance && !chipping(battle, i);
        if (!still) {
            stalled = 0;
            continue;
        }
        // Stalled: the spot (one per place), and how long.
        const last = out.stalls[out.stalls.length - 1];
        if (last && stalled > 0 && Math.hypot(last[0] - px, last[1] - pz) < 1) last[2] = round(last[2] + RUN.sample);
        else out.stalls.push([round(px), round(pz), STALL.window]);
        stalled += RUN.sample;
        if (stalled >= STALL.giveUp) {
            out.end = 'stuck';
            break;
        }
    }
    return out;
}

function main(): void {
    const map = fieldMap();
    const runs: Run[] = [];
    let seed = 7;
    const range = ARENA.cannonRange;
    const kinds = new Set((level.pads ?? []).map((p) => p.kind ?? 'giant'));
    // From the cannon: each card's unit (all three: any of them can be a card), across the cannon's reach.
    for (const unit of ['giant', 'truck', 'car'] as UnitId[]) {
        for (let k = 0; k < RUN.across; k++) {
            const x = -range + (2 * range * k) / (RUN.across - 1);
            runs.push(run(unit, 'cannon', x, -2.8, seed++));
        }
    }
    // Out of each house (where its units come out: its far side).
    for (const pad of level.pads ?? []) {
        const kind = (pad.kind ?? 'giant') as string;
        if (kind === 'saucer') continue;
        const unit = kind as UnitId;
        const r = TUNING.radius * (unit === 'truck' ? TUNING.truckScale : unit === 'car' ? TUNING.carScale : TUNING.giantScale);
        const spread = Math.max(0, pad.width / 2 - r * 0.5);
        for (let k = 0; k < RUN.perHouse; k++) {
            const x = pad.x + (RUN.perHouse > 1 ? -spread + (2 * spread * k) / (RUN.perHouse - 1) : 0);
            runs.push(run(unit, 'house', x, pad.z - pad.depth / 2 - r - 0.2, seed++));
        }
    }
    // Red giants, when the level has them: down from the far end.
    if ((level.redGiantEvery ?? 0) > 0) {
        for (let k = 0; k < RUN.across; k++) {
            const x = -range + (2 * range * k) / (RUN.across - 1);
            runs.push(run('redGiant', 'far end', x, ARENA.baseZ + 1.5, seed++));
        }
    }
    const bodies = {
        plain: { size: TUNING.radius, body: TUNING.radius },
        giant: { size: TUNING.radius * TUNING.giantScale, body: TUNING.radius * TUNING.giantScale * bodyShare('giant') },
        truck: { size: TUNING.radius * TUNING.truckScale, body: TUNING.radius * TUNING.truckScale * bodyShare('truck') },
        car: { size: TUNING.radius * TUNING.carScale, body: TUNING.radius * TUNING.carScale * bodyShare('car') },
    };
    process.stdout.write(JSON.stringify({ field: { halfWidth: ARENA.halfWidth, baseZ: ARENA.baseZ }, bodies, houses: [...kinds], map, runs }));
}

main();
