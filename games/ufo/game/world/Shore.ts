// Shore.ts
//
// The island's outline and the polygon maths the town is built and flown on (the same shape the editor draws).

import { Level, Point } from '../data/UfoConfig';

const CORNER_RADIUS = 3.5;
const CORNER_STEP = Math.PI / 12;

/** The island's outline (else the ground's rect), every corner rounded. */
export function shoreOutline(level: Level): Point[] {
    const outline = level.island?.outline;
    const radius = level.island?.cornerRadius ?? CORNER_RADIUS;
    if (outline && outline.length >= 3) return roundCorners(outline, radius);
    const { x, z, width, depth } = level.ground;
    return roundCorners([
        { x: x - width / 2, z: z - depth / 2 }, { x: x + width / 2, z: z - depth / 2 },
        { x: x + width / 2, z: z + depth / 2 }, { x: x - width / 2, z: z + depth / 2 },
    ], radius);
}

/** Each corner replaced by an arc tangent to both its edges (smaller where the edges are short). */
function roundCorners(points: readonly Point[], radius: number): Point[] {
    if (radius <= 0 || points.length < 3) return points.map((p) => ({ x: p.x, z: p.z }));
    const out: Point[] = [];
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
            out.push({ x: p.x, z: p.z });
            return;
        }
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

/** Each edge's inward unit normal (edge i runs from point i to point i + 1). */
export function inwardNormals(points: readonly Point[]): Point[] {
    let area = 0;
    points.forEach((p, i) => {
        const q = points[(i + 1) % points.length];
        area += p.x * q.z - q.x * p.z;
    });
    const sign = area >= 0 ? 1 : -1;
    return points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        const length = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        return { x: (-(q.z - p.z) / length) * sign, z: ((q.x - p.x) / length) * sign };
    });
}

/** The polygon moved `distance` inwards. */
export function insetPolygon(points: readonly Point[], distance: number): Point[] {
    const normals = inwardNormals(points);
    return points.map((p, i) => {
        const a = normals[(i - 1 + points.length) % points.length];
        const b = normals[i];
        const scale = distance / Math.max(0.25, 1 + a.x * b.x + a.z * b.z);
        return { x: p.x + (a.x + b.x) * scale, z: p.z + (a.z + b.z) * scale };
    });
}

export function containsPoint(points: readonly Point[], x: number, z: number): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
}
