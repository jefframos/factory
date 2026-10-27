// bandit-vault-rooms.mjs
//
// Level migration for Bandit Controller (idempotent — safe to re-run):
//   1. Widens every door opening to DOOR_WIDTH (clamped inside its wall segment, away from corners
//      and from walls that meet it).
//   2. Attaches a rectangular vault room to the outer wall nearest the end of each campaign level:
//      one entrance door, no enemies inside, the safe on the wall opposite the entrance, and every
//      member's final waypoint (or the shared finish) inside the room in front of the safe.
//
//   node scripts/bandit-vault-rooms.mjs [--dry]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = path.join(ROOT, 'games', 'bandit-controller', 'levels');
const DRY = process.argv.includes('--dry');

const DOOR_WIDTH = 4.2;
const VAULT_DOOR_WIDTH = 4;
const CORNER_MARGIN = 0.7;
const MIN_ROOM = 7;
const EPS = 0.05;

const round = (value) => Math.round(value * 100) / 100;
const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function segments(wall) {
    const out = [];
    const count = wall.points.length;
    for (let i = 0; i < count - (wall.closed ? 0 : 1); i++) {
        out.push([wall.points[i], wall.points[(i + 1) % count]]);
    }
    return out;
}

/** Where other walls touch the line of `segment` (T-junctions and corners), as tangent values. */
function junctionsOn(level, segment, alongX) {
    const [a, b] = segment;
    const line = alongX ? a.z : a.x;
    const values = [];
    for (const wall of level.walls) {
        for (const point of wall.points) {
            const onLine = Math.abs((alongX ? point.z : point.x) - line) < EPS;
            const t = alongX ? point.x : point.z;
            const min = Math.min(alongX ? a.x : a.z, alongX ? b.x : b.z);
            const max = Math.max(alongX ? a.x : a.z, alongX ? b.x : b.z);
            if (onLine && t > min + EPS && t < max - EPS) values.push(t);
        }
        // Walls that cross straight through this line.
        for (const [p, q] of segments(wall)) {
            const pn = alongX ? p.z : p.x;
            const qn = alongX ? q.z : q.x;
            if ((pn - line) * (qn - line) >= 0) continue;
            const k = (line - pn) / (qn - pn);
            const t = (alongX ? p.x : p.z) + ((alongX ? q.x : q.z) - (alongX ? p.x : p.z)) * k;
            const min = Math.min(alongX ? a.x : a.z, alongX ? b.x : b.z);
            const max = Math.max(alongX ? a.x : a.z, alongX ? b.x : b.z);
            if (t > min + EPS && t < max - EPS) values.push(t);
        }
    }
    return values;
}

/** Ends of open walls (other than `door wall`) that sit on the door's wall line within [min, max]. */
function wallStubsInDoor(level, doorWall, alongX, line, min, max) {
    const stubs = [];
    for (const wall of level.walls) {
        if (wall === doorWall || wall.closed || wall.points.length < 2) continue;
        for (const index of [0, wall.points.length - 1]) {
            const point = wall.points[index];
            const t = alongX ? point.x : point.z;
            if (Math.abs((alongX ? point.z : point.x) - line) < EPS && t > min && t < max) {
                stubs.push({ wall, index });
            }
        }
    }
    return stubs;
}

const STUB_PULLBACK = 2;

function canPullBack({ wall, index }) {
    const point = wall.points[index];
    const neighbour = wall.points[index === 0 ? 1 : wall.points.length - 2];
    return Math.hypot(neighbour.x - point.x, neighbour.z - point.z) >= STUB_PULLBACK + 1;
}

/** Shortens a wall at one end by STUB_PULLBACK (see canPullBack). */
function pullBackStub({ wall, index }) {
    const point = wall.points[index];
    const neighbour = wall.points[index === 0 ? 1 : wall.points.length - 2];
    const length = Math.hypot(neighbour.x - point.x, neighbour.z - point.z);
    point.x = round(point.x + (neighbour.x - point.x) * STUB_PULLBACK / length);
    point.z = round(point.z + (neighbour.z - point.z) * STUB_PULLBACK / length);
    return true;
}

function widenDoors(level) {
    let widened = 0;
    for (const wall of level.walls) {
        for (const opening of wall.openings) {
            if (opening.kind !== 'door') continue;
            const alongX = opening.maxX - opening.minX >= opening.maxZ - opening.minZ;
            const width = alongX ? opening.maxX - opening.minX : opening.maxZ - opening.minZ;
            const midpoint = alongX ? (opening.minX + opening.maxX) / 2 : (opening.minZ + opening.maxZ) / 2;
            const line = alongX ? (opening.minZ + opening.maxZ) / 2 : (opening.minX + opening.maxX) / 2;
            const segment = segments(wall).find(([a, b]) => alongX
                ? Math.abs(a.z - line) < 0.35 && Math.abs(b.z - line) < 0.35 && midpoint >= Math.min(a.x, b.x) && midpoint <= Math.max(a.x, b.x)
                : Math.abs(a.x - line) < 0.35 && Math.abs(b.x - line) < 0.35 && midpoint >= Math.min(a.z, b.z) && midpoint <= Math.max(a.z, b.z));
            if (!segment) continue;
            const [a, b] = segment;
            let lo = Math.min(alongX ? a.x : a.z, alongX ? b.x : b.z) + CORNER_MARGIN;
            let hi = Math.max(alongX ? a.x : a.z, alongX ? b.x : b.z) - CORNER_MARGIN;
            const junctions = junctionsOn(level, segment, alongX);
            let centre = alongX ? (opening.minX + opening.maxX) / 2 : (opening.minZ + opening.maxZ) / 2;
            const start0 = alongX ? opening.minX : opening.minZ;
            const end0 = alongX ? opening.maxX : opening.maxZ;
            if (junctions.some((j) => j > start0 - 0.2 && j < end0 + 0.2)) {
                // A wall ends inside this doorway, splitting it into slivers. Pull such wall stubs
                // back from the doorway (keeps every room it joined connected); a wall that crosses
                // straight through can't be pulled back, so the door moves to the longest clear stretch.
                const stubs = wallStubsInDoor(level, wall, alongX, line, start0 - 0.2, end0 + 0.2);
                const crossing = junctions.filter((j) => j > start0 - 0.2 && j < end0 + 0.2).length > stubs.length;
                if (!crossing && stubs.every(canPullBack)) {
                    stubs.forEach(pullBackStub);
                    const half = Math.max(width, DOOR_WIDTH) / 2;
                    const lo2 = Math.min(alongX ? a.x : a.z, alongX ? b.x : b.z) + CORNER_MARGIN;
                    const hi2 = Math.max(alongX ? a.x : a.z, alongX ? b.x : b.z) - CORNER_MARGIN;
                    const mid = Math.min(Math.max(centre, lo2 + half), hi2 - half);
                    if (alongX) { opening.minX = round(mid - half); opening.maxX = round(mid + half); }
                    else { opening.minZ = round(mid - half); opening.maxZ = round(mid + half); }
                    widened++;
                    continue;
                }
                const stops = [lo - CORNER_MARGIN, ...junctions.sort((p, q) => p - q), hi + CORNER_MARGIN];
                let best;
                for (let i = 1; i < stops.length; i++) {
                    const length = stops[i] - stops[i - 1] - 2 * CORNER_MARGIN;
                    const mid = (stops[i] + stops[i - 1]) / 2;
                    if (length >= 3 && (!best || Math.abs(mid - centre) < Math.abs(best.mid - centre))) best = { mid, length };
                }
                if (!best) continue;
                centre = best.mid;
                const half = Math.min(DOOR_WIDTH, best.length) / 2;
                if (alongX) { opening.minX = round(centre - half); opening.maxX = round(centre + half); }
                else { opening.minZ = round(centre - half); opening.maxZ = round(centre + half); }
                widened++;
                continue;
            }
            if (width >= DOOR_WIDTH - EPS) continue;
            for (const junction of junctions) {
                if (junction <= centre) lo = Math.max(lo, junction + CORNER_MARGIN);
                else hi = Math.min(hi, junction - CORNER_MARGIN);
            }
            // Other openings on the same wall line stay untouched.
            for (const other of wall.openings) {
                if (other === opening) continue;
                const oMin = alongX ? other.minX : other.minZ;
                const oMax = alongX ? other.maxX : other.maxZ;
                const oLine = alongX ? (other.minZ + other.maxZ) / 2 : (other.minX + other.maxX) / 2;
                if (Math.abs(oLine - line) > 0.35) continue;
                if (oMax <= centre) lo = Math.max(lo, oMax + 0.4);
                else if (oMin >= centre) hi = Math.min(hi, oMin - 0.4);
            }
            const available = hi - lo;
            const target = Math.min(DOOR_WIDTH, available);
            if (target <= width + 0.1) continue;
            const start = Math.min(Math.max(centre - target / 2, lo), hi - target);
            if (alongX) { opening.minX = round(start); opening.maxX = round(start + target); }
            else { opening.minZ = round(start); opening.maxZ = round(start + target); }
            widened++;
        }
    }
    return widened;
}

const SIDES = {
    '+x': { axis: 'x', tangent: 'z', sign: 1 },
    '-x': { axis: 'x', tangent: 'z', sign: -1 },
    '+z': { axis: 'z', tangent: 'x', sign: 1 },
    '-z': { axis: 'z', tangent: 'x', sign: -1 },
};

function floorRects(level) {
    return level.floor.rects?.length ? level.floor.rects : [{ x: 0, z: 0, width: level.floor.width, depth: level.floor.depth }];
}

const rectOverlaps = (a, b, pad = 0) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + pad - EPS
    && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 + pad - EPS;
const pointIn = (p, r, pad = 0) => Math.abs(p.x - r.x) <= r.width / 2 + pad && Math.abs(p.z - r.z) <= r.depth / 2 + pad;

function members(level) {
    return level.squad?.length ? level.squad : [level];
}

function planVault(level) {
    const team = members(level);
    const shared = level.sharedGoal && level.sharedGoal.enabled !== false && team.length > 1;
    const goals = team.map((m) => m.waypoints[m.waypoints.length - 1]);
    const goal = shared ? level.sharedGoal : {
        x: goals.reduce((s, p) => s + p.x, 0) / goals.length,
        z: goals.reduce((s, p) => s + p.z, 0) / goals.length,
    };
    const start = {
        x: team.reduce((s, m) => s + m.start.x, 0) / team.length,
        z: team.reduce((s, m) => s + m.start.z, 0) / team.length,
    };
    const travel = { x: goal.x - start.x, z: goal.z - start.z };
    const seed = hash(level.id);
    const depth = 6.5 + (seed % 4) * 0.5;
    const width = Math.max(MIN_ROOM + ((seed >>> 3) % 3) * 0.75, team.length * 2 + 3);
    const sideOrder = Object.keys(SIDES).sort((a, b) => {
        const score = (key) => travel[SIDES[key].axis] * SIDES[key].sign;
        return score(b) - score(a);
    });
    const blockers = [
        ...(level.entryPath ? [level.entryPath] : []),
    ];
    const points = [
        ...(level.guards ?? []).flatMap((g) => g.path),
        ...(level.drones ?? []).flatMap((d) => d.path),
        ...(level.cameras ?? []),
        ...(level.traps ?? []),
        ...level.props,
        ...level.loot,
        ...team.map((m) => m.start),
    ];

    for (const sideKey of sideOrder) {
        const side = SIDES[sideKey];
        if (travel[side.axis] * side.sign < -2) continue;
        // Outer walls on this side, nearest the goal first.
        const candidates = [];
        for (const wall of level.walls) {
            for (const [a, b] of segments(wall)) {
                if (Math.abs(a[side.axis] - b[side.axis]) > EPS) continue;
                const line = a[side.axis];
                const t0 = Math.min(a[side.tangent], b[side.tangent]);
                const t1 = Math.max(a[side.tangent], b[side.tangent]);
                if (t1 - t0 < width + 2 * CORNER_MARGIN) continue;
                // It must be an outer edge: floor on the inner side, none on the outer side.
                const probe = (offset) => ({ [side.axis]: line + side.sign * offset, [side.tangent]: (t0 + t1) / 2 });
                if (!floorRects(level).some((r) => pointIn(probe(-0.3), r))) continue;
                if (floorRects(level).some((r) => pointIn(probe(0.3), r))) continue;
                candidates.push({ wall, line, t0, t1 });
            }
        }
        candidates.sort((a, b) => Math.abs(a.line - goal[side.axis]) - Math.abs(b.line - goal[side.axis]));
        for (const { wall, line, t0, t1 } of candidates) {
            if ((line - goal[side.axis]) * side.sign < -1) continue;
            const junctions = junctionsOn(level, [
                { [side.axis]: line, [side.tangent]: t0 },
                { [side.axis]: line, [side.tangent]: t1 },
            ], side.axis === 'z');
            const tries = [];
            for (let t = t0 + width / 2 + CORNER_MARGIN; t <= t1 - width / 2 - CORNER_MARGIN + EPS; t += 0.25) tries.push(t);
            tries.sort((a, b) => Math.abs(a - goal[side.tangent]) - Math.abs(b - goal[side.tangent]));
            for (const centre of tries) {
                const doorLo = centre - VAULT_DOOR_WIDTH / 2;
                const doorHi = centre + VAULT_DOOR_WIDTH / 2;
                if (junctions.some((j) => j > doorLo - CORNER_MARGIN && j < doorHi + CORNER_MARGIN)) continue;
                const openingClash = level.walls.some((w) => w.openings.some((o) => {
                    const oLine = side.axis === 'x' ? (o.minX + o.maxX) / 2 : (o.minZ + o.maxZ) / 2;
                    const oMin = side.axis === 'x' ? o.minZ : o.minX;
                    const oMax = side.axis === 'x' ? o.maxZ : o.maxX;
                    return Math.abs(oLine - line) < 0.4 && oMax > centre - width / 2 - 0.3 && oMin < centre + width / 2 + 0.3;
                }));
                if (openingClash) continue;
                const room = {
                    [side.axis]: line + side.sign * depth / 2,
                    [side.tangent]: centre,
                    width: side.axis === 'x' ? depth : width,
                    depth: side.axis === 'x' ? width : depth,
                };
                if (floorRects(level).some((r) => rectOverlaps(r, room))) continue;
                if (blockers.some((r) => rectOverlaps(r, room, 0.5))) continue;
                if (points.some((p) => pointIn(p, room, 0.5))) continue;
                return { side: sideKey, room, wall, line, centre, width, depth, shared, team };
            }
        }
    }
    return undefined;
}

function applyVault(level, plan) {
    const { side: sideKey, room, wall, line, centre, width, depth, shared, team } = plan;
    const side = SIDES[sideKey];
    const point = (axisValue, tangentValue) => ({ [side.axis]: round(axisValue), [side.tangent]: round(tangentValue) });
    const ordered = (p) => ({ x: p.x, z: p.z });
    const far = line + side.sign * depth;
    level.walls.push({
        closed: false,
        points: [
            ordered(point(line, centre - width / 2)),
            ordered(point(far, centre - width / 2)),
            ordered(point(far, centre + width / 2)),
            ordered(point(line, centre + width / 2)),
        ],
        openings: [],
    });
    const door = side.axis === 'x'
        ? { kind: 'door', minX: round(line - 0.3), maxX: round(line + 0.3), minZ: round(centre - VAULT_DOOR_WIDTH / 2), maxZ: round(centre + VAULT_DOOR_WIDTH / 2) }
        : { kind: 'door', minX: round(centre - VAULT_DOOR_WIDTH / 2), maxX: round(centre + VAULT_DOOR_WIDTH / 2), minZ: round(line - 0.3), maxZ: round(line + 0.3) };
    wall.openings.push(door);

    const rects = floorRects(level).map((r) => ({ ...r }));
    rects.push({ x: round(room.x), z: round(room.z), width: round(room.width), depth: round(room.depth) });
    level.floor.rects = rects;
    const extentX = Math.max(...rects.map((r) => Math.abs(r.x) + r.width / 2));
    const extentZ = Math.max(...rects.map((r) => Math.abs(r.z) + r.depth / 2));
    level.floor.width = round(Math.max(level.floor.width, extentX * 2));
    level.floor.depth = round(Math.max(level.floor.depth, extentZ * 2));

    level.vault = { x: round(room.x), z: round(room.z), width: round(room.width), depth: round(room.depth), side: sideKey };

    // Finish spots: the room centre, a little toward the entrance so the safe stays behind them.
    const finishAxis = room[side.axis] - side.sign * 0.4;
    if (shared) {
        level.sharedGoal = {
            x: round(room.x), z: round(room.z),
            width: round(room.width - 0.6), depth: round(room.depth - 0.6), enabled: true,
        };
    }
    team.forEach((member, index) => {
        const offset = (index - (team.length - 1) / 2) * 1.8;
        member.waypoints[member.waypoints.length - 1] = ordered(point(finishAxis, centre + offset));
    });
    // The old decorative safes near the previous finish would now be a second, fake goal.
    level.props = level.props.filter((prop) => !prop.model.includes('vault/vault'));
}

const worlds = JSON.parse(fs.readFileSync(path.join(LEVELS, 'worlds.json'), 'utf8'));
const ids = [...new Set(worlds.worlds.flatMap((w) => w.levels))];
const failures = [];
for (const id of ids) {
    const file = path.join(LEVELS, `${id}.json`);
    const level = JSON.parse(fs.readFileSync(file, 'utf8'));
    const widened = widenDoors(level);
    let note = '';
    if (!level.vault) {
        const plan = planVault(level);
        if (!plan) {
            failures.push(id);
            note = 'NO VAULT SPOT';
        } else {
            applyVault(level, plan);
            note = `vault ${plan.side} ${plan.width}x${plan.depth}`;
        }
    } else {
        note = 'vault kept';
    }
    console.log(`${id}: widened ${widened} door(s); ${note}`);
    if (!DRY) fs.writeFileSync(file, `${JSON.stringify(level, null, 2)}\n`);
}
if (failures.length) {
    console.error(`No vault placement for: ${failures.join(', ')}`);
    process.exitCode = 1;
}
