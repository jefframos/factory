// HatIcons.ts
//
// Renders each hat model once into a small transparent texture for the Edit Squad shop grid.
// Uses its own GLTF load (not the shared model cache) so the world-bend shader never touches it.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import SetupThree from 'core/scene/SetupThree';

const SIZE = 128;
const cache = new Map<string, Promise<PIXI.Texture | undefined>>();
let loader: GLTFLoader | undefined;

async function render(hat: string): Promise<PIXI.Texture | undefined> {
    const renderer = SetupThree.renderer;
    if (!renderer) {
        return undefined;
    }
    loader ??= new GLTFLoader();
    const gltf = await loader.loadAsync(`./bandit-controller/models/hats/${hat}.glb`);
    const object = gltf.scene;
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    object.position.sub(center);

    const scene = new THREE.Scene();
    scene.add(object, new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 3, 4);
    scene.add(sun);
    const radius = Math.max(size.x, size.y, size.z) * 0.62;
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, 100);
    camera.position.set(radius * 1.4, radius * 1.1, radius * 2.4);
    camera.lookAt(0, 0, 0);

    const target = new THREE.WebGLRenderTarget(SIZE, SIZE);
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

export const HatIcons = {
    get(hat: string): Promise<PIXI.Texture | undefined> {
        let promise = cache.get(hat);
        if (!promise) {
            promise = render(hat).catch(() => undefined);
            cache.set(hat, promise);
        }
        return promise;
    },
};
