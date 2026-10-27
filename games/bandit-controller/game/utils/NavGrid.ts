// NavGrid.ts
//
// Walkable grid for drawn routes: floor rects (+ the entry path) minus every wall/prop collider
// inflated by the character's clearance. Used to keep traces on the floor, slide them off walls
// and detour them through doors with A* instead of rejecting the whole path. Plain {x, z} data so
// the level tests can use the exact same rules as the game.

export interface NavPoint {
    x: number;
    z: number;
}

export interface NavRegion {
    x: number;
    z: number;
    width: number;
    depth: number;
}

export interface NavBox {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
}

const SQRT2 = Math.SQRT2;

export class NavGrid {
    public readonly cell: number;
    private readonly minX: number;
    private readonly minZ: number;
    private readonly cols: number;
    private readonly rows: number;
    private readonly free: Uint8Array;

    constructor(
        private readonly regions: readonly NavRegion[],
        private readonly obstacles: readonly NavBox[],
        public readonly clearance = 0.55,
        cell = 0.25,
    ) {
        this.cell = cell;
        const minX = Math.min(...regions.map((r) => r.x - r.width / 2));
        const maxX = Math.max(...regions.map((r) => r.x + r.width / 2));
        const minZ = Math.min(...regions.map((r) => r.z - r.depth / 2));
        const maxZ = Math.max(...regions.map((r) => r.z + r.depth / 2));
        this.minX = minX;
        this.minZ = minZ;
        this.cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
        this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
        this.free = new Uint8Array(this.cols * this.rows);
        for (let row = 0; row < this.rows; row++) {
            for (let col = 0; col < this.cols; col++) {
                this.free[row * this.cols + col] = this.isFree(this.cellX(col), this.cellZ(row)) ? 1 : 0;
            }
        }
    }

    /** Point test with the full clearance: on a floor piece and away from every collider. */
    public isFree(x: number, z: number): boolean {
        const inside = this.regions.some((r) => Math.abs(x - r.x) <= r.width / 2 + 1e-6 && Math.abs(z - r.z) <= r.depth / 2 + 1e-6);
        if (!inside) {
            return false;
        }
        const c = this.clearance;
        return !this.obstacles.some((b) => Math.abs(x - b.x) < b.halfX + c && Math.abs(z - b.z) < b.halfZ + c);
    }

    /** True when the straight segment stays on free ground (sampled finer than a cell). */
    public segmentClear(a: NavPoint, b: NavPoint): boolean {
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(length / (this.cell * 0.5)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            if (!this.isFree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Closest free spot to `point`. With `from`, spots reachable in a straight line from it win,
     * so a trace brushing a wall slides along the near side instead of jumping through it.
     */
    public nearestFree(point: NavPoint, from?: NavPoint, maxRadius = 3): NavPoint | undefined {
        if (this.isFree(point.x, point.z) && (!from || this.segmentClear(from, point))) {
            return { x: point.x, z: point.z };
        }
        const clamped = this.clampToRegions(point);
        const centreCol = Math.round((clamped.x - this.minX) / this.cell);
        const centreRow = Math.round((clamped.z - this.minZ) / this.cell);
        const radius = Math.ceil(maxRadius / this.cell);
        const candidates: { point: NavPoint; distance: number }[] = [];
        for (let dr = -radius; dr <= radius; dr++) {
            for (let dc = -radius; dc <= radius; dc++) {
                const col = centreCol + dc;
                const row = centreRow + dr;
                if (!this.cellFree(col, row)) {
                    continue;
                }
                const candidate = { x: this.cellX(col), z: this.cellZ(row) };
                candidates.push({ point: candidate, distance: Math.hypot(candidate.x - point.x, candidate.z - point.z) });
            }
        }
        if (candidates.length === 0) {
            return undefined;
        }
        candidates.sort((a, b) => a.distance - b.distance);
        if (from) {
            // Only nearby spots count as "the near side"; further ones mean the trace really crossed.
            const limit = candidates[0].distance + 1.2;
            for (const candidate of candidates) {
                if (candidate.distance > limit) {
                    break;
                }
                if (this.segmentClear(from, candidate.point)) {
                    return candidate.point;
                }
            }
        }
        return candidates[0].point;
    }

    /** Shortest free path (A*, 8-connected, then string-pulled). Undefined when there is none. */
    public findPath(start: NavPoint, goal: NavPoint): NavPoint[] | undefined {
        if (this.segmentClear(start, goal)) {
            return [{ ...start }, { ...goal }];
        }
        const from = this.nearestCell(start);
        const to = this.nearestCell(goal);
        if (from === undefined || to === undefined) {
            return undefined;
        }
        const count = this.cols * this.rows;
        const g = new Float32Array(count).fill(Infinity);
        const parent = new Int32Array(count).fill(-1);
        const closed = new Uint8Array(count);
        const goalCol = to % this.cols;
        const goalRow = Math.floor(to / this.cols);
        const heuristic = (index: number): number => {
            const dc = Math.abs(index % this.cols - goalCol);
            const dr = Math.abs(Math.floor(index / this.cols) - goalRow);
            return Math.max(dc, dr) + (SQRT2 - 1) * Math.min(dc, dr);
        };
        const heap = new MinHeap();
        g[from] = 0;
        heap.push(from, heuristic(from));
        let found = false;
        while (heap.size > 0) {
            const current = heap.pop();
            if (closed[current]) {
                continue;
            }
            if (current === to) {
                found = true;
                break;
            }
            closed[current] = 1;
            const col = current % this.cols;
            const row = Math.floor(current / this.cols);
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (!dr && !dc) {
                        continue;
                    }
                    const nc = col + dc;
                    const nr = row + dr;
                    if (!this.cellFree(nc, nr)) {
                        continue;
                    }
                    // No corner cutting past a blocked cell.
                    if (dr && dc && (!this.cellFree(col + dc, row) || !this.cellFree(col, row + dr))) {
                        continue;
                    }
                    const next = nr * this.cols + nc;
                    const cost = g[current] + (dr && dc ? SQRT2 : 1);
                    if (cost < g[next]) {
                        g[next] = cost;
                        parent[next] = current;
                        heap.push(next, cost + heuristic(next));
                    }
                }
            }
        }
        if (!found) {
            return undefined;
        }
        const cells: NavPoint[] = [];
        for (let index = to; index !== -1; index = parent[index]) {
            cells.push({ x: this.cellX(index % this.cols), z: this.cellZ(Math.floor(index / this.cols)) });
        }
        cells.reverse();
        const raw = [{ ...start }, ...cells, { ...goal }];
        return this.smooth(raw);
    }

    /** Drops every point that a straight, clear line can skip. */
    public smooth(points: readonly NavPoint[]): NavPoint[] {
        if (points.length <= 2) {
            return points.map((p) => ({ ...p }));
        }
        const out: NavPoint[] = [{ ...points[0] }];
        let anchor = 0;
        while (anchor < points.length - 1) {
            let next = anchor + 1;
            for (let probe = points.length - 1; probe > anchor + 1; probe--) {
                if (this.segmentClear(points[anchor], points[probe])) {
                    next = probe;
                    break;
                }
            }
            out.push({ ...points[next] });
            anchor = next;
        }
        return out;
    }

    /**
     * Next stretch of an assisted route from `last` toward the raw `target`: the target slides off
     * walls onto the floor, and a stretch that would cut through a wall detours through a door.
     * Returns the new points (without `last`), or undefined when the target is unreachable.
     */
    public extend(last: NavPoint, target: NavPoint): NavPoint[] | undefined {
        const snapped = this.nearestFree(target, last);
        if (!snapped) {
            return undefined;
        }
        if (this.segmentClear(last, snapped)) {
            return [snapped];
        }
        const path = this.findPath(last, snapped);
        return path?.slice(1);
    }

    /** Whole-trace version of extend(): every raw sample kept on the floor and joined without hitting walls. */
    public assistRoute(trace: readonly NavPoint[]): NavPoint[] {
        if (trace.length === 0) {
            return [];
        }
        const first = this.isFree(trace[0].x, trace[0].z) ? { ...trace[0] } : this.nearestFree(trace[0]) ?? { ...trace[0] };
        const out: NavPoint[] = [first];
        for (let i = 1; i < trace.length; i++) {
            const added = this.extend(out[out.length - 1], trace[i]);
            if (added) {
                out.push(...added);
            }
        }
        return out;
    }

    private clampToRegions(point: NavPoint): NavPoint {
        let best = { x: point.x, z: point.z };
        let bestDistance = Infinity;
        for (const r of this.regions) {
            const x = Math.min(Math.max(point.x, r.x - r.width / 2), r.x + r.width / 2);
            const z = Math.min(Math.max(point.z, r.z - r.depth / 2), r.z + r.depth / 2);
            const distance = Math.hypot(x - point.x, z - point.z);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = { x, z };
            }
        }
        return best;
    }

    private nearestCell(point: NavPoint): number | undefined {
        const spot = this.nearestFree(point);
        if (!spot) {
            return undefined;
        }
        const col = Math.round((spot.x - this.minX) / this.cell);
        const row = Math.round((spot.z - this.minZ) / this.cell);
        return this.cellFree(col, row) ? row * this.cols + col : undefined;
    }

    private cellFree(col: number, row: number): boolean {
        return col >= 0 && row >= 0 && col < this.cols && row < this.rows && this.free[row * this.cols + col] === 1;
    }

    private cellX(col: number): number {
        return this.minX + col * this.cell;
    }

    private cellZ(row: number): number {
        return this.minZ + row * this.cell;
    }
}

class MinHeap {
    private readonly items: number[] = [];
    private readonly priorities: number[] = [];

    public get size(): number {
        return this.items.length;
    }

    public push(item: number, priority: number): void {
        this.items.push(item);
        this.priorities.push(priority);
        let index = this.items.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this.priorities[parent] <= this.priorities[index]) {
                break;
            }
            this.swap(parent, index);
            index = parent;
        }
    }

    public pop(): number {
        const top = this.items[0];
        const lastItem = this.items.pop() as number;
        const lastPriority = this.priorities.pop() as number;
        if (this.items.length > 0) {
            this.items[0] = lastItem;
            this.priorities[0] = lastPriority;
            let index = 0;
            for (;;) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;
                if (left < this.items.length && this.priorities[left] < this.priorities[smallest]) {
                    smallest = left;
                }
                if (right < this.items.length && this.priorities[right] < this.priorities[smallest]) {
                    smallest = right;
                }
                if (smallest === index) {
                    break;
                }
                this.swap(index, smallest);
                index = smallest;
            }
        }
        return top;
    }

    private swap(a: number, b: number): void {
        [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
        [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
    }
}
