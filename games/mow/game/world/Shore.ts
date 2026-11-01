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

/** The island's outline: its polygon, or the ground's rect corners. */
export function shoreOutline(): ShorePoint[] {
    const outline = TOWN.island?.outline;
    if (outline && outline.length >= 3) return outline.map((p) => ({ x: p.x, z: p.z }));
    const { ground } = TOWN;
    const hx = ground.width / 2;
    const hz = ground.depth / 2;
    return [
        { x: ground.x - hx, z: ground.z - hz }, { x: ground.x + hx, z: ground.z - hz },
        { x: ground.x + hx, z: ground.z + hz }, { x: ground.x - hx, z: ground.z + hz },
    ];
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
