// The held tools, from the library's KayKit packs (CC0), their texture's colours baked into the vertices (no texture to
// load). Their metal is made grey and marked (the colour's alpha: 1), so the game can give it any colour; the rest is 0:
// node games/wall/tools/build-tools.mjs, then build-crew.mjs (the icons), then `npm run models` and `npm run image` (GAME=wall).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const kit = `${repo}/library3d/files/KayKit_Bits_Bundle2_1.0/KayKit_Bits_Bundle2_1.0`;
const rpg = `${kit}/KayKit RPG Tools Bits 1.0/Assets/gltf`;
const fantasy = `${kit}/KayKit Fantasy Weapons Bits 1.0/Assets/gltf`;
/** `head`: everything above this is metal, whatever its colour; else what's greyish blue is. */
const TOOLS = {
    hammer: { file: `${rpg}/hammer.gltf` },
    axe: { file: `${rpg}/axe.gltf` },
    pickaxe: { file: `${rpg}/pickaxe.gltf` },
    mace: { file: `${fantasy}/hammer_B.gltf` },
    battleaxe: { file: `${fantasy}/axe_B.gltf` },
    warhammer: { file: `${fantasy}/hammer_D.gltf`, head: 0.69 },
};
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [name, { file, head }] of Object.entries(TOOLS)) {
    const doc = await io.read(file);
    const buffer = doc.getRoot().listBuffers()[0];
    for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
        const material = primitive.getMaterial();
        const { data, info } = await sharp(Buffer.from(material.getBaseColorTexture().getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const uv = primitive.getAttribute('TEXCOORD_0');
        const position = primitive.getAttribute('POSITION');
        const colors = new Float32Array(uv.getCount() * 4);
        const metals = [];
        for (let i = 0; i < uv.getCount(); i++) {
            const [u, v] = uv.getElement(i, []);
            const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
            const y = Math.min(info.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * info.height)));
            const [r, g, b] = [0, 1, 2].map((k) => data[(y * info.width + x) * 4 + k]);
            const metal = head === undefined ? b >= r - 6 : position.getElement(i, [])[1] > head && r > 110;
            if (metal) metals.push(i);
            for (let k = 0; k < 3; k++) colors[i * 4 + k] = metal ? (0.3 * r + 0.59 * g + 0.11 * b) / 255 : linear([r, g, b][k] / 255);
            colors[i * 4 + 3] = metal ? 1 : 0;
        }
        // The metal's greys brought up, so a colour over them keeps its own brightness.
        const values = metals.map((i) => colors[i * 4]).sort((a, b) => a - b);
        const top = values[Math.floor(values.length * 0.9)] ?? 1;
        for (const i of metals) for (let k = 0; k < 3; k++) colors[i * 4 + k] = linear(Math.min(1, 0.35 + 0.6 * (colors[i * 4 + k] / top)));
        primitive.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(colors).setBuffer(buffer));
        for (const semantic of ['TEXCOORD_0', 'TANGENT']) primitive.setAttribute(semantic, null);
        material.setBaseColorTexture(null).setMetallicRoughnessTexture(null).setNormalTexture(null).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.7).setAlphaMode('OPAQUE');
        const min = position.getMin([]).map((v) => v.toFixed(2));
        const max = position.getMax([]).map((v) => v.toFixed(2));
        console.log(name, 'metal', metals.length, 'of', uv.getCount(), min.join(), max.join());
    }
    await doc.transform(dedup(), weld(), prune());
    await io.write(`${here}/../raw-assets/models/player{m}/${name}.glb`, doc);
}

// The boxing glove (library3d's hands pack; a left one): its palm toward +x, its fist up, its thumb toward +z, the wrist at
// the origin, in the hand's size; the leather and the band keep their own materials, coloured in the game.
const glove = await io.read(`${repo}/library3d/files/hands/gloves/boxing_glove.glb`);
const SIZE = 0.165;
for (const node of glove.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const primitive of mesh.listPrimitives()) {
        for (const [semantic, size] of [['POSITION', SIZE], ['NORMAL', 1]]) {
            const attribute = primitive.getAttribute(semantic);
            const out = new Float32Array(attribute.getCount() * 3);
            for (let i = 0; i < attribute.getCount(); i++) {
                const [a, b, c] = attribute.getElement(i, []);
                const move = semantic === 'POSITION' ? 1 : 0;
                const x = m[0] * a + m[4] * b + m[8] * c + move * (m[12] - 0.04);
                const y = m[1] * a + m[5] * b + m[9] * c + move * (m[13] - 0.36);
                const z = m[2] * a + m[6] * b + m[10] * c + move * (m[14] - 0.02);
                const length = move ? 1 : Math.hypot(x, y, z) || 1;
                out.set([(x * size) / length, (y * size) / length, (z * size) / length], i * 3);
            }
            attribute.setArray(out).setNormalized(false);
        }
        primitive.setAttribute('TEXCOORD_0', null);
        primitive.getMaterial().setName(primitive.getMaterial().getName() === 'red' ? 'leather' : 'band');
    }
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
await glove.transform(prune());
await io.write(`${here}/../raw-assets/models/player{m}/boxing.glb`, glove);
console.log('boxing');
