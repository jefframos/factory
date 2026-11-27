// The crew's hats (their ranks, bought with skulls: ui/Crew panel): three hats out of library3d's stylized hats pack (owned),
// their textures' colours baked into the vertices as the crew's are, so no texture ships; and a sticker of each for the
// menu. node games/wall/tools/build-hats.mjs, then `npm run models` and `npm run image` (GAME=wall).
//
// Out: raw-assets/models/crew{m}/hat-<id>.glb (centred at the bottom middle, its widest 1 across: the game sits it on a head)
// and raw-assets/images/ui{tps}/Wall_hat_<id>.png.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, quantize, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const models = `${here}/../raw-assets/models`;
const images = `${here}/../raw-assets/images/ui{tps}`;
const PACK = `${repo}/library3d/files/hats/3d_props_stylized_hats_pack.glb`;
/** The hats, by rank: their node in the pack, and how much of their triangles to keep (up to 45 crew may wear one: few). */
const HATS = [
    { id: 'hard', node: 'Hard_Hat_3', keep: 0.6 },
    { id: 'viking', node: 'Viking_Hat_0', keep: 0.3 },
    { id: 'crown', node: 'Crown_14', keep: 0.16 },
];
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(`${models}/crew{m}`, { recursive: true });

/** The pack with only one hat left, its colours in its vertices. */
async function hat({ id, node: keepName, keep }) {
    const doc = await io.read(PACK);
    const root = doc.getRoot();
    root.listAnimations().forEach((animation) => animation.dispose());
    const kept = root.listNodes().find((node) => node.getName() === keepName);
    if (!kept) throw new Error(`no ${keepName} in the pack`);
    // (Every hat but this one away: its own subtree and the wrappers over it stay.)
    const keepSet = new Set();
    const walk = (node) => {
        keepSet.add(node);
        node.listChildren().forEach(walk);
    };
    walk(kept);
    for (let parent = kept.getParentNode(); parent; parent = parent.getParentNode()) keepSet.add(parent);
    for (const node of root.listNodes()) if (!keepSet.has(node)) node.dispose();
    const buffer = root.listBuffers()[0];
    for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
        const material = primitive.getMaterial();
        const texture = material?.getBaseColorTexture();
        const factor = material?.getBaseColorFactor() ?? [1, 1, 1, 1];
        const uv = primitive.getAttribute('TEXCOORD_0');
        const count = primitive.getAttribute('POSITION').getCount();
        const colors = new Float32Array(count * 3);
        if (texture && uv) {
            const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            for (let i = 0; i < count; i++) {
                const [u, v] = uv.getElement(i, []);
                const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
                const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
                for (let k = 0; k < 3; k++) colors[i * 3 + k] = linear(data[(y * info.width + x) * 4 + k] / 255) * factor[k];
            }
        } else for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) colors[i * 3 + k] = factor[k];
        primitive.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(colors).setBuffer(buffer));
        for (const semantic of primitive.listSemantics()) if (!['POSITION', 'NORMAL', 'COLOR_0'].includes(semantic)) primitive.setAttribute(semantic, null);
    }
    const plain = doc.createMaterial('hat').setRoughnessFactor(0.7).setMetallicFactor(0);
    for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) primitive.setMaterial(plain);
    root.listTextures().forEach((texture) => texture.dispose());
    await MeshoptSimplifier.ready;
    await doc.transform(dedup(), flatten(), join({ keepNamed: false, keepMeshes: false }), weld(), simplify({ simplifier: MeshoptSimplifier, ratio: keep, error: 0.01 }), prune());
    // Its own frame: the bottom middle at the origin, its widest 1 across.
    const list = triangles(doc);
    const all = list.flatMap(({ p }) => p);
    const min = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k])));
    const max = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));
    const scale = 1 / Math.max(max[0] - min[0], max[2] - min[2]);
    const scene = root.listScenes()[0];
    const holder = doc.createNode('hat').setScale([scale, scale, scale]).setTranslation([-(min[0] + max[0]) / 2 * scale, -min[1] * scale, -(min[2] + max[2]) / 2 * scale]);
    for (const child of scene.listChildren()) {
        scene.removeChild(child);
        holder.addChild(child);
    }
    scene.addChild(holder);
    await doc.transform(flatten(), quantize({ quantizePosition: 13, quantizeNormal: 8, quantizeColor: 8 }));
    await io.write(`${models}/crew{m}/hat-${id}.glb`, doc);
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

/** A sticker of some triangles, turned (degrees): fitted in `size`, lit, a dark outline round it (as build-crew's). */
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
    const light = [-0.35, 0.75, 0.56];
    for (const { p, c: colors } of turned) {
        const [A, B, C] = p;
        const u = A.map((v, k) => B[k] - v);
        const w = A.map((v, k) => C[k] - v);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const length = Math.hypot(...n);
        if (!length) continue;
        const shade = 0.72 + 0.42 * Math.abs((n[0] * light[0] + n[1] * light[1] + n[2] * light[2]) / length);
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
            }
        }
    }
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

for (const def of HATS) {
    const doc = await hat(def);
    const list = triangles(doc);
    const bytes = fs.statSync(`${models}/crew{m}/hat-${def.id}.glb`).size;
    console.log(`hat-${def.id}: ${list.length} triangles, ${(bytes / 1024).toFixed(0)} KB`);
    await icon(`hat_${def.id}`, list, [18, 30, 0], 110);
}
