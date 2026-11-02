/**
 * The island's outline (TOWN.island.outline, a polygon on the ground; the ground rect without one) and the polygon
 * maths the town builds and walks on: insets (the deck's inner edge, the fence line), inside tests, edge distances.
 * Mirrored in web/public/town3d.js for the editor.
 */
import { TOWN } from '../data/MowConfig';

export interface ShorePoint {
    x: number;
    z: number;
}

/** The outline's corners are drawn round, this radius unless the island says (cornerRadius). */
const CORNER_RADIUS = 3.5;
/** A rounded corner gets a point every this many radians of its turn. */
const CORNER_STEP = Math.PI / 12;

/**
 * The island's outline: its polygon, or the ground's rect corners, with every corner rounded (roundCorners()): the
 * deck, its fence, the sides, the sea and the walkable area all follow the rounded shape.
 */
export function shoreOutline(): ShorePoint[] {
    const outline = TOWN.island?.outline;
    const radius = TOWN.island?.cornerRadius ?? CORNER_RADIUS;
    if (outline && outline.length >= 3) return roundCorners(outline.map((p) => ({ x: p.x, z: p.z })), radius);
    const { ground } = TOWN;
    const hx = ground.width / 2;
    const hz = ground.depth / 2;
    return roundCorners([
        { x: ground.x - hx, z: ground.z - hz }, { x: ground.x + hx, z: ground.z - hz },
        { x: ground.x + hx, z: ground.z + hz }, { x: ground.x - hx, z: ground.z + hz },
    ], radius);
}

/**
 * Each corner replaced by an arc of `radius` (smaller where its edges are short: at most 45% of either) tangent to
 * both its edges, a point every CORNER_STEP of the turn. Straight-through points stay as they are.
 */
export function roundCorners(points: readonly ShorePoint[], radius: number): ShorePoint[] {
    if (radius <= 0 || points.length < 3) return points.map((p) => ({ ...p }));
    const out: ShorePoint[] = [];
    points.forEach((p, i) => {
        const prev = points[(i - 1 + points.length) % points.length];
        const next = points[(i + 1) % points.length];
        const inLength = Math.hypot(p.x - prev.x, p.z - prev.z);
        const outLength = Math.hypot(next.x - p.x, next.z - p.z);
        if (inLength < 1e-6 || outLength < 1e-6) return;
        const toPrev = { x: (prev.x - p.x) / inLength, z: (prev.z - p.z) / inLength };
        const toNext = { x: (next.x - p.x) / outLength, z: (next.z - p.z) / outLength };
        const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, toPrev.x * toNext.x + toPrev.z * toNext.z)));
        if (turn < 0.02) {
            out.push({ ...p });
            return;
        }
        // How far along each edge the arc starts, for this radius (capped by the edges' lengths).
        const half = (Math.PI - turn) / 2;
        const reach = Math.min(radius / Math.tan(half), inLength * 0.45, outLength * 0.45);
        const r = reach * Math.tan(half);
        const start = { x: p.x + toPrev.x * reach, z: p.z + toPrev.z * reach };
        const end = { x: p.x + toNext.x * reach, z: p.z + toNext.z * reach };
        const bisector = { x: toPrev.x + toNext.x, z: toPrev.z + toNext.z };
        const length = Math.hypot(bisector.x, bisector.z) || 1;
        const centre = { x: p.x + (bisector.x / length) * (r / Math.sin(half)), z: p.z + (bisector.z / length) * (r / Math.sin(half)) };
        const from = Math.atan2(start.z - centre.z, start.x - centre.x);
        let sweep = Math.atan2(end.z - centre.z, end.x - centre.x) - from;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        while (sweep < -Math.PI) sweep += Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(sweep) / CORNER_STEP));
        for (let s = 0; s <= steps; s++) {
            const angle = from + (sweep * s) / steps;
            out.push({ x: centre.x + Math.cos(angle) * r, z: centre.z + Math.sin(angle) * r });
        }
    });
    return out;
}

/** Twice the signed area (positive when the points run counter-clockwise in x/z). */
function area2(points: readonly ShorePoint[]): number {
    let sum = 0;
    points.forEach((p, i) => {
        const q = points[(i + 1) % points.length];
        sum += p.x * q.z - q.x * p.z;
    });
    return sum;
}

/** Each edge's inward unit normal (edge i runs from point i to point i + 1). */
export function inwardNormals(points: readonly ShorePoint[]): ShorePoint[] {
    const sign = area2(points) >= 0 ? 1 : -1;
    return points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        const length = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        return { x: (-(q.z - p.z) / length) * sign, z: ((q.x - p.x) / length) * sign };
    });
}

/** The polygon moved `distance` inwards (mitred corners, capped on very sharp ones). */
export function insetPolygon(points: readonly ShorePoint[], distance: number): ShorePoint[] {
    const normals = inwardNormals(points);
    return points.map((p, i) => {
        const a = normals[(i - 1 + points.length) % points.length];
        const b = normals[i];
        const scale = distance / Math.max(0.25, 1 + a.x * b.x + a.z * b.z);
        return { x: p.x + (a.x + b.x) * scale, z: p.z + (a.z + b.z) * scale };
    });
}

export function containsPoint(points: readonly ShorePoint[], x: number, z: number): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
}

/** How far (x, z) is from the polygon's nearest edge. */
export function edgeDistance(points: readonly ShorePoint[], x: number, z: number): number {
    let best = Infinity;
    points.forEach((a, i) => {
        const b = points[(i + 1) % points.length];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
    });
    return best;
}

export function bounds(points: readonly ShorePoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return {
        minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)),
        minZ: Math.min(...points.map((p) => p.z)), maxZ: Math.max(...points.map((p) => p.z)),
    };
}
