// VoxelWall.ts
//
// The wall: a block of cells (columns x rows x depth), each alive or gone. A hit takes the ones nearest the spot, steered by
// weak lines (a seeded noise, weaker toward the bottom), so holes branch and the aim still decides; whatever's left hanging
// with nothing holding it falls too. It comes down once a share of its cells is gone (WALL.breakShare): that share is its
// HP, so the bar and the hole are the same thing.
//
// Drawn as one InstancedMesh of chamfered blocks: only the cells that can be seen (with nothing in front of them, or beside
// them) are in it, and a cell uncovered joins in. The colours are baked: the material's pattern, a little of its own per
// cell, darker the deeper it is.
//
// The grid's z runs out of the wall: z = depth - 1 is its face. World: the wall's middle at x = 0, its foot at y = 0, its
// face at z = 0.

import * as THREE from 'three';
import { fx, vivid } from '../config/Effects';
import { MaterialDef, WALL, hash, noise2 } from '../data/WallConfig';

const CELL = WALL.cell;
/** A block's share of its cell, and how much it varies. */
const BLOCK = { share: 0.97, jitter: 0.05, chamfer: 0.09 };
/** How much darker each layer in is, and each block's own lighter or darker. */
const DEPTH_SHADE = 0.08;
const OWN_SHADE = 0.1;
/** The deepest layers are another colour (what's inside). */
const CORE_LAYERS = 2;
/** The weak lines: how big, and how much the bottom's weaker. */
const WEAK = { scale: 0.17, fine: 0.42, bottom: 0.35 };
/** Tiles round a hit flash: how long (seconds), how white at first, and how far past what was hit. */
const FLASH = { seconds: 0.22, white: 0.8, past: 0.5 };
const WHITE = new THREE.Color(1, 1, 1);
/** Strain: from this share of its HP on, it trembles. */
const STRAIN_FROM = 0.3;

/** The boss gate's skull (its top first): bone, eyes. */
const SKULL = [
    '..#######..',
    '.#########.',
    '###########',
    '##ooo#ooo##',
    '##ooo#ooo##',
    '##.oo#oo.##',
    '.####.####.',
    '..###.###..',
    '..#######..',
    '..#.#.#.#..',
    '..#.#.#.#..',
];

export interface Cell {
    position: THREE.Vector3;
    color: THREE.Color;
}

export interface Bite {
    wide: number;
    deep: number;
}

/** A block with its edges cut off: 44 triangles, 1 across. */
export function blockGeometry(chamfer = BLOCK.chamfer): THREE.BufferGeometry {
    const h = 0.5;
    const i = h - chamfer;
    const positions: number[] = [];
    const face = (points: number[][]) => {
        // Its winding from its own middle, outwards.
        const mid = [0, 1, 2].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length);
        const a = points[0];
        const b = points[1];
        const c = points[2];
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const ordered = n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0 ? [...points].reverse() : points;
        for (let k = 1; k < ordered.length - 1; k++) positions.push(...ordered[0], ...ordered[k], ...ordered[k + 1]);
    };
    const place = (axis: number, along: number, b: number, c: number) => {
        const point = [0, 0, 0];
        point[axis] = along;
        point[(axis + 1) % 3] = b;
        point[(axis + 2) % 3] = c;
        return point;
    };
    for (let axis = 0; axis < 3; axis++) {
        for (const s of [-h, h]) face([place(axis, s, -i, -i), place(axis, s, i, -i), place(axis, s, i, i), place(axis, s, -i, i)]);
        // The edges along this axis.
        for (const b of [-1, 1]) for (const c of [-1, 1]) {
            face([place(axis, -i, b * h, c * i), place(axis, i, b * h, c * i), place(axis, i, b * i, c * h), place(axis, -i, b * i, c * h)]);
        }
    }
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) face([[x * h, y * i, z * i], [x * i, y * h, z * i], [x * i, y * i, z * h]]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}

let sharedBlock: THREE.BufferGeometry | undefined;

export class VoxelWall {
    public readonly group = new THREE.Group();
    private readonly mesh: THREE.InstancedMesh;
    private readonly alive: Uint8Array;
    /** A cell's instance (-1: none), and an instance's cell. */
    private readonly instanceOf: Int32Array;
    private readonly cellOf: Int32Array;
    private readonly weak: Float32Array;
    private readonly total: number;
    /** Cells to take to bring it down, and how many are gone. */
    private readonly toBreak: number;
    private gone = 0;
    /** Damage toward the next cell. */
    private carry = 0;
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly scale = new THREE.Vector3();
    private readonly still = new THREE.Quaternion();
    private readonly color = new THREE.Color();
    private readonly palette: THREE.Color[];
    private readonly core: THREE.Color[];
    /** Cells flashing: the seconds left, and how white. */
    private readonly flashing = new Map<number, { left: number; white: number }>();
    private readonly seen: Uint8Array;
    private readonly stack: Int32Array;

    public constructor(private readonly def: MaterialDef, public readonly hp: number, public readonly seed: number, public readonly cols: number, gone?: string) {
        this.total = cols * WALL.rows * WALL.depth;
        this.toBreak = Math.round(this.total * WALL.breakShare);
        this.alive = new Uint8Array(this.total).fill(1);
        this.instanceOf = new Int32Array(this.total).fill(-1);
        this.cellOf = new Int32Array(this.total);
        this.weak = new Float32Array(this.total);
        this.seen = new Uint8Array(this.total);
        this.stack = new Int32Array(this.total);
        const tinted = (color: string) => {
            const made = new THREE.Color(color);
            if (def.hue) made.offsetHSL(def.hue, 0.08, 0);
            return vivid(made);
        };
        this.palette = def.colors.map(tinted);
        this.core = def.core.map(tinted);
        for (let i = 0; i < this.total; i++) {
            const { x, y } = this.at(i);
            this.weak[i] = (noise2(x * WEAK.scale, y * WEAK.scale, seed) * 0.7 + noise2(x * WEAK.fine, y * WEAK.fine, seed + 9) * 0.3) * (1 - WEAK.bottom) + (y / WALL.rows) * WEAK.bottom;
        }
        if (gone) this.restore(gone);
        sharedBlock ??= blockGeometry();
        this.mesh = new THREE.InstancedMesh(sharedBlock, new THREE.MeshLambertMaterial(), this.total);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.setColorAt(0, this.color.setRGB(1, 1, 1));
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        for (let i = 0; i < this.total; i++) if (this.alive[i] && this.uncovered(i)) this.draw(i);
        this.group.add(this.mesh);
        this.flush();
    }

    // ---------------------------------------------------------------- the grid

    private at(i: number): { x: number; y: number; z: number } {
        const z = Math.floor(i / (this.cols * WALL.rows));
        const rest = i - z * this.cols * WALL.rows;
        const y = Math.floor(rest / this.cols);
        return { x: rest - y * this.cols, y, z };
    }

    private index(x: number, y: number, z: number): number {
        return x < 0 || y < 0 || z < 0 || x >= this.cols || y >= WALL.rows || z >= WALL.depth ? -1 : x + (y + z * WALL.rows) * this.cols;
    }

    private isAlive(x: number, y: number, z: number): boolean {
        const i = this.index(x, y, z);
        return i >= 0 && this.alive[i] === 1;
    }

    /** A cell's middle, in the wall's space. */
    private placeOf(i: number, out: THREE.Vector3): THREE.Vector3 {
        const { x, y, z } = this.at(i);
        return out.set((x + 0.5 - this.cols / 2) * CELL, (y + 0.5) * CELL, (z + 0.5 - WALL.depth) * CELL);
    }

    /** Seen from the front: its face, or any of its sides but the back, is open. */
    private uncovered(i: number): boolean {
        const { x, y, z } = this.at(i);
        if (!this.isAlive(x, y, z + 1)) return true;
        const open = (a: number, b: number) => a >= 0 && b >= 0 && a < this.cols && b < WALL.rows && !this.isAlive(a, b, z);
        return open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1);
    }

    // ---------------------------------------------------------------- what's drawn

    /** A cell's own colour: its material's pattern, its depth, a little of its own. */
    public colorOf(i: number, out: THREE.Color): THREE.Color {
        const { x, y, z } = this.at(i);
        const deep = WALL.depth - 1 - z;
        const own = hash(x, y, z, this.seed);
        if (deep >= WALL.depth - CORE_LAYERS) out.copy(this.core[Math.floor(own * this.core.length)]);
        else out.copy(this.pattern(x, y, own));
        return out.multiplyScalar((1 - deep * DEPTH_SHADE) * (1 - OWN_SHADE / 2 + own * OWN_SHADE));
    }

    private pattern(x: number, y: number, own: number): THREE.Color {
        const pick = (t: number) => this.palette[Math.min(this.palette.length - 1, Math.floor(t * this.palette.length))];
        switch (this.def.look) {
            case 'brick': {
                // Courses two cells high, bricks four long, each course half a brick along.
                const course = Math.floor(y / 2);
                return pick(hash(Math.floor((x + (course % 2) * 2) / 4), course, 1, this.seed));
            }
            case 'stone': {
                // Blocks of uneven sizes.
                const row = Math.floor(y / 3);
                const shift = Math.floor(hash(row, 0, 2, this.seed) * 5);
                return pick(hash(Math.floor((x + shift) / 5), row, 3, this.seed) * 0.8 + own * 0.2);
            }
            case 'iron': {
                // Plates with rivets at their corners.
                const px = x % 7;
                const py = y % 6;
                if (px === 0 || py === 0) return this.palette[1];
                return (px === 1 || px === 6) && (py === 1 || py === 5) ? this.palette[2] : this.palette[0];
            }
            case 'boxes': {
                // Boxes piled up, a strip of tape over each.
                const row = Math.floor(y / 5);
                const bx = x + (row % 2) * 3;
                if (bx % 6 === 0 || y % 5 === 0) return this.palette[1];
                return y % 5 === 3 ? this.palette[3] : this.palette[hash(Math.floor(bx / 6), row, 1, this.seed) < 0.5 ? 0 : 2];
            }
            case 'planks': {
                // Upright ones, a dark gap and the odd knot.
                if (x % 4 === 3) return this.palette[3];
                return hash(x, y, 8, this.seed) < 0.03 ? this.palette[3] : this.palette[Math.min(2, Math.floor(hash(Math.floor(x / 4), Math.floor(y / 9), 2, this.seed) * 3))];
            }
            case 'gate': {
                // Plates, and a great skull on them.
                const row = SKULL[SKULL.length - 1 - (y - Math.round((WALL.rows - SKULL.length) / 2))];
                const mark = row?.[x - Math.round((this.cols - SKULL[0].length) / 2)];
                if (mark === '#') return this.palette[2];
                if (mark === 'o') return this.palette[3];
                return x % 4 === 0 || y % 4 === 0 ? this.palette[1] : this.palette[0];
            }
            case 'stripes':
                // Slanting ones.
                return this.palette[Math.floor((x + y) / 3) % 2 === 0 ? (own < 0.5 ? 0 : 2) : own < 0.7 ? 1 : 3];
            case 'circuit': {
                // Tracks with pads where they meet, on a board.
                const cx = Math.floor(x / 4);
                const cy = Math.floor(y / 4);
                const along = x % 4 === 1 && hash(cx, 0, 5, this.seed) < 0.6;
                const across = y % 4 === 2 && hash(cy, 1, 5, this.seed) < 0.6;
                if (along && across) return this.palette[3];
                return along || across ? this.palette[own < 0.3 ? 3 : 2] : this.palette[own < 0.5 ? 0 : 1];
            }
            case 'veins':
                // Veins.
                return Math.abs(noise2(x * 0.22, y * 0.22, this.seed + 4) - 0.5) < 0.035 ? this.palette[3] : pick(own * 0.75);
            default:
                return pick(noise2(x * 0.3, y * 0.3, this.seed + 2) * 0.7 + own * 0.3);
        }
    }

    private draw(i: number): void {
        if (this.instanceOf[i] >= 0) return;
        const n = this.mesh.count++;
        this.instanceOf[i] = n;
        this.cellOf[n] = i;
        this.placeOf(i, this.position);
        this.scale.setScalar(CELL * BLOCK.share * (1 - BLOCK.jitter / 2 + hash(i, 7, 7, this.seed) * BLOCK.jitter));
        this.mesh.setMatrixAt(n, this.matrix.compose(this.position, this.still, this.scale));
        this.mesh.setColorAt(n, this.colorOf(i, this.color));
    }

    private undraw(i: number): void {
        const n = this.instanceOf[i];
        if (n < 0) return;
        const last = --this.mesh.count;
        if (n !== last) {
            const moved = this.cellOf[last];
            this.mesh.getMatrixAt(last, this.matrix);
            this.mesh.setMatrixAt(n, this.matrix);
            this.mesh.getColorAt(last, this.color);
            this.mesh.setColorAt(n, this.color);
            this.cellOf[n] = moved;
            this.instanceOf[moved] = n;
        }
        this.instanceOf[i] = -1;
    }

    private flush(): void {
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    // ---------------------------------------------------------------- hitting it

    /** What's left of its HP (1 whole, 0 down). */
    public get share(): number {
        return Math.max(0, 1 - (this.gone + this.carry) / this.toBreak);
    }

    public get down(): boolean {
        return this.gone >= this.toBreak;
    }

    /** Where a ray (in the wall's space) meets it: the first cell standing; through a hole, the nearest one to where it comes out. */
    public aim(ray: THREE.Ray): { point: THREE.Vector3; cell: number } | null {
        // Stepped through from its face, a third of a cell at a time (it's only a few cells deep).
        if (ray.direction.z > -1e-3) return null;
        const point = new THREE.Vector3();
        const step = (CELL / 3) / -ray.direction.z;
        let t = (0 - ray.origin.z) / ray.direction.z;
        const end = (-WALL.depth * CELL - ray.origin.z) / ray.direction.z;
        for (; t <= end + step; t += step) {
            ray.at(t, point);
            const cell = this.index(Math.floor(point.x / CELL + this.cols / 2), Math.floor(point.y / CELL), Math.floor(point.z / CELL + WALL.depth - 1e-6));
            if (cell >= 0 && this.alive[cell]) return { point, cell };
        }
        ray.at((-WALL.depth * CELL * 0.5 - ray.origin.z) / ray.direction.z, point);
        let best = -1;
        let nearest = Infinity;
        const middle = new THREE.Vector3();
        for (let i = 0; i < this.total; i++) {
            if (!this.alive[i]) continue;
            const distance = this.placeOf(i, middle).distanceToSquared(point);
            if (distance < nearest) {
                nearest = distance;
                best = i;
            }
        }
        return best < 0 ? null : { point: this.placeOf(best, point), cell: best };
    }

    /** A standing cell that shows, where something could hit it (the wall's space): of a few, the one nearest to (x, y). */
    public spotNear(x: number, y: number, tries: number, out: THREE.Vector3): THREE.Vector3 | null {
        if (this.mesh.count === 0) return null;
        let best = -1;
        let nearest = Infinity;
        for (let k = 0; k < tries; k++) {
            const i = this.cellOf[Math.floor(Math.random() * this.mesh.count)];
            const distance = this.placeOf(i, out).x - x;
            const far = Math.hypot(distance, (out.y - y) * 0.6) - out.z * 0.5;
            if (far < nearest) {
                nearest = far;
                best = i;
            }
        }
        return best < 0 ? null : this.placeOf(best, out);
    }

    /** A hit of `damage` at `point` (the wall's space): the cells it takes, what falls with them included. */
    public hit(point: THREE.Vector3, damage: number, bite: Bite): { cells: Cell[]; fallen: Cell[] } {
        // (A touch more: three thirds are a whole.)
        this.carry += (damage / this.hp) * this.toBreak + 1e-4;
        const count = Math.min(Math.floor(this.carry), this.toBreak - this.gone);
        this.carry -= Math.floor(this.carry);
        if (count <= 0) return { cells: [], fallen: [] };
        // The nearest, the weak ones seeming nearer; across and into the wall by the tool's bite.
        const middle = new THREE.Vector3();
        const reach = (Math.cbrt(count) * 1.6 + 3) * CELL;
        const order: { i: number; far: number }[] = [];
        const collect = (limit: number) => {
            order.length = 0;
            for (let i = 0; i < this.total; i++) {
                if (!this.alive[i]) continue;
                this.placeOf(i, middle).sub(point);
                const across = Math.hypot(middle.x, middle.y) / bite.wide;
                const into = Math.abs(middle.z) / bite.deep;
                const far = Math.hypot(across, into);
                if (far < limit) order.push({ i, far: far + this.weak[i] * WALL.noise * CELL * 2 });
            }
        };
        collect(reach);
        if (order.length < count) collect(Infinity);
        order.sort((a, b) => a.far - b.far);
        const cells = order.slice(0, count).map(({ i }) => this.take(i));
        const fallen = this.down ? [] : this.dropLoose();
        this.flush();
        return { cells, fallen };
    }

    /** A cell goes; what was behind and beside it shows. */
    private take(i: number): Cell {
        this.alive[i] = 0;
        this.gone++;
        this.undraw(i);
        const { x, y, z } = this.at(i);
        for (const [dx, dy, dz] of NEIGHBOURS) {
            const n = this.index(x + dx, y + dy, z + dz);
            if (n >= 0 && this.alive[n] && this.instanceOf[n] < 0 && this.uncovered(n)) this.draw(n);
        }
        return { position: this.placeOf(i, new THREE.Vector3()), color: this.colorOf(i, new THREE.Color()) };
    }

    /** Cells no longer joined to the wall's edges fall. */
    private dropLoose(): Cell[] {
        this.seen.fill(0);
        let top = 0;
        const push = (i: number) => {
            if (i < 0 || !this.alive[i] || this.seen[i]) return;
            this.seen[i] = 1;
            this.stack[top++] = i;
        };
        for (let z = 0; z < WALL.depth; z++) {
            for (let x = 0; x < this.cols; x++) {
                push(this.index(x, 0, z));
                push(this.index(x, WALL.rows - 1, z));
            }
            for (let y = 0; y < WALL.rows; y++) {
                push(this.index(0, y, z));
                push(this.index(this.cols - 1, y, z));
            }
        }
        while (top > 0) {
            const { x, y, z } = this.at(this.stack[--top]);
            for (const [dx, dy, dz] of NEIGHBOURS) push(this.index(x + dx, y + dy, z + dz));
        }
        const fallen: Cell[] = [];
        for (let i = 0; i < this.total; i++) if (this.alive[i] && !this.seen[i]) fallen.push(this.take(i));
        return fallen;
    }

    /** It comes down: every cell that showed (for the burst); nothing's left of it. */
    public collapse(): Cell[] {
        const cells: Cell[] = [];
        for (let n = 0; n < this.mesh.count; n++) {
            const i = this.cellOf[n];
            cells.push({ position: this.placeOf(i, new THREE.Vector3()), color: this.colorOf(i, new THREE.Color()) });
        }
        this.mesh.count = 0;
        this.mesh.visible = false;
        return cells;
    }

    /** The tiles that show within `reach` of a hit (the wall's space) flash white, the nearer the more. */
    public flash(point: THREE.Vector3, reach: number): void {
        const strong = Math.min(1, FLASH.white * fx('tileFlash'));
        if (strong <= 0) return;
        const far = reach + FLASH.past;
        for (let n = 0; n < this.mesh.count; n++) {
            const distance = this.placeOf(this.cellOf[n], this.position).distanceTo(point);
            if (distance < far) this.flashing.set(this.cellOf[n], { left: FLASH.seconds, white: strong * (1 - 0.55 * (distance / far)) });
        }
        this.updateFlash(0);
    }

    /** The flash fades. */
    public updateFlash(delta: number): void {
        if (this.flashing.size === 0) return;
        for (const [cell, flash] of this.flashing) {
            flash.left -= delta;
            const n = this.instanceOf[cell];
            if (n >= 0) {
                const t = Math.max(0, flash.left / FLASH.seconds);
                this.mesh.setColorAt(n, this.colorOf(cell, this.color).lerp(WHITE, flash.white * t * t));
            }
            if (n < 0 || flash.left <= 0) this.flashing.delete(cell);
        }
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    /** Nearly down, it trembles. */
    public update(time: number): void {
        const strain = Math.max(0, 1 - this.share / STRAIN_FROM) * fx('tremble');
        this.group.position.x = strain > 0 ? Math.sin(time * 47) * 0.008 * strain : 0;
        this.group.rotation.z = strain > 0 ? Math.sin(time * 31) * 0.0012 * strain : 0;
    }

    // ---------------------------------------------------------------- the save

    /** The cells gone, a bit each. */
    public save(): string {
        const bytes = new Uint8Array(Math.ceil(this.total / 8));
        for (let i = 0; i < this.total; i++) if (!this.alive[i]) bytes[i >> 3] |= 1 << (i & 7);
        let text = '';
        bytes.forEach((byte) => (text += String.fromCharCode(byte)));
        return btoa(text);
    }

    private restore(saved: string): void {
        try {
            const text = atob(saved);
            if (text.length !== Math.ceil(this.total / 8)) return;
            for (let i = 0; i < this.total; i++) {
                if (!(text.charCodeAt(i >> 3) & (1 << (i & 7)))) continue;
                this.alive[i] = 0;
                this.gone++;
            }
        } catch {
            // Not ours: a whole wall.
        }
    }

    public dispose(): void {
        this.group.removeFromParent();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh.dispose();
    }
}

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
