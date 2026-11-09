// Shapes.ts
//
// The field's obstacles as the battle sees them: a polygon (any outline: a box is just four corners) or a circle, with
// its bounding box for a quick "nowhere near" test. What a mob needs from one: is it touching it (grown by its radius),
// which way out, and which way along the nearest edge — so a crowd slides round any shape, not only boxes.

export interface Shape {
    /** The polygon's corners as x, z pairs (flat), in order round it; empty for a circle. */
    points: Float32Array;
    circle?: { x: number; z: number; r: number };
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

/** A polygon from [x, z] corners. */
export function polygonShape(corners: readonly (readonly [number, number])[]): Shape {
    const points = new Float32Array(corners.length * 2);
    corners.forEach(([x, z], i) => points.set([x, z], i * 2));
    const xs = corners.map((c) => c[0]);
    const zs = corners.map((c) => c[1]);
    return { points, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** A box (width across, depth along, centred on x, z) as a polygon. */
export function boxShape(x: number, z: number, width: number, depth: number): Shape {
    const hw = width / 2;
    const hd = depth / 2;
    return polygonShape([[x - hw, z - hd], [x + hw, z - hd], [x + hw, z + hd], [x - hw, z + hd]]);
}

export function circleShape(x: number, z: number, r: number): Shape {
    return { points: new Float32Array(0), circle: { x, z, r }, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r };
}

/** Where the shape's middle is (its corners' average; a circle's centre). */
export function shapeCentre(shape: Shape): [number, number] {
    if (shape.circle) return [shape.circle.x, shape.circle.z];
    let x = 0;
    let z = 0;
    const n = shape.points.length / 2;
    for (let i = 0; i < n; i++) {
        x += shape.points[i * 2];
        z += shape.points[i * 2 + 1];
    }
    return [x / n, z / n];
}

/** Whether (x, z) is inside the polygon (even-odd rule). */
function inside(points: Float32Array, x: number, z: number): boolean {
    let hit = false;
    const n = points.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = points[i * 2];
        const zi = points[i * 2 + 1];
        const xj = points[j * 2];
        const zj = points[j * 2 + 1];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) hit = !hit;
    }
    return hit;
}

/** Where a mob touching a shape ends up, and the edge it touched. Reused: one per caller, no allocation. */
export interface Contact {
    /** (x, z) moved out to just touching. */
    x: number;
    z: number;
    /** The way out (unit), and along the edge (unit; for a circle, round it). */
    nx: number;
    nz: number;
    tx: number;
    tz: number;
}

/**
 * Whether a mob of radius `r` at (x, z) touches the shape; if so `out` says where it'd be just clear of it, the way out
 * and the way along the nearest edge.
 *
 * `limitX`: how far from the middle (|x|) the mob may be, the field's side. An edge that would push it out past that isn't
 * the way out: a polygon reaching the field's side has edges along it or beyond it, and out through one of those the side
 * pushes the mob straight back in, every step, and it's stuck. The nearest edge that keeps it on the field is used instead
 * (the nearest of all only if none does).
 */
export function touch(shape: Shape, x: number, z: number, r: number, out: Contact, limitX = Infinity): boolean {
    if (x < shape.minX - r || x > shape.maxX + r || z < shape.minZ - r || z > shape.maxZ + r) return false;
    if (shape.circle) {
        const { x: cx, z: cz, r: cr } = shape.circle;
        const dx = x - cx;
        const dz = z - cz;
        const d2 = dx * dx + dz * dz;
        const reach = cr + r;
        if (d2 >= reach * reach) return false;
        const d = Math.sqrt(d2) || 1e-3;
        out.nx = dx / d;
        out.nz = dz / d;
        out.tx = -out.nz;
        out.tz = out.nx;
        out.x = cx + out.nx * reach;
        out.z = cz + out.nz * reach;
        return true;
    }
    const points = shape.points;
    const n = points.length / 2;
    const isIn = inside(points, x, z);
    const flip = isIn ? -1 : 1;
    // The nearest point on the outline whose way out keeps the mob on the field; and the nearest of all, to fall back on.
    let best = Infinity;
    let any = Infinity;
    let found = false;
    let anyFound = false;
    const pick = { px: 0, pz: 0, ex: 1, ez: 0, nx: 0, nz: 0, corner: false };
    const fallback = { px: 0, pz: 0, ex: 1, ez: 0, nx: 0, nz: 0, corner: false };
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = points[j * 2];
        const az = points[j * 2 + 1];
        const bx = points[i * 2];
        const bz = points[i * 2 + 1];
        const abx = bx - ax;
        const abz = bz - az;
        const length2 = abx * abx + abz * abz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / length2));
        const qx = ax + abx * t;
        const qz = az + abz * t;
        const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
        if (d2 >= best && d2 >= any) continue;
        const length = Math.sqrt(length2);
        const ex = abx / length;
        const ez = abz / length;
        let nx: number;
        let nz: number;
        const d = Math.sqrt(d2);
        if (d > 1e-4) {
            // From the outline towards the mob — flipped when the mob's inside.
            nx = ((x - qx) / d) * flip;
            nz = ((z - qz) / d) * flip;
        } else {
            // Right on the outline: out is square to the edge, away from the middle.
            const [cx, cz] = shapeCentre(shape);
            nx = -ez;
            nz = ex;
            if ((qx - cx) * nx + (qz - cz) * nz < 0) {
                nx = -nx;
                nz = -nz;
            }
        }
        // Nearest to one of its corners, not along the edge: round a corner, the way along is square to the way out.
        const corner = t <= 0 || t >= 1;
        const candidate = d2 < any ? fallback : null;
        if (candidate) {
            any = d2;
            anyFound = true;
            Object.assign(candidate, { px: qx, pz: qz, ex, ez, nx, nz, corner });
        }
        if (d2 < best && Math.abs(qx + nx * r) <= limitX + 1e-3) {
            best = d2;
            found = true;
            Object.assign(pick, { px: qx, pz: qz, ex, ez, nx, nz, corner });
        }
    }
    if (!anyFound) return false;
    const use = found ? pick : fallback;
    // Outside and clear of every edge (by the nearest one of all: a far edge it could use doesn't make it touch).
    if (!isIn && any >= r * r) return false;
    out.nx = use.nx;
    out.nz = use.nz;
    // Round a corner from outside: square to the way out, so it curves round the point. (Along an edge it'd flip from one
    // edge's way to the other's each step as the nearest edge changed, and the mob would stand at the point.)
    if (use.corner && !isIn) {
        out.tx = -use.nz;
        out.tz = use.nx;
    } else {
        out.tx = use.ex;
        out.tz = use.ez;
    }
    out.x = use.px + use.nx * r;
    out.z = use.pz + use.nz * r;
    return true;
}
