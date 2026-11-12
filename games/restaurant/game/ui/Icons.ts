// Icons.ts
//
// Pictures of the food for the UI (the order bubble, the ticket, the shopping list): a model rendered once, from the front
// and above, into a small transparent texture through the game's renderer, then kept. Made on first use (the model must
// be loaded: Models.loadModels). As the UFO game's Snapshots.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import SetupThree from 'core/scene/SetupThree';
import { kitchenModel } from '../world/Models';
import { PART_MODELS, Part } from '../data/Recipes';

const SIZE = 192;
const cache = new Map<string, PIXI.Texture>();

function snapshot(object: THREE.Object3D, elevation: number): PIXI.Texture {
    const renderer = SetupThree.renderer;
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    object.position.sub(center);
    const scene = new THREE.Scene();
    scene.add(object, new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 5, 4);
    scene.add(sun);
    const radius = Math.max(size.x, size.y, size.z) * 0.58;
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 20);
    camera.position.set(0, Math.sin(elevation) * radius * 4, Math.cos(elevation) * radius * 4);
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

/** Flat things (slices, buns' halves) are drawn from higher up, so their faces show. */
const FLAT = /slice|bun_bottom|burger_(un)?cooked/;

/** A model's picture, centred, `size` across. */
export function modelIcon(model: string, size: number): PIXI.Sprite {
    let texture = cache.get(model);
    if (!texture) {
        try {
            texture = snapshot(kitchenModel(model), FLAT.test(model) ? 0.85 : 0.5);
        } catch {
            texture = PIXI.Texture.WHITE;
        }
        cache.set(model, texture);
    }
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = size;
    return sprite;
}

/** A burger part's picture, or the whole burger's. */
export const foodIcon = (id: Part | 'burger', size: number): PIXI.Sprite => modelIcon(id === 'burger' ? 'food_burger' : PART_MODELS[id], size);
