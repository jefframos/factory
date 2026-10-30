// GuidePath.ts
//
// The walking route for the guide's floor arrows: A* over a CELL-sized grid around the miner and the target, the
// blocked cells being solid rock (VoxelTerrain) and the hub's colliders (walls, stations, props, built pieces —
// HubRoom.blockers). The grid is lined up with the rock's 1-unit blocks (two cells per block), so a 1-wide tunnel is
// always two open cells: rock blocks exactly its own cells, and cells touching rock only cost more (the route keeps
// to the middle of wide tunnels without closing narrow ones). Hub colliders are grown by the miner's radius so the
// route keeps clear of their corners. The search box is SIZE units a side around the miner and the target — the
// whole mine, so a route can go the long way round through the tunnels — and cells are only looked at as the search
// reaches them, so that costs no more than the route needs. Returns the route as world points from the miner to the target; with no way through (the target
// boxed in by rock) it leads as close as it can get, then straight on.

import * as THREE from 'three';

const CELL = 0.5;
/** Hub colliders are grown by the miner's half-width (plus a little), so the route never hugs a wall. */
const CLEARANCE = 0.45;
/** A cell this close to rock costs this much more: the route keeps to the middle of tunnels. */
const ROCK_NEAR = 0.3;
const ROCK_NEAR_COST = 1.5;
/** The search box side, in cells (SIZE * CELL units: more than the whole mine across). */
const SIZE = 360;
/** Give up (and lead as close as reached) after this many cells, so a target with no way to it can't stall a frame. */
const MAX_EXPANDED = 60000;
const SMOOTH_REACH = 40;

export interface Box {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
}

const enum Cell {
    Unknown = 0,
    Open = 1,
    Near = 2,
    Blocked = 3,
}

/** The search grids, made once and cleared for every search (a repath runs several times a second). */
const buffers = {
    cells: new Uint8Array(SIZE * SIZE),
    g: new Float32Array(SIZE * SIZE),
    came: new Int32Array(SIZE * SIZE),
    closed: new Uint8Array(SIZE * SIZE),
};

export function findPath(from: THREE.Vector3, to: THREE.Vector3, solid: (x: number, z: number) => boolean, boxes: readonly Box[]): THREE.Vector3[] {
    // Centred between the two, snapped to whole units so cell edges fall on block edges.
    const w = SIZE;
    const h = SIZE;
    const minX = Math.floor((from.x + to.x) / 2 - (SIZE * CELL) / 2);
    const minZ = Math.floor((from.z + to.z) / 2 - (SIZE * CELL) / 2);
    const cx = (i: number) => minX + (i + 0.5) * CELL;
    const cz = (j: number) => minZ + (j + 0.5) * CELL;
    const { cells, g, came, closed } = buffers;
    cells.fill(Cell.Unknown);
    g.fill(Infinity);
    came.fill(-1);
    closed.fill(0);
    const kind = (k: number): Cell => {
        if (cells[k] !== Cell.Unknown) return cells[k];
        const x = cx(k % w);
        const z = cz(Math.floor(k / w));
        let result = Cell.Open;
        if (solid(x, z) || boxes.some((b) => Math.abs(x - b.x) <= b.halfX + CLEARANCE && Math.abs(z - b.z) <= b.halfZ + CLEARANCE)) {
            result = Cell.Blocked;
        } else if (solid(x + ROCK_NEAR, z) || solid(x - ROCK_NEAR, z) || solid(x, z + ROCK_NEAR) || solid(x, z - ROCK_NEAR)) {
            result = Cell.Near;
        }
        cells[k] = result;
        return result;
    };
    const cellOf = (p: THREE.Vector3): [number, number] => [
        THREE.MathUtils.clamp(Math.floor((p.x - minX) / CELL), 0, w - 1),
        THREE.MathUtils.clamp(Math.floor((p.z - minZ) / CELL), 0, h - 1),
    ];
    const [si, sj] = cellOf(from);
    const [gi, gj] = cellOf(to);
    const start = si + sj * w;
    const goal = gi + gj * w;
    // The miner's own cell and the target's (a pad, a doorway, a buildable spot) always count as open.
    cells[start] = Cell.Open;
    cells[goal] = Cell.Open;

    // Octile distance: exact on an 8-way grid with no obstacles.
    const heuristic = (k: number) => {
        const dx = Math.abs((k % w) - gi);
        const dz = Math.abs(Math.floor(k / w) - gj);
        return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    const open = new Heap();
    g[start] = 0;
    open.push(start, heuristic(start));
    // The closest cell reached, in case the goal can't be.
    let nearest = start;
    let expanded = 0;
    while (open.size && expanded < MAX_EXPANDED) {
        const k = open.pop();
        if (k === goal) break;
        if (closed[k]) continue;
        closed[k] = 1;
        expanded++;
        if (heuristic(k) < heuristic(nearest)) nearest = k;
        const i = k % w;
        const j = Math.floor(k / w);
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
                const nk = ni + nj * w;
                if (closed[nk]) continue;
                const next = kind(nk);
                if (next === Cell.Blocked) continue;
                // No cutting corners diagonally past a blocked cell.
                if (di && dj && (kind(i + di + j * w) === Cell.Blocked || kind(i + (j + dj) * w) === Cell.Blocked)) continue;
                const cost = g[k] + (di && dj ? Math.SQRT2 : 1) * (next === Cell.Near ? ROCK_NEAR_COST : 1);
                if (cost >= g[nk]) continue;
                g[nk] = cost;
                came[nk] = k;
                open.push(nk, cost + heuristic(nk));
            }
        }
    }
    const reached = came[goal] >= 0 || goal === start;
    const end = reached ? goal : nearest;
    const route: number[] = [];
    for (let k = end; k !== -1; k = came[k]) route.unshift(k);
    const points = route.map((k) => new THREE.Vector3(cx(k % w), 0, cz(Math.floor(k / w))));
    points[0] = from.clone().setY(0);
    if (reached) points[points.length - 1] = to.clone().setY(0);
    else points.push(to.clone().setY(0));
    return smooth(points, solid, boxes);
}

/** A binary min-heap of cell indices by priority (the A* open list). */
class Heap {
    private readonly keys: number[] = [];
    private readonly priorities: number[] = [];

    public get size(): number {
        return this.keys.length;
    }

    public push(key: number, priority: number): void {
        const keys = this.keys;
        const priorities = this.priorities;
        let n = keys.length;
        keys.push(key);
        priorities.push(priority);
        while (n > 0) {
            const parent = (n - 1) >> 1;
            if (priorities[parent] <= priority) break;
            keys[n] = keys[parent];
            priorities[n] = priorities[parent];
            n = parent;
        }
        keys[n] = key;
        priorities[n] = priority;
    }

    public pop(): number {
        const keys = this.keys;
        const priorities = this.priorities;
        const top = keys[0];
        const lastKey = keys.pop()!;
        const lastPriority = priorities.pop()!;
        const size = keys.length;
        if (size === 0) return top;
        let n = 0;
        for (;;) {
            let child = 2 * n + 1;
            if (child >= size) break;
            if (child + 1 < size && priorities[child + 1] < priorities[child]) child++;
            if (priorities[child] >= lastPriority) break;
            keys[n] = keys[child];
            priorities[n] = priorities[child];
            n = child;
        }
        keys[n] = lastKey;
        priorities[n] = lastPriority;
        return top;
    }
}

/**
 * String-pulling: drops corners a straight walk can skip (checked against the same obstacles, rock with a little
 * room either side so a shortcut never clips a tunnel corner), so arrows run straight.
 */
function smooth(points: THREE.Vector3[], solid: (x: number, z: number) => boolean, boxes: readonly Box[]): THREE.Vector3[] {
    const room = 0.2;
    const clear = (a: THREE.Vector3, b: THREE.Vector3) => {
        const steps = Math.ceil(a.distanceTo(b) / (CELL * 0.5));
        for (let s = 1; s < steps; s++) {
            const x = a.x + ((b.x - a.x) * s) / steps;
            const z = a.z + ((b.z - a.z) * s) / steps;
            if (solid(x, z) || solid(x + room, z + room) || solid(x - room, z + room) || solid(x + room, z - room) || solid(x - room, z - room)) return false;
            if (boxes.some((box) => Math.abs(x - box.x) <= box.halfX + CLEARANCE * 0.6 && Math.abs(z - box.z) <= box.halfZ + CLEARANCE * 0.6)) return false;
        }
        return true;
    };
    const out = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
        let far = anchor + 1;
        // Shortcuts are only looked for this many cells ahead: a long route costs no more than a short one.
        for (let n = Math.min(points.length - 1, anchor + SMOOTH_REACH); n > anchor + 1; n--) {
            if (clear(points[anchor], points[n])) {
                far = n;
                break;
            }
        }
        out.push(points[far]);
        anchor = far;
    }
    return out;
}
