// build-people.mjs — node games/ufo/tools/build-people.mjs, then npm run models.
//
// The people's models, in raw-assets/models/people{m}/, from the library's "characters Fun" kit and the Mixamo clips in
// games/ufo/mixamo/.
//
// Each outfit below becomes a model. The kit's pieces share one skeleton, bone order and texture, so an outfit's pieces
// become one skinned mesh: one draw call a person. People are small on screen, so the mesh is simplified and the texture
// goes: each vertex keeps its colour in COLOR_0. Its alpha says which part it is (PART below): a person's own colours
// replace those parts in the game, the RGB then being only the shading to keep (a grey, 0.5 = as is; game/world/People.ts).
//
// The Mixamo clips become people-anims.glb, on the kit's skeleton. Mixamo rigged the kit's body in its T-pose
// (kit-skeleton.mjs), so each bone's turn from the T-pose on Mixamo's rig is the same turn on the kit's, whatever way
// each rig's bones happen to be rolled. Fingers aren't converted (too small to see, and the kit has fewer of them).

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitSkeleton, poseTPose } from './kit-skeleton.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '../../../library3d/files/characters-Fun');
const MIXAMO = path.resolve(HERE, '../mixamo');
const OUT = path.resolve(HERE, '../raw-assets/models/people{m}');

const OUTFITS = {
    'person-01': ['Male_emotion_happy_002', 'Hairstyle_male_010', 'T-Shirt_009', 'Pants_010', 'Shoe_Slippers_005'],
    'person-02': ['Male_emotion_usual_001', 'Hairstyle_male_012', 'Outwear_029', 'Pants_014', 'Shoe_Slippers_002'],
    'person-03': ['Male_emotion_happy_002', 'Hat_010', 'T-Shirt_009', 'Shorts_003', 'Socks_008', 'Shoe_Slippers_002'],
    'person-04': ['Male_emotion_angry_003', 'Moustache_001', 'Hat_049', 'Outwear_036', 'Pants_010', 'Shoe_Slippers_005'],
    'person-05': ['Male_emotion_usual_001', 'Glasses_004', 'Hairstyle_male_012', 'T-Shirt_009', 'Shorts_003', 'Shoe_Slippers_005'],
    'person-06': ['Male_emotion_happy_002', 'Clown_nose_001', 'Hairstyle_male_010', 'Costume_10_001', 'Gloves_006'],
    'person-07': ['Male_emotion_usual_001', 'Moustache_002', 'Costume_6_001', 'Pants_014', 'Shoe_Slippers_002'],
    'person-08': ['Male_emotion_happy_002', 'Headphones_002', 'Glasses_006', 'Hat_057', 'Outwear_029', 'Shorts_003', 'Socks_008', 'Shoe_Slippers_005', 'Gloves_014'],
};

/** Which colour of a person's each piece takes (game/world/People.ts). Anything else keeps its own: faces, hats, costumes. */
const PART = { fixed: 0, skin: 1, top: 2, bottom: 3, shoes: 4, hair: 5 };
const partOf = (piece) => {
    if (/^Body/.test(piece)) return PART.skin;
    if (/^(T-Shirt|Outwear)/.test(piece)) return PART.top;
    if (/^(Pants|Shorts)/.test(piece)) return PART.bottom;
    if (/^(Shoe|Socks)/.test(piece)) return PART.shoes;
    if (/^(Hairstyle|Moustache)/.test(piece)) return PART.hair;
    return PART.fixed;
};
const PART_SCALE = 16;

/** How much of a person's triangles stay, and the most the shape may change (share of its size). */
const SIMPLIFY = { ratio: 0.4, error: 0.003 };

/** Kit bone, Mixamo bone (Mixamo has one more spine bone), parents first. */
const BONES = ['Hips', 'Spine', ['Spine1', 'Spine2'], 'Neck', 'Head',
    ...['Left', 'Right'].flatMap((side) => [`${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`, `${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`]),
].map((bone) => (Array.isArray(bone) ? { kit: bone[0], mixamo: `mixamorig${bone[1]}` } : { kit: bone, mixamo: `mixamorig${bone}` }));
/** Keys per second: enough to look right on people this small. */
const CLIPS = [{ name: 'walk', file: 'Walking.fbx', fps: 20 }, { name: 'idle', file: 'Breathing-Idle.fbx', fps: 8 }];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const atlas = await sharp(path.join(KIT, 'Textures_4.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const toLinear = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);

function sampleAtlas(u, v) {
    const { data, info } = atlas;
    const wrap = (t) => ((t % 1) + 1) % 1;
    const x = Math.min(info.width - 1, Math.floor(wrap(u) * info.width));
    const y = Math.min(info.height - 1, Math.floor(wrap(v) * info.height));
    const at = (y * info.width + x) * 3;
    return toLinear([data[at], data[at + 1], data[at + 2]]);
}

/** A piece's triangles and vertices added to the outfit's, with each vertex's colour. */
function addPiece(pile, document, part) {
    for (const node of document.getRoot().listNodes()) {
        for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
            const position = primitive.getAttribute('POSITION');
            const uv = primitive.getAttribute('TEXCOORD_0');
            const start = pile.positions.length / 3;
            const count = position.getCount();
            const read = (semantic, out) => {
                const accessor = primitive.getAttribute(semantic);
                for (let i = 0; i < count; i++) out.push(...accessor.getElement(i, []));
            };
            read('POSITION', pile.positions);
            read('NORMAL', pile.normals);
            read('JOINTS_0', pile.joints);
            read('WEIGHTS_0', pile.weights);
            const samples = [];
            for (let i = 0; i < count; i++) {
                const [u, v] = uv.getElement(i, []);
                samples.push(sampleAtlas(u, v));
            }
            // A part's colour comes from the person: only its light and dark stay, round the piece's average.
            const brightness = (c) => (c.r + c.g + c.b) / 3;
            const average = samples.reduce((sum, c) => sum + brightness(c), 0) / Math.max(1, count) || 1;
            for (const color of samples) {
                if (part === PART.fixed) pile.colors.push(color.r, color.g, color.b, 0);
                else {
                    const shade = Math.min(1, (brightness(color) / average) * 0.5);
                    pile.colors.push(shade, shade, shade, part / PART_SCALE);
                }
            }
            const indices = primitive.getIndices();
            const total = indices ? indices.getCount() : count;
            for (let i = 0; i < total; i++) pile.indices.push(start + (indices ? indices.getScalar(i) : i));
        }
    }
}

async function buildOutfit(name, pieces) {
    // The body's file is the base: it has the skeleton and skin they all share.
    const document = await io.read(path.join(KIT, 'Body_010.glb'));
    const root = document.getRoot();
    const node = root.listNodes().find((candidate) => candidate.getMesh());
    const mesh = node.getMesh();
    const pile = { positions: [], normals: [], joints: [], weights: [], colors: [], indices: [] };
    addPiece(pile, document, PART.skin);
    for (const piece of pieces) addPiece(pile, await io.read(path.join(KIT, `${piece}.glb`)), partOf(piece));

    const buffer = root.listBuffers()[0];
    const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    mesh.listPrimitives().forEach((primitive) => primitive.dispose());
    root.listMaterials().forEach((material) => material.dispose());
    root.listTextures().forEach((texture) => texture.dispose());
    const material = document.createMaterial('Person').setRoughnessFactor(0.85).setMetallicFactor(0);
    mesh.addPrimitive(document.createPrimitive()
        .setMaterial(material)
        .setIndices(accessor('SCALAR', new Uint32Array(pile.indices)))
        .setAttribute('POSITION', accessor('VEC3', new Float32Array(pile.positions)))
        .setAttribute('NORMAL', accessor('VEC3', new Float32Array(pile.normals)))
        .setAttribute('COLOR_0', accessor('VEC4', new Float32Array(pile.colors)))
        .setAttribute('JOINTS_0', accessor('VEC4', new Uint16Array(pile.joints)))
        .setAttribute('WEIGHTS_0', accessor('VEC4', new Float32Array(pile.weights))));
    node.setName(name);
    mesh.setName(name);
    await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ...SIMPLIFY }), prune());
    const kept = mesh.listPrimitives()[0].getIndices().getCount() / 3;
    const file = path.join(OUT, `${name}.glb`);
    await io.write(file, document);
    console.log(`${name}: ${pile.indices.length / 3} -> ${kept} triangles, ${(fs.statSync(file).size / 1024) | 0} KB`);
}

function loadFbx(file) {
    const bytes = fs.readFileSync(path.join(MIXAMO, file));
    const warn = console.warn;
    console.warn = () => {}; // FBXLoader warns about every vertex with over 4 weights.
    const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    console.warn = warn;
    return object;
}

/** A clip on the kit's skeleton: { rotations: bone -> Float32Array, hips: Float32Array, times }. */
function convertClip(clipDef, mixamoRig, kit) {
    const clip = loadFbx(clipDef.file).animations[0];
    const mixer = new THREE.AnimationMixer(mixamoRig);
    mixer.clipAction(clip).play();
    const frames = Math.max(2, Math.round(clip.duration * clipDef.fps) + 1);
    const times = Float32Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * clip.duration);
    const rotations = new Map(BONES.map(({ kit: name }) => [name, new Float32Array(frames * 4)]));
    const hips = new Float32Array(frames * 3);

    const mixamoHips = mixamoRig.getObjectByName('mixamorigHips');
    const kitHips = kit.byName('Hips');
    const kitHipsRest = kitHips.getWorldPosition(new THREE.Vector3());
    const hipsParentInverse = kitHips.parent.matrixWorld.clone().invert();
    // Sized to the kit: the same hips height is the same size of step.
    const rest = clipDef.rest;
    const sizeRatio = kitHipsRest.y / rest.hips.y;
    const previous = new Map();
    const world = new Map();
    const parentWorld = new THREE.Quaternion();
    times.forEach((time, frame) => {
        mixer.setTime(time);
        mixamoRig.updateMatrixWorld(true);
        for (const { kit: name, mixamo } of BONES) {
            const bone = kit.byName(name);
            const now = mixamoRig.getObjectByName(mixamo).getWorldQuaternion(new THREE.Quaternion());
            // Its turn from the T-pose on Mixamo's rig, onto the kit's T-pose; then relative to its parent's new rotation.
            const target = now.multiply(rest.bones.get(mixamo).clone().invert()).multiply(rest.kit.get(name));
            world.set(name, target);
            parentWorld.copy(world.get(bone.parent.name) ?? rest.kit.get(bone.parent.name));
            const local = parentWorld.clone().invert().multiply(target);
            // The short way round from the last key, so nothing spins between keys.
            const last = previous.get(name);
            if (last && last.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
            previous.set(name, local);
            rotations.get(name).set([local.x, local.y, local.z, local.w], frame * 4);
        }
        const moved = mixamoHips.getWorldPosition(new THREE.Vector3()).sub(rest.hips).multiplyScalar(sizeRatio).add(kitHipsRest).applyMatrix4(hipsParentInverse);
        hips.set(moved.toArray(), frame * 3);
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(mixamoRig);
    return { name: clipDef.name, times, rotations, hips };
}

async function buildAnimations() {
    const mixamoRig = loadFbx('T-Pose.fbx');
    mixamoRig.updateMatrixWorld(true);
    const kit = kitSkeleton(await io.read(path.join(KIT, 'Body_010.glb')));
    poseTPose(kit);

    const kitWorld = new Map();
    kit.top.traverse((object) => kitWorld.set(object.name, object.getWorldQuaternion(new THREE.Quaternion())));
    const bones = new Map();
    for (const { mixamo } of BONES) bones.set(mixamo, mixamoRig.getObjectByName(mixamo).getWorldQuaternion(new THREE.Quaternion()));
    const rest = { kit: kitWorld, bones, hips: mixamoRig.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3()) };

    const document = new Document();
    const root = document;
    const buffer = root.createBuffer();
    const scene = root.createScene('anims');
    const nodes = new Map(BONES.map(({ kit: name }) => {
        const node = root.createNode(name);
        scene.addChild(node);
        return [name, node];
    }));
    const accessor = (type, array) => root.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    for (const def of CLIPS) {
        const clip = convertClip({ ...def, rest }, mixamoRig, kit);
        const animation = root.createAnimation(clip.name);
        const times = accessor('SCALAR', clip.times);
        const track = (node, targetPath, values, type) => {
            const sampler = root.createAnimationSampler().setInput(times).setOutput(accessor(type, values)).setInterpolation('LINEAR');
            animation.addSampler(sampler);
            animation.addChannel(root.createAnimationChannel().setTargetNode(node).setTargetPath(targetPath).setSampler(sampler));
        };
        for (const [name, values] of clip.rotations) track(nodes.get(name), 'rotation', values, 'VEC4');
        track(nodes.get('Hips'), 'translation', clip.hips, 'VEC3');
        console.log(`${clip.name}: ${clip.times.length} keys over ${clip.times[clip.times.length - 1].toFixed(2)}s`);
    }
    const file = path.join(OUT, 'people-anims.glb');
    await io.write(file, document);
    console.log(`people-anims: ${(fs.statSync(file).size / 1024) | 0} KB`);
}

await MeshoptSimplifier.ready;
fs.mkdirSync(OUT, { recursive: true });
for (const [name, pieces] of Object.entries(OUTFITS)) await buildOutfit(name, pieces);
await buildAnimations();
