// GuidePath.ts
//
// The walking route for the guide's floor arrows: A* over a CELL-sized grid around the miner and the target, the
// blocked cells being solid rock (VoxelTerrain) and the hub's colliders (walls, stations, props, built pieces —
// HubRoom.blockers), each grown by the miner's radius so the route keeps clear of corners. Returns the route as world
// points from the miner to the target (straight line if there is none, e.g. the target is boxed in by rock).

import * as THREE from 'three';

const CELL = 0.5;
/** Grown by the miner's half-width (plus a little), so the route never hugs a wall. */
const CLEARANCE = 0.45;
/** The search box: the miner and the target plus this margin, never bigger than MAX_CELLS a side. */
const MARGIN = 6;
const MAX_CELLS = 120;

export interface Box {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
}

export function findPath(from: THREE.Vector3, to: THREE.Vector3, solid: (x: number, z: number) => boolean, boxes: readonly Box[]): THREE.Vector3[] {
    const minX = Math.min(from.x, to.x) - MARGIN;
    const minZ = Math.min(from.z, to.z) - MARGIN;
    const w = Math.min(MAX_CELLS, Math.ceil((Math.max(from.x, to.x) + MARGIN - minX) / CELL));
    const h = Math.min(MAX_CELLS, Math.ceil((Math.max(from.z, to.z) + MARGIN - minZ) / CELL));
    const cx = (i: number) => minX + (i + 0.5) * CELL;
    const cz = (j: number) => minZ + (j + 0.5) * CELL;
    const blocked = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
            const x = cx(i);
            const z = cz(j);
            // Rock: the cell and its clearance ring.
            if (solid(x, z) || solid(x + CLEARANCE, z) || solid(x - CLEARANCE, z) || solid(x, z + CLEARANCE) || solid(x, z - CLEARANCE)) {
                blocked[i + j * w] = 1;
                continue;
            }
            for (const b of boxes) {
                if (Math.abs(x - b.x) <= b.halfX + CLEARANCE && Math.abs(z - b.z) <= b.halfZ + CLEARANCE) {
                    blocked[i + j * w] = 1;
                    break;
                }
            }
        }
    }
    const cellOf = (p: THREE.Vector3): [number, number] => [
        THREE.MathUtils.clamp(Math.floor((p.x - minX) / CELL), 0, w - 1),
        THREE.MathUtils.clamp(Math.floor((p.z - minZ) / CELL), 0, h - 1),
    ];
    const [si, sj] = cellOf(from);
    const [gi, gj] = cellOf(to);
    // The miner's own cell and the target's (a pad, a doorway, a buildable spot) always count as open.
    blocked[si + sj * w] = 0;
    blocked[gi + gj * w] = 0;
    const start = si + sj * w;
    const goal = gi + gj * w;

    const g = new Float32Array(w * h).fill(Infinity);
    const came = new Int32Array(w * h).fill(-1);
    const open: number[] = [start];
    const f = new Float32Array(w * h).fill(Infinity);
    const heuristic = (k: number) => Math.hypot((k % w) - gi, Math.floor(k / w) - gj);
    g[start] = 0;
    f[start] = heuristic(start);
    const closed = new Uint8Array(w * h);
    while (open.length) {
        let best = 0;
        for (let n = 1; n < open.length; n++) if (f[open[n]] < f[open[best]]) best = n;
        const k = open[best];
        open[best] = open[open.length - 1];
        open.pop();
        if (k === goal) break;
        if (closed[k]) continue;
        closed[k] = 1;
        const i = k % w;
        const j = Math.floor(k / w);
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
                const nk = ni + nj * w;
                if (blocked[nk] || closed[nk]) continue;
                // No cutting corners diagonally past a blocked cell.
                if (di && dj && (blocked[i + di + j * w] || blocked[i + (j + dj) * w])) continue;
                const cost = g[k] + (di && dj ? Math.SQRT2 : 1);
                if (cost >= g[nk]) continue;
                g[nk] = cost;
                came[nk] = k;
                f[nk] = cost + heuristic(nk);
                open.push(nk);
            }
        }
    }
    if (came[goal] < 0 && goal !== start) return [from.clone().setY(0), to.clone().setY(0)];
    const cells: number[] = [];
    for (let k = goal; k !== -1; k = came[k]) cells.unshift(k);
    const points = cells.map((k) => new THREE.Vector3(cx(k % w), 0, cz(Math.floor(k / w))));
    points[0] = from.clone().setY(0);
    points[points.length - 1] = to.clone().setY(0);
    return smooth(points, solid, boxes);
}

/** String-pulling: drops corners a straight walk can skip (checked against the same obstacles), so arrows run straight. */
function smooth(points: THREE.Vector3[], solid: (x: number, z: number) => boolean, boxes: readonly Box[]): THREE.Vector3[] {
    const clear = (a: THREE.Vector3, b: THREE.Vector3) => {
        const steps = Math.ceil(a.distanceTo(b) / (CELL * 0.5));
        for (let s = 1; s < steps; s++) {
            const x = a.x + ((b.x - a.x) * s) / steps;
            const z = a.z + ((b.z - a.z) * s) / steps;
            if (solid(x, z)) return false;
            if (boxes.some((box) => Math.abs(x - box.x) <= box.halfX + CLEARANCE * 0.6 && Math.abs(z - box.z) <= box.halfZ + CLEARANCE * 0.6)) return false;
        }
        return true;
    };
    const out = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
        let far = anchor + 1;
        for (let n = points.length - 1; n > anchor + 1; n--) {
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
