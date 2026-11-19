// Roads.ts
//
// Ways along the level's roads for the farm test's trucks. truckRoutes(): the roads laid with the editor's road builder
// (🛣 Roads: the level's road cells, core/roads/RoadGrid — the same as the UFO and restaurant games'), driven as the
// cars do: over their network (a waypoint per tile, linked to its neighbours: TOWN.traffic), breadth first from the
// tile nearest one point to the tile nearest the other, on the right-hand lane (MOW.traffic.lane off the middle) — the
// way back on the other side. Without road tiles, the pavements whose id starts with `road` (roadPath(): a grid of
// CELL cells on those rects, eight neighbours, its corners kept), both ways down the middle.

import * as THREE from 'three';
import { MOW, TOWN } from '../data/MowConfig';
import type { SpawnArea } from '../data/MowConfig';

const CELL = 0.5;

/** The road rects (pavements whose id starts with `road`). */
function roads(): { x: number; z: number; width: number; depth: number }[] {
    return TOWN.pavements.filter((p) => p.id.startsWith('road'));
}

/** A random point in a spawn area of `kind` (any, at random), or null when the level has none. */
export function spawnPoint(kind: SpawnArea['kind'], near?: THREE.Vector3): THREE.Vector3 | null {
    const areas = (TOWN.spawns ?? []).filter((area) => area.kind === kind);
    if (!areas.length) return null;
    // Near something: the closest area; else any.
    const area = near
        ? areas.reduce((best, a) => (Math.hypot(a.x - near.x, a.z - near.z) < Math.hypot(best.x - near.x, best.z - near.z) ? a : best))
        : areas[Math.floor(Math.random() * areas.length)];
    return new THREE.Vector3(area.x + (Math.random() - 0.5) * area.width * 0.8, 0, area.z + (Math.random() - 0.5) * area.depth * 0.8);
}

/**
 * The way over the roads from `from` to `to` (each taken to the nearest road cell): the corners, `from`'s road cell
 * first and `to`'s last. Null when there are no roads or the two aren't joined by them.
 */
export function roadPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const rects = roads();
    if (!rects.length) return null;
    const minX = Math.min(...rects.map((r) => r.x - r.width / 2));
    const minZ = Math.min(...rects.map((r) => r.z - r.depth / 2));
    const maxX = Math.max(...rects.map((r) => r.x + r.width / 2));
    const maxZ = Math.max(...rects.map((r) => r.z + r.depth / 2));
    const cols = Math.ceil((maxX - minX) / CELL);
    const rows = Math.ceil((maxZ - minZ) / CELL);
    const centre = (c: number, r: number) => ({ x: minX + (c + 0.5) * CELL, z: minZ + (r + 0.5) * CELL });
    // A cell is road when its middle is on a road rect, with half a cell to spare from its edge (trucks keep inside).
    const road = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const { x, z } = centre(c, r);
            if (rects.some((p) => Math.abs(x - p.x) <= p.width / 2 - CELL && Math.abs(z - p.z) <= p.depth / 2 - CELL)) road[r * cols + c] = 1;
        }
    }
    const nearest = (point: THREE.Vector3): number => {
        let best = -1;
        let bestDistance = Infinity;
        for (let i = 0; i < road.length; i++) {
            if (!road[i]) continue;
            const { x, z } = centre(i % cols, Math.floor(i / cols));
            const distance = Math.hypot(x - point.x, z - point.z);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        }
        return best;
    };
    const start = nearest(from);
    const goal = nearest(to);
    if (start < 0 || goal < 0) return null;
    const previous = new Int32Array(cols * rows).fill(-1);
    previous[start] = start;
    const queue = [start];
    for (let head = 0; head < queue.length && previous[goal] < 0; head++) {
        const i = queue[head];
        const c = i % cols;
        const r = Math.floor(i / cols);
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (!dr && !dc) continue;
                const nc = c + dc;
                const nr = r + dr;
                if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
                const n = nr * cols + nc;
                // Diagonals only where both sides are road too (no cutting corners).
                if (!road[n] || previous[n] >= 0 || (dr && dc && (!road[r * cols + nc] || !road[nr * cols + c]))) continue;
                previous[n] = i;
                queue.push(n);
            }
        }
    }
    if (previous[goal] < 0) return null;
    const cells: number[] = [];
    for (let i = goal; ; i = previous[i]) {
        cells.push(i);
        if (i === start) break;
    }
    cells.reverse();
    // Keep the corners: where the step changes.
    const points: THREE.Vector3[] = [];
    let lastStep = '';
    cells.forEach((i, k) => {
        const next = cells[k + 1];
        const step = next === undefined ? '' : `${(next % cols) - (i % cols)},${Math.floor(next / cols) - Math.floor(i / cols)}`;
        if (k === 0 || next === undefined || step !== lastStep) {
            const { x, z } = centre(i % cols, Math.floor(i / cols));
            points.push(new THREE.Vector3(x, 0, z));
        }
        lastStep = step;
    });
    return points;
}

/** The way from `from` to `to` over the road tiles' network (waypoint middles), or null without one or a way. */
function networkPath(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null {
    const traffic = TOWN.traffic;
    if (!TOWN.roads?.cells.length || !traffic?.waypoints.length) return null;
    const byId = new Map(traffic.waypoints.map((w) => [w.id, w]));
    const links = new Map<string, string[]>();
    for (const [a, b] of traffic.links) {
        links.set(a, [...(links.get(a) ?? []), b]);
        links.set(b, [...(links.get(b) ?? []), a]);
    }
    const nearest = (point: THREE.Vector3) => traffic.waypoints.reduce((best, w) =>
        (Math.hypot(w.x - point.x, w.z - point.z) < Math.hypot(best.x - point.x, best.z - point.z) ? w : best));
    const start = nearest(from).id;
    const goal = nearest(to).id;
    const previous = new Map<string, string>([[start, start]]);
    const queue = [start];
    for (let head = 0; head < queue.length && !previous.has(goal); head++) {
        for (const next of links.get(queue[head]) ?? []) {
            if (previous.has(next)) continue;
            previous.set(next, queue[head]);
            queue.push(next);
        }
    }
    if (!previous.has(goal)) return null;
    const ids: string[] = [];
    for (let id = goal; ; id = previous.get(id)!) {
        ids.push(id);
        if (id === start) break;
    }
    return ids.reverse().map((id) => new THREE.Vector3(byId.get(id)!.x, 0, byId.get(id)!.z));
}

/**
 * `points` (down the road's middle) moved `lane` to the right of the way they're driven: each by its legs' average
 * heading (right of heading (x, z) is (-z, x): three.js, +Z ahead has +X on the left).
 */
function onLane(points: THREE.Vector3[], lane: number): THREE.Vector3[] {
    return points.map((point, k) => {
        const before = points[Math.max(0, k - 1)];
        const after = points[Math.min(points.length - 1, k + 1)];
        const dx = after.x - before.x;
        const dz = after.z - before.z;
        const length = Math.hypot(dx, dz) || 1;
        return new THREE.Vector3(point.x - (dz / length) * lane, 0, point.z + (dx / length) * lane);
    });
}

/**
 * A truck's ways: in (from `from` to where it parks, nearest `to`) and back out, each on its right-hand lane over the
 * road tiles (or down the middle of the road pavements). Null when the roads don't join the two.
 */
export function truckRoutes(from: THREE.Vector3, to: THREE.Vector3): { inbound: THREE.Vector3[]; outbound: THREE.Vector3[] } | null {
    const network = networkPath(from, to);
    if (network) {
        const lane = MOW.traffic?.lane ?? 1.75;
        // A single tile: in along its middle, out the same way.
        const way = network.length > 1 ? network : [from.clone(), network[0]];
        const back = [...way].reverse();
        return { inbound: onLane(way, lane), outbound: onLane(back, lane) };
    }
    const path = roadPath(from, to);
    if (!path) return null;
    return { inbound: [from.clone(), ...path], outbound: [...path].reverse().concat(from.clone()) };
}
