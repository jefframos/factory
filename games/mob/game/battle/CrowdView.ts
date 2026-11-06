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
// Colour: the model's COLOR_0 alpha says which vertices the team colour paints (its RGB is then the shading to keep,
// 0.5 = as is); the face keeps its own. Each instance has its team colour (a `teamColor` instance attribute), applied
// in the material's vertex shader.

import * as THREE from 'three';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { COLORS, TUNING } from '../data/MobConfig';
import { applyBend } from '../services/Bend';
import { BLUE, Battle, CAR, TRUCK } from './Battle';

/** Poses of the run cycle baked. */
const FRAMES = 10;
/** The clip played as the run (Mixamo's Running, converted by tools/build-mob.mjs; the walk if it's missing), and how
 *  many cycles a unit of speed makes (so a slower mob steps slower: no sliding feet). */
const CLIP_NAMES = ['run', 'walk'];
const CYCLES_PER_UNIT = 0.5;
/** A new mob pops in over this long (seconds), from this share of its size. */
const POP_SECONDS = 0.18;
const POP_FROM = 0.3;

/** How the baked poses are fitted: scaled to unit height, feet at 0, centred. */
interface Fit { scale: number; x: number; y: number; z: number }

export class CrowdView {
    public readonly group = new THREE.Group();
    private meshes: THREE.InstancedMesh[] = [];
    private teamColors: THREE.InstancedBufferAttribute[] = [];
    private helmets: THREE.InstancedMesh[] = [];
    private readonly blue = new THREE.Color(COLORS.blue);
    private readonly red = new THREE.Color(COLORS.red);
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly rotation = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();
    private readonly up = new THREE.Vector3(0, 1, 0);
    private ready = false;

    /** Loads the model and bakes its poses; nothing's drawn until it's done. */
    public async load(base: string, capacity: number): Promise<void> {
        const loader = createGLTFLoader();
        const [model, anims, helmetModel] = await Promise.all([
            loader.loadAsync(`${base}mob.glb`),
            loader.loadAsync(`${base}mob-anims.glb`),
            loader.loadAsync(`${base}mob-helmet.glb`).catch(() => null),
        ]);
        let skinned: THREE.SkinnedMesh | undefined;
        model.scene.traverse((object) => {
            if ((object as THREE.SkinnedMesh).isSkinnedMesh) skinned = object as THREE.SkinnedMesh;
        });
        if (!skinned) throw new Error('mob.glb has no skinned mesh');
        const clip = CLIP_NAMES.map((name) => anims.animations.find((a) => a.name === name)).find(Boolean);
        if (!clip) throw new Error('mob-anims.glb has no run or walk clip');

        const { poses, fit } = this.bake(model.scene, skinned, clip);
        const material = this.material();
        applyBend(material);
        for (const geometry of poses) {
            const mesh = new THREE.InstancedMesh(geometry, material, capacity);
            const colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
            colors.setUsage(THREE.DynamicDrawUsage);
            geometry.setAttribute('teamColor', colors);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.count = 0;
            // Mobs move all over the field: the instances' bounds aren't worth keeping up.
            mesh.frustumCulled = false;
            this.meshes.push(mesh);
            this.teamColors.push(colors);
            this.group.add(mesh);
        }
        // The helmet: the same poses, the same fit (so it sits on the head).
        let helmetSkinned: THREE.SkinnedMesh | undefined;
        helmetModel?.scene.traverse((object) => {
            if ((object as THREE.SkinnedMesh).isSkinnedMesh) helmetSkinned = object as THREE.SkinnedMesh;
        });
        if (helmetModel && helmetSkinned) {
            const helmetMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
            applyBend(helmetMaterial);
            for (const geometry of this.bake(helmetModel.scene, helmetSkinned, clip, fit).poses) {
                const mesh = new THREE.InstancedMesh(geometry, helmetMaterial, capacity);
                mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                mesh.count = 0;
                mesh.frustumCulled = false;
                this.helmets.push(mesh);
                this.group.add(mesh);
            }
        }
        this.ready = true;
    }

    /** FRAMES poses of the clip, each the skinned mesh's vertices where the clip has them then, fitted to the mob height. */
    private bake(root: THREE.Object3D, skinned: THREE.SkinnedMesh, clip: THREE.AnimationClip, fitted?: Fit): { poses: THREE.BufferGeometry[]; fit: Fit } {
        const mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(clip).play();
        const source = skinned.geometry;
        const count = source.getAttribute('position').count;
        const vertex = new THREE.Vector3();
        const poses: THREE.BufferGeometry[] = [];
        // Fitted from the first pose: unit height (TUNING.mobHeight scales each mob as it's drawn, live), feet on the
        // ground, centred.
        let fit: Fit | null = fitted ?? null;
        for (let f = 0; f < FRAMES; f++) {
            mixer.setTime((f / FRAMES) * clip.duration);
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
            for (let i = 0; i < count; i++) {
                positions[i * 3] = (positions[i * 3] - fit.x) * fit.scale;
                positions[i * 3 + 1] = (positions[i * 3 + 1] - fit.y) * fit.scale;
                positions[i * 3 + 2] = (positions[i * 3 + 2] - fit.z) * fit.scale;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('color', source.getAttribute('color').clone());
            geometry.setIndex(source.getIndex()!.clone());
            geometry.computeVertexNormals();
            poses.push(geometry);
        }
        mixer.stopAllAction();
        return { poses, fit: fit! };
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
        for (const mesh of this.meshes) mesh.count = 0;
        for (const mesh of this.helmets) mesh.count = 0;
        for (let i = 0; i < battle.count; i++) {
            // Trucks are drawn by the arena (a model of their own).
            if (battle.big[i] === TRUCK || battle.big[i] === CAR) continue;
            const speed = battle.team[i] === BLUE ? TUNING.blueSpeed : TUNING.redSpeed;
            const cycle = (time * speed * CYCLES_PER_UNIT + battle.phase[i]) % 1;
            const pose = Math.min(FRAMES - 1, Math.floor(cycle * FRAMES));
            const mesh = this.meshes[pose];
            const slot = mesh.count++;
            const grow = battle.age[i] < POP_SECONDS ? POP_FROM + (1 - POP_FROM) * (battle.age[i] / POP_SECONDS) : 1;
            this.position.set(battle.x[i], 0, battle.z[i]);
            this.rotation.setFromAxisAngle(this.up, battle.heading[i] + Math.PI);
            const leave = battle.leaving[i];
            const shrink = leave > 0 ? (leave < 0.3 ? 1 + leave : 1.3 * (1 - (leave - 0.3) / 0.7)) : 1;
            this.scale.setScalar(grow * shrink * TUNING.mobHeight * (battle.big[i] ? TUNING.giantScale : 1));
            this.matrix.compose(this.position, this.rotation, this.scale);
            mesh.setMatrixAt(slot, this.matrix);
            const helmet = battle.helmet[i] ? this.helmets[pose] : undefined;
            if (helmet) helmet.setMatrixAt(helmet.count++, this.matrix);
            const color = battle.team[i] === BLUE ? this.blue : this.red;
            this.teamColors[pose].setXYZ(slot, color.r, color.g, color.b);
        }
        for (let p = 0; p < this.meshes.length; p++) {
            const mesh = this.meshes[p];
            mesh.instanceMatrix.needsUpdate = true;
            this.teamColors[p].needsUpdate = true;
            if (this.helmets[p]) this.helmets[p].instanceMatrix.needsUpdate = true;
        }
    }
}
