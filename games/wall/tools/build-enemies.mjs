// The enemies' models, as Mob's card units have them: every pose of their walk a mesh of its own (pose_0..), no skeleton.
// - golem, turtle, bat, stone monster: Mob's baked ones (cachedBuilds/mob, from library3d/packs-characters), decoded, some of
//   their poses kept (the golem thinned out);
// - the skeletons (KayKit, library3d/packs-characters/pack2): posed here through their walk, the packs' flat colours put in
//   their vertices, a weapon in their hands.
// And the boss's picture for the HUD comes from the UI kit (ItemIcon_Skull). node games/wall/tools/build-enemies.mjs, then
// `npm run models` (GAME=wall).
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, reorder, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const mob = `${repo}/cachedBuilds/mob/mob/models/characters`;
const pack = `${repo}/library3d/packs-characters/pack2`;
const out = `${here}/../raw-assets/models/enemies{m}`;
const BAKED = [
    { id: 'bat', poses: [0] },
    { id: 'stone-monster', poses: [0, 2, 4, 6, 8] },
    { id: 'turtle', poses: [0, 2, 4, 6, 8], ratio: 0.75, hue: 100 },
    { id: 'golem', poses: [0, 1, 2, 4, 5, 6, 7, 9], ratio: 0.55 },
];
const SKELETONS = [
    { id: 'skeleton-minion', file: 'Skeleton_Minion', ratio: 0.2, poses: 6, hands: { 'handslot.r': 'Skeleton_Blade' } },
    { id: 'skeleton-warrior', file: 'Skeleton_Warrior', ratio: 0.22, poses: 6, hands: { 'handslot.r': 'Skeleton_Axe', 'handslot.l': 'Skeleton_Shield_Large_A' } },
];
const CLIP = { file: 'Rig_Medium_MovementBasic', name: 'Walking_A' };

await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
fs.mkdirSync(out, { recursive: true });
const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Poses as one GLB: positions and indices (normals are made in the game), colours or a texture; packed small (meshopt). */
async function write(id, poses, texture) {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene();
    const material = doc.createMaterial(id).setRoughnessFactor(0.9).setMetallicFactor(0);
    if (texture) material.setBaseColorTexture(doc.createTexture(id).setImage(texture).setMimeType('image/png'));
    let triangles = 0;
    poses.forEach(({ position, color, uv, index }, i) => {
        const primitive = doc.createPrimitive().setMaterial(material)
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(position)).setBuffer(buffer))
            .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(index)).setBuffer(buffer));
        if (uv) primitive.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
        else primitive.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setNormalized(true).setArray(Uint8Array.from(color, (v) => Math.round(Math.min(1, v) * 255))).setBuffer(buffer));
        const mesh = doc.createMesh(`pose_${i}`).addPrimitive(primitive);
        scene.addChild(doc.createNode(`pose_${i}`).setMesh(mesh));
        triangles = index.length / 3;
    });
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }), quantize({ quantizePosition: 12, quantizeColor: 8, quantizeTexcoord: 12 }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await io.write(`${out}/${id}.glb`, doc);
    console.log(id, poses.length, 'poses', triangles, 'triangles', Math.round(fs.statSync(`${out}/${id}.glb`).size / 1024), 'KB');
}

/** A primitive in the world, thinned out: what write() takes. */
function read(primitive, matrix) {
    const position = primitive.getAttribute('POSITION');
    const color = primitive.getAttribute('COLOR_0');
    const uv = primitive.getAttribute('TEXCOORD_0');
    const made = { position: [], color: color ? [] : undefined, uv: !color && uv ? [] : undefined, index: [...primitive.getIndices().getArray()] };
    const v = new THREE.Vector3();
    for (let i = 0; i < position.getCount(); i++) {
        v.fromArray(position.getElement(i, [])).applyMatrix4(matrix);
        made.position.push(v.x, v.y, v.z);
        if (color) {
            const [r, g, b] = color.getElement(i, []);
            made.color.push(r, g, b, 1);
        } else if (uv) made.uv.push(...uv.getElement(i, []).slice(0, 2));
    }
    return made;
}

for (const { id, poses, ratio, hue = 0 } of BAKED) {
    const doc = await io.read(`${mob}/${id}.glb`);
    if (ratio) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.03 }));
    const root = doc.getRoot();
    const nodes = root.listNodes().filter((node) => node.getMesh());
    const numbered = nodes.map((node, i) => ({ node, n: Number(/(\d+)$/.exec(node.getName() || node.getMesh().getName())?.[1] ?? i) })).sort((a, b) => a.n - b.n);
    const made = poses.filter((n) => numbered[n]).map((n) => read(numbered[n].node.getMesh().listPrimitives()[0], new THREE.Matrix4().fromArray(numbered[n].node.getWorldMatrix())));
    // (Another colour, where it's in the vertices.)
    if (hue) for (const pose of made) {
        const color = new THREE.Color();
        for (let k = 0; k < (pose.color?.length ?? 0); k += 4) {
            color.setRGB(pose.color[k], pose.color[k + 1], pose.color[k + 2]).offsetHSL(hue / 360, 0, 0);
            [pose.color[k], pose.color[k + 1], pose.color[k + 2]] = [color.r, color.g, color.b];
        }
    }
    const texture = root.listTextures()[0];
    await write(id, made, texture && made[0].uv ? await sharp(Buffer.from(texture.getImage())).modulate({ hue }).png().toBuffer() : undefined);
}

/** A texture's pixels. */
async function pixelsOf(material) {
    const texture = material.getBaseColorTexture();
    if (!texture) return undefined;
    const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

/** A vertex's flat colour: its texture's where its UV falls, or its material's light. */
function colorAt(material, pixels, uv, i) {
    if (!pixels || !uv) {
        const glow = material.getEmissiveFactor();
        return glow.some((v) => v > 0) ? glow : material.getBaseColorFactor().slice(0, 3);
    }
    const [u, v] = uv.getElement(i, []);
    const x = Math.min(pixels.width - 1, Math.floor((u - Math.floor(u)) * pixels.width));
    const y = Math.min(pixels.height - 1, Math.floor((v - Math.floor(v)) * pixels.height));
    return [0, 1, 2].map((k) => linear(pixels.data[(y * pixels.width + x) * 4 + k] / 255));
}

/** The clip: each bone's track, sampled. */
const clipDoc = await io.read(`${pack}/Animations/gltf/Rig_Medium/${CLIP.file}.glb`);
const clip = clipDoc.getRoot().listAnimations().find((animation) => animation.getName() === CLIP.name);
const tracks = new Map();
let length = 0;
for (const channel of clip.listChannels()) {
    const sampler = channel.getSampler();
    const input = sampler.getInput().getArray();
    length = Math.max(length, input[input.length - 1]);
    tracks.set(`${channel.getTargetNode().getName()}/${channel.getTargetPath()}`, { input, output: sampler.getOutput() });
}
function sample(name, what, time, rest) {
    const track = tracks.get(`${name}/${what}`);
    if (!track) return rest;
    const { input, output } = track;
    let k = 0;
    while (k < input.length - 2 && input[k + 1] <= time) k++;
    const last = Math.min(k + 1, input.length - 1);
    const t = input[last] > input[k] ? Math.min(1, Math.max(0, (time - input[k]) / (input[last] - input[k]))) : 0;
    const a = output.getElement(k, []);
    const b = output.getElement(last, []);
    if (what === 'rotation') return new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), t).toArray();
    return a.map((v, i) => v + (b[i] - v) * t);
}

for (const { id, file, ratio, poses, hands } of SKELETONS) {
    const doc = await io.read(`${pack}/characters/gltf/${file}.glb`);
    for (const animation of doc.getRoot().listAnimations()) animation.dispose();
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.06 }));
    const root = doc.getRoot();
    const pixels = new Map();
    for (const material of root.listMaterials()) pixels.set(material, await pixelsOf(material));
    const weapons = [];
    for (const [slot, weapon] of Object.entries(hands)) {
        const own = await io.read(`${pack}/assets/gltf/${weapon}.gltf`);
        const ownPixels = new Map();
        for (const material of own.getRoot().listMaterials()) ownPixels.set(material, await pixelsOf(material));
        weapons.push({ slot, doc: own, pixels: ownPixels });
    }
    const made = [];
    let fit;
    for (let f = 0; f < poses; f++) {
        const time = (f / poses) * length;
        // The skeleton posed.
        const world = new Map();
        const pose = (node, parent) => {
            const name = node.getName();
            const m = new THREE.Matrix4().compose(
                new THREE.Vector3(...sample(name, 'translation', time, node.getTranslation())),
                new THREE.Quaternion(...sample(name, 'rotation', time, node.getRotation())),
                new THREE.Vector3(...sample(name, 'scale', time, node.getScale())),
            ).premultiply(parent);
            world.set(node, m);
            node.listChildren().forEach((child) => pose(child, m));
        };
        root.listScenes()[0].listChildren().forEach((node) => pose(node, new THREE.Matrix4()));
        const merged = { position: [], color: [], index: [] };
        const v = new THREE.Vector3();
        const w = new THREE.Vector3();
        const add = (primitive, place, colors) => {
            const offset = merged.position.length / 3;
            const position = primitive.getAttribute('POSITION');
            const material = primitive.getMaterial();
            for (let i = 0; i < position.getCount(); i++) {
                place(i, primitive, v.fromArray(position.getElement(i, [])));
                merged.position.push(v.x, v.y, v.z);
                merged.color.push(...colorAt(material, colors.get(material), primitive.getAttribute('TEXCOORD_0'), i), 1);
            }
            for (const i of primitive.getIndices().getArray()) merged.index.push(i + offset);
        };
        for (const node of root.listNodes()) {
            const mesh = node.getMesh();
            if (!mesh) continue;
            const skin = node.getSkin();
            const joints = skin?.listJoints();
            const inverse = skin?.getInverseBindMatrices();
            const bones = joints?.map((joint, j) => new THREE.Matrix4().multiplyMatrices(world.get(joint), new THREE.Matrix4().fromArray(inverse.getElement(j, []))));
            for (const primitive of mesh.listPrimitives()) add(primitive, (i, own, at) => {
                if (!bones) return at.applyMatrix4(world.get(node));
                const j = own.getAttribute('JOINTS_0').getElement(i, []);
                const weight = own.getAttribute('WEIGHTS_0').getElement(i, []);
                const start = at.clone();
                at.set(0, 0, 0);
                for (let k = 0; k < 4; k++) if (weight[k] > 0) at.addScaledVector(w.copy(start).applyMatrix4(bones[j[k]]), weight[k]);
                return at;
            }, pixels);
        }
        for (const { slot, doc: weapon, pixels: colors } of weapons) {
            const hand = root.listNodes().find((node) => node.getName() === slot);
            for (const node of weapon.getRoot().listNodes()) {
                const mesh = node.getMesh();
                if (!mesh) continue;
                const m = new THREE.Matrix4().multiplyMatrices(world.get(hand), new THREE.Matrix4().fromArray(node.getWorldMatrix()));
                for (const primitive of mesh.listPrimitives()) add(primitive, (i, own, at) => at.applyMatrix4(m), colors);
            }
        }
        // Fitted from the first: the body a unit high (not its weapon), feet on the ground.
        if (!fit) {
            const box = new THREE.Box3().setFromArray(merged.position);
            const heights = merged.position.filter((_, k) => k % 3 === 1).sort((a, b) => a - b);
            fit = { scale: 1 / (heights[Math.floor(heights.length * 0.995)] - box.min.y), y: box.min.y };
        }
        for (let k = 0; k < merged.position.length; k += 3) {
            merged.position[k] *= fit.scale;
            merged.position[k + 1] = (merged.position[k + 1] - fit.y) * fit.scale;
            merged.position[k + 2] *= fit.scale;
        }
        made.push(merged);
    }
    await write(id, made);
}
