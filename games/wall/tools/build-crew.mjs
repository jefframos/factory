// The crew (library3d's animals: one mesh each, their texture's colours baked into the vertices) and the tray's icons (the
// crew, the tools, a brick, drawn here with an outline): node games/wall/tools/build-crew.mjs, then `npm run models` and
// `npm run image` (GAME=wall).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, quantize, weld } from '@gltf-transform/functions';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const models = `${here}/../raw-assets/models`;
const images = `${here}/../raw-assets/images/ui{tps}`;
const CREW = ['chick', 'beaver', 'hog', 'monkey', 'cow', 'panda', 'elephant', 'giraffe'];
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(`${models}/crew{m}`, { recursive: true });

async function crew(name) {
    const doc = await io.read(`${repo}/library3d/files/animals/models/animal-${name}.glb`);
    const root = doc.getRoot();
    root.listAnimations().forEach((animation) => animation.dispose());
    const buffer = root.listBuffers()[0];
    for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
        const material = primitive.getMaterial();
        const { data, info } = await sharp(Buffer.from(material.getBaseColorTexture().getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const uv = primitive.getAttribute('TEXCOORD_0');
        const colors = new Float32Array(uv.getCount() * 3);
        for (let i = 0; i < uv.getCount(); i++) {
            const [u, v] = uv.getElement(i, []);
            const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
            const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
            for (let k = 0; k < 3; k++) colors[i * 3 + k] = linear(data[(y * info.width + x) * 4 + k] / 255);
        }
        primitive.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(colors).setBuffer(buffer));
        for (const semantic of primitive.listSemantics()) if (!['POSITION', 'NORMAL', 'COLOR_0'].includes(semantic)) primitive.setAttribute(semantic, null);
    }
    const plain = doc.createMaterial('crew').setRoughnessFactor(0.8).setMetallicFactor(0);
    for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) primitive.setMaterial(plain);
    await doc.transform(dedup(), flatten(), join({ keepNamed: false, keepMeshes: false }), weld(), prune(), quantize({ quantizePosition: 13, quantizeNormal: 8, quantizeColor: 8 }));
    await io.write(`${models}/crew{m}/${name}.glb`, doc);
    return doc;
}

/** Every triangle of a document, in the world. */
function triangles(doc) {
    const out = [];
    for (const node of doc.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const m = node.getWorldMatrix();
        for (const primitive of mesh.listPrimitives()) {
            const position = primitive.getAttribute('POSITION');
            const color = primitive.getAttribute('COLOR_0');
            const indices = primitive.getIndices();
            const count = indices ? indices.getCount() : position.getCount();
            for (let t = 0; t < count; t += 3) {
                const corners = [0, 1, 2].map((k) => (indices ? indices.getScalar(t + k) : t + k));
                out.push({
                    p: corners.map((i) => {
                        const [x, y, z] = position.getElement(i, []);
                        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
                    }),
                    c: corners.map((i) => (color ? color.getElement(i, []) : [1, 1, 1])),
                });
            }
        }
    }
    return out;
}

/**
 * A sticker of some triangles, turned (degrees): fitted in `size`, lit, a dark outline round it. What's marked (a tool's
 * metal) is drawn again on its own, for the game to tint and put over it.
 */
async function icon(name, list, [pitch, yaw, roll], size = 120) {
    const big = size * 3;
    const line = 12;
    const [a, b, c] = [pitch, yaw, roll].map((d) => (d * Math.PI) / 180);
    const turn = ([x, y, z]) => {
        [x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)];
        [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
        return [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c), z];
    };
    const turned = list.map(({ p, c: colors }) => ({ p: p.map(turn), c: colors }));
    const all = turned.flatMap(({ p }) => p);
    const min = [0, 1].map((k) => Math.min(...all.map((p) => p[k])));
    const max = [0, 1].map((k) => Math.max(...all.map((p) => p[k])));
    const scale = (big - line * 2 - 4) / Math.max(max[0] - min[0], max[1] - min[1]);
    const at = ([x, y, z]) => [big / 2 + (x - (min[0] + max[0]) / 2) * scale, big / 2 - (y - (min[1] + max[1]) / 2) * scale, z];
    const depth = new Float32Array(big * big).fill(-Infinity);
    const pixels = new Uint8ClampedArray(big * big * 4);
    const marked = new Uint8ClampedArray(big * big * 4);
    const anyMarked = list.some(({ c: [corner] }) => corner[3] === 1);
    const light = [-0.35, 0.75, 0.56];
    for (const { p, c: colors } of turned) {
        const [A, B, C] = p;
        const u = A.map((v, k) => B[k] - v);
        const w = A.map((v, k) => C[k] - v);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const length = Math.hypot(...n);
        if (!length) continue;
        const shade = 0.72 + 0.42 * Math.max(0, (n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / length);
        const [P, Q, R] = p.map(at);
        const area = (Q[0] - P[0]) * (R[1] - P[1]) - (R[0] - P[0]) * (Q[1] - P[1]);
        if (Math.abs(area) < 1e-6) continue;
        for (let y = Math.max(0, Math.floor(Math.min(P[1], Q[1], R[1]))); y <= Math.min(big - 1, Math.ceil(Math.max(P[1], Q[1], R[1]))); y++) {
            for (let x = Math.max(0, Math.floor(Math.min(P[0], Q[0], R[0]))); x <= Math.min(big - 1, Math.ceil(Math.max(P[0], Q[0], R[0]))); x++) {
                const X = x + 0.5;
                const Y = y + 0.5;
                const w0 = ((Q[0] - X) * (R[1] - Y) - (R[0] - X) * (Q[1] - Y)) / area;
                const w1 = ((R[0] - X) * (P[1] - Y) - (P[0] - X) * (R[1] - Y)) / area;
                const w2 = 1 - w0 - w1;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const z = w0 * P[2] + w1 * Q[2] + w2 * R[2];
                const i = x + y * big;
                if (z <= depth[i]) continue;
                depth[i] = z;
                for (let k = 0; k < 3; k++) pixels[i * 4 + k] = 255 * Math.min(1, toSrgb(w0 * colors[0][k] + w1 * colors[1][k] + w2 * colors[2][k]) * shade);
                pixels[i * 4 + 3] = 255;
                marked.set(pixels.subarray(i * 4, i * 4 + 4), i * 4);
                if (!anyMarked || (colors[0][3] + colors[1][3] + colors[2][3]) < 2) marked[i * 4 + 3] = 0;
            }
        }
    }
    if (anyMarked) await sharp(Buffer.from(marked.buffer), { raw: { width: big, height: big, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).png().toFile(`${images}/Wall_${name}_metal.png`);
    // The outline: within `line` of the picture's edge.
    const solid = Array.from({ length: big * big }, (_, i) => pixels[i * 4 + 3] > 0);
    const round = [];
    for (let y = -line; y <= line; y++) for (let x = -line; x <= line; x++) if (x * x + y * y <= line * line) round.push([x, y]);
    for (let y = 0; y < big; y++) for (let x = 0; x < big; x++) {
        const i = x + y * big;
        if (!solid[i] || (x > 0 && y > 0 && x < big - 1 && y < big - 1 && solid[i - 1] && solid[i + 1] && solid[i - big] && solid[i + big])) continue;
        for (const [dx, dy] of round) {
            const j = x + dx + (y + dy) * big;
            if (x + dx >= 0 && y + dy >= 0 && x + dx < big && y + dy < big && !solid[j]) pixels.set([23, 18, 14, 255], j * 4);
        }
    }
    await sharp(Buffer.from(pixels.buffer), { raw: { width: big, height: big, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).png().toFile(`${images}/Wall_${name}.png`);
}

/** A box's triangles. */
function box([x0, y0, z0], [x1, y1, z1], color) {
    const c = color.map(linear);
    const v = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
    const quads = [[4, 5, 7, 6], [1, 0, 2, 3], [5, 1, 3, 7], [0, 4, 6, 2], [6, 7, 3, 2], [0, 1, 5, 4]];
    return quads.flatMap(([a, b, d, e]) => [[a, b, d], [a, d, e]]).map((corners) => ({ p: corners.map(v), c: [c, c, c] }));
}

for (const name of CREW) {
    const doc = await crew(name);
    const list = triangles(doc);
    console.log(name, list.length);
    await icon(name, list, [12, 26, 0]);
}
for (const tool of ['hammer', 'axe', 'pickaxe', 'mace', 'battleaxe', 'warhammer', 'sword', 'saber', 'greatsword', 'flame']) {
    await icon(tool, triangles(await io.read(`${models}/player{m}/${tool}.glb`)), [10, 20, -38]);
}
const brick = [0.87, 0.42, 0.27];
const mortar = [0.72, 0.31, 0.19];
await icon('brick', [...box([-1, 0, -0.5], [1, 0.75, 0.5], brick), ...box([-0.7, 0.75, -0.3], [-0.15, 0.78, 0.3], mortar), ...box([0.15, 0.75, -0.3], [0.7, 0.78, 0.3], mortar)], [32, 34, 0], 96);
// The fists: the posed hand's triangles, if they've been dumped (a list of { p, c }).
if (process.argv[2]) await icon('fists', JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), [-20, 205, 0]);
