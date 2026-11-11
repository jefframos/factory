// bake-characters.mjs — the card units from Unity FBX packs (build-characters.mjs runs it), baked here once.
//
// Each FBX (three's FBXLoader in Node) is posed through its run cycle — its own clip (the Stone Monster's Run), or, for a
// model sold without animations (the Kevin Iglesias Golem), a walk made here from its bones (WALKS: legs swinging,
// knees bending, the arms down out of the T-pose and swinging, a bob) — into FRAMES poses. Each pose: every part's
// skinned vertices, merged into one mesh, each vertex coloured from the texture where its UV falls, fitted (unit
// height, feet at 0, centred, facing +Z). Written as one GLB of FRAMES meshes, pose_0..pose_N (no skeleton: the game's
// CharacterView draws them as they are), meshopt-compressed.

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import fs from 'node:fs';
import path from 'node:path';

const FRAMES = 10;

/**
 * The FBX characters. `model`: the FBX; `clip`: an FBX with its run (or none: `walk`, the walk made here); `texture`:
 * its colour texture; `turn`: a turn about Y (radians) so it faces +Z.
 */
export const BAKED = [
    // The Level 1 Monster Pack: one take with every clip in it (the Unity .meta's frame ranges: `range`, at `fps`).
    {
        // (Textured: their faces are painted on, finer than their few vertices.)
        // Still (one pose, as modelled: the game floats them).
        id: 'bat', model: 'Level 1 Monster Pack/Models/Bat_Level_1.fbx', still: true, textured: true,
        texture: 'Level 1 Monster Pack/Images/Bat/Bat_Color.jpg',
    },
    // The RPG Monster DUO's spiked shell (its Polyart look: a palette texture), its walk its own FBX.
    {
        id: 'turtle', model: 'RPG Monster DUO PBR Polyart/Meshes/TurtleShellPolyartMesh.fbx', clip: 'RPG Monster DUO PBR Polyart/Animations/TurtleShell/Walk_TurtleShell_Anim.fbx',
        texture: 'RPG Monster DUO PBR Polyart/Textures/Albedo.png', textured: true,
        // Modelled Z-up: laid down (its shell up, its head forward).
        layDown: true,
    },
    {
        // Still (one pose, as modelled: the game floats it, its run's no use).
        id: 'stone-monster', model: 'amusedART/StoneMonster/StoneMonster.FBX', still: true,
        texture: 'amusedART/StoneMonster/Texture/StoneMonster.png', keep: 0.5,
    },
    {
        id: 'golem', model: 'Kevin Iglesias/Characters/Humanoid Giant/Models/GiantModel01_Flat - Golem_Flat.fbx',
        texture: 'Kevin Iglesias/Characters/Humanoid Giant/Textures/Giant01/Texture01/Giant01_Texture01-BaseColor.png', keep: 0.4,
        walk: {
            hips: 'B-hips', spine: 'B-spine',
            thighs: ['B-thighL', 'B-thighR'], shins: ['B-shinL', 'B-shinR'], feet: ['B-footL', 'B-footR'],
            arms: ['B-upperArmL', 'B-upperArmR'], forearms: ['B-forearmL', 'B-forearmR'], hands: ['B-handL', 'B-handR'],
            // Degrees: the stride, the knee's bend, the arms' swing, how far down from the T-pose, the elbows' bend, the bob (a share of its height).
            stride: 26, knee: 38, swing: 18, armsDown: 72, elbow: 18, bob: 0.025,
        },
    },
];

// FBXLoader tries to load the FBX's textures, which needs a DOM: an empty texture will do (the colours come below).
THREE.TextureLoader.prototype.load = () => new THREE.Texture();

function parseFbx(file) {
    const bytes = fs.readFileSync(file);
    const warn = console.warn;
    console.warn = () => {};
    const object = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    console.warn = warn;
    object.updateMatrixWorld(true);
    return object;
}

/** A bone `bone` turned by `angle` (radians) about the world axis `axis`, over its rest (its parent as it is now). */
function turnInWorld(bone, rest, axis, angle) {
    const parent = new THREE.Quaternion();
    bone.parent.getWorldQuaternion(parent);
    const turn = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    // L' = P^-1 R P L
    bone.quaternion.copy(parent.clone().invert().multiply(turn).multiply(parent).multiply(rest));
    bone.updateMatrixWorld(true);
}

/** Which way (+1 / -1) turning `bone` about `axis` moves `probe` along `along` (world). */
function sideOf(bone, rest, axis, probe, along) {
    const before = probe.getWorldPosition(new THREE.Vector3());
    turnInWorld(bone, rest, axis, 0.3);
    const after = probe.getWorldPosition(new THREE.Vector3());
    bone.quaternion.copy(rest);
    bone.updateMatrixWorld(true);
    return Math.sign(after.sub(before).dot(along)) || 1;
}

/** The walk for a model with none: poses its bones for the cycle's point `t` (0..1). */
function makeWalk(root, spec) {
    const find = (name) => {
        let found = null;
        root.traverse((o) => { if (!found && o.isBone && o.name === name) found = o; });
        return found;
    };
    const bones = {};
    for (const key of ['thighs', 'shins', 'feet', 'arms', 'forearms', 'hands']) bones[key] = spec[key].map(find);
    const hips = find(spec.hips);
    const all = [hips, ...Object.values(bones).flat()].filter(Boolean);
    const rest = new Map(all.map((bone) => [bone, bone.quaternion.clone()]));
    const hipsRest = hips.position.clone();
    root.updateMatrixWorld(true);
    // The model's axes: up Y; forward from the feet to the toes' side (its front), side X.
    const box = new THREE.Box3().setFromObject(root);
    const height = box.max.y - box.min.y;
    const side = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const footAt = bones.feet[0].getWorldPosition(new THREE.Vector3());
    const toe = bones.feet[0].children[0]?.getWorldPosition(new THREE.Vector3()) ?? footAt.clone().add(new THREE.Vector3(0, 0, 1));
    const forward = new THREE.Vector3(0, 0, Math.sign(toe.z - footAt.z) || 1);
    // Signs: a knee bends the foot back; an arm comes down (its hand lower); an elbow brings the hand forward.
    const kneeSign = bones.shins.map((shin, k) => -sideOf(shin, rest.get(shin), side, bones.feet[k], forward));
    const armAxis = forward;
    const downSign = bones.arms.map((arm, k) => -sideOf(arm, rest.get(arm), armAxis, bones.hands[k], up));
    const elbowSign = bones.forearms.map((fore, k) => sideOf(fore, rest.get(fore), side, bones.hands[k], forward));
    const rad = THREE.MathUtils.degToRad;
    return {
        forward,
        pose(t) {
            const phase = t * Math.PI * 2;
            for (const bone of all) bone.quaternion.copy(rest.get(bone));
            hips.position.copy(hipsRest);
            // A bob: lowest as each foot lands (twice a cycle). In the hips' parent's units (the model's).
            hips.position.y -= Math.abs(Math.cos(phase)) * spec.bob * height / (hips.parent?.getWorldScale(new THREE.Vector3()).y || 1);
            root.updateMatrixWorld(true);
            bones.thighs.forEach((thigh, k) => {
                const swing = Math.sin(phase + k * Math.PI);
                turnInWorld(thigh, rest.get(thigh), side, rad(spec.stride) * swing);
                // The knee bends on the leg coming forward (the back half of its swing).
                const bend = Math.max(0, Math.sin(phase + k * Math.PI + Math.PI / 2));
                turnInWorld(bones.shins[k], rest.get(bones.shins[k]), side, kneeSign[k] * rad(spec.knee) * bend);
            });
            bones.arms.forEach((arm, k) => {
                // Down out of the T-pose, then swinging against its leg.
                turnInWorld(arm, rest.get(arm), armAxis, downSign[k] * rad(spec.armsDown));
                const swung = arm.quaternion.clone();
                turnInWorld(arm, swung, side, -rad(spec.swing) * Math.sin(phase + k * Math.PI));
                turnInWorld(bones.forearms[k], rest.get(bones.forearms[k]), side, elbowSign[k] * rad(spec.elbow));
            });
            root.updateMatrixWorld(true);
        },
    };
}

/** A texture's pixels (RGB), and a lookup by UV (FBX: v up). */
async function sampler(file) {
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return (u, v) => {
        const x = Math.min(info.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * info.width)));
        const y = Math.min(info.height - 1, Math.max(0, Math.floor((1 - (v - Math.floor(v))) * info.height)));
        const k = (y * info.width + x) * 3;
        return [data[k] / 255, data[k + 1] / 255, data[k + 2] / 255];
    };
}

/** sRGB (0..1) to linear: glTF's vertex colours are linear. */
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export async function bakeCharacters(packs, out) {
    await MeshoptEncoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    for (const spec of BAKED) {
        const file = path.join(packs, spec.model);
        if (!fs.existsSync(file)) {
            console.log(`characters: ${spec.id} skipped (no ${spec.model})`);
            continue;
        }
        const root = parseFbx(file);
        const meshes = [];
        root.traverse((o) => { if (o.isMesh) meshes.push(o); });
        const sample = await sampler(path.join(packs, spec.texture));
        // Each part's vertex colours, from the texture (once: the UVs don't move).
        const colours = meshes.map((mesh) => {
            const uv = mesh.geometry.getAttribute('uv');
            const count = mesh.geometry.getAttribute('position').count;
            const array = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                const [r, g, b] = uv ? sample(uv.getX(i), uv.getY(i)) : [0.7, 0.7, 0.7];
                array.set([linear(r), linear(g), linear(b)], i * 3);
            }
            return array;
        });
        let poseAt;
        let forward = new THREE.Vector3(0, 0, 1);
        const frames = spec.still ? 1 : FRAMES;
        if (spec.still) {
            poseAt = () => root.updateMatrixWorld(true);
        } else if (spec.range) {
            // Its own take, the move clip's frames of it.
            const clip = root.animations[0];
            const mixer = new THREE.AnimationMixer(root);
            mixer.clipAction(clip).play();
            const [from, to] = spec.range;
            poseAt = (t) => {
                mixer.setTime((from + t * (to - from)) / spec.fps);
                root.updateMatrixWorld(true);
            };
        } else if (spec.clip) {
            const clip = parseFbx(path.join(packs, spec.clip)).animations[0];
            const mixer = new THREE.AnimationMixer(root);
            mixer.clipAction(clip).play();
            poseAt = (t) => {
                mixer.setTime(t * clip.duration);
                root.updateMatrixWorld(true);
            };
        } else {
            const walk = makeWalk(root, spec.walk);
            forward = walk.forward;
            poseAt = (t) => walk.pose(t);
        }
        // To face +Z.
        const turn = new THREE.Matrix4().makeRotationY(forward.z < 0 ? Math.PI : 0);
        if (spec.layDown) turn.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        const vertex = new THREE.Vector3();
        const document = new Document();
        const buffer = document.createBuffer();
        const scene = document.createScene(spec.id);
        let fit = null;
        // Each pose's merged mesh first; then simplified (`keep`: the share of triangles) once, on the first pose, the
        // same triangles and vertices kept in every pose.
        // Its material: plain (the colours in the vertices), or its texture (cut to 256 px).
        const material = document.createMaterial(spec.id).setRoughnessFactor(1).setMetallicFactor(0);
        if (spec.textured) {
            const image = await sharp(path.join(packs, spec.texture)).resize(256, 256, { fit: 'inside' }).png().toBuffer();
            material.setBaseColorTexture(document.createTexture(spec.id).setImage(image).setMimeType('image/png'));
        }
        const baked = [];
        for (let f = 0; f < frames; f++) {
            poseAt(f / frames);
            const positions = [];
            const colors = [];
            const uvs = [];
            const indices = [];
            meshes.forEach((mesh, m) => {
                // Its UVs (glTF's: v down).
                const uv = mesh.geometry.getAttribute('uv');
                const n = mesh.geometry.getAttribute('position').count;
                for (let i = 0; i < n; i++) uvs.push(uv ? uv.getX(i) : 0, uv ? 1 - uv.getY(i) : 0);
                if (mesh.isSkinnedMesh) mesh.skeleton.update();
                const position = mesh.geometry.getAttribute('position');
                const offset = positions.length / 3;
                for (let i = 0; i < position.count; i++) {
                    if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, vertex);
                    else vertex.fromBufferAttribute(position, i);
                    vertex.applyMatrix4(mesh.matrixWorld).applyMatrix4(turn);
                    positions.push(vertex.x, vertex.y, vertex.z);
                }
                for (const c of colours[m]) colors.push(c);
                const index = mesh.geometry.getIndex();
                if (index) for (let i = 0; i < index.count; i++) indices.push(index.getX(i) + offset);
                else for (let i = 0; i < position.count; i++) indices.push(i + offset);
            });
            baked.push({ positions: new Float32Array(positions), colors: new Float32Array(colors), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) });
        }
        // A textured one keeps its every corner (its UV seams): no welding or simplifying.
        const textured = !!spec.textured;
        // Welded first: the flat-shaded FBXs give each triangle its own corners; corners at the same spot (in the first
        // pose: the same skin, so the same spot in every pose) become one, so the simplifier can merge anything.
        if (!textured) {
            const key = new Map();
            const p0 = baked[0].positions;
            const weldMap = new Uint32Array(p0.length / 3);
            const keep = [];
            for (let v = 0; v < weldMap.length; v++) {
                const k = `${Math.round(p0[v * 3] * 1e4)},${Math.round(p0[v * 3 + 1] * 1e4)},${Math.round(p0[v * 3 + 2] * 1e4)}`;
                let n = key.get(k);
                if (n === undefined) {
                    n = keep.length;
                    key.set(k, n);
                    keep.push(v);
                }
                weldMap[v] = n;
            }
            for (const pose of baked) {
                const positions = new Float32Array(keep.length * 3);
                const colors = new Float32Array(keep.length * 3);
                keep.forEach((v, n) => {
                    positions.set(pose.positions.subarray(v * 3, v * 3 + 3), n * 3);
                    colors.set(pose.colors.subarray(v * 3, v * 3 + 3), n * 3);
                });
                pose.indices = pose.indices.map((v) => weldMap[v]);
                pose.positions = positions;
                pose.colors = colors;
            }
        }
        await MeshoptSimplifier.ready;
        const first = baked[0];
        const target = Math.floor((first.indices.length / 3) * (spec.keep ?? 1)) * 3;
        const kept = spec.keep && !textured ? MeshoptSimplifier.simplify(first.indices, first.positions, 3, target, 0.05)[0] : first.indices;
        // The vertices still used, renumbered.
        const remap = new Int32Array(first.positions.length / 3).fill(-1);
        let used = 0;
        for (const v of kept) if (remap[v] < 0) remap[v] = used++;
        const keptIndices = new Uint32Array(kept.length);
        for (let i = 0; i < kept.length; i++) keptIndices[i] = remap[kept[i]];
        const squeeze = (source, width) => {
            const out = new Float32Array(used * width);
            for (let v = 0; v < remap.length; v++) if (remap[v] >= 0) for (let c = 0; c < width; c++) out[remap[v] * width + c] = source[v * width + c];
            return out;
        };
        for (let f = 0; f < frames; f++) {
            const array = squeeze(baked[f].positions, 3);
            const colors = squeeze(baked[f].colors, 3);
            const uvs = squeeze(baked[f].uvs, 2);
            const indices = keptIndices;
            if (!fit) {
                const box = new THREE.Box3().setFromArray(array);
                fit = { scale: 1 / Math.max(1e-6, box.max.y - box.min.y), x: (box.min.x + box.max.x) / 2, y: box.min.y, z: (box.min.z + box.max.z) / 2 };
            }
            for (let i = 0; i < array.length; i += 3) {
                array[i] = (array[i] - fit.x) * fit.scale;
                array[i + 1] = (array[i + 1] - fit.y) * fit.scale;
                array[i + 2] = (array[i + 2] - fit.z) * fit.scale;
            }
            const primitive = document.createPrimitive()
                .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(array).setBuffer(buffer))
                .setAttribute('COLOR_0', document.createAccessor().setType('VEC3').setArray(colors).setBuffer(buffer))
                .setIndices(document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
                .setMaterial(material);
            if (textured) primitive.setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(uvs).setBuffer(buffer));
            scene.addChild(document.createNode(`pose_${f}`).setMesh(document.createMesh(`pose_${f}`).addPrimitive(primitive)));
        }
        await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
        await io.write(path.join(out, `${spec.id}.glb`), document);
        console.log(`characters: ${spec.id} (${frames} pose${frames === 1 ? '' : 's'} baked, ${keptIndices.length / 3} triangles)`);
    }
}
