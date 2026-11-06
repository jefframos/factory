// build-mob.mjs — node games/mob/tools/build-mob.mjs, then npm run models.
//
// The mob's model, in raw-assets/models/mob{m}/: the library's "characters Fun" kit body (the plain skin one, the
// same skeleton UFO's people use) with a face, as one simplified skinned mesh with no texture. Each vertex keeps its
// colour in COLOR_0, and its alpha says whether the team colour paints it: 1 = paint (the RGB is then only the shading
// to keep, 0.5 = as is), 0 = keep its own colour (the face). game/battle/CrowdView.ts bakes the run cycle from it.
//
// The animations, mob-anims.glb: Mixamo clips converted onto the kit's skeleton the way UFO's people's are
// (games/ufo/tools/build-people.mjs): Mixamo rigged the kit's body in its T-pose (kit-skeleton.mjs), so each bone's turn
// from the T-pose on Mixamo's rig is the same turn on the kit's. `run` is games/mob/mixamo/Running.fbx (in place);
// `walk` and `idle` are UFO's clips (games/ufo/mixamo/), as is the T-pose they're measured from.

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
import { kitSkeleton, poseTPose } from '../../ufo/tools/kit-skeleton.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '../../../library3d/files/characters-Fun');
const MOB_MIXAMO = path.resolve(HERE, '../mixamo');
const UFO_MIXAMO = path.resolve(HERE, '../../ufo/mixamo');
/** The clips: name in the game, file, folder, keys per second (enough for mobs this small). */
const CLIPS = [
    { name: 'run', file: 'Running.fbx', dir: MOB_MIXAMO, fps: 24 },
    { name: 'walk', file: 'Walking.fbx', dir: UFO_MIXAMO, fps: 20 },
    { name: 'idle', file: 'Breathing-Idle.fbx', dir: UFO_MIXAMO, fps: 8 },
];
/** Kit bone, Mixamo bone (Mixamo has one more spine bone), parents first. Fingers aren't converted (too small to see). */
const BONES = ['Hips', 'Spine', ['Spine1', 'Spine2'], 'Neck', 'Head',
    ...['Left', 'Right'].flatMap((side) => [`${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`, `${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`]),
].map((bone) => (Array.isArray(bone) ? { kit: bone[0], mixamo: `mixamorig${bone[1]}` } : { kit: bone, mixamo: `mixamorig${bone}` }));
const OUT = path.resolve(HERE, '../raw-assets/models/mob{m}');

/** The pieces: the body is painted with the team colour, the face keeps its own. */
const BODY = 'Body_010';
const FACE = 'Male_emotion_happy_002';
/** Mobs are small and many: keep a quarter of the triangles, the shape barely changing. */
const SIMPLIFY = { ratio: 0.25, error: 0.004 };

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

/** A piece's triangles and vertices added to the pile, each vertex with its colour (painted or kept). */
function addPiece(pile, document, painted) {
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
            // Painted: only the light and dark stay, round the piece's average (0.5 = the team colour as is).
            const brightness = (c) => (c.r + c.g + c.b) / 3;
            const average = samples.reduce((sum, c) => sum + brightness(c), 0) / Math.max(1, count) || 1;
            for (const color of samples) {
                if (!painted) pile.colors.push(color.r, color.g, color.b, 0);
                else {
                    const shade = Math.min(1, (brightness(color) / average) * 0.5);
                    pile.colors.push(shade, shade, shade, 1);
                }
            }
            const indices = primitive.getIndices();
            const total = indices ? indices.getCount() : count;
            for (let i = 0; i < total; i++) pile.indices.push(start + (indices ? indices.getScalar(i) : i));
        }
    }
}

async function buildMob() {
    // The body's file is the base: it has the skeleton and skin the face shares.
    const document = await io.read(path.join(KIT, `${BODY}.glb`));
    const root = document.getRoot();
    const node = root.listNodes().find((candidate) => candidate.getMesh());
    const mesh = node.getMesh();
    const pile = { positions: [], normals: [], joints: [], weights: [], colors: [], indices: [] };
    addPiece(pile, document, true);
    addPiece(pile, await io.read(path.join(KIT, `${FACE}.glb`)), false);

    const buffer = root.listBuffers()[0];
    const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    mesh.listPrimitives().forEach((primitive) => primitive.dispose());
    root.listMaterials().forEach((material) => material.dispose());
    root.listTextures().forEach((texture) => texture.dispose());
    const material = document.createMaterial('Mob').setRoughnessFactor(0.8).setMetallicFactor(0);
    mesh.addPrimitive(document.createPrimitive()
        .setMaterial(material)
        .setIndices(accessor('SCALAR', new Uint32Array(pile.indices)))
        .setAttribute('POSITION', accessor('VEC3', new Float32Array(pile.positions)))
        .setAttribute('NORMAL', accessor('VEC3', new Float32Array(pile.normals)))
        .setAttribute('COLOR_0', accessor('VEC4', new Float32Array(pile.colors)))
        .setAttribute('JOINTS_0', accessor('VEC4', new Uint16Array(pile.joints)))
        .setAttribute('WEIGHTS_0', accessor('VEC4', new Float32Array(pile.weights))));
    node.setName('mob');
    mesh.setName('mob');
    await document.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ...SIMPLIFY }), prune());
    const kept = mesh.listPrimitives()[0].getIndices().getCount() / 3;
    const file = path.join(OUT, 'mob.glb');
    await io.write(file, document);
    console.log(`mob: ${pile.indices.length / 3} -> ${kept} triangles, ${(fs.statSync(file).size / 1024) | 0} KB`);
}

function loadFbx(dir, file) {
    const bytes = fs.readFileSync(path.join(dir, file));
    const warn = console.warn;
    console.warn = () => {}; // FBXLoader warns about every vertex with over 4 weights.
    const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    console.warn = warn;
    return object;
}

/** A clip on the kit's skeleton: { name, times, rotations: bone -> Float32Array, hips: Float32Array }. */
function convertClip(clipDef, rest, mixamoRig, kit) {
    const clip = loadFbx(clipDef.dir, clipDef.file).animations[0];
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
    const mixamoRig = loadFbx(UFO_MIXAMO, 'T-Pose.fbx');
    mixamoRig.updateMatrixWorld(true);
    const kit = kitSkeleton(await io.read(path.join(KIT, `${BODY}.glb`)));
    poseTPose(kit);
    const kitWorld = new Map();
    kit.top.traverse((object) => kitWorld.set(object.name, object.getWorldQuaternion(new THREE.Quaternion())));
    const bones = new Map();
    for (const { mixamo } of BONES) bones.set(mixamo, mixamoRig.getObjectByName(mixamo).getWorldQuaternion(new THREE.Quaternion()));
    const rest = { kit: kitWorld, bones, hips: mixamoRig.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3()) };

    const document = new Document();
    const buffer = document.createBuffer();
    const scene = document.createScene('anims');
    const nodes = new Map(BONES.map(({ kit: name }) => {
        const node = document.createNode(name);
        scene.addChild(node);
        return [name, node];
    }));
    const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
    for (const def of CLIPS) {
        const clip = convertClip(def, rest, mixamoRig, kit);
        const animation = document.createAnimation(clip.name);
        const times = accessor('SCALAR', clip.times);
        const track = (node, targetPath, values, type) => {
            const sampler = document.createAnimationSampler().setInput(times).setOutput(accessor(type, values)).setInterpolation('LINEAR');
            animation.addSampler(sampler);
            animation.addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath(targetPath).setSampler(sampler));
        };
        for (const [name, values] of clip.rotations) track(nodes.get(name), 'rotation', values, 'VEC4');
        track(nodes.get('Hips'), 'translation', clip.hips, 'VEC3');
        console.log(`${clip.name}: ${clip.times.length} keys over ${clip.times[clip.times.length - 1].toFixed(2)}s`);
    }
    const file = path.join(OUT, 'mob-anims.glb');
    await io.write(file, document);
    console.log(`mob-anims: ${(fs.statSync(file).size / 1024) | 0} KB`);
}

await MeshoptSimplifier.ready;
fs.mkdirSync(OUT, { recursive: true });
await buildMob();
await buildAnimations();
