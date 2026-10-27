import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { levelDoors, LevelData, LevelPoint, shouldShowWaypointMarker, vaultSafe } from '../games/bandit-controller/game/data/LevelData';
import { NavGrid } from '../games/bandit-controller/game/utils/NavGrid';
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
        assert.equal(shouldShowWaypointMarker(level, count - 1, count), !shared && !level.vault, `${id}: final disk duplicates shared area or vault room`);
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
assert(shouldShowWaypointMarker({ ...twoThieves, vault: undefined, sharedGoal: { ...twoThieves.sharedGoal, enabled: false } }, 2, 3));
assert(!shouldShowWaypointMarker({ ...twoThieves, sharedGoal: { ...twoThieves.sharedGoal, enabled: false } }, 2, 3),
    'the vault room replaces the final disk');
assert(shouldShowWaypointMarker({ ...twoThieves, vault: undefined, squad: twoThieves.squad.slice(0, 1) }, 2, 3));
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
const campaign = [...new Set(worlds.worlds.flatMap(w => w.levels))];
for (const id of campaign) {
    const level = readLevel(id);
    const boxes = boxesFor(level);
    assert(boxes.every(b => [b.x, b.z, b.halfX, b.halfZ].every(Number.isFinite)), `${id}: invalid wall collider`);
    const floor = level.floor.rects?.length ? level.floor.rects : [{ x: 0, z: 0, ...level.floor }];
    const regions = [...floor, ...(level.entryPath ? [level.entryPath] : [])];
    const vault = level.vault;
    if (!vault) { failures.push(`${id}: no vault room`); continue; }
    const safe = vaultSafe(vault);
    const obstacles = [...boxes, { x: safe.x, z: safe.z, halfX: safe.halfX, halfZ: safe.halfZ },
        ...level.props.filter(p => p.collider).map(p => ({ x: p.x, z: p.z, halfX: p.collider!.halfX, halfZ: p.collider!.halfZ }))];
    const insideVault = (p: LevelPoint, pad = 0) => Math.abs(p.x - vault.x) <= vault.width / 2 + pad && Math.abs(p.z - vault.z) <= vault.depth / 2 + pad;

    // Vault room: big enough, guard-free, one entrance, the safe on the far side from it.
    if (Math.min(vault.width, vault.depth) < 6.5) failures.push(`${id}: vault smaller than 6.5`);
    const enemies = [...(level.guards ?? []).flatMap(g => g.path), ...(level.drones ?? []).flatMap(d => d.path),
        ...(level.cameras ?? []), ...(level.traps ?? [])];
    if (enemies.some(p => insideVault(p, 0.3))) failures.push(`${id}: enemy inside the vault`);
    const vaultDoors = levelDoors(level).filter(d => insideVault(d, 0.4));
    if (vaultDoors.length !== 1) failures.push(`${id}: vault needs exactly one door, has ${vaultDoors.length}`);
    const axis = vault.side.endsWith('x') ? 'x' : 'z';
    const sign = vault.side.startsWith('+') ? 1 : -1;
    const members = level.squad?.length ? level.squad : [{ start: level.start, waypoints: level.waypoints }];
    for (const member of members) {
        const finish = member.waypoints[member.waypoints.length - 1];
        if (!insideVault(finish)) failures.push(`${id}: finish ${finish.x},${finish.z} outside the vault`);
        const door = vaultDoors[0];
        if (door && !((safe[axis] - finish[axis]) * sign > 1 && (finish[axis] - door[axis]) * sign > 1)) {
            failures.push(`${id}: finish must sit between the vault door and the safe`);
        }
    }

    for (const [actorIndex, actor] of (level.guards ?? []).entries()) {
        const points = actor.loop ? [...actor.path, actor.path[0]] : actor.path;
        const blocked = points.some((point, i) => {
            const previous = points[Math.max(0, i - 1)];
            const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z) / 0.2));
            for (let step = 0; step <= steps; step++) {
                const x = previous.x + (point.x - previous.x) * step / steps;
                const z = previous.z + (point.z - previous.z) * step / steps;
                if (obstacles.some(b => Math.abs(x - b.x) < b.halfX + 0.4 && Math.abs(z - b.z) < b.halfZ + 0.4)) return true;
                if (insideVault({ x, z })) return true;
            }
            return false;
        });
        if (blocked) failures.push(`${id}: guard ${actorIndex} patrol crosses a collider or the vault`);
    }

    // Same grid, clearance and A* the game uses to assist drawn routes.
    const grid = new NavGrid(regions, obstacles, 0.55);
    for (const [memberIndex, member] of members.entries()) {
        const stops = [member.start, ...member.waypoints];
        for (let i = 1; i < stops.length; i++) {
            if (!grid.findPath(stops[i - 1], stops[i])) {
                failures.push(`${id} member ${memberIndex}: no walkable path ${stops[i - 1].x},${stops[i - 1].z} -> ${stops[i].x},${stops[i].z}`);
            }
        }
        for (const loot of level.loot) {
            if (!grid.findPath(member.start, loot)) failures.push(`${id} member ${memberIndex}: unreachable loot at ${loot.x},${loot.z}`);
        }
    }
    checked++;
}
assert.equal(failures.length, 0, failures.join('\n'));
console.log(`${checked} campaign layouts: vault rooms guard-free with the safe opposite the entrance; every checkpoint and loot reachable on the game's nav grid`);

// Route assist: brushing a wall slides along it; a trace through a wall detours through the door.
{
    const level = readLevel('w1-08');
    const floor = level.floor.rects!;
    const grid = new NavGrid([...floor, level.entryPath!], boxesFor(level), 0.55);
    const routeHits = (route: LevelPoint[]) => route.some((p, i) => i > 0 && !grid.segmentClear(route[i - 1], p));
    const through = grid.assistRoute([{ x: -3, z: 2.52 }, { x: -3, z: -6 }, { x: 3, z: -6 }]);
    assert(!routeHits(through), 'assisted route must never cut through a wall');
    const brushing = grid.assistRoute([{ x: -8, z: 2.52 }, { x: -8, z: 4.4 }, { x: -6, z: 4.4 }, { x: -4, z: 2.52 }]);
    assert(!routeHits(brushing), 'brushing a wall must slide along it');
    assert(Math.hypot(brushing[brushing.length - 1].x + 4, brushing[brushing.length - 1].z - 2.52) < 0.3, 'assist keeps the release point');
}
console.log('Route assist keeps traces on the floor and detours through doors');
