// bandit-safe-checkpoints.ts
//
// A squad member parked on a checkpoint keeps waiting there while the others move, and the level clock
// (guards, cameras, drones, traps) runs the whole time, so every intermediate checkpoint must be a
// place nobody can ever see. This simulates each level's sensors for a full minute with the game's
// own rules (Guard/SecurityCamera/Drone/Trap + LevelSight walls) and moves any exposed checkpoint to
// the nearest safe spot in the same room that keeps the route walkable on the game's nav grid.
// Run before `dress:bandit` so furniture keeps clear of the new spots.
//
//   npm run safe-checkpoints:bandit [-- --dry] [-- rx-w7-08]

import fs from 'node:fs';
import path from 'node:path';
import type { LevelData, LevelPoint } from '../games/bandit-controller/game/data/LevelData';
import { vaultSafe } from '../games/bandit-controller/game/data/LevelData';
import { LevelSight } from '../games/bandit-controller/game/utils/LevelSight';
import { NavGrid, NavBox } from '../games/bandit-controller/game/utils/NavGrid';
import { PolyWallBuilder } from '../games/pizza/game/builders/PolyWallBuilder';

const GAME = path.resolve(__dirname, '../games/bandit-controller');
const LEVELS = path.join(GAME, 'levels');
const DRY = process.argv.includes('--dry');
const ONLY = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

// Same values as Guard.ts / SecurityCamera.ts.
const GUARD_TURN_RATE = (280 * Math.PI) / 180;
const CAMERA_TURN_RATE = (200 * Math.PI) / 180;
const GUARD_SWEEP_PERIOD = 3;
const TOUCH_RADIUS = 1.0;
const CLOSE_FRONT_RADIUS = 2.2;

const SIM_SECONDS = 60;
const DT = 0.05;
/** A waiting character is not a point: test its centre and a ring around it. */
const BODY = 0.6;
const SEARCH_RADIUS = 7;
const SEARCH_STEP = 0.5;
/** Squad members waiting at the same stage need room to stand apart. */
const MEMBER_SPACING = 1.8;

const wrap = (a: number) => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
const turn = (from: number, to: number, max: number) => from + Math.max(-max, Math.min(max, wrap(to - from)));

interface Sensor { step(): void; sees(x: number, z: number): boolean }

function guardSensor(level: LevelData, index: number, sight: LevelSight): Sensor {
    const g = level.guards![index];
    const path = g.path.map((p) => ({ x: p.x, z: p.z }));
    const half = ((g.fov * Math.PI) / 180) / 2;
    const pos = { ...path[0] };
    let target = path.length > 1 ? 1 : 0;
    let direction = 1;
    let heading = path.length > 1 ? Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z) : (g.facing * Math.PI) / 180;
    let base = heading;
    let mode: 'wait' | 'move' = 'wait';
    let waited = 0;
    const next = () => {
        if (path.length <= 1) return 0;
        if (g.loop) return (target + 1) % path.length;
        if (target + direction >= path.length || target + direction < 0) direction = -direction;
        return target + direction;
    };
    return {
        step() {
            if (mode === 'wait') {
                waited += DT;
                heading = turn(heading, base + ((g.sweep * Math.PI) / 180) * Math.sin((waited * Math.PI * 2) / GUARD_SWEEP_PERIOD), GUARD_TURN_RATE * DT);
                if (path.length > 1 && waited >= g.pause) mode = 'move';
                return;
            }
            const t = path[target];
            const dx = t.x - pos.x;
            const dz = t.z - pos.z;
            const dist = Math.hypot(dx, dz);
            heading = turn(heading, Math.atan2(dx, dz), GUARD_TURN_RATE * DT);
            if (dist <= g.speed * DT) {
                pos.x = t.x;
                pos.z = t.z;
                base = heading;
                mode = 'wait';
                waited = 0;
                target = next();
                return;
            }
            pos.x += (dx / dist) * g.speed * DT;
            pos.z += (dz / dist) * g.speed * DT;
        },
        sees(x, z) {
            const dx = x - pos.x;
            const dz = z - pos.z;
            const dist = Math.hypot(dx, dz);
            if (dist <= TOUCH_RADIUS) return true;
            const inCone = dist <= 0.05 || Math.abs(wrap(Math.atan2(dx, dz) - heading)) <= half;
            if (dist > Math.max(g.range, CLOSE_FRONT_RADIUS) || !inCone) return false;
            return sight.hasLineOfSight(pos.x, pos.z, x, z);
        },
    };
}

function cameraSensor(level: LevelData, index: number, sight: LevelSight): Sensor {
    const c = level.cameras![index];
    const half = ((c.fov * Math.PI) / 180) / 2;
    const base = (c.facing * Math.PI) / 180;
    let heading = base;
    let time = 0;
    return {
        step() {
            time += DT;
            const sweep = ((c.sweep * Math.PI) / 180) * Math.sin((time * Math.PI * 2) / Math.max(0.5, c.period));
            heading = turn(heading, base + sweep, CAMERA_TURN_RATE * DT);
        },
        sees(x, z) {
            const dx = x - c.x;
            const dz = z - c.z;
            const dist = Math.hypot(dx, dz);
            if (dist > c.range) return false;
            if (dist > 0.05 && Math.abs(wrap(Math.atan2(dx, dz) - heading)) > half) return false;
            return sight.hasLineOfSight(c.x, c.z, x, z);
        },
    };
}

function droneSensor(level: LevelData, index: number, sight: LevelSight): Sensor {
    const d = level.drones![index];
    const lengths = d.path.slice(1).map((p, i) => Math.hypot(p.x - d.path[i].x, p.z - d.path[i].z));
    const total = lengths.reduce((a, b) => a + b, 0);
    let travelled = 0;
    const pos = { ...d.path[0] };
    return {
        step() {
            travelled += DT * d.speed;
            if (total <= 0) return;
            let along = travelled % (total * 2);
            along = along <= total ? along : total * 2 - along;
            for (let i = 0; i < lengths.length; i++) {
                if (along <= lengths[i] || i === lengths.length - 1) {
                    const f = lengths[i] > 0 ? Math.min(1, along / lengths[i]) : 0;
                    pos.x = d.path[i].x + (d.path[i + 1].x - d.path[i].x) * f;
                    pos.z = d.path[i].z + (d.path[i + 1].z - d.path[i].z) * f;
                    break;
                }
                along -= lengths[i];
            }
        },
        sees(x, z) {
            return Math.hypot(x - pos.x, z - pos.z) <= d.radius && sight.hasLineOfSight(pos.x, pos.z, x, z);
        },
    };
}

/** True when a character standing at (x, z) is ever spotted (or standing on spikes) during the simulation. */
function exposed(level: LevelData, x: number, z: number): boolean {
    for (const trap of level.traps ?? []) {
        if (Math.abs(x - trap.x) <= trap.width / 2 + BODY && Math.abs(z - trap.z) <= trap.depth / 2 + BODY) return true;
    }
    const sight = new LevelSight(level);
    const sensors: Sensor[] = [
        ...(level.guards ?? []).map((_, i) => guardSensor(level, i, sight)),
        ...(level.cameras ?? []).map((_, i) => cameraSensor(level, i, sight)),
        ...(level.drones ?? []).map((_, i) => droneSensor(level, i, sight)),
    ];
    if (!sensors.length) return false;
    const probes = [[0, 0], [BODY, 0], [-BODY, 0], [0, BODY], [0, -BODY]];
    for (let t = 0; t < SIM_SECONDS; t += DT) {
        for (const sensor of sensors) {
            sensor.step();
            if (probes.some(([ox, oz]) => sensor.sees(x + ox, z + oz))) return true;
        }
    }
    return false;
}

const worlds: { worlds: { id: string; levels: string[]; styles?: { wall?: string } }[] } = JSON.parse(fs.readFileSync(path.join(LEVELS, 'worlds.json'), 'utf8'));
const wallStyles: { wall: Record<string, { height: number; thickness: number }> } = JSON.parse(fs.readFileSync(path.join(GAME, 'ui', 'worldstyles.json'), 'utf8'));

function navFor(level: LevelData, worldStyle?: string): NavGrid {
    const style = wallStyles.wall[worldStyle ?? level.styles?.wall ?? 'wallStyle1'];
    const boxes = level.walls.flatMap((wall) => PolyWallBuilder.colliderBoxes({
        ...wall, openings: wall.openings.map((o) => ({ kind: o.kind, rect: o })),
    } as never, { ...style, doorHeight: 4, tallDoorHeight: 5.5, windowHeight: 1.5 } as never) as NavBox[]);
    const safe = level.vault ? vaultSafe(level.vault) : undefined;
    const obstacles: NavBox[] = [
        ...boxes,
        ...(safe ? [{ x: safe.x, z: safe.z, halfX: safe.halfX, halfZ: safe.halfZ }] : []),
        ...level.props.filter((p) => p.collider).map((p) => ({ x: p.x, z: p.z, halfX: p.collider!.halfX, halfZ: p.collider!.halfZ })),
    ];
    const floor = level.floor.rects?.length ? level.floor.rects : [{ x: 0, z: 0, width: level.floor.width, depth: level.floor.depth }];
    return new NavGrid([...floor, ...(level.entryPath ? [level.entryPath] : [])], obstacles, 0.55);
}

let moved = 0;
let unfixable = 0;
for (const world of worlds.worlds) {
    for (const id of world.levels) {
        if (ONLY.length && !ONLY.includes(id)) continue;
        const file = path.join(LEVELS, `${id}.json`);
        const raw = fs.readFileSync(file, 'utf8');
        const level: LevelData = JSON.parse(raw);
        const sight = new LevelSight(level);
        const grid = navFor(level, world.styles?.wall);
        const members = level.squad?.length ? level.squad : [{ start: level.start, waypoints: level.waypoints }];
        const notes: string[] = [];
        members.forEach((member, memberIndex) => {
            if (exposed(level, member.start.x, member.start.z)) notes.push(`member ${memberIndex} START is exposed (left as is)`);
            // The last waypoint is the vault/finish; every other one is a place to wait.
            for (let i = 0; i < member.waypoints.length - 1; i++) {
                const point = member.waypoints[i];
                if (!exposed(level, point.x, point.z)) continue;
                const previous = i === 0 ? member.start : member.waypoints[i - 1];
                const next = member.waypoints[i + 1];
                const others: LevelPoint[] = members.flatMap((m, mi) => (mi === memberIndex ? [] : m.waypoints.slice(0, -1)));
                const candidates: LevelPoint[] = [];
                for (let r = SEARCH_STEP; r <= SEARCH_RADIUS; r += SEARCH_STEP) {
                    for (let a = 0; a < 360; a += Math.max(10, 180 / (r * 2))) {
                        candidates.push({ x: point.x + Math.sin((a * Math.PI) / 180) * r, z: point.z + Math.cos((a * Math.PI) / 180) * r });
                    }
                }
                const found = candidates.find((c) => grid.isFree(c.x, c.z)
                    && sight.hasLineOfSight(point.x, point.z, c.x, c.z)
                    && !(level.vault && Math.abs(c.x - level.vault.x) <= level.vault.width / 2 && Math.abs(c.z - level.vault.z) <= level.vault.depth / 2)
                    && others.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= MEMBER_SPACING)
                    && level.loot.every((l) => Math.hypot(l.x - c.x, l.z - c.z) >= 1.2)
                    && !exposed(level, c.x, c.z)
                    && Boolean(grid.findPath(previous, c)) && Boolean(grid.findPath(c, next)));
                if (found) {
                    const rounded = { x: Math.round(found.x * 100) / 100, z: Math.round(found.z * 100) / 100 };
                    notes.push(`member ${memberIndex} checkpoint ${i + 1} (${point.x},${point.z}) -> (${rounded.x},${rounded.z})`);
                    member.waypoints[i] = rounded;
                    moved++;
                } else {
                    notes.push(`member ${memberIndex} checkpoint ${i + 1} (${point.x},${point.z}) exposed, NO safe spot within ${SEARCH_RADIUS}`);
                    unfixable++;
                }
            }
        });
        if (level.squad?.length) {
            // Single-player fields mirror the first member for older code paths.
            level.start = { ...level.squad[0].start };
            level.waypoints = level.squad[0].waypoints.map((p) => ({ ...p }));
        }
        if (notes.length) {
            console.log(`${id}:\n  ${notes.join('\n  ')}`);
            if (!DRY && notes.some((n) => n.includes('->'))) {
                const eol = raw.includes('\r\n') ? '\r\n' : '\n';
                fs.writeFileSync(file, `${JSON.stringify(level, null, 2)}\n`.replace(/\n/g, eol));
            }
        }
    }
}
console.log(`✅ ${moved} checkpoint(s) ${DRY ? 'would be ' : ''}moved to safety, ${unfixable} without a safe spot nearby`);
