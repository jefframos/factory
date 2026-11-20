// FarmModels.ts
//
// The farm test's small things, built in code and shared (one geometry and material each): a grass bale (what the
// bag's clippings look like in the backpack), an egg, a tray of eggs, a bundle of cash. And the animals from the
// library (animals/animal-*.glb: the pizza game's pets pack, with their own idle / walk / eat clips), loaded once and
// cloned, each with its own mixer.

import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { BendService } from '../services/BendService';

export type FarmItem = 'bale' | 'egg' | 'tray' | 'goldTray' | 'cash';

/** Each item's height when stacked (world units). */
export const ITEM_HEIGHT: Record<FarmItem, number> = { bale: 0.2, egg: 0.27, tray: 0.17, goldTray: 0.17, cash: 0.06 };

const materials = new Map<string, THREE.MeshStandardMaterial>();
function material(color: number, roughness = 0.8): THREE.MeshStandardMaterial {
    const key = `${color}:${roughness}`;
    let found = materials.get(key);
    if (!found) {
        found = new THREE.MeshStandardMaterial({ color, roughness });
        BendService.applyBend(found);
        materials.set(key, found);
    }
    return found;
}

const geometries = new Map<string, THREE.BufferGeometry>();
function geometry(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let found = geometries.get(key);
    if (!found) {
        found = make();
        geometries.set(key, found);
    }
    return found;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
}

/** A bale of cut grass: a green block with two twine bands, sitting on y = 0. */
function bale(): THREE.Group {
    const group = new THREE.Group();
    const block = mesh(geometry('bale', () => new THREE.BoxGeometry(0.46, 0.18, 0.3)), material(0x7ccf4f, 0.95), 0, 0.09, 0);
    group.add(block);
    // A rougher top: a few blades' worth of lighter clumps.
    const tuft = geometry('bale-top', () => new THREE.BoxGeometry(0.44, 0.03, 0.28));
    group.add(mesh(tuft, material(0x9ce06a, 0.95), 0, 0.185, 0));
    const band = geometry('bale-band', () => new THREE.BoxGeometry(0.035, 0.19, 0.31));
    for (const x of [-0.12, 0.12]) group.add(mesh(band, material(0xc9a35a), x, 0.095, 0));
    return group;
}

/** An egg, standing, sitting on y = 0. */
function egg(): THREE.Mesh {
    const shell = geometry('egg', () => {
        const g = new THREE.SphereGeometry(0.105, 12, 10);
        g.scale(1, 1.3, 1);
        g.translate(0, 0.1365, 0);
        return g;
    });
    return new THREE.Mesh(shell, material(0xfff0d0, 0.5));
}

/** A cardboard tray with six eggs, sitting on y = 0 (`gold`: a red tray of golden eggs, the gold machine's). */
function tray(gold = false): THREE.Group {
    const group = new THREE.Group();
    group.add(mesh(geometry('tray', () => new THREE.BoxGeometry(0.5, 0.06, 0.36)), material(gold ? 0xc0392b : 0xe2c48e), 0, 0.03, 0));
    const small = geometry('tray-egg', () => {
        const g = new THREE.SphereGeometry(0.075, 10, 8);
        g.scale(1, 1.2, 1);
        return g;
    });
    for (let i = 0; i < 6; i++) {
        group.add(mesh(small, gold ? goldEggMaterial() : material(0xfff0d0, 0.5), -0.155 + (i % 3) * 0.155, 0.11, i < 3 ? -0.085 : 0.085));
    }
    return group;
}

let goldEgg: THREE.MeshStandardMaterial | undefined;
/** The golden eggs' shine. */
function goldEggMaterial(): THREE.MeshStandardMaterial {
    if (!goldEgg) {
        goldEgg = new THREE.MeshStandardMaterial({ color: 0xffe23a, metalness: 0.25, roughness: 0.3, emissive: 0x8a6a00, emissiveIntensity: 0.45 });
        BendService.applyBend(goldEgg);
    }
    return goldEgg;
}

/** A bundle of notes, sitting on y = 0. */
function cash(): THREE.Group {
    const group = new THREE.Group();
    group.add(mesh(geometry('cash', () => new THREE.BoxGeometry(0.36, 0.05, 0.18)), material(0x5fc85a, 0.6), 0, 0.025, 0));
    group.add(mesh(geometry('cash-band', () => new THREE.BoxGeometry(0.07, 0.055, 0.185)), material(0xf2f0e0, 0.6), 0, 0.0255, 0));
    return group;
}

/** A new item (its own object; the geometry and materials are shared). */
export function farmItem(kind: FarmItem): THREE.Object3D {
    switch (kind) {
        case 'bale': return bale();
        case 'egg': return egg();
        case 'tray': return tray();
        case 'goldTray': return tray(true);
        case 'cash': return cash();
    }
}

// ---------------------------------------------------------------- animals

interface AnimalSource {
    scene: THREE.Object3D;
    clips: THREE.AnimationClip[];
}

const animalSources = new Map<string, Promise<AnimalSource>>();

/** An animal placed in the world: its model, and the clip playing (idle / walk / eat / ...). */
export class Animal {
    public readonly object = new THREE.Group();
    private mixer?: THREE.AnimationMixer;
    private clips: THREE.AnimationClip[] = [];
    private current?: THREE.AnimationAction;
    private wanted = 'idle';

    /** `path`: under ./mow/models/ (e.g. `animals/animal-chick.glb`); `height`: its height in the world. */
    public constructor(path: string, height: number) {
        void Animal.source(path).then((source) => {
            const model = cloneSkinned(source.scene);
            model.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                child.material = (child.material as THREE.Material).clone();
                BendService.applyBend(child.material as THREE.Material);
            });
            const box = new THREE.Box3().setFromObject(model);
            const size = box.getSize(new THREE.Vector3());
            model.scale.setScalar(height / Math.max(size.y, 1e-3));
            this.object.add(model);
            this.mixer = new THREE.AnimationMixer(model);
            this.clips = source.clips;
            this.play(this.wanted);
        }).catch((error) => console.warn('[FarmModels] animal', path, error));
    }

    private static source(path: string): Promise<AnimalSource> {
        let found = animalSources.get(path);
        if (!found) {
            found = createGLTFLoader().loadAsync(`./mow/models/${path}`).then((gltf) => ({ scene: gltf.scene, clips: gltf.animations }));
            animalSources.set(path, found);
        }
        return found;
    }

    /** Plays a clip by name (crossfading from the last), once it has loaded. */
    public play(name: string, fade = 0.25): void {
        this.wanted = name;
        if (!this.mixer) return;
        const clip = this.clips.find((c) => c.name === name);
        if (!clip) return;
        const action = this.mixer.clipAction(clip);
        if (action === this.current) return;
        action.reset().fadeIn(fade).play();
        this.current?.fadeOut(fade);
        this.current = action;
    }

    public update(delta: number): void {
        this.mixer?.update(delta);
    }

    public destroy(): void {
        this.mixer?.stopAllAction();
        this.object.removeFromParent();
    }
}
