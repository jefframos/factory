// ModelIcons.ts
//
// Renders a model once into a small transparent texture for UI cards (the collection's artifacts, the
// wardrobe's hats) — bandit-controller's HatIcons, for any model. Uses its own GLTF load (not the shared
// model cache) so the world-bend shader never touches it, and renders through the game's renderer into
// an offscreen target.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import SetupThree from 'core/scene/SetupThree';

/** Render size: about twice the largest size an icon is shown at, so it stays crisp. */
const SIZE = 256;
const cache = new Map<string, Promise<PIXI.Texture | undefined>>();
let loader: GLTFLoader | undefined;

async function render(url: string, greyscale: boolean): Promise<PIXI.Texture | undefined> {
    const renderer = SetupThree.renderer;
    if (!renderer) {
        return undefined;
    }
    loader ??= new GLTFLoader();
    const gltf = await loader.loadAsync(url);
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
    const radius = Math.max(size.x, size.y, size.z) * 0.68;
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
    if (greyscale) {
        // The same model in grey (the Digger: the tractor desaturated).
        const data = image.data;
        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            data[i] = data[i + 1] = data[i + 2] = luma;
        }
    }
    context.putImageData(image, 0, 0);
    return PIXI.Texture.from(canvas);
}

export const ModelIcons = {
    /** The icon for a model (a ./dig/models/... url), optionally in grey; undefined if it can't be drawn. */
    get(url: string, greyscale = false): Promise<PIXI.Texture | undefined> {
        const key = greyscale ? `${url}|grey` : url;
        let promise = cache.get(key);
        if (!promise) {
            promise = render(url, greyscale).catch(() => undefined);
            cache.set(key, promise);
        }
        return promise;
    },

    /** A sprite that fills in with the model's icon once it's rendered, `size` px across. */
    sprite(url: string, size: number, silhouette = false, greyscale = false): PIXI.Sprite {
        const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sprite.anchor.set(0.5);
        void this.get(url, greyscale).then((texture) => {
            if (!texture || sprite.destroyed) return;
            sprite.texture = texture;
            sprite.scale.set(size / texture.width);
            if (silhouette) {
                // Not found yet: just its shape, in shadow.
                sprite.tint = 0x000000;
                sprite.alpha = 0.55;
            }
        });
        return sprite;
    },
};
