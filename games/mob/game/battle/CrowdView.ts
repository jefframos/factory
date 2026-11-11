// CrowdView.ts
//
// Draws every mob of a Battle — hundreds of them — in a handful of draw calls. The model (mob.glb, built by
// tools/build-mob.mjs) is a skinned mesh, but posing hundreds of skeletons a frame is far too slow, so at load the run
// cycle is baked: FRAMES poses of the clip, each a plain mesh (the skinning done once, on the CPU). Each pose is one
// InstancedMesh; a mob is drawn by the pose its own point in the cycle is at (its phase + time), so the crowd's steps
// don't line up.
//
// Helmets (mob-helmet.glb: the kit's hat on the same skeleton) are baked in the same poses, fitted the same way, and drawn
// over the mobs wearing one (Battle.helmet), one InstancedMesh per pose too.
//
// Giants are the same model baked a second time, buff (GIANT_BUILD): a wider chest, thicker arms, a smaller head, sturdier
// legs, the arms set a little further out, so a giant reads as strong, not just as a mob drawn bigger. It costs nothing a
// frame: a second set of baked poses (and its hats).
//
// Viking hats (props/viking.glb, from an attack barrier: Battle.viking) aren't skinned: the hat is fitted to the head
// (the vertices skinned to the Head bone) the way Dig and Mow fit theirs (VIKING), then each pose puts it where the head
// bone is then, so it bobs with the run; drawn the same way.
//
// Colour: the model's COLOR_0 alpha says which vertices the team colour paints (its RGB is then the shading to keep,
// 0.5 = as is); the face keeps its own. Each instance has its team colour (a `teamColor` instance attribute), applied
// in the material's vertex shader.

import * as THREE from 'three';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { COLORS, TUNING, UNIT_COLORS } from '../data/MobConfig';
import { applyBend } from '../services/Bend';
import { BLUE, Battle, CAR, TRUCK, GIANT, TINT } from './Battle';

/** Poses of the run cycle baked. */
const FRAMES = 10;
/** The clip played as the run (Mixamo's Running, converted by tools/build-mob.mjs; the walk if it's missing), and how
 *  many cycles a unit of speed makes (so a slower mob steps slower: no sliding feet). */
const CLIP_NAMES = ['run', 'walk'];
const CYCLES_PER_UNIT = 0.5;
/** A new mob pops in over this long (seconds), from this share of its size. */
const POP_SECONDS = 0.18;
const POP_FROM = 0.3;

/**
 * The viking hat on the head, as Dig and Mow wear it (their ui/hatfits.json Viking_Hat, applied as CharacterBody.setHat
 * does): its widest side widthFit x scale head widths, its bottom (sink - y) head widths below the head's top, centred on
 * the head; the model's front is +Z, as the mob's face is.
 */
const VIKING = { scale: 1.75, y: -0.27, widthFit: 1.05, sink: 0.03 };

/**
 * The giant's build. `thicken`: each bone's own skin scaled round the bone (x, y, z, in the bone's axes: each runs along
 * its y, so x and z thicken it, y lengthens it). Only the skin it carries: what hangs off it isn't moved or stretched (so
 * a wider chest doesn't lengthen the arms out of it, and nothing's skewed where bones meet at an angle). `armsOut`: the
 * arms' joints moved this share further out along the shoulders, for the wider chest.
 */
interface Build {
    thicken: Record<string, [number, number, number]>;
    armsOut: number;
}

const GIANT_BUILD: Build = {
    thicken: {
        Spine: [1.15, 1, 1.12],
        Spine1: [1.32, 1, 1.22],
        LeftShoulder: [1.12, 1, 1.12],
        RightShoulder: [1.12, 1, 1.12],
        Head: [0.88, 0.88, 0.88],
        LeftArm: [1.22, 1, 1.22],
        RightArm: [1.22, 1, 1.22],
        LeftForeArm: [1.1, 1, 1.1],
        RightForeArm: [1.1, 1, 1.1],
        LeftUpLeg: [1.15, 1, 1.15],
        RightUpLeg: [1.15, 1, 1.15],
    },
    armsOut: 0.25,
};

/** One build's baked poses: the mobs, their team colours, and the helmets and viking hats in the same poses. */
interface PoseSet {
    meshes: THREE.InstancedMesh[];
    teamColors: THREE.InstancedBufferAttribute[];
    helmets: THREE.InstancedMesh[];
    /** vikings[pose][part]: a mesh per material. */
    vikings: THREE.InstancedMesh[][];
}

/**
 * A copy of `source` with every attribute plain float. The props are meshopt-quantized (normalized 16-bit positions,
 * scaled back by their node): moved in place, their values leave the [-1, 1] a normalized attribute holds and clip.
 */
function floatGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
        const size = attribute.itemSize;
        const array = new Float32Array(attribute.count * size);
        const read = [attribute.getX, attribute.getY, attribute.getZ, attribute.getW];
        for (let i = 0; i < attribute.count; i++) {
            for (let k = 0; k < size; k++) array[i * size + k] = read[k].call(attribute, i);
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    if (source.index) geometry.setIndex(source.index.clone());
    return geometry;
}

/** How the baked poses are fitted: scaled to unit height, feet at 0, centred. */
interface Fit { scale: number; x: number; y: number; z: number }

export class CrowdView {
    public readonly group = new THREE.Group();
    /** The plain mobs' poses, and the giants' (GIANT_BUILD). */
    private plain: PoseSet = { meshes: [], teamColors: [], helmets: [], vikings: [] };
    private giant: PoseSet = { meshes: [], teamColors: [], helmets: [], vikings: [] };
    private readonly blue = new THREE.Color(COLORS.blue);
    /** The blue giant's own colour (UNIT_COLORS.giant: picked live in the debug panel). */
    private readonly giantBlue = new THREE.Color(UNIT_COLORS.giant);
    private readonly red = new THREE.Color(COLORS.red);
    /** The tinted giants' colours (Battle TINT: the armoured one, the viking). */
    private readonly tints: Record<number, THREE.Color> = { [TINT.green]: new THREE.Color(0x7cc23a), [TINT.orange]: new THREE.Color(0xf07a22) };
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly rotation = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private ready = false;

    /** Loads the model and bakes its poses; nothing's drawn until it's done. */
    public async load(base: string, capacity: number): Promise<void> {
        const loader = createGLTFLoader();
        const [model, anims, helmetModel, vikingModel] = await Promise.all([
            loader.loadAsync(`${base}mob.glb`),
            loader.loadAsync(`${base}mob-anims.glb`),
            loader.loadAsync(`${base}mob-helmet.glb`).catch(() => null),
            loader.loadAsync(`${base}../props/viking.glb`).catch(() => null),
        ]);
        let skinned: THREE.SkinnedMesh | undefined;
        model.scene.traverse((object) => {
            if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned = object as THREE.SkinnedMesh;
        });
        if (!skinned) throw new Error('mob.glb has no skinned mesh');
        const clip = CLIP_NAMES.map((name) => anims.animations.find((a) => a.name === name)).find(Boolean);
        if (!clip) throw new Error('mob-anims.glb has no run or walk clip');

        let helmetSkinned: THREE.SkinnedMesh | undefined;
        helmetModel?.scene.traverse((object) => {
            if ((object as THREE.SkinnedMesh).isSkinnedMesh) helmetSkinned = object as THREE.SkinnedMesh;
        });
        const material = this.material();
        applyBend(material);
        const helmetMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
        applyBend(helmetMaterial);
        // The plain build first: its fit (unit height) is the giants' too, so a giant's extra width and height are its own.
        const plainFit = this.buildSet(this.plain, { model: model.scene, skinned, helmetModel: helmetModel?.scene, helmetSkinned, vikingModel: vikingModel?.scene, clip, capacity, material, helmetMaterial });
        this.buildSet(this.giant, { model: model.scene, skinned, helmetModel: helmetModel?.scene, helmetSkinned, vikingModel: vikingModel?.scene, clip, capacity, material, helmetMaterial }, GIANT_BUILD, plainFit);
        this.ready = true;
    }

    /** One build's poses (mobs, helmets, viking hats) into `set`; returns their fit. */
    private buildSet(set: PoseSet, from: {
        model: THREE.Object3D; skinned: THREE.SkinnedMesh; helmetModel?: THREE.Object3D; helmetSkinned?: THREE.SkinnedMesh; vikingModel?: THREE.Object3D;
        clip: THREE.AnimationClip; capacity: number; material: THREE.Material; helmetMaterial: THREE.Material;
    }, build?: Build, fitted?: Fit): Fit {
        const { capacity } = from;
        const { poses, fit, heads, headBox } = this.bake(from.model, from.skinned, from.clip, fitted, build);
        for (const geometry of poses) {
            const mesh = new THREE.InstancedMesh(geometry, from.material, capacity);
            const colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
            colors.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('teamColor', colors);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.count = 0;
            // Mobs move all over the field: the instances' bounds aren't worth keeping up.
            mesh.frustumCulled = false;
            set.meshes.push(mesh);
            set.teamColors.push(colors);
            this.group.add(mesh);
        }
        // The helmet: the same poses, the same fit and build (so it sits on the head).
        if (from.helmetModel && from.helmetSkinned) {
            for (const geometry of this.bake(from.helmetModel, from.helmetSkinned, from.clip, fit, build).poses) {
                const mesh = new THREE.InstancedMesh(geometry, from.helmetMaterial, capacity);
                mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                mesh.count = 0;
                mesh.frustumCulled = false;
                set.helmets.push(mesh);
                this.group.add(mesh);
            }
        }
        if (from.vikingModel && headBox) set.vikings = this.bakeViking(from.vikingModel, heads, headBox, capacity);
        return fit;
    }

    /**
     * The viking hat in each pose: fitted to the head (headBox: the head's vertices in the first pose, fitted space) as
     * VIKING says, then carried by the head bone (heads[f]: where it is in pose f, in the fitted space) in the others.
     */
    private bakeViking(scene: THREE.Object3D, heads: THREE.Matrix4[], headBox: THREE.Box3, capacity: number): THREE.InstancedMesh[][] {
        const vikings: THREE.InstancedMesh[][] = [];
        if (!heads.length) return vikings;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const headSize = headBox.getSize(new THREE.Vector3());
        const headWidth = Math.max(headSize.x, headSize.z);
        const scale = (headWidth * VIKING.widthFit * VIKING.scale) / Math.max(1e-6, size.x, size.z);
        const head = headBox.getCenter(new THREE.Vector3());
        // The hat in the first pose: centred on the head, its bottom just under the head's top.
        const seat = new THREE.Matrix4()
            .makeTranslation(head.x, headBox.max.y - headWidth * (VIKING.sink - VIKING.y), head.z)
            .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
            .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
        // In head space, so each pose's head carries it.
        const inHead = heads[0].clone().invert().multiply(seat);
        const parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
        scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            const source = mesh.material as THREE.MeshStandardMaterial;
            const material = new THREE.MeshLambertMaterial({ map: source.map ?? null, color: source.color ?? 0xffffff });
            applyBend(material);
            const geometry = floatGeometry(mesh.geometry).applyMatrix4(mesh.matrixWorld);
            parts.push({ geometry, material });
        });
        const matrix = new THREE.Matrix4();
        for (const pose of heads) {
            matrix.multiplyMatrices(pose, inHead);
            vikings.push(parts.map(({ geometry, material }) => {
                const mesh = new THREE.InstancedMesh(geometry.clone().applyMatrix4(matrix), material, capacity);
                mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                mesh.count = 0;
                mesh.frustumCulled = false;
                this.group.add(mesh);
                return mesh;
            }));
        }
        for (const { geometry } of parts) geometry.dispose();
        return vikings;
    }

    /** FRAMES poses of the clip, each the skinned mesh's vertices where the clip has them then, fitted to the mob height. */
    private bake(root: THREE.Object3D, skinned: THREE.SkinnedMesh, clip: THREE.AnimationClip, fitted?: Fit, build?: Build): { poses: THREE.BufferGeometry[]; fit: Fit; heads: THREE.Matrix4[]; headBox: THREE.Box3 | null } {
        const mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(clip).play();
        const source = skinned.geometry;
        const count = source.getAttribute('position').count;
        const vertex = new THREE.Vector3();
        const poses: THREE.BufferGeometry[] = [];
        // The head bone in each pose (in the mesh's own space, then fitted like the vertices), for what sits on it.
        const headBone = skinned.skeleton.bones.find((bone) => /head$/i.test(bone.name) && !/top/i.test(bone.name));
        const heads: THREE.Matrix4[] = [];
        const toMesh = new THREE.Matrix4();
        // The head itself, in the first pose: the vertices the Head bone moves most (fitted space).
        const headIndex = headBone ? skinned.skeleton.bones.indexOf(headBone) : -1;
        const skinIndex = source.getAttribute('skinIndex');
        const skinWeight = source.getAttribute('skinWeight');
        let headBox: THREE.Box3 | null = null;
        // Fitted from the first pose: unit height (TUNING.mobHeight scales each mob as it's drawn, live), feet on the
        // ground, centred.
        let fit: Fit | null = fitted ?? null;
        // The build. Thickening: a bone's skin is placed by its matrix times its inverse rest pose, so a scale between the
        // two scales just that skin, round the bone; the inverses are put back after (the next bake's on this skeleton).
        const { bones, boneInverses } = skinned.skeleton;
        const thickened = Object.entries(build?.thicken ?? {}).map(([name, [x, y, z]]) => {
            const index = bones.findIndex((bone) => bone.name === name);
            return index < 0 ? null : { index, rest: boneInverses[index].clone(), scale: new THREE.Matrix4().makeScale(x, y, z) };
        }).filter((entry): entry is NonNullable<typeof entry> => !!entry);
        for (const { index, rest, scale } of thickened) boneInverses[index].multiplyMatrices(scale, rest);
        // The arms out: their joints moved along the shoulders (each frame, after the clip: it may move them itself).
        const arms = build ? bones.filter((bone) => /^(Left|Right)Arm$/.test(bone.name)).map((bone) => ({ bone, rest: bone.position.clone() })) : [];
        for (let f = 0; f < FRAMES; f++) {
            mixer.setTime((f / FRAMES) * clip.duration);
            for (const { bone, rest } of arms) {
                if (!clip.tracks.some((track) => track.name === `${bone.name}.position`)) bone.position.copy(rest);
                bone.position.multiplyScalar(1 + (build?.armsOut ?? 0));
            }
            root.updateMatrixWorld(true);
            skinned.skeleton.update();
            const positions = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                skinned.getVertexPosition(i, vertex);
                positions.set([vertex.x, vertex.y, vertex.z], i * 3);
            }
            if (!fit) {
                const box = new THREE.Box3().setFromArray(positions);
                fit = { scale: 1 / Math.max(0.01, box.max.y - box.min.y), x: (box.min.x + box.max.x) / 2, y: box.min.y, z: (box.min.z + box.max.z) / 2 };
            }
            if (headBone) {
                toMesh.copy(skinned.matrixWorld).invert();
                heads.push(new THREE.Matrix4()
                    .makeScale(fit.scale, fit.scale, fit.scale)
                    .multiply(new THREE.Matrix4().makeTranslation(-fit.x, -fit.y, -fit.z))
                    .multiply(toMesh)
                    .multiply(headBone.matrixWorld));
            }
            for (let i = 0; i < count; i++) {
                positions[i * 3] = (positions[i * 3] - fit.x) * fit.scale;
                positions[i * 3 + 1] = (positions[i * 3 + 1] - fit.y) * fit.scale;
                positions[i * 3 + 2] = (positions[i * 3 + 2] - fit.z) * fit.scale;
            }
            if (f === 0 && headIndex >= 0 && skinIndex && skinWeight) {
                headBox = new THREE.Box3();
                for (let i = 0; i < count; i++) {
                    let most = 0;
                    for (let k = 1; k < 4; k++) if (skinWeight.getComponent(i, k) > skinWeight.getComponent(i, most)) most = k;
                    if (skinIndex.getComponent(i, most) === headIndex) headBox.expandByPoint(vertex.fromArray(positions, i * 3));
                }
                if (headBox.isEmpty()) headBox = null;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', source.getAttribute('color').clone());
            geometry.setIndex(source.getIndex()!.clone());
            geometry.computeVertexNormals();
            poses.push(geometry);
        }
        mixer.stopAllAction();
        for (const { index, rest } of thickened) boneInverses[index].copy(rest);
        for (const { bone, rest } of arms) bone.position.copy(rest);
        root.updateMatrixWorld(true);
        return { poses, fit: fit!, heads, headBox };
    }

    /** Vertex colours, with the painted ones (alpha 1) taking the instance's team colour times their shading. */
    private material(): THREE.MeshLambertMaterial {
        const material = new THREE.MeshLambertMaterial({ vertexColors: true });
        material.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nattribute vec3 teamColor;')
                .replace('#include <color_vertex>', `#include <color_vertex>
                vColor = vec4(mix(color.rgb, teamColor * color.rgb * 2.0, step(0.5, color.a)), 1.0);`);
        };
        return material;
    }

    /** Every live mob into its pose's instances. */
    public update(battle: Battle, time: number): void {
        if (!this.ready) return;
        this.giantBlue.setHex(UNIT_COLORS.giant);
        for (const set of [this.plain, this.giant]) {
            for (const mesh of set.meshes) mesh.count = 0;
            for (const mesh of set.helmets) mesh.count = 0;
            for (const parts of set.vikings) for (const mesh of parts) mesh.count = 0;
        }
        for (let i = 0; i < battle.count; i++) {
            // Trucks are drawn by the arena (a model of their own).
            if (battle.big[i] === TRUCK || battle.big[i] === CAR) continue;
            // (A card's character: CharacterView draws it.)
            if (battle.look[i]) continue;
            const speed = battle.team[i] === BLUE ? TUNING.blueSpeed : TUNING.redSpeed;
            const cycle = (time * speed * CYCLES_PER_UNIT + battle.phase[i]) % 1;
            const pose = Math.min(FRAMES - 1, Math.floor(cycle * FRAMES));
            const set = battle.big[i] === GIANT && this.giant.meshes.length ? this.giant : this.plain;
            const mesh = set.meshes[pose];
            const slot = mesh.count++;
            const grow = battle.age[i] < POP_SECONDS ? POP_FROM + (1 - POP_FROM) * (battle.age[i] / POP_SECONDS) : 1;
            this.position.set(battle.x[i], 0, battle.z[i]);
            this.rotation.setFromAxisAngle(this.up, battle.heading[i] + Math.PI);
            const leave = battle.leaving[i];
            const shrink = leave > 0 ? (leave < 0.3 ? 1 + leave : 1.3 * (1 - (leave - 0.3) / 0.7)) : 1;
            this.scale.setScalar(grow * shrink * TUNING.mobHeight * (battle.big[i] ? TUNING.giantScale : 1));
            this.matrix.compose(this.position, this.rotation, this.scale);
            mesh.setMatrixAt(slot, this.matrix);
            const helmet = battle.helmet[i] ? set.helmets[pose] : undefined;
            if (helmet) helmet.setMatrixAt(helmet.count++, this.matrix);
            if (battle.viking[i] && set.vikings[pose]) for (const part of set.vikings[pose]) part.setMatrixAt(part.count++, this.matrix);
            const color = battle.team[i] === BLUE ? (this.tints[battle.tint[i]] ?? (battle.big[i] === GIANT ? this.giantBlue : this.blue)) : this.red;
            set.teamColors[pose].setXYZ(slot, color.r, color.g, color.b);
        }
        for (const set of [this.plain, this.giant]) {
            for (let p = 0; p < set.meshes.length; p++) {
                set.meshes[p].instanceMatrix.needsUpdate = true;
                set.teamColors[p].needsUpdate = true;
                if (set.helmets[p]) set.helmets[p].instanceMatrix.needsUpdate = true;
                for (const part of set.vikings[p] ?? []) part.instanceMatrix.needsUpdate = true;
            }
        }
    }
}
