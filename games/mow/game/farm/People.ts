// People.ts
//
// The people (the restaurant game's: raw-assets/models/people{m}, eight skinned models whose vertex colours mark their
// parts — skin, top, bottom, shoes, hair — and one file of clips: walk, idle, run, sit, ...). Both the player and the
// den's customers are made of them: loaded once (loadPeople()), each a skinned copy dressed in its own colours
// (dressed()). PERSON_HEIGHT is how tall one stands, at the player's size 1.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { BendService } from '../services/BendService';

const PEOPLE = './mow/models/people/';
export const PERSON_COUNT = 8;
/** The people models' own height, and how tall one stands in the world (times the player's size). */
export const PERSON_MODEL_HEIGHT = 1.83;
export const PERSON_HEIGHT = 1.6;

/** Model colours: COLOR_0's alpha x PART_SCALE is the part; for a part, RGB x 2 is the shading on its colour. */
const PART_SCALE = 16;
export const PALETTE = {
    skin: ['#ffe0c4', '#f7cba4', '#eab084', '#d09060', '#a86f45', '#7d4e30', '#5a3722'],
    top: ['#e8483f', '#f39a2d', '#f5d547', '#58b957', '#2fa8a0', '#3f86e0', '#7b5be0', '#e65fa8', '#f4f1ea', '#39414f'],
    bottom: ['#2f4a7a', '#4c6ea8', '#39414f', '#5b5148', '#8a7a5c', '#c9b48a', '#6c7d4e', '#7a3f3f'],
    shoes: ['#f4f1ea', '#2b2b2f', '#c0392b', '#2d6cc0', '#8a5a33', '#e6b422'],
    hair: ['#1f1a17', '#3a2a20', '#5e3c23', '#8f5a2c', '#d9b160', '#b5482a', '#9a9a9a'],
};
export type Part = keyof typeof PALETTE;
const PARTS: Part[] = ['skin', 'top', 'bottom', 'shoes', 'hair'];
export type Outfit = Record<Part, string>;

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A random outfit (a colour per part). */
export function randomOutfit(): Outfit {
    return Object.fromEntries(PARTS.map((part) => [part, pick(PALETTE[part])])) as Outfit;
}

/** `source` (a person's geometry) with each part in the outfit's colour. */
export function dressed(source: THREE.BufferGeometry, outfit: Outfit): THREE.BufferGeometry {
    const choice = PARTS.map((part) => new THREE.Color(outfit[part]));
    const from = source.getAttribute('color');
    if (!from) return source;
    const colors = new Float32Array(from.count * 3);
    for (let i = 0; i < from.count; i++) {
        const part = Math.round(from.getW(i) * PART_SCALE);
        if (part === 0) colors.set([from.getX(i), from.getY(i), from.getZ(i)], i * 3);
        else {
            const shade = from.getX(i) * 2;
            const color = choice[part - 1];
            colors.set([color.r * shade, color.g * shade, color.b * shade], i * 3);
        }
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(source.index);
    return geometry;
}

export interface People {
    models: THREE.Object3D[];
    clips: { walk: THREE.AnimationClip; idle: THREE.AnimationClip; run: THREE.AnimationClip; sit: THREE.AnimationClip | null };
}

let people: Promise<People> | null = null;

/** The people's models and clips (loaded once). */
export function loadPeople(): Promise<People> {
    if (!people) {
        const loader = createGLTFLoader();
        people = (async () => {
            const files = Array.from({ length: PERSON_COUNT }, (_, i) => `person-0${i + 1}.glb`);
            const [anims, ...models] = await Promise.all([loader.loadAsync(`${PEOPLE}people-anims.glb`), ...files.map((f) => loader.loadAsync(`${PEOPLE}${f}`))]);
            const find = (name: string) => THREE.AnimationClip.findByName(anims.animations, name);
            const walk = find('walk');
            const idle = find('idle');
            if (!walk || !idle) throw new Error('people-anims has no walk or idle');
            return { models: models.map((m) => m.scene), clips: { walk, idle, run: find('run') ?? walk, sit: find('sit') ?? null } };
        })();
        people.catch(() => (people = null));
    }
    return people;
}

/**
 * A skinned copy of person `index`, in `outfit`, its materials ready for the world (vertex colours, the bend). Returns
 * the model and its meshes with their undressed geometry (to dress them again: dress()).
 */
export function personCopy(source: People, index: number, outfit: Outfit): { model: THREE.Object3D; meshes: { mesh: THREE.SkinnedMesh; source: THREE.BufferGeometry }[] } {
    const model = cloneSkinned(source.models[index % source.models.length]);
    const meshes: { mesh: THREE.SkinnedMesh; source: THREE.BufferGeometry }[] = [];
    model.traverse((child) => {
        if (!(child instanceof THREE.SkinnedMesh)) return;
        meshes.push({ mesh: child, source: child.geometry });
        child.geometry = dressed(child.geometry, outfit);
        child.frustumCulled = false;
        const materials = [child.material].flat().map((material) => {
            const copy = material.clone();
            copy.vertexColors = true;
            BendService.applyBend(copy);
            return copy;
        });
        child.material = materials.length === 1 ? materials[0] : materials;
    });
    return { model, meshes };
}

/** Dresses a copy's meshes again (the old dressed geometry freed). */
export function dress(meshes: { mesh: THREE.SkinnedMesh; source: THREE.BufferGeometry }[], outfit: Outfit): void {
    for (const { mesh, source } of meshes) {
        const old = mesh.geometry;
        mesh.geometry = dressed(source, outfit);
        if (old !== source) old.dispose();
    }
}
