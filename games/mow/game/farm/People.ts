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
import { afterStart } from '../utils/AfterStart';

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
/** Each part's colour, and (optionally) a pattern on the top: `kind:#hex` (dressed()). */
export type Outfit = Record<Part, string> & { pattern?: string };

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A random outfit (a colour per part). */
export function randomOutfit(): Outfit {
    return Object.fromEntries(PARTS.map((part) => [part, pick(PALETTE[part])])) as Outfit;
}

/**
 * A pattern on the top (the wardrobe's PATTERNS): its kind and second colour, as `kind:#hex` — stripes across it, a
 * band over the chest, two-tone (the lower half), or sleeves. Painted per vertex (the people have no textures), so it
 * comes out soft and chunky, like a knit.
 */
type PatternKind = 'stripes' | 'band' | 'twotone' | 'sleeves';
const TOP_PART = PARTS.indexOf('top') + 1;

/** Whether a top's vertex (its height `t` 0..1 up the top, its side `side` 0..1 out from the middle) takes the second colour. */
function patterned(kind: PatternKind, t: number, side: number): boolean {
    switch (kind) {
        case 'stripes': return Math.floor(t * 7) % 2 === 1;
        case 'band': return t > 0.45 && t < 0.72;
        case 'twotone': return t < 0.5;
        case 'sleeves': return side > 0.55;
    }
}

/** `source` (a person's geometry) with each part in the outfit's colour (and the top's pattern, if it has one). */
export function dressed(source: THREE.BufferGeometry, outfit: Outfit): THREE.BufferGeometry {
    const choice = PARTS.map((part) => new THREE.Color(outfit[part]));
    const from = source.getAttribute('color');
    if (!from) return source;
    // The pattern: its kind, its colour, and the top's extent (to place it up and across the top).
    const [kind, second] = (outfit.pattern ?? '').split(':') as [PatternKind | '', string | undefined];
    const pattern = kind && second ? { kind, color: new THREE.Color(second) } : undefined;
    const position = source.getAttribute('position');
    let minY = Infinity;
    let maxY = -Infinity;
    let maxX = 1e-6;
    if (pattern && position) {
        for (let i = 0; i < from.count; i++) {
            if (Math.round(from.getW(i) * PART_SCALE) !== TOP_PART) continue;
            minY = Math.min(minY, position.getY(i));
            maxY = Math.max(maxY, position.getY(i));
            maxX = Math.max(maxX, Math.abs(position.getX(i)));
        }
    }
    const colors = new Float32Array(from.count * 3);
    for (let i = 0; i < from.count; i++) {
        const part = Math.round(from.getW(i) * PART_SCALE);
        if (part === 0) colors.set([from.getX(i), from.getY(i), from.getZ(i)], i * 3);
        else {
            const shade = from.getX(i) * 2;
            let color = choice[part - 1];
            if (pattern && position && part === TOP_PART && maxY > minY) {
                const t = (position.getY(i) - minY) / (maxY - minY);
                if (patterned(pattern.kind, t, Math.abs(position.getX(i)) / maxX)) color = pattern.color;
            }
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
let clips: Promise<People['clips']> | null = null;
const persons = new Map<number, Promise<THREE.Object3D>>();

function loadClips(): Promise<People['clips']> {
    if (!clips) {
        clips = createGLTFLoader().loadAsync(`${PEOPLE}people-anims.glb`).then((anims) => {
            const find = (name: string) => THREE.AnimationClip.findByName(anims.animations, name);
            const walk = find('walk');
            const idle = find('idle');
            if (!walk || !idle) throw new Error('people-anims has no walk or idle');
            return { walk, idle, run: find('run') ?? walk, sit: find('sit') ?? null };
        });
        clips.catch(() => (clips = null));
    }
    return clips;
}

function loadModel(index: number): Promise<THREE.Object3D> {
    let found = persons.get(index);
    if (!found) {
        found = createGLTFLoader().loadAsync(`${PEOPLE}person-0${index + 1}.glb`).then((gltf) => gltf.scene);
        found.catch(() => persons.delete(index));
        persons.set(index, found);
    }
    return found;
}

/** One person (the player's) and the clips: all the loading screen waits for. Its model is the only one in `models`. */
export async function loadPerson(index: number): Promise<People> {
    const [own, model] = await Promise.all([loadClips(), loadModel(index)]);
    return { models: [model], clips: own };
}

/** All the people's models and clips (loaded once, once the game is up: customers and helpers). */
export function loadPeople(): Promise<People> {
    if (!people) {
        people = (async () => {
            await afterStart();
            const [own, ...models] = await Promise.all([loadClips(), ...Array.from({ length: PERSON_COUNT }, (_, i) => loadModel(i))]);
            return { models, clips: own };
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
