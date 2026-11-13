// build-people.mjs — node games/restaurant/tools/build-people.mjs, then npm run models (GAME=restaurant).
//
// The restaurant's people, in raw-assets/models/people{m}/ (person-0N: the customers, close up; crowd-0N: the same people
// much lighter, for the street's crowd, small on screen): the library's "characters Fun" kit (its own Body_010 and its
// own clothes, on its own skeleton) and the Mixamo clips the Dig game plays (games/dig/raw-assets/models/characters{m}/
// default: walking, idle, sitting, ...).
//
// Outfits: as UFO's (games/ufo/tools/build-people.mjs: one skinned mesh a person, the kit's texture baked into COLOR_0,
// its alpha the part a person's own colours replace: game/world/Customers.ts). The customers keep the kit's full detail
// (simplifying the body and its clothes apart lets skin poke through them); the crowd's are simplified hard (CROWD). The
// body's own triangles under the clothes go first in both (COVER), so nothing pokes through when the clothes and the body
// bend a little differently. npm run models then quantises and meshopt-compresses them all (raw-assets/models-optimize.json).
//
// Clips: Dig's are on its characterMedium rig (Kenney's: Root, HipsCtrl, Hips, Spine, Chest, UpperChest, ...; the clip
// files only key it, its rest pose is in characterMedium.fbx). Both rigs are straightened into the same T-pose (arms
// out along X, legs down: STRAIGHTEN), so a bone's turn from that pose on Dig's rig is the same turn on the kit's, however
// each rig's bones are rolled. The kit's in-between bones take what Dig's had added up by then (its Spine1: Dig's
// UpperChest, over its Chest). The hips' move is scaled by the two rigs' hips heights. Fingers aren't converted.

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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const KIT = path.join(REPO, 'library3d/files/characters-Fun');
const DIG = path.join(REPO, 'games/dig/raw-assets/models/characters{m}/default');
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

/** Which colour of a person's each piece takes (game/world/Customers.ts). Anything else keeps its own: faces, hats, costumes. */
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
/** Pieces that cover the body (its skin under them goes). Not socks: shoes go over them, and bare ankles show between. */
const COVERS = /^(T-Shirt|Outwear|Pants|Shorts|Shoe|Costume|Gloves)/;
/**
 * A body vertex is under the clothes when a covering piece's surface is outside it within `depth` along its normal (and
 * within `across` of that line). A body triangle goes when all three of its corners are.
 */
const COVER = { depth: 0.05, across: 0.025, cell: 0.05 };

/** The crowd's people: the share of triangles kept, and the most the shape may change (share of its size). */
const CROWD = { ratio: 0.18, error: 0.02 };

/** Kit bone, Dig's bone (the kit has two spine bones to Dig's three, and ToeBase for Toes); parents first. */
const BONES = [['Hips', 'Hips'], ['Spine', 'Spine'], ['Spine1', 'UpperChest'], ['Neck', 'Neck'], ['Head', 'Head'],
    ...['Left', 'Right'].flatMap((side) => [
        ...['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot'].map((b) => [`${side}${b}`, `${side}${b}`]),
        [`${side}ToeBase`, `${side}Toes`],
    ]),
].map(([kit, dig]) => ({ kit, dig }));

const RIGHT = new THREE.Vector3(1, 0, 0);
const LEFT = new THREE.Vector3(-1, 0, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
/** Bone, the child it points at, which way it points in the T-pose. Parents first. Left is +X in both rigs (both face +Z). */
const STRAIGHTEN = [
    ['LeftArm', 'LeftForeArm', RIGHT], ['LeftForeArm', 'LeftHand', RIGHT],
    ['RightArm', 'RightForeArm', LEFT], ['RightForeArm', 'RightHand', LEFT],
    ['LeftUpLeg', 'LeftLeg', DOWN], ['LeftLeg', 'LeftFoot', DOWN],
    ['RightUpLeg', 'RightLeg', DOWN], ['RightLeg', 'RightFoot', DOWN],
];

/**
 * The clips: our name, Dig's file (its first clip that isn't a one-frame pose), keys per second. `loop`: it starts where
 * it ends. `inPlace`: the hips' drift over the clip taken out (people walk by the game's code, not the clip's).
 */
const CLIPS = [
    { name: 'walk', file: 'Walking.glb', fps: 30, inPlace: true },
    { name: 'idle', file: 'idle.glb', fps: 15 },
    { name: 'sit', file: 'Sitting.glb', fps: 15 },
    { name: 'sitDown', file: 'StandToSit.glb', fps: 30 },
    { name: 'talk', file: 'Talking.glb', fps: 15 },
    { name: 'happy', file: 'Excited.glb', fps: 24 },
    { name: 'happyIdle', file: 'HappyIdle.glb', fps: 15 },
    { name: 'run', file: 'Running.glb', fps: 30, inPlace: true },
];

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

// ---------------------------------------------------------------- outfits

/** A piece's triangles and vertices (its colours from the texture), as plain arrays. */
function readPiece(document, part) {
    const piece = { positions: [], normals: [], joints: [], weights: [], colors: [], indices: [] };
    for (const node of document.getRoot().listNodes()) {
        for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
            const start = piece.positions.length / 3;
            const count = primitive.getAttribute('POSITION').getCount();
            const read = (semantic, out) => {
                const accessor = primitive.getAttribute(semantic);
                for (let i = 0; i < count; i++) out.push(...accessor.getElement(i, []));
            };
            read('POSITION', piece.positions);
            read('NORMAL', piece.normals);
            read('JOINTS_0', piece.joints);
            read('WEIGHTS_0', piece.weights);
            const uv = primitive.getAttribute('TEXCOORD_0');
            const samples = [];
            for (let i = 0; i < count; i++) {
                const [u, v] = uv.getElement(i, []);
                samples.push(sampleAtlas(u, v));
            }
            // A part's colour comes from the person: only its light and dark stay, round the piece's average.
            const brightness = (c) => (c.r + c.g + c.b) / 3;
            const average = samples.reduce((sum, c) => sum + brightness(c), 0) / Math.max(1, count) || 1;
            for (const color of samples) {
                if (part === PART.fixed) piece.colors.push(color.r, color.g, color.b, 0);
                else {
                    const shade = Math.min(1, (brightness(color) / average) * 0.5);
                    piece.colors.push(shade, shade, shade, part / PART_SCALE);
                }
            }
            const indices = primitive.getIndices();
            const total = indices ? indices.getCount() : count;
            for (let i = 0; i < total; i++) piece.indices.push(start + (indices ? indices.getScalar(i) : i));
        }
    }
    return piece;
}

/** The body's triangles left once those under `covers` (pieces' vertex positions) are dropped. */
function uncoveredBody(body, covers) {
    // The covering pieces' vertices in a grid, to look near a body vertex quickly.
    const grid = new Map();
    const key = (x, y, z) => `${Math.floor(x / COVER.cell)},${Math.floor(y / COVER.cell)},${Math.floor(z / COVER.cell)}`;
    for (const cover of covers) {
        for (let i = 0; i < cover.positions.length; i += 3) {
            const k = key(cover.positions[i], cover.positions[i + 1], cover.positions[i + 2]);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(cover.positions[i], cover.positions[i + 1], cover.positions[i + 2]);
        }
    }
    const reach = Math.ceil(COVER.depth / COVER.cell);
    const count = body.positions.length / 3;
    const covered = new Uint8Array(count);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const d = new THREE.Vector3();
    for (let v = 0; v < count; v++) {
        p.fromArray(body.positions, v * 3);
        n.fromArray(body.normals, v * 3).normalize();
        const [cx, cy, cz] = [p.x, p.y, p.z].map((t) => Math.floor(t / COVER.cell));
        search: for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - reach; y <= cy + reach; y++) for (let z = cz - reach; z <= cz + reach; z++) {
            const list = grid.get(`${x},${y},${z}`);
            if (!list) continue;
            for (let i = 0; i < list.length; i += 3) {
                d.set(list[i] - p.x, list[i + 1] - p.y, list[i + 2] - p.z);
                const along = d.dot(n);
                if (along < -0.002 || along > COVER.depth) continue;
                if (d.addScaledVector(n, -along).length() > COVER.across) continue;
                covered[v] = 1;
                break search;
            }
        }
    }
    const kept = [];
    for (let t = 0; t < body.indices.length; t += 3) {
        const [a, b, c] = [body.indices[t], body.indices[t + 1], body.indices[t + 2]];
        if (!(covered[a] && covered[b] && covered[c])) kept.push(a, b, c);
    }
    return { indices: kept, dropped: (body.indices.length - kept.length) / 3 };
}

/** Outfit `index` (from 1): its customer (full detail) and its crowd copy (CROWD). */
async function buildOutfit(index, pieces) {
    const id = String(index).padStart(2, '0');
    const full = await writeOutfit(`person-${id}`, pieces, null);
    const light = await writeOutfit(`crowd-${id}`, pieces, CROWD);
    console.log(`outfit ${id}: customer ${full.triangles} triangles (${full.dropped} of the body's under the clothes left out), ${full.kb} KB; crowd ${light.triangles} triangles, ${light.kb} KB`);
}

async function writeOutfit(name, pieces, simplified) {
    // The body's file is the base: it has the skeleton and skin they all share.
    const document = await io.read(path.join(KIT, 'Body_010.glb'));
    const root = document.getRoot();
    const node = root.listNodes().find((candidate) => candidate.getMesh());
    const mesh = node.getMesh();
    const body = readPiece(document, PART.skin);
    const worn = await Promise.all(pieces.map(async (piece) => ({ piece, ...readPiece(await io.read(path.join(KIT, `${piece}.glb`)), partOf(piece)) })));
    const { indices: bodyIndices, dropped } = uncoveredBody(body, worn.filter(({ piece }) => COVERS.test(piece)));

    const pile = { positions: [], normals: [], joints: [], weights: [], colors: [], indices: [] };
    const add = (piece, indices) => {
        const start = pile.positions.length / 3;
        for (const key of ['positions', 'normals', 'joints', 'weights', 'colors']) pile[key].push(...piece[key]);
        for (const i of indices) pile.indices.push(start + i);
    };
    add(body, bodyIndices);
    for (const piece of worn) add(piece, piece.indices);

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
    await document.transform(weld(), ...(simplified ? [simplify({ simplifier: MeshoptSimplifier, ...simplified })] : []), prune());
    const file = path.join(OUT, `${name}.glb`);
    await io.write(file, document);
    return { triangles: mesh.listPrimitives()[0].getIndices().getCount() / 3, dropped, kb: (fs.statSync(file).size / 1024) | 0 };
}

// ---------------------------------------------------------------- clips

/** The kit's skeleton as three.js objects (in its bind pose). */
function kitSkeleton(document) {
    const objects = new Map();
    for (const node of document.getRoot().listNodes()) {
        if (node.getMesh()) continue;
        const object = new THREE.Object3D();
        object.name = node.getName();
        object.position.fromArray(node.getTranslation());
        object.quaternion.fromArray(node.getRotation());
        object.scale.fromArray(node.getScale());
        objects.set(node, object);
    }
    const top = new THREE.Object3D();
    for (const [node, object] of objects) {
        const parent = node.listParents().find((candidate) => objects.has(candidate));
        (parent ? objects.get(parent) : top).add(object);
    }
    top.updateMatrixWorld(true);
    return top;
}

/** Dig's rig (characterMedium.fbx) in its bind pose. */
function digRig() {
    const bytes = fs.readFileSync(path.join(DIG, 'characterMedium.fbx'));
    const warn = console.warn;
    console.warn = () => {}; // FBXLoader warns about every vertex with over 4 weights.
    const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    console.warn = warn;
    object.updateMatrixWorld(true);
    return object;
}

const bone = (top, name) => {
    const found = top.getObjectByName(name);
    if (!found) throw new Error(`No bone ${name}`);
    return found;
};

/** Puts a rig in the T-pose (STRAIGHTEN). */
function straighten(top) {
    for (const [name, childName, direction] of STRAIGHTEN) {
        const b = bone(top, name);
        const at = b.getWorldPosition(new THREE.Vector3());
        const now = bone(top, childName).getWorldPosition(new THREE.Vector3()).sub(at).normalize();
        const world = new THREE.Quaternion().setFromUnitVectors(now, direction).multiply(b.getWorldQuaternion(new THREE.Quaternion()));
        b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
        top.updateMatrixWorld(true);
    }
}

/** One of Dig's clip files as a three.js clip on its rig (rotations; HipsCtrl's move too). */
async function digClip(file) {
    const document = await io.read(path.join(DIG, file));
    const animations = document.getRoot().listAnimations();
    const length = (animation) => Math.max(...animation.listSamplers().map((s) => s.getInput().getMax([])[0]));
    const animation = animations.find((a) => length(a) > 0.1) ?? animations[0];
    const tracks = [];
    for (const channel of animation.listChannels()) {
        const name = channel.getTargetNode().getName();
        const targetPath = channel.getTargetPath();
        const sampler = channel.getSampler();
        const times = Array.from(sampler.getInput().getArray());
        const values = Array.from(sampler.getOutput().getArray());
        if (targetPath === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
        else if (targetPath === 'translation' && name === 'HipsCtrl') tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, values));
    }
    return new THREE.AnimationClip(animation.getName(), length(animation), tracks);
}

/** A clip on the kit's skeleton: { rotations: bone -> Float32Array, hips: Float32Array, times }. */
async function convertClip(def, rest, kit) {
    const clip = await digClip(def.file);
    const rig = digRig();
    const mixer = new THREE.AnimationMixer(rig);
    mixer.clipAction(clip).play();
    const frames = Math.max(2, Math.round(clip.duration * def.fps) + 1);
    const times = Float32Array.from({ length: frames }, (_, i) => (i / (frames - 1)) * clip.duration);
    const rotations = new Map(BONES.map(({ kit: name }) => [name, new Float32Array(frames * 4)]));
    const hips = new Float32Array(frames * 3);

    const digHips = bone(rig, 'Hips');
    const kitHips = bone(kit, 'Hips');
    const hipsParentInverse = kitHips.parent.matrixWorld.clone().invert();
    const sizeRatio = rest.kitHips.y / rest.digHips.y;
    const previous = new Map();
    const world = new Map();
    const moves = [];
    times.forEach((time, frame) => {
        mixer.setTime(time);
        rig.updateMatrixWorld(true);
        for (const { kit: name, dig } of BONES) {
            const kitBone = bone(kit, name);
            const now = bone(rig, dig).getWorldQuaternion(new THREE.Quaternion());
            // Its turn from the T-pose on Dig's rig, onto the kit's T-pose; then relative to its parent's new rotation.
            const target = now.multiply(rest.dig.get(dig).clone().invert()).multiply(rest.kit.get(name));
            world.set(name, target);
            const parentWorld = world.get(kitBone.parent.name) ?? rest.kit.get(kitBone.parent.name);
            const local = parentWorld.clone().invert().multiply(target);
            // The short way round from the last key, so nothing spins between keys.
            const last = previous.get(name);
            if (last && last.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
            previous.set(name, local);
            rotations.get(name).set([local.x, local.y, local.z, local.w], frame * 4);
        }
        moves.push(digHips.getWorldPosition(new THREE.Vector3()).sub(rest.digHips).multiplyScalar(sizeRatio));
    });
    if (def.inPlace) {
        // Its drift over the clip (forward, sideways) out: it starts and ends on the spot.
        const drift = moves[moves.length - 1].clone().sub(moves[0]).setY(0);
        moves.forEach((move, frame) => move.addScaledVector(drift, -frame / (frames - 1)));
    }
    moves.forEach((move, frame) => hips.set(move.clone().add(rest.kitHips).applyMatrix4(hipsParentInverse).toArray(), frame * 3));
    // How the clip moves, for the game's numbers: the hips' lowest height (sitting), and how fast a foot travels back
    // while it's down (walking: the speed the clip walks at).
    const feet = { min: Infinity, speed: 0 };
    feet.min = Math.min(...moves.map((m) => m.y + rest.kitHips.y));
    mixer.stopAllAction();
    return { name: def.name, times, rotations, hips, hipsLowest: feet.min, duration: clip.duration, moves };
}

/** How fast the clip walks (model units a second): a planted foot's speed back under the body, on the kit. */
function walkSpeed(clip, kit) {
    const foot = bone(kit, 'LeftFoot');
    const restRotations = new Map();
    kit.traverse((object) => restRotations.set(object, object.quaternion.clone()));
    const samples = [];
    const hipsBone = bone(kit, 'Hips');
    const hipsRest = hipsBone.position.clone();
    for (let frame = 0; frame < clip.times.length; frame++) {
        for (const [name, values] of clip.rotations) bone(kit, name).quaternion.fromArray(values, frame * 4);
        hipsBone.position.fromArray(clip.hips, frame * 3);
        kit.updateMatrixWorld(true);
        samples.push(foot.getWorldPosition(new THREE.Vector3()));
    }
    // Restore the bind pose.
    for (const [object, quaternion] of restRotations) object.quaternion.copy(quaternion);
    hipsBone.position.copy(hipsRest);
    kit.updateMatrixWorld(true);
    const lowest = Math.min(...samples.map((s) => s.y));
    let travelled = 0;
    let time = 0;
    for (let i = 1; i < samples.length; i++) {
        // Planted: near its lowest.
        if (samples[i].y - lowest > 0.03 || samples[i - 1].y - lowest > 0.03) continue;
        travelled += Math.abs(samples[i].z - samples[i - 1].z);
        time += clip.times[i] - clip.times[i - 1];
    }
    return time ? travelled / time : 0;
}

async function buildAnimations() {
    const kitDocument = await io.read(path.join(KIT, 'Body_010.glb'));
    const kit = kitSkeleton(kitDocument);
    const kitBind = kitSkeleton(kitDocument);
    straighten(kit);
    const rig = digRig();
    straighten(rig);

    const worldOf = (top, names) => new Map(names.map((name) => [name, bone(top, name).getWorldQuaternion(new THREE.Quaternion())]));
    const kitNames = [];
    kit.traverse((object) => object.name && kitNames.push(object.name));
    const rest = {
        kit: worldOf(kit, kitNames),
        dig: worldOf(rig, BONES.map(({ dig }) => dig)),
        kitHips: bone(kit, 'Hips').getWorldPosition(new THREE.Vector3()),
        digHips: bone(rig, 'Hips').getWorldPosition(new THREE.Vector3()),
    };
    const toes = bone(kit, 'LeftToeBase').getWorldPosition(new THREE.Vector3());
    const heel = bone(kit, 'LeftFoot').getWorldPosition(new THREE.Vector3());
    if (toes.z < heel.z) throw new Error('The kit faces -Z: STRAIGHTEN assumes both rigs face +Z');

    const document = new Document();
    const buffer = document.createBuffer();
    const scene = document.createScene('anims');
    const nodes = new Map(BONES.map(({ kit: name }) => {
        const node = document.createNode(name);
        scene.addChild(node);
        return [name, node];
    }));
    const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    const report = {};
    for (const def of CLIPS) {
        const clip = await convertClip(def, rest, kit);
        const animation = document.createAnimation(clip.name);
        const times = accessor('SCALAR', clip.times);
        const track = (node, targetPath, values, type) => {
            const sampler = document.createAnimationSampler().setInput(times).setOutput(accessor(type, values)).setInterpolation('LINEAR');
            animation.addSampler(sampler);
            animation.addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath(targetPath).setSampler(sampler));
        };
        for (const [name, values] of clip.rotations) track(nodes.get(name), 'rotation', values, 'VEC4');
        track(nodes.get('Hips'), 'translation', clip.hips, 'VEC3');
        const line = { keys: clip.times.length, seconds: +clip.duration.toFixed(2), hipsLowest: +clip.hipsLowest.toFixed(3) };
        if (def.inPlace) line.walkSpeed = +walkSpeed(clip, kitBind).toFixed(3);
        report[clip.name] = line;
    }
    const file = path.join(OUT, 'people-anims.glb');
    await io.write(file, document);
    console.log(`people-anims: ${(fs.statSync(file).size / 1024) | 0} KB; kit hips at ${rest.kitHips.y.toFixed(3)} (model units)`);
    console.table(report);
}

fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready;
if (!process.argv.includes('--clips')) for (const [i, pieces] of Object.values(OUTFITS).entries()) await buildOutfit(i + 1, pieces);
await buildAnimations();
