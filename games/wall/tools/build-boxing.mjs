// The boxing glove, made smooth: the library's (kept in art/boxing.glb) welded, each triangle split in four and rounded (Loop's
// way), lit smoothly: node games/wall/tools/build-boxing.mjs, then build-powers.mjs (its icon), `npm run models` and `npm run image`.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, quantize } from '@gltf-transform/functions';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LEVELS = 1;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const scaled = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/** Welded: points, and triangles of them. */
function weld(position, index) {
    const points = [];
    const known = new Map();
    const at = (i) => {
        const p = position.getElement(i, []);
        const key = p.map((v) => Math.round(v * 20000)).join();
        if (!known.has(key)) known.set(key, points.push(p) - 1);
        return known.get(key);
    };
    const faces = [];
    for (let t = 0; t < index.getCount(); t += 3) {
        const face = [0, 1, 2].map((k) => at(index.getScalar(t + k)));
        if (new Set(face).size === 3) faces.push(face);
    }
    return { points, faces };
}

/** Each triangle in four, everything rounded off; open edges keep their line. */
function loop({ points, faces }) {
    const edges = new Map();
    const edge = (a, b, across) => {
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!edges.has(key)) edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), across: [] });
        edges.get(key).across.push(across);
    };
    for (const [a, b, c] of faces) {
        edge(a, b, c);
        edge(b, c, a);
        edge(c, a, b);
    }
    const near = points.map(() => []);
    const rim = points.map(() => []);
    for (const { a, b, across } of edges.values()) {
        near[a].push(b);
        near[b].push(a);
        if (across.length !== 2) {
            rim[a].push(b);
            rim[b].push(a);
        }
    }
    const made = points.map((p, i) => {
        if (rim[i].length) return rim[i].length === 2 ? add(add(scaled(p, 0.75), points[rim[i][0]], 0.125), points[rim[i][1]], 0.125) : p;
        const n = near[i].length;
        if (!n) return p;
        const beta = n === 3 ? 3 / 16 : 3 / (8 * n);
        return near[i].reduce((sum, j) => add(sum, points[j], beta), scaled(p, 1 - n * beta));
    });
    const middle = new Map();
    for (const [key, { a, b, across }] of edges) {
        const half = add(scaled(points[a], 0.5), points[b], 0.5);
        const p = across.length === 2 ? add(add(scaled(half, 0.75), points[across[0]], 0.125), points[across[1]], 0.125) : half;
        middle.set(key, made.push(p) - 1);
    }
    const mid = (a, b) => middle.get(a < b ? `${a},${b}` : `${b},${a}`);
    const out = faces.flatMap(([a, b, c]) => {
        const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
        return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
    });
    return { points: made, faces: out };
}

function normals({ points, faces }) {
    const out = points.map(() => [0, 0, 0]);
    for (const face of faces) {
        const [a, b, c] = face.map((i) => points[i]);
        const u = add(b, a, -1);
        const v = add(c, a, -1);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        for (const i of face) out[i] = add(out[i], n);
    }
    return out.map((n) => scaled(n, 1 / (Math.hypot(...n) || 1)));
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(`${here}/../art/boxing.glb`);
const buffer = doc.getRoot().listBuffers()[0];
for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    let shape = weld(primitive.getAttribute('POSITION'), primitive.getIndices());
    const before = shape.faces.length;
    for (let i = 0; i < LEVELS; i++) shape = loop(shape);
    primitive.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(shape.points.flat())).setBuffer(buffer));
    primitive.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals(shape).flat())).setBuffer(buffer));
    primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(shape.faces.flat())).setBuffer(buffer));
    console.log(primitive.getMaterial()?.getName(), before, 'triangles ->', shape.faces.length);
}
await doc.transform(prune(), quantize({ quantizePosition: 14, quantizeNormal: 10 }));
await io.write(`${here}/../raw-assets/models/player{m}/boxing.glb`, doc);
