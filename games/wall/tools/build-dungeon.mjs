// The dungeon's props round the gates (game/wall/Dungeon.ts; where each goes: ui/wall.json `dungeon`): barrels, a mace
// and an axe from KayKit's Resource and Fantasy Weapons bits in library3d (CC0), their texture's colours baked into the vertices as the crew's are, so no
// texture ships. node games/wall/tools/build-dungeon.mjs, then `npm run models` (GAME=wall).
//
// Out: raw-assets/models/dungeon{m}/<id>.glb, as the pack has it (the game sits each on its spot by its own box).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, quantize, weld } from '@gltf-transform/functions';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const out = `${here}/../raw-assets/models/dungeon{m}`;
const BITS = `${repo}/library3d/files/KayKit_Bits_Bundle2_1.0/KayKit_Bits_Bundle2_1.0`;
const RESOURCE = `${BITS}/KayKit Resource Bits 1.0/Assets/gltf`;
const WEAPONS = `${BITS}/KayKit Fantasy Weapons Bits 1.0/Assets/gltf`;
/** The props: their id in the game, and their file in the library. */
const PROPS = [
    { id: 'barrel', file: `${RESOURCE}/Food_Barrel_Empty.gltf` },
    { id: 'mace', file: `${WEAPONS}/hammer_B.gltf` },
    { id: 'axe', file: `${WEAPONS}/axe_B.gltf` },
];
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(out, { recursive: true });

for (const prop of PROPS) {
    const file = prop.file;
    const doc = await io.read(file);
    const root = doc.getRoot();
    root.listAnimations().forEach((animation) => animation.dispose());
    const buffer = root.listBuffers()[0];
    const plain = doc.createMaterial('plain');
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
        } else {
            for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) colors[i * 3 + k] = factor[k];
        }
        primitive.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(colors).setBuffer(buffer));
        for (const semantic of primitive.listSemantics()) if (!['POSITION', 'NORMAL', 'COLOR_0'].includes(semantic)) primitive.setAttribute(semantic, null);
        primitive.setMaterial(plain);
    }
    root.listTextures().forEach((texture) => texture.dispose());
    await doc.transform(dedup(), flatten(), join({ keepNamed: false, keepMeshes: false }), weld(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }));
    await io.write(`${out}/${prop.id}.glb`, doc);
    // (Its size, to place it by: the bounds of its positions, with its nodes' transforms.)
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const node of root.listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const world = node.getWorldMatrix();
        for (const primitive of mesh.listPrimitives()) {
            const position = primitive.getAttribute('POSITION');
            for (let i = 0; i < position.getCount(); i++) {
                const [x, y, z] = position.getElement(i, []);
                const p = [0, 1, 2].map((r) => world[r] * x + world[4 + r] * y + world[8 + r] * z + world[12 + r]);
                min = min.map((m, k) => Math.min(m, p[k]));
                max = max.map((m, k) => Math.max(m, p[k]));
            }
        }
    }
    console.log(`${prop.id.padEnd(17)} size ${max.map((m, k) => (m - min[k]).toFixed(2)).join(' x ')}  (${path.basename(file)}, ${(fs.statSync(`${out}/${prop.id}.glb`).size / 1024).toFixed(1)} KB)`);
}
