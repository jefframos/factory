// StoreNavGrid.ts
//
// A walkability grid over one store (its area plus entrance/exit — see
// Store.buildNavGrid()) and A* pathfinding on it. A navmesh would be
// overkill here: a store is one small room with a handful of clients, and a
// fine grid gives the same paths for far less (see the store README's
// "Client pathfinding & avoidance").
//
// Blocked cells are painted by whoever builds the grid (blockRect() /
// blockWhere()) with obstacles already inflated by the client radius, so a
// path through walkable cell centers never clips a corner. Paths:
//   - start/goal snap to the nearest walkable cell (a client may stand just
//     inside an inflated obstacle — e.g. at a shelf's pick-up spot),
//   - 8-neighbour A* with an octile heuristic and no diagonal corner cutting,
//     an optional extra per-cell cost (NavAgent uses it to go around clients
//     standing still),
//   - then string-pulled with line-of-sight checks down to a few straight
//     segments, ending exactly on the goal.
// findPath() returns false when there's no path at all; callers fall back to
// walking straight (fail-open, never stuck forever).
//
// Scratch arrays are allocated once per grid and reused with a search stamp,
// so a path costs no allocation beyond the returned waypoints.

import * as THREE from 'three';

export interface NavBounds {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
}

/** Extra cost for stepping onto the cell centered at (x, z) — 0 for none. */
export type NavCellCost = (x: number, z: number) => number;

const SQRT2 = Math.SQRT2;
/** Neighbour offsets: 4 straight, then 4 diagonal. */
const NEIGHBOURS: readonly [number, number, number][] = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];
/** How far nearestWalkableCell() searches outward, in cells. */
const MAX_SNAP_RADIUS_CELLS = 12;

export default class StoreNavGrid {
    public readonly cellSize: number;
    public readonly minX: number;
    public readonly minZ: number;
    public readonly cols: number;
    public readonly rows: number;

    private readonly blocked: Uint8Array;
    private readonly gScore: Float32Array;
    private readonly cameFrom: Int32Array;
    private readonly stamp: Uint32Array;
    private readonly closedStamp: Uint32Array;
    private searchId = 0;
    private readonly heap: MinHeap;

    public constructor(bounds: NavBounds, cellSize: number) {
        this.cellSize = cellSize;
        this.minX = bounds.minX;
        this.minZ = bounds.minZ;
        this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
        this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
        const count = this.cols * this.rows;
        this.blocked = new Uint8Array(count);
        this.gScore = new Float32Array(count);
        this.cameFrom = new Int32Array(count);
        this.stamp = new Uint32Array(count);
        this.closedStamp = new Uint32Array(count);
        this.heap = new MinHeap(count);
    }

    public get cellCount(): number {
        return this.cols * this.rows;
    }

    /** Blocks every cell whose center lies inside `bounds` grown by `inflate` on every side. */
    public blockRect(bounds: NavBounds, inflate: number): void {
        const c0 = Math.max(0, Math.ceil((bounds.minX - inflate - this.minX) / this.cellSize - 0.5));
        const c1 = Math.min(this.cols - 1, Math.floor((bounds.maxX + inflate - this.minX) / this.cellSize - 0.5));
        const r0 = Math.max(0, Math.ceil((bounds.minZ - inflate - this.minZ) / this.cellSize - 0.5));
        const r1 = Math.min(this.rows - 1, Math.floor((bounds.maxZ + inflate - this.minZ) / this.cellSize - 0.5));
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                this.blocked[r * this.cols + c] = 1;
            }
        }
    }

    /** Blocks every cell whose center `isBlocked` says is blocked. */
    public blockWhere(isBlocked: (x: number, z: number) => boolean): void {
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                if (isBlocked(this.minX + (c + 0.5) * this.cellSize, this.minZ + (r + 0.5) * this.cellSize)) {
                    this.blocked[r * this.cols + c] = 1;
                }
            }
        }
    }

    /** Same blocked cells as `other` (same size grid)? Lets a rebuild skip replanning when nothing changed. */
    public sameBlockedAs(other: StoreNavGrid): boolean {
        if (other.cols !== this.cols || other.rows !== this.rows) {
            return false;
        }
        for (let i = 0; i < this.blocked.length; i++) {
            if (this.blocked[i] !== other.blocked[i]) {
                return false;
            }
        }
        return true;
    }

    public isCellBlocked(index: number): boolean {
        return this.blocked[index] === 1;
    }

    /** Cell index under world (x, z), or -1 outside the grid. */
    public cellAt(x: number, z: number): number {
        const c = Math.floor((x - this.minX) / this.cellSize);
        const r = Math.floor((z - this.minZ) / this.cellSize);
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) {
            return -1;
        }
        return r * this.cols + c;
    }

    public cellCenter(index: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        const c = index % this.cols;
        const r = (index - c) / this.cols;
        return target.set(this.minX + (c + 0.5) * this.cellSize, 0, this.minZ + (r + 0.5) * this.cellSize);
    }

    /** Walkable = inside the grid and not blocked. */
    public isWalkableAt(x: number, z: number): boolean {
        const index = this.cellAt(x, z);
        return index !== -1 && this.blocked[index] === 0;
    }

    /** The walkable cell nearest to (x, z) — the cell itself if walkable — or -1 if none within MAX_SNAP_RADIUS_CELLS. */
    public nearestWalkableCell(x: number, z: number): number {
        const c0 = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize)));
        const r0 = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cellSize)));
        if (this.blocked[r0 * this.cols + c0] === 0) {
            return r0 * this.cols + c0;
        }
        for (let radius = 1; radius <= MAX_SNAP_RADIUS_CELLS; radius++) {
            let best = -1;
            let bestDistSq = Infinity;
            for (let dr = -radius; dr <= radius; dr++) {
                for (let dc = -radius; dc <= radius; dc++) {
                    if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) {
                        continue;
                    }
                    const c = c0 + dc;
                    const r = r0 + dr;
                    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || this.blocked[r * this.cols + c] === 1) {
                        continue;
                    }
                    const cx = this.minX + (c + 0.5) * this.cellSize - x;
                    const cz = this.minZ + (r + 0.5) * this.cellSize - z;
                    const distSq = cx * cx + cz * cz;
                    if (distSq < bestDistSq) {
                        bestDistSq = distSq;
                        best = r * this.cols + c;
                    }
                }
            }
            if (best !== -1) {
                return best;
            }
        }
        return -1;
    }

    /** Snaps `point` onto the nearest walkable cell center if it isn't walkable already (in place). */
    public snapToWalkable(point: THREE.Vector3): THREE.Vector3 {
        if (this.isWalkableAt(point.x, point.z)) {
            return point;
        }
        const index = this.nearestWalkableCell(point.x, point.z);
        return index === -1 ? point : this.cellCenter(index, point);
    }

    /**
     * True if a client can walk the straight segment a -> b. Samples within `endSlack` of either
     * end are ignored, so a client standing just inside an inflated obstacle can still step out.
     */
    public hasLineOfSight(ax: number, az: number, bx: number, bz: number, endSlack: number = this.cellSize * 1.5): boolean {
        const dx = bx - ax;
        const dz = bz - az;
        const length = Math.hypot(dx, dz);
        if (length < 1e-6) {
            return true;
        }
        const step = this.cellSize * 0.5;
        for (let d = 0; d <= length; d += step) {
            if (d < endSlack || length - d < endSlack) {
                continue;
            }
            if (!this.isWalkableAt(ax + (dx * d) / length, az + (dz * d) / length)) {
                return false;
            }
        }
        return true;
    }

    /**
     * A* from `from` to `to`, smoothed. Fills `out` with the waypoints AFTER the start, the last
     * being exactly `to`. Returns false (and leaves `out` empty) when there's no path.
     */
    public findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[], extraCost?: NavCellCost): boolean {
        out.length = 0;
        const start = this.nearestWalkableCell(from.x, from.z);
        const goal = this.nearestWalkableCell(to.x, to.z);
        if (start === -1 || goal === -1) {
            return false;
        }
        if (start === goal || this.hasLineOfSight(from.x, from.z, to.x, to.z)) {
            out.push(to.clone());
            return true;
        }

        const cells = this.searchCells(start, goal, extraCost);
        if (!cells) {
            return false;
        }

        // String-pull: from the current anchor, jump to the farthest cell still in line of sight.
        const points = cells.map(index => this.cellCenter(index));
        points.push(to.clone());
        let anchorX = from.x;
        let anchorZ = from.z;
        let i = 0;
        while (i < points.length) {
            let farthest = i;
            for (let j = points.length - 1; j > i; j--) {
                if (this.hasLineOfSight(anchorX, anchorZ, points[j].x, points[j].z)) {
                    farthest = j;
                    break;
                }
            }
            const point = points[farthest];
            out.push(point);
            anchorX = point.x;
            anchorZ = point.z;
            i = farthest + 1;
        }
        return true;
    }

    /** Uniform random walkable point inside `bounds` (a few tries), or undefined. */
    public randomWalkablePoint(bounds: NavBounds, accept?: (point: THREE.Vector3) => boolean, tries = 24): THREE.Vector3 | undefined {
        const point = new THREE.Vector3();
        for (let i = 0; i < tries; i++) {
            point.set(
                bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
                0,
                bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ),
            );
            if (this.isWalkableAt(point.x, point.z) && (!accept || accept(point))) {
                return point;
            }
        }
        return undefined;
    }

    /** Every walkable cell center within `radius` of (x, z). */
    public walkableCellsNear(x: number, z: number, radius: number): THREE.Vector3[] {
        const result: THREE.Vector3[] = [];
        const c0 = Math.max(0, Math.floor((x - radius - this.minX) / this.cellSize));
        const c1 = Math.min(this.cols - 1, Math.floor((x + radius - this.minX) / this.cellSize));
        const r0 = Math.max(0, Math.floor((z - radius - this.minZ) / this.cellSize));
        const r1 = Math.min(this.rows - 1, Math.floor((z + radius - this.minZ) / this.cellSize));
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                if (this.blocked[r * this.cols + c] === 1) {
                    continue;
                }
                const cx = this.minX + (c + 0.5) * this.cellSize;
                const cz = this.minZ + (r + 0.5) * this.cellSize;
                if ((cx - x) * (cx - x) + (cz - z) * (cz - z) <= radius * radius) {
                    result.push(new THREE.Vector3(cx, 0, cz));
                }
            }
        }
        return result;
    }

    /** Plain A* over cell indices — the cells from start to goal (inclusive), or undefined if unreachable. */
    private searchCells(start: number, goal: number, extraCost?: NavCellCost): number[] | undefined {
        const id = ++this.searchId;
        const cols = this.cols;
        const goalC = goal % cols;
        const goalR = (goal - goalC) / cols;
        const heuristic = (index: number): number => {
            const c = index % cols;
            const dc = Math.abs(c - goalC);
            const dr = Math.abs((index - c) / cols - goalR);
            return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
        };

        this.heap.clear();
        this.stamp[start] = id;
        this.gScore[start] = 0;
        this.cameFrom[start] = -1;
        this.heap.push(start, heuristic(start));

        while (this.heap.size > 0) {
            const current = this.heap.pop();
            if (current === goal) {
                const cells: number[] = [];
                for (let at = goal; at !== -1; at = this.cameFrom[at]) {
                    cells.push(at);
                }
                return cells.reverse();
            }
            if (this.closedStamp[current] === id) {
                continue;
            }
            this.closedStamp[current] = id;

            const c = current % cols;
            const r = (current - c) / cols;
            for (const [dc, dr, cost] of NEIGHBOURS) {
                const nc = c + dc;
                const nr = r + dr;
                if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) {
                    continue;
                }
                const next = nr * cols + nc;
                if (this.blocked[next] === 1 || this.closedStamp[next] === id) {
                    continue;
                }
                // No corner cutting: a diagonal needs both straight neighbours free.
                if (dc !== 0 && dr !== 0 && (this.blocked[r * cols + nc] === 1 || this.blocked[nr * cols + c] === 1)) {
                    continue;
                }
                let stepCost = cost;
                if (extraCost) {
                    stepCost += extraCost(this.minX + (nc + 0.5) * this.cellSize, this.minZ + (nr + 0.5) * this.cellSize);
                }
                const tentative = this.gScore[current] + stepCost;
                if (this.stamp[next] === id && tentative >= this.gScore[next]) {
                    continue;
                }
                this.stamp[next] = id;
                this.gScore[next] = tentative;
                this.cameFrom[next] = current;
                this.heap.push(next, tentative + heuristic(next));
            }
        }
        return undefined;
    }
}

/** Binary min-heap of cell indices keyed by f-score. Duplicates are allowed (stale entries are skipped via the closed stamp). */
class MinHeap {
    private indices: Int32Array;
    private keys: Float32Array;
    public size = 0;

    public constructor(capacity: number) {
        this.indices = new Int32Array(Math.max(16, capacity));
        this.keys = new Float32Array(Math.max(16, capacity));
    }

    public clear(): void {
        this.size = 0;
    }

    public push(index: number, key: number): void {
        if (this.size === this.indices.length) {
            const indices = new Int32Array(this.size * 2);
            const keys = new Float32Array(this.size * 2);
            indices.set(this.indices);
            keys.set(this.keys);
            this.indices = indices;
            this.keys = keys;
        }
        let i = this.size++;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.keys[parent] <= key) {
                break;
            }
            this.indices[i] = this.indices[parent];
            this.keys[i] = this.keys[parent];
            i = parent;
        }
        this.indices[i] = index;
        this.keys[i] = key;
    }

    public pop(): number {
        const top = this.indices[0];
        const lastIndex = this.indices[--this.size];
        const lastKey = this.keys[this.size];
        let i = 0;
        for (;;) {
            let child = 2 * i + 1;
            if (child >= this.size) {
                break;
            }
            if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) {
                child++;
            }
            if (this.keys[child] >= lastKey) {
                break;
            }
            this.indices[i] = this.indices[child];
            this.keys[i] = this.keys[child];
            i = child;
        }
        this.indices[i] = lastIndex;
        this.keys[i] = lastKey;
        return top;
    }
}
