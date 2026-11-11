// UnitIcons.ts
//
// Pictures of the units for their cards: from the `entities` atlas when it has one (raw-assets/images/entities{tps}/
// card-<kind>.png: saved by the editor's Settings tab, then edited by hand as wanted), else each rendered once into a
// small transparent texture,
// through the game's renderer into an offscreen target, then kept (as UFO's Snapshots.ts). The giant is the crowd's
// model (mob.glb) caught mid-run, painted the giant's blue; the truck, the UFO and the car are their models
// (props/<name>.glb). The character cards' (the skeletons): their models (characters/<name>.glb) caught mid-run, a few
// of them for a batch.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import SetupThree from 'core/scene/SetupThree';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { UNIT_COLORS } from '../data/MobConfig';
import { CardKind } from '../data/Settings';

/** About twice the largest size a picture's shown at, so it stays crisp. */
const SIZE = 256;
const BASE = './mob/models/';
const PROP_MODEL: Record<'truck' | 'saucer' | 'car', string> = { truck: 'truck', saucer: 'saucer', car: 'car' };
/** The character cards: their model, and how many stand in the picture (a batch: a few, side by side). */
const CHARACTER_MODEL: Partial<Record<CardKind, { model: string; count: number; baked?: boolean }>> = {
    skeletons: { model: 'skeleton-minion', count: 3 },
    warriors: { model: 'skeleton-warrior', count: 1 },
    golem: { model: 'golem', count: 1, baked: true },
    bomb: { model: 'stone-monster', count: 1, baked: true },
    bats: { model: 'bat', count: 1, baked: true },
    turtle: { model: 'turtle', count: 1, baked: true },
};
const cache = new Map<CardKind, Promise<PIXI.Texture | null>>();

/** Draws `object`, framed by its bounds, from the front and a little above. */
function snapshot(object: THREE.Object3D): PIXI.Texture | null {
    const renderer = SetupThree.renderer;
    if (!renderer) return null;
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(object);
    object.position.sub(center);
    const scene = new THREE.Scene();
    scene.add(holder, new THREE.AmbientLight(0xffffff, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 4, 4);
    scene.add(sun);
    // Close in: the unit fills its picture (the card crops what spills over).
    const radius = Math.max(size.x, size.y, size.z) * 0.48;
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 10);
    camera.position.set(radius * 0.9, radius * 1.1, radius * 2.4);
    camera.lookAt(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    target.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
        const source = (SIZE - 1 - y) * SIZE * 4;
        image.data.set(pixels.subarray(source, source + SIZE * 4), y * SIZE * 4);
    }
    context.putImageData(image, 0, 0);
    return PIXI.Texture.from(canvas);
}

/** The giant: the crowd's model a little way into its run, its team-painted parts in the giant's blue (as CrowdView). */
async function renderGiant(): Promise<PIXI.Texture | null> {
    const loader = createGLTFLoader();
    const [model, anims] = await Promise.all([loader.loadAsync(`${BASE}mob/mob.glb`), loader.loadAsync(`${BASE}mob/mob-anims.glb`)]);
    const figure = cloneSkinned(model.scene);
    const team = new THREE.Color(UNIT_COLORS.giant);
    figure.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const material = new THREE.MeshLambertMaterial({ vertexColors: true });
        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTeam = { value: team };
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nuniform vec3 uTeam;')
                .replace('#include <color_vertex>', `#include <color_vertex>
                vColor = vec4(mix(color.rgb, uTeam * color.rgb * 2.0, step(0.5, color.a)), 1.0);`);
        };
        child.material = material;
    });
    const clip = anims.animations.find((a) => a.name === 'run') ?? anims.animations[0];
    if (clip) {
        const mixer = new THREE.AnimationMixer(figure);
        mixer.clipAction(clip).play();
        mixer.setTime(clip.duration * 0.3);
    }
    // Skinned: its bounds come from the bones' pose, so give it a plain box to frame by.
    figure.updateMatrixWorld(true);
    return snapshot(figure);
}

/** A character card: its model a little way into its run, a few of them for a batch (the middle one in front). */
async function renderCharacter(spec: { model: string; count: number; baked?: boolean }): Promise<PIXI.Texture | null> {
    const loader = createGLTFLoader();
    if (spec.baked) {
        // Baked poses (one mesh each): one of them, a little way into the run.
        const gltf = await loader.loadAsync(`${BASE}characters/${spec.model}.glb`);
        // (A still one has only pose_0.)
        const shown = gltf.scene.getObjectByName('pose_2') ?? gltf.scene.getObjectByName('pose_0');
        if (!shown) return null;
        gltf.scene.remove(shown);
        return snapshot(shown);
    }
    const [model, rig] = await Promise.all([loader.loadAsync(`${BASE}characters/${spec.model}.glb`), loader.loadAsync(`${BASE}characters/rig-medium.glb`)]);
    const clip = rig.animations.find((a) => a.name === 'Running_A') ?? rig.animations[0];
    const group = new THREE.Group();
    for (let k = 0; k < spec.count; k++) {
        const figure = cloneSkinned(model.scene);
        if (clip) {
            const mixer = new THREE.AnimationMixer(figure);
            mixer.clipAction(clip).play();
            mixer.setTime(clip.duration * (0.25 + k * 0.3));
        }
        const side = spec.count > 1 ? k - (spec.count - 1) / 2 : 0;
        figure.position.set(side * 0.9, 0, side === 0 ? 0.4 : 0);
        group.add(figure);
    }
    group.updateMatrixWorld(true);
    return snapshot(group);
}

async function renderProp(kind: 'truck' | 'saucer' | 'car'): Promise<PIXI.Texture | null> {
    const gltf = await createGLTFLoader().loadAsync(`${BASE}props/${PROP_MODEL[kind]}.glb`);
    return snapshot(gltf.scene.clone(true));
}

export const UnitIcons = {
    /** `kind`'s picture (rendered the first time it's asked for; null if it can't be). */
    get(kind: CardKind): Promise<PIXI.Texture | null> {
        let texture = cache.get(kind);
        if (!texture) {
            // The atlas's, if it has it.
            const saved = PIXI.utils.TextureCache[`card-${kind}`] as PIXI.Texture | undefined;
            if (saved) {
                texture = Promise.resolve(saved);
                cache.set(kind, texture);
                return texture;
            }
            const character = CHARACTER_MODEL[kind];
            texture = (kind === 'giant' ? renderGiant() : character ? renderCharacter(character) : renderProp(kind as 'truck' | 'saucer' | 'car')).catch((error) => {
                console.warn('[mob] unit icon', kind, error);
                return null;
            });
            cache.set(kind, texture);
        }
        return texture;
    },
};
