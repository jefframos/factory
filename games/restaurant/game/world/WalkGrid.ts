// WalkGrid.ts
//
// Where customers can walk in the room as it is at the player's stage, and the way round what's in it. A grid over the
// floor (CELL across) with every cell a person can't stand in marked: the walls (core/rooms' collider boxes: doors and
// gaps stay open), round tables (as circles), and every other prop standing on the floor (as its turned box: counters,
// the oven's table, the fridge...). Not chairs and stools (people walk up to them to sit) and not what's up on a table
// or a counter. Everything's grown by a person's half width first, so a route keeps them clear of it.
//
// `route(from, to)`: the way there (A* on the grid, 8 ways), pulled straight wherever it can be (only the corners round
// things are kept). Ends exactly at `to`, even when `to` itself is just inside something (a seat by its table).

import * as THREE from 'three';
import type { Room } from 'core/rooms/Room';

/** Cell size (world units); a person's half width (clearance round things); how far round the floor's edge it reaches. */
const CELL = 0.2;
const CLEARANCE = 0.32;

/** A grid for something else: a car (bigger cells over the whole town, more room round things). */
export interface WalkGridOptions {
    cell?: number;
    clearance?: number;
    /** Props (by model) that aren't in the way for it (a car: lampposts, benches, trees — it drives through them). */
    ignore?: RegExp;
}
const MARGIN = 2;
/** Props people walk up to (they sit on them), and ones that are never in the way. */
const WALK_UP_TO = /chair|stool|bench/i;
/** Off the floor by more than this (on a table, a counter): not in the way. */
const ON_SOMETHING = 0.3;

export class WalkGrid {
    private readonly minX: number;
    private readonly minZ: number;
    private readonly columns: number;
    private readonly rows: number;
    private readonly blocked: Uint8Array;
    private readonly cell: number;

    public constructor(room: Room, area: { minX: number; maxX: number; minZ: number; maxZ: number }, options: WalkGridOptions = {}) {
        this.cell = options.cell ?? CELL;
        const clearance = options.clearance ?? CLEARANCE;
        this.minX = area.minX - MARGIN;
        this.minZ = area.minZ - MARGIN;
        this.columns = Math.ceil((area.maxX - area.minX + MARGIN * 2) / this.cell);
        this.rows = Math.ceil((area.maxZ - area.minZ + MARGIN * 2) / this.cell);
        this.blocked = new Uint8Array(this.columns * this.rows);

        for (const box of room.wallBoxes) {
            this.blockBox(box.x - box.halfX - clearance, box.x + box.halfX + clearance, box.z - box.halfZ - clearance, box.z + box.halfZ + clearance);
        }
        for (const { prop, object } of room.placed) {
            if (WALK_UP_TO.test(prop.model) || (prop.elevation ?? 0) > ON_SOMETHING || options.ignore?.test(prop.model)) continue;
            object.updateWorldMatrix(true, true);
            // Its own size (unturned), then its footprint turned as it stands.
            const turn = object.rotation.y;
            object.rotation.y = 0;
            object.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(object);
            object.rotation.y = turn;
            object.updateWorldMatrix(true, true);
            if (box.isEmpty()) continue;
            const size = box.getSize(new THREE.Vector3());
            // (Something flat on the floor — a rug, a puddle — isn't in the way.)
            if (size.y < 0.15) continue;
            const middle = box.getCenter(new THREE.Vector3()).sub(object.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).add(object.position);
            if (/round/i.test(prop.model)) this.blockCircle(middle.x, middle.z, Math.max(size.x, size.z) / 2 + clearance);
            else this.blockTurnedBox(middle.x, middle.z, size.x / 2 + clearance, size.z / 2 + clearance, turn);
        }
    }

    // ---------------------------------------------------------------- the grid

    private index(column: number, row: number): number {
        return row * this.columns + column;
    }

    private cellOf(x: number, z: number): [number, number] {
        return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)];
    }

    private middleOf(column: number, row: number): THREE.Vector3 {
        return new THREE.Vector3(this.minX + (column + 0.5) * this.cell, 0, this.minZ + (row + 0.5) * this.cell);
    }

    private inside(column: number, row: number): boolean {
        return column >= 0 && row >= 0 && column < this.columns && row < this.rows;
    }

    /** Whether a person can stand at (x, z) (off the grid counts as free: the street's open). */
    public free(x: number, z: number): boolean {
        const [column, row] = this.cellOf(x, z);
        return !this.inside(column, row) || !this.blocked[this.index(column, row)];
    }

    private blockWhere(minX: number, maxX: number, minZ: number, maxZ: number, hit: (x: number, z: number) => boolean): void {
        const [c0, r0] = this.cellOf(minX, minZ);
        const [c1, r1] = this.cellOf(maxX, maxZ);
        for (let row = Math.max(0, r0); row <= Math.min(this.rows - 1, r1); row++) {
            for (let column = Math.max(0, c0); column <= Math.min(this.columns - 1, c1); column++) {
                const middle = this.middleOf(column, row);
                if (hit(middle.x, middle.z)) this.blocked[this.index(column, row)] = 1;
            }
        }
    }

    private blockBox(minX: number, maxX: number, minZ: number, maxZ: number): void {
        this.blockWhere(minX, maxX, minZ, maxZ, () => true);
    }

    private blockCircle(x: number, z: number, radius: number): void {
        this.blockWhere(x - radius, x + radius, z - radius, z + radius, (px, pz) => Math.hypot(px - x, pz - z) <= radius);
    }

    private blockTurnedBox(x: number, z: number, halfX: number, halfZ: number, turn: number): void {
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const reach = Math.hypot(halfX, halfZ);
        this.blockWhere(x - reach, x + reach, z - reach, z + reach, (px, pz) => {
            // Into the box's own axes (undo its turn round y).
            const dx = px - x;
            const dz = pz - z;
            const lx = dx * cos - dz * sin;
            const lz = dx * sin + dz * cos;
            return Math.abs(lx) <= halfX && Math.abs(lz) <= halfZ;
        });
    }

    /** The free cell nearest (x, z) (itself if it's free), searching outward. */
    private nearestFree(x: number, z: number): [number, number] | null {
        const [column, row] = this.cellOf(x, z);
        if (!this.inside(column, row)) return null;
        if (!this.blocked[this.index(column, row)]) return [column, row];
        for (let ring = 1; ring < 40; ring++) {
            let best: [number, number] | null = null;
            let bestDistance = Infinity;
            for (let dr = -ring; dr <= ring; dr++) {
                for (let dc = -ring; dc <= ring; dc++) {
                    if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
                    const c = column + dc;
                    const r = row + dr;
                    if (!this.inside(c, r) || this.blocked[this.index(c, r)]) continue;
                    const distance = this.middleOf(c, r).distanceTo(new THREE.Vector3(x, 0, z));
                    if (distance < bestDistance) {
                        best = [c, r];
                        bestDistance = distance;
                    }
                }
            }
            if (best) return best;
        }
        return null;
    }

    /** The free spot nearest (x, z) (itself if free; null: none near, or off the grid). */
    public nearestFreePoint(x: number, z: number): THREE.Vector3 | null {
        const cell = this.nearestFree(x, z);
        return cell ? this.middleOf(cell[0], cell[1]) : null;
    }

    /** Whether the straight line a -> b stays on free cells. */
    public clear(a: THREE.Vector3, b: THREE.Vector3): boolean {
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(length / (this.cell * 0.5)));
        for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            if (!this.free(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
        }
        return true;
    }

    // ---------------------------------------------------------------- the way

    /** The way from `from` to `to` (the points after `from`, the last one `to`): round whatever's in between. */
    public route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
        const end = to.clone().setY(0);
        if (this.clear(from, end)) return [end];
        const start = this.nearestFree(from.x, from.z);
        const goal = this.nearestFree(to.x, to.z);
        if (!start || !goal) return [end];
        const cells = this.search(start, goal);
        if (!cells) return [end];
        // The cells' middles, from the start's (where `from` may not be), then pulled straight: from each point, on to
        // the furthest one it can see.
        const points = [from.clone().setY(0), ...cells.map(([c, r]) => this.middleOf(c, r)), end];
        const way: THREE.Vector3[] = [];
        let at = 0;
        while (at < points.length - 1) {
            let next = points.length - 1;
            while (next > at + 1 && !this.clear(points[at], points[next])) next--;
            way.push(points[next]);
            at = next;
        }
        return way;
    }

    /** A* from cell `start` to `goal` (8 ways; no cutting a blocked corner): the cells after `start`, or null. */
    private search(start: [number, number], goal: [number, number]): [number, number][] | null {
        const total = this.columns * this.rows;
        const cost = new Float32Array(total).fill(Infinity);
        const came = new Int32Array(total).fill(-1);
        const closed = new Uint8Array(total);
        const startIndex = this.index(start[0], start[1]);
        const goalIndex = this.index(goal[0], goal[1]);
        const guess = (i: number) => {
            const dc = Math.abs((i % this.columns) - goal[0]);
            const dr = Math.abs(Math.floor(i / this.columns) - goal[1]);
            return Math.max(dc, dr) + (Math.SQRT2 - 1) * Math.min(dc, dr);
        };
        // A binary heap of [estimate, cell].
        const heap: [number, number][] = [];
        const push = (item: [number, number]) => {
            heap.push(item);
            let k = heap.length - 1;
            while (k > 0) {
                const parent = (k - 1) >> 1;
                if (heap[parent][0] <= heap[k][0]) break;
                [heap[parent], heap[k]] = [heap[k], heap[parent]];
                k = parent;
            }
        };
        const pop = (): [number, number] => {
            const top = heap[0];
            const last = heap.pop()!;
            if (heap.length) {
                heap[0] = last;
                let k = 0;
                for (;;) {
                    const l = k * 2 + 1;
                    const r = l + 1;
                    let least = k;
                    if (l < heap.length && heap[l][0] < heap[least][0]) least = l;
                    if (r < heap.length && heap[r][0] < heap[least][0]) least = r;
                    if (least === k) break;
                    [heap[least], heap[k]] = [heap[k], heap[least]];
                    k = least;
                }
            }
            return top;
        };
        cost[startIndex] = 0;
        push([guess(startIndex), startIndex]);
        while (heap.length) {
            const [, current] = pop();
            if (closed[current]) continue;
            if (current === goalIndex) break;
            closed[current] = 1;
            const column = current % this.columns;
            const row = Math.floor(current / this.columns);
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (!dr && !dc) continue;
                    const c = column + dc;
                    const r = row + dr;
                    if (!this.inside(c, r)) continue;
                    const next = this.index(c, r);
                    if (this.blocked[next] || closed[next]) continue;
                    // Diagonally only when both sides are free (no slipping through a corner).
                    if (dr && dc && (this.blocked[this.index(column + dc, row)] || this.blocked[this.index(column, row + dr)])) continue;
                    const step = cost[current] + (dr && dc ? Math.SQRT2 : 1);
                    if (step < cost[next]) {
                        cost[next] = step;
                        came[next] = current;
                        push([step + guess(next), next]);
                    }
                }
            }
        }
        if (came[goalIndex] < 0 && goalIndex !== startIndex) return null;
        const cells: [number, number][] = [];
        for (let i = goalIndex; i !== startIndex; i = came[i]) cells.push([i % this.columns, Math.floor(i / this.columns)]);
        return cells.reverse();
    }
}
