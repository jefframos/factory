// Models.ts
//
// The 3D models: the kitchen's (KayKit Restaurant Bits: raw-assets/models/kitchen{m} → public/restaurant/models/kitchen,
// one texture shared by all) and the people (the UFO game's skinned people and their walk / idle clips). Each is loaded
// once; a copy is handed out per use. Copies are set so their bottom is at y 0 (x and z stay the model's own: KayKit
// pieces are centred on them), and `sizeOf` tells how big one is.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createGLTFLoader } from 'core/three/GLTFLoaders';

const KITCHEN = './restaurant/models/kitchen/';
const PEOPLE = './restaurant/models/people/';
export const PERSON_COUNT = 8;
/** The people models' own height. */
export const PERSON_MODEL_HEIGHT = 1.83;

/**
 * A model's URL from the name the code and the layout use: a bare name is a kitchen model (models/kitchen/<name>.gltf);
 * one with a slash is a path under models/ (a model imported from the 3D library by the editor: library/<slug>/...).
 */
export const modelUrl = (name: string): string => (name.includes('/') ? `./restaurant/models/${name}` : `${KITCHEN}${name}.gltf`);

const loader = createGLTFLoader();
const kitchen = new Map<string, THREE.Object3D>();
let people: { models: THREE.Object3D[]; walk: THREE.AnimationClip; idle: THREE.AnimationClip } | null = null;

/** Loads every model named (models/kitchen/<name>.gltf) and the people. */
export async function loadModels(names: readonly string[]): Promise<void> {
    const kitchenLoads = names.filter((name) => !kitchen.has(name)).map(async (name) => {
        const gltf = await loader.loadAsync(modelUrl(name));
        gltf.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        kitchen.set(name, gltf.scene);
    });
    const peopleLoad = people ? Promise.resolve() : (async () => {
        const files = Array.from({ length: PERSON_COUNT }, (_, i) => `person-0${i + 1}.glb`);
        const [anims, ...models] = await Promise.all([loader.loadAsync(`${PEOPLE}people-anims.glb`), ...files.map((f) => loader.loadAsync(`${PEOPLE}${f}`))]);
        const walk = THREE.AnimationClip.findByName(anims.animations, 'walk');
        const idle = THREE.AnimationClip.findByName(anims.animations, 'idle');
        if (!walk || !idle) throw new Error('people-anims has no walk or idle');
        people = { models: models.map((m) => m.scene), walk, idle };
    })();
    await Promise.all([...kitchenLoads, peopleLoad]);
}

/** A copy of a kitchen model, its bottom at y 0. */
export function kitchenModel(name: string): THREE.Group {
    const source = kitchen.get(name);
    if (!source) throw new Error(`model not loaded: ${name}`);
    const copy = source.clone(true);
    const box = new THREE.Box3().setFromObject(copy);
    copy.position.y = -box.min.y;
    const holder = new THREE.Group();
    holder.name = name;
    holder.add(copy);
    return holder;
}

/** How big an object is (its world bounds). */
export function sizeOf(object: THREE.Object3D): THREE.Vector3 {
    object.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
}

/** A copy of person `index` (skinned), and their clips. */
export function personModel(index: number): { model: THREE.Object3D; walk: THREE.AnimationClip; idle: THREE.AnimationClip } {
    if (!people) throw new Error('people not loaded');
    return { model: cloneSkinned(people.models[index % people.models.length]), walk: people.walk, idle: people.idle };
}
