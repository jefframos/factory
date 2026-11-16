// cityfill.js
//
// Filling a city block with buildings, SimCity-style: shared by the game (world/CityBlocks.ts) and the editor's
// preview (editor.js), so what the editor shows is what the game builds. Plain JS (the editor loads it straight).
//
// A block is a lawn (a polygon on the ground) with `buildings` on it: { kind, seed, setback, gap }. Along each of its
// sides, buildings stand side by side facing out (to the street round it): each one picked from the pool (its kind's:
// 'living' homes, 'business' shops and offices, 'mixed' both) by the block's seed, `setback` in from the side, `gap`
// apart, never over the block's edge or each other. The block's middle stays open (yards). A building model's front is
// its -z (the town kit's): it's turned so that faces out.

/** A seeded random (mulberry32): the same seed, the same block. */
function random(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function inside(points, x, z) {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
    }
    return hit;
}

/** A turned rectangle's corners (its middle, half sizes along and across its own axes, its turn round y). */
function corners(r) {
    const cos = Math.cos(r.turn);
    const sin = Math.sin(r.turn);
    // Its own x axis in the world: (cos, -sin); its own z: (sin, cos) — as three.js turns things round y.
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
        x: r.x + u * r.halfW * cos + v * r.halfD * sin,
        z: r.z - u * r.halfW * sin + v * r.halfD * cos,
    }));
}

/** Whether two turned rectangles overlap (separating axes). */
function overlap(a, b) {
    const ca = corners(a);
    const cb = corners(b);
    for (const r of [a, b]) {
        for (const axis of [{ x: Math.cos(r.turn), z: -Math.sin(r.turn) }, { x: Math.sin(r.turn), z: Math.cos(r.turn) }]) {
            const project = (cs) => cs.map((c) => c.x * axis.x + c.z * axis.z);
            const pa = project(ca);
            const pb = project(cb);
            if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
        }
    }
    return true;
}

/** Which pool entries a kind takes. */
function ofKind(pool, kind) {
    const list = pool.filter((b) => !kind || kind === 'mixed' || b.kind === kind);
    return list.length ? list : pool;
}

/**
 * The buildings on a block: `lawn` (its points and its `buildings`), `pool` (each { model, kind, height, width, depth }:
 * width along its own x, depth along its z, at that height). Returns { model, height, x, z, rotationY } for each.
 */
export function fillBlock(lawn, pool) {
    const fill = lawn.buildings;
    const points = lawn.points;
    if (!fill || !points || points.length < 3 || !pool.length) return [];
    const setback = fill.setback ?? 1.5;
    const gap = fill.gap ?? 1;
    const rand = random(fill.seed ?? 1);
    const choices = ofKind(pool, fill.kind);
    const placed = [];
    const out = [];
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 2) continue;
        const along = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
        // Out of the block: the side's normal that points away from its middle.
        let normal = { x: along.z, z: -along.x };
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        if (inside(points, mid.x + normal.x * 0.1, mid.z + normal.z * 0.1)) normal = { x: -normal.x, z: -normal.z };
        // Its front (-z) faces out: turned so (-sin, -cos) is the normal.
        const turn = Math.atan2(-normal.x, -normal.z);
        let cursor = gap / 2;
        let misses = 0;
        while (cursor < length - 1 && misses < 40) {
            // A building that fits what's left of this side (the seed's pick among them).
            const room = length - cursor - gap / 2;
            const fits = choices.filter((c) => c.width <= room);
            if (!fits.length) break;
            const pick = fits[Math.floor(rand() * fits.length)];
            const offset = setback + pick.depth / 2;
            const at = cursor + pick.width / 2;
            const rect = { x: a.x + along.x * at - normal.x * offset, z: a.z + along.z * at - normal.z * offset, halfW: pick.width / 2, halfD: pick.depth / 2, turn };
            const grown = { ...rect, halfW: rect.halfW + gap / 2 - 0.01, halfD: rect.halfD + gap / 2 - 0.01 };
            const ok = corners(rect).every((c) => inside(points, c.x, c.z)) && !placed.some((p) => overlap(grown, p));
            if (ok) {
                placed.push(rect);
                out.push({ model: pick.model, height: pick.height, x: Math.round(rect.x * 1000) / 1000, z: Math.round(rect.z * 1000) / 1000, rotationY: Math.round(turn * 10000) / 10000 });
                cursor += pick.width + gap;
                misses = 0;
            } else {
                cursor += 1;
                misses++;
            }
        }
    }
    return out;
}
