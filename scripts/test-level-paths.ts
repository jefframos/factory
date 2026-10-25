import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { levelDoors, LevelData, LevelPoint, shouldShowWaypointMarker } from '../games/bandit-controller/game/data/LevelData';
import { GUARD_CHARACTER_VIEW, SQUAD_COLORS, CHARACTER_VIEWS } from '../games/bandit-controller/game/data/CharacterViews';
import { adjustRouteThroughDoors, doorCrossing } from '../games/bandit-controller/game/utils/LevelRoute';
import { PolyWallBuilder } from '../games/pizza/game/builders/PolyWallBuilder';

const root = path.resolve(__dirname, '../games/bandit-controller/levels');
const readLevel = (id: string): LevelData => JSON.parse(fs.readFileSync(path.join(root, `${id}.json`), 'utf8'));
const vector = (x: number, z: number) => new THREE.Vector3(x, 0.08, z);
const villa = readLevel('h1-02');
const doors = levelDoors(villa);
const trace = [vector(-8, -3), vector(-8, 5), vector(8, 5), vector(8, -4)];
const adjusted = adjustRouteThroughDoors(trace, doors);
assert(adjusted.some(p => p.x > 7.9 && p.z < -3), 'villa route must reach the opposite wing');
assert(adjusted.some(p => Math.abs(p.x) < 0.2 && Math.abs(p.z - 5) < 0.01), 'cross-villa corridor must not snap to either door');
for (let i = 1; i < adjusted.length; i++) {
    assert(adjusted[i].distanceTo(adjusted[i - 1]) < 0.65, 'door assist must not teleport between villa wings');
}
assert.deepEqual(adjusted[0], trace[0]);
assert.deepEqual(adjusted[adjusted.length - 1], trace[trace.length - 1]);
const reverse = adjustRouteThroughDoors([...trace].reverse(), doors);
assert(reverse.some(p => Math.abs(p.x) < 0.2 && Math.abs(p.z - 5) < 0.01), 'reverse crossing must preserve the corridor');
const verticalDoor = { x: 0, z: 2, halfWidth: 1.5, alongX: false };
assert.equal(doorCrossing(verticalDoor, vector(-2, 2.5), vector(2, 2.5)), 0.5);
const sideways = adjustRouteThroughDoors([vector(-5, 2.5), vector(5, 2.5)], [verticalDoor]);
assert(sideways.some(p => Math.abs(p.x) < 0.1 && p.z === 2), 'sideways doorway must centre on Z');
assert.deepEqual(adjustRouteThroughDoors([], []), []);
assert.deepEqual(adjustRouteThroughDoors([vector(1, 1), vector(1, 1)], []), [vector(1, 1)]);
console.log('Door-route regressions passed');

const styles: { wall: Record<string, { height: number; thickness: number }> } =
    JSON.parse(fs.readFileSync(path.resolve(root, '../ui/worldstyles.json'), 'utf8'));
const worlds: { worlds: { levels: string[]; styles?: { wall?: string } }[] } =
    JSON.parse(fs.readFileSync(path.join(root, 'worlds.json'), 'utf8'));
assert(!SQUAD_COLORS.includes(GUARD_CHARACTER_VIEW.color), 'guard uniform must not be a selectable squad color');
assert(Object.values(CHARACTER_VIEWS).every(view => view.color !== GUARD_CHARACTER_VIEW.color),
    'guard uniform must not match any named player skin');
let sharedFinishes = 0;
for (const id of new Set(worlds.worlds.flatMap(world => world.levels))) {
    const level = readLevel(id);
    const members = level.squad?.length ? level.squad : [level];
    const shared = Boolean(level.sharedGoal && level.sharedGoal.enabled !== false && members.length > 1);
    for (const member of members) {
        const count = member.waypoints.length + 1;
        assert.equal(shouldShowWaypointMarker(level, count - 1, count), !shared, `${id}: final disk duplicates shared area`);
        for (let i = 1; i < count - 1; i++) {
            assert(shouldShowWaypointMarker(level, i, count), `${id}: intermediate checkpoint must stay visible`);
        }
    }
    if (shared) sharedFinishes++;
}
const twoThieves = readLevel('tutorial-04');
assert(twoThieves.sharedGoal && twoThieves.squad?.length === 2, '1-3 must exercise shared squad finish regression');
assert(!shouldShowWaypointMarker(twoThieves, 2, 3), '1-3 must not reveal final disks after its checkpoint');
assert(shouldShowWaypointMarker(twoThieves, 1, 3), '1-3 must keep its intermediate checkpoints');
assert(shouldShowWaypointMarker({ ...twoThieves, sharedGoal: { ...twoThieves.sharedGoal, enabled: false } }, 2, 3));
assert(shouldShowWaypointMarker({ ...twoThieves, squad: twoThieves.squad.slice(0, 1) }, 2, 3));
console.log(`${sharedFinishes} shared campaign finishes: final disks hidden, intermediate checkpoints preserved; guard palette reserved`);
const boxesFor = (level: LevelData) => {
    const world = worlds.worlds.find(w => w.levels.includes(level.id));
    const style = styles.wall[world?.styles?.wall ?? level.styles?.wall ?? 'wallStyle1'];
    return level.walls.flatMap(wall => PolyWallBuilder.colliderBoxes({
        ...wall, openings: wall.openings.map(o => ({ kind: o.kind, rect: o })),
    }, { ...style, doorHeight: 4, tallDoorHeight: 5.5, windowHeight: 1.5 }));
};
const villaBoxes = boxesFor(villa);
for (const p of adjusted) {
    assert(!villaBoxes.some(b => Math.abs(p.x - b.x) < b.halfX + 0.48 && Math.abs(p.z - b.z) < b.halfZ + 0.48),
        `villa adjusted route hits a wall at ${p.x},${p.z}`);
}
console.log('Villa route clears actual wall colliders');

const rooftop = readLevel('w1-08');
const rooftopBoxes = boxesFor(rooftop);
const rooftopDoors = levelDoors(rooftop);
const rooftopTraces = [
    [vector(-13, 2.52), vector(-3, 2.52)],
    [vector(-3, 2.52), vector(-1, 2), vector(1, 0), vector(4, 0), vector(5, -2), vector(7, -2.52)],
    [vector(-3, 2.52), vector(-5, 2), vector(-5, -2), vector(0, -2), vector(1, 0), vector(4, 0), vector(5, -2), vector(7, -2.52)],
    [vector(-3, 2.52), vector(-5, 0), vector(-5, -5), vector(-5, 0), vector(1, 0), vector(7, -2.52)],
];
for (const trace of rooftopTraces) {
    for (const direction of [trace, [...trace].reverse()]) {
        for (const point of adjustRouteThroughDoors(direction, rooftopDoors)) {
            assert(!rooftopBoxes.some(box => Math.abs(point.x - box.x) < box.halfX + 0.48
                && Math.abs(point.z - box.z) < box.halfZ + 0.48),
            `1-7 doorway approach hits wall at ${point.x},${point.z}`);
        }
    }
}
console.log('1-7 entry, central doorway and side-room detours clear actual walls in both directions');

let checked = 0;
const failures: string[] = [];
for (const id of worlds.worlds.slice(0, 7).flatMap(w => w.levels).filter(id => !id.startsWith('tutorial-'))) {
    const level = readLevel(id);
    const boxes = boxesFor(level);
    assert(boxes.every(b => [b.x, b.z, b.halfX, b.halfZ].every(Number.isFinite)), `${id}: invalid wall collider`);
    const floor = level.floor.rects?.length ? level.floor.rects : [{ x: 0, z: 0, ...level.floor }];
    const regions = [...floor, ...(level.entryPath ? [level.entryPath] : [])];
    const inside = (p: LevelPoint) => regions.some(r =>
        Math.abs(p.x - r.x) <= r.width / 2 + 0.01 && Math.abs(p.z - r.z) <= r.depth / 2 + 0.01);
    const obstacles = [...boxes, ...level.props.filter(p => p.collider).map(p => ({
        x: p.x, z: p.z, halfX: p.collider!.halfX, halfZ: p.collider!.halfZ,
    }))];
    for (const [actorIndex, actor] of (level.guards ?? []).entries()) {
        const points = actor.loop ? [...actor.path, actor.path[0]] : actor.path;
        const blocked = points.some((point, i) => {
            const previous = points[Math.max(0, i - 1)];
            const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z) / 0.2));
            for (let step = 0; step <= steps; step++) {
                const x = previous.x + (point.x - previous.x) * step / steps;
                const z = previous.z + (point.z - previous.z) * step / steps;
                if (obstacles.some(b => Math.abs(x - b.x) < b.halfX + 0.4 && Math.abs(z - b.z) < b.halfZ + 0.4)) return true;
            }
            return false;
        });
        if (blocked) failures.push(`${id}: guard ${actorIndex} patrol crosses a collider`);
    }
    const free = (p: LevelPoint) => inside(p) && !obstacles.some(b =>
        Math.abs(p.x - b.x) < b.halfX + 0.48 && Math.abs(p.z - b.z) < b.halfZ + 0.48);
    const cell = 0.25;
    const minX = Math.floor(Math.min(...regions.map(r => r.x - r.width / 2)) / cell);
    const maxX = Math.ceil(Math.max(...regions.map(r => r.x + r.width / 2)) / cell);
    const minZ = Math.floor(Math.min(...regions.map(r => r.z - r.depth / 2)) / cell);
    const maxZ = Math.ceil(Math.max(...regions.map(r => r.z + r.depth / 2)) / cell);
    const stride = maxX - minX + 1;
    const key = (x: number, z: number) => (z - minZ) * stride + x - minX;
    const nearest = (p: LevelPoint) => {
        const x = Math.round(p.x / cell), z = Math.round(p.z / cell);
        let best: { x: number; z: number; distance: number } | undefined;
        for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
            const q = { x: (x + dx) * cell, z: (z + dz) * cell };
            const distance = Math.hypot(p.x - q.x, p.z - q.z);
            if (free(q) && (!best || distance < best.distance)) best = { x: x + dx, z: z + dz, distance };
        }
        return best;
    };
    const members = level.squad?.length ? level.squad : [{ start: level.start, waypoints: level.waypoints }];
    for (const [memberIndex, member] of members.entries()) {
        const start = nearest(member.start);
        if (!start) { failures.push(`${id} member ${memberIndex}: blocked start`); continue; }
        const seen = new Set([key(start.x, start.z)]);
        const queue = [start];
        for (let i = 0; i < queue.length; i++) {
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const x = queue[i].x + dx, z = queue[i].z + dz;
                if (x < minX || x > maxX || z < minZ || z > maxZ || seen.has(key(x, z)) || !free({ x: x * cell, z: z * cell })) continue;
                seen.add(key(x, z)); queue.push({ x, z, distance: 0 });
            }
        }
        for (const [label, targets] of [['waypoint', member.waypoints], ['loot', level.loot]] as const) {
            for (const target of targets) {
                const q = nearest(target);
                if (!q || !seen.has(key(q.x, q.z))) failures.push(`${id} member ${memberIndex}: unreachable ${label} at ${target.x},${target.z}`);
            }
        }
        if (level.sharedGoal?.enabled !== false && level.sharedGoal) {
            const goal = level.sharedGoal;
            for (let i = 0; i < members.length; i++) {
                const slot = nearest({ x: goal.x + (i - (members.length - 1) / 2) * 1.8, z: goal.z });
                if (!slot || !seen.has(key(slot.x, slot.z))) failures.push(`${id}: unreachable shared-goal slot ${i}`);
            }
        }
    }
    checked++;
}
assert.equal(failures.length, 0, failures.join('\n'));
console.log(`${checked} non-tutorial layouts: all member waypoints, shared-goal slots and loot reachable; guard patrols clear`);
