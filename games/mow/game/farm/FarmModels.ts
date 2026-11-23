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
import { MOW } from '../data/MowConfig';

type BaseItem = 'bale' | 'egg' | 'tray' | 'goldTray' | 'cash' | 'milk' | 'butter' | 'cheese';
/** A crop farm's goods: a crop's fresh fruit (`crop:<id>`) and what its machine makes (`product:<id>`, by the crop's id). */
export type CropItem = `crop:${string}` | `product:${string}`;
export type FarmItem = BaseItem | CropItem;

/** The crop (ui/mow.json `crops`) a crop item is of. */
export const cropOf = (kind: CropItem) => MOW.crops?.find((crop) => crop.id === kind.slice(kind.indexOf(':') + 1));

/** A farm item's height when stacked. */
export function itemHeight(kind: FarmItem): number {
    if (kind.startsWith('crop:')) return 0.24;
    if (kind.startsWith('product:')) return 0.27;
    return ITEM_HEIGHT[kind as BaseItem];
}

/** Each item's height when stacked (world units). */
export const ITEM_HEIGHT: Record<BaseItem, number> = { bale: 0.2, egg: 0.27, tray: 0.17, goldTray: 0.17, cash: 0.06, milk: 0.36, butter: 0.16, cheese: 0.2 };

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

// ---------------------------------------------------------------- models for items (the pizza game's food pack)

/**
 * Items drawn with a model (models/farm: the pizza game's milk carton, cheese, strawberry and jar), fitted to their
 * stacking height and at most `width` across. Until they've loaded (preloadFarmModels()), the drawn shapes stand in.
 */
const ITEM_MODELS: Record<string, { path: string; height: number; width: number }> = {
    milk: { path: 'farm/carton.glb', height: 0.34, width: 0.24 },
    cheese: { path: 'farm/cheese.glb', height: 0.2, width: 0.42 },
    'crop:strawberry': { path: 'farm/strawberry.glb', height: 0.24, width: 0.26 },
    'product:strawberry': { path: 'farm/jar_D_medium.gltf', height: 0.27, width: 0.26 },
};
const itemTemplates = new Map<string, THREE.Object3D>();
let preloading: Promise<void> | undefined;

/** A model (under ./mow/models/) fitted: its base on y = 0, centred, `height` tall at most and `width` across at most. */
function loadFitted(path: string, height: number, width: number): Promise<THREE.Object3D> {
    return createGLTFLoader().loadAsync(`./mow/models/${path}`).then((gltf) => {
        const model = gltf.scene;
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.material = [child.material].flat().map((m) => {
                const copy = (m as THREE.Material).clone();
                BendService.applyBend(copy);
                return copy;
            });
            if ((child.material as THREE.Material[]).length === 1) child.material = (child.material as THREE.Material[])[0];
        });
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = Math.min(height / Math.max(size.y, 1e-3), width / Math.max(size.x, size.z, 1e-3));
        const holder = new THREE.Group();
        model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
        holder.add(model);
        holder.scale.setScalar(scale);
        return holder;
    });
}

/** Loads the item models once (the scene calls it as the farm builds); items made after it use them. */
export function preloadFarmModels(): Promise<void> {
    preloading ??= Promise.all(Object.entries(ITEM_MODELS).map(([kind, spec]) => loadFitted(spec.path, spec.height, spec.width)
        .then((template) => void itemTemplates.set(kind, template))
        .catch((error) => console.warn('[FarmModels] item model', spec.path, error)))).then(() => undefined);
    return preloading;
}

const props = new Map<string, Promise<THREE.Object3D | null>>();
/** A prop model (under ./mow/models/: the churn's barrel...) fitted to `height` (and `width` across); null if it can't load. */
export function farmProp(path: string, height: number, width = height * 2): Promise<THREE.Object3D | null> {
    const key = `${path}:${height}:${width}`;
    let found = props.get(key);
    if (!found) {
        found = loadFitted(path, height, width).catch((error) => {
            console.warn('[FarmModels] prop', path, error);
            return null;
        });
        props.set(key, found);
    }
    return found.then((template) => template?.clone(true) ?? null);
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
/** A milk bottle (white, a blue cap and label), standing, on y = 0. */
function milk(): THREE.Group {
    const group = new THREE.Group();
    group.add(mesh(geometry('milk', () => new THREE.CylinderGeometry(0.1, 0.11, 0.26, 12)), material(0xfafaf6, 0.4), 0, 0.13, 0));
    group.add(mesh(geometry('milk-neck', () => new THREE.CylinderGeometry(0.05, 0.09, 0.07, 12)), material(0xfafaf6, 0.4), 0, 0.295, 0));
    group.add(mesh(geometry('milk-cap', () => new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12)), material(0x2f7fe0, 0.5), 0, 0.345, 0));
    group.add(mesh(geometry('milk-label', () => new THREE.CylinderGeometry(0.106, 0.112, 0.08, 12)), material(0x4fa3ff, 0.6), 0, 0.12, 0));
    return group;
}

/** A block of butter in its paper (yellow, a white band), on y = 0. */
function butter(): THREE.Group {
    const group = new THREE.Group();
    group.add(mesh(geometry('butter', () => new THREE.BoxGeometry(0.4, 0.14, 0.24)), material(0xffe066, 0.45), 0, 0.07, 0));
    group.add(mesh(geometry('butter-band', () => new THREE.BoxGeometry(0.12, 0.145, 0.245)), material(0xf7f3e6, 0.6), 0, 0.0705, 0));
    return group;
}

/** A cheese wheel (orange rind, its top a paler yellow), on y = 0. */
function cheese(): THREE.Group {
    const group = new THREE.Group();
    group.add(mesh(geometry('cheese', () => new THREE.CylinderGeometry(0.2, 0.2, 0.17, 16)), material(0xf2a33a, 0.6), 0, 0.085, 0));
    group.add(mesh(geometry('cheese-top', () => new THREE.CylinderGeometry(0.17, 0.17, 0.01, 16)), material(0xffd36b, 0.6), 0, 0.175, 0));
    return group;
}

function cash(): THREE.Group {
    const group = new THREE.Group();
    group.add(mesh(geometry('cash', () => new THREE.BoxGeometry(0.36, 0.05, 0.18)), material(0x5fc85a, 0.6), 0, 0.025, 0));
    group.add(mesh(geometry('cash-band', () => new THREE.BoxGeometry(0.07, 0.055, 0.185)), material(0xf2f0e0, 0.6), 0, 0.0255, 0));
    return group;
}

/** A new item (its own object; the geometry and materials are shared). */
export function farmItem(kind: FarmItem): THREE.Object3D {
    // A model when there is one (loaded), else the drawn shape.
    const template = itemTemplates.get(kind);
    if (template) return template.clone(true);
    switch (kind) {
        case 'bale': return bale();
        case 'egg': return egg();
        case 'tray': return tray();
        case 'goldTray': return tray(true);
        case 'cash': return cash();
        case 'milk': return milk();
        case 'butter': return butter();
        case 'cheese': return cheese();
    }
    return kind.startsWith('crop:') ? fruit(kind) : product(kind);
}

/** A crop's fruit (a strawberry: a plump red drop, a green leaf cap), in its colours, on y = 0. */
function fruit(kind: CropItem): THREE.Group {
    const crop = cropOf(kind);
    const color = new THREE.Color(crop?.color ?? '#e8323f').getHex();
    const leaf = new THREE.Color(crop?.leaf ?? '#3fa34d').getHex();
    const group = new THREE.Group();
    const body = mesh(geometry('fruit', () => new THREE.SphereGeometry(0.12, 14, 10)), material(color, 0.45), 0, 0.12, 0);
    body.scale.set(1, 1.15, 1);
    group.add(body);
    group.add(mesh(geometry('fruit-cap', () => new THREE.ConeGeometry(0.09, 0.06, 6)), material(leaf, 0.7), 0, 0.255, 0));
    return group;
}

/** What a crop's machine makes: a jar (jam) with a lid and a label, or a box, in its colours, on y = 0. */
function product(kind: CropItem): THREE.Group {
    const def = cropOf(kind)?.product;
    const color = new THREE.Color(def?.color ?? '#c0182e').getHex();
    const lid = new THREE.Color(def?.lid ?? '#f2f2f2').getHex();
    const group = new THREE.Group();
    if (def?.shape === 'box') {
        group.add(mesh(geometry('product-box', () => new THREE.BoxGeometry(0.34, 0.22, 0.26)), material(color, 0.55), 0, 0.11, 0));
        group.add(mesh(geometry('product-box-band', () => new THREE.BoxGeometry(0.1, 0.225, 0.265)), material(lid, 0.6), 0, 0.1105, 0));
        return group;
    }
    group.add(mesh(geometry('jar', () => new THREE.CylinderGeometry(0.12, 0.12, 0.2, 14)), material(color, 0.3), 0, 0.1, 0));
    group.add(mesh(geometry('jar-label', () => new THREE.CylinderGeometry(0.123, 0.123, 0.08, 14)), material(0xfaf3e0, 0.6), 0, 0.1, 0));
    group.add(mesh(geometry('jar-lid', () => new THREE.CylinderGeometry(0.125, 0.125, 0.05, 14)), material(lid, 0.5), 0, 0.225, 0));
    return group;
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
