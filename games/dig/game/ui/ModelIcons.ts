// ModelIcons.ts
//
// Renders a model once into a small transparent texture for UI cards (the collection's artifacts, the
// wardrobe's hats, the tractor) — bandit-controller's HatIcons, for any model or a built object (`object()`). Uses its own GLTF load (not the shared
// model cache) so the world-bend shader never touches it, and renders through the game's renderer into
// an offscreen target.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import { paintBody, paintPixels } from '../utils/Paint';
import SetupThree from 'core/scene/SetupThree';
import { ToolDef, toolPaint } from '../data/DigConfig';
import { MowerBlades } from '../player/MowerBlades';
import { dressedTractor, freeDressed } from '../player/TractorDress';
import type { TractorLook } from '../data/TractorSkins';

/** Render size: about twice the largest size an icon is shown at, so it stays crisp. */
const SIZE = 256;
const cache = new Map<string, Promise<HTMLCanvasElement | undefined>>();
const textures = new WeakMap<HTMLCanvasElement, PIXI.Texture>();
let loader: GLTFLoader | undefined;

async function render(url: string, paint: string | undefined, tight = false): Promise<HTMLCanvasElement | undefined> {
    if (!SetupThree.renderer) return undefined;
    loader ??= createGLTFLoader();
    const gltf = await loader.loadAsync(url);
    // A model in plain colours takes the paint on its body's materials (as in game); a textured one on its pixels.
    const painted = !!paint && paintBody(gltf.scene, paint);
    return snapshot(gltf.scene, painted ? undefined : paint, tight);
}

/** The pixels of `scene` drawn offscreen (SIZE x SIZE, bottom row first), the renderer left as it was. */
function draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Uint8Array {
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
    return pixels;
}

/** Closes `camera` in on what it drew (`pixels`), so it fills the picture; false if it drew nothing. */
function frameTight(camera: THREE.OrthographicCamera, pixels: Uint8Array): boolean {
    let minX = SIZE, maxX = -1, minY = SIZE, maxY = -1;
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (pixels[(y * SIZE + x) * 4 + 3] < 8) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }
    if (maxX < 0) return false;
    const unit = (camera.right - camera.left) / SIZE;
    const middleX = camera.left + ((minX + maxX + 1) / 2) * unit;
    const middleY = camera.bottom + ((minY + maxY + 1) / 2) * unit;
    const half = (Math.max(maxX - minX, maxY - minY) / 2 + 3) * unit;
    camera.left = middleX - half;
    camera.right = middleX + half;
    camera.bottom = middleY - half;
    camera.top = middleY + half;
    camera.updateProjectionMatrix();
    return true;
}

/** Draws `object` (centred, framed by its bounds, or `tight`: filling the picture; seen from the front-right and above) into a canvas. */
function snapshot(object: THREE.Object3D, paint?: string, tight = false): HTMLCanvasElement | undefined {
    const renderer = SetupThree.renderer;
    if (!renderer) return undefined;
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

    let pixels = draw(renderer, scene, camera);
    if (tight && frameTight(camera, pixels)) pixels = draw(renderer, scene, camera);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
        const source = (SIZE - 1 - y) * SIZE * 4;
        image.data.set(pixels.subarray(source, source + SIZE * 4), y * SIZE * 4);
    }
    // The same model repainted (grey, or a colour).
    if (paint) paintPixels(image.data, paint);
    context.putImageData(image, 0, 0);
    return canvas;
}

/** The UI texture of a rendered canvas (one per canvas). */
function textureOf(canvas: HTMLCanvasElement | undefined): PIXI.Texture | undefined {
    if (!canvas) return undefined;
    let texture = textures.get(canvas);
    if (!texture) {
        texture = PIXI.Texture.from(canvas);
        textures.set(canvas, texture);
    }
    return texture;
}

export const ModelIcons = {
    /** The icon for a model (a ./dig/models/... url), optionally repainted ('grey' or a colour: Paint); undefined if it can't be drawn. */
    get(url: string, paint?: string): Promise<PIXI.Texture | undefined> {
        return this.canvas(url, paint).then(textureOf);
    },

    /** The icon for a model as a canvas (get()'s image, for drawing on: the grass locks' badges). */
    canvas(url: string, paint?: string): Promise<HTMLCanvasElement | undefined> {
        const key = paint ? `${url}|${paint}` : url;
        let promise = cache.get(key);
        if (!promise) {
            promise = render(url, paint).catch(() => undefined);
            cache.set(key, promise);
        }
        return promise;
    },

    /** The icon of an object built in code (`key` caches it; `build` runs once). */
    object(key: string, build: () => THREE.Object3D): Promise<PIXI.Texture | undefined> {
        return this.objectCanvas(key, build).then(textureOf);
    },

    /** object()'s icon as a canvas. */
    objectCanvas(key: string, build: () => THREE.Object3D): Promise<HTMLCanvasElement | undefined> {
        const cacheKey = `object:${key}`;
        let promise = cache.get(cacheKey);
        if (!promise) {
            promise = Promise.resolve().then(() => {
                const object = build();
                const canvas = snapshot(object);
                object.traverse((node) => (node as THREE.Mesh).geometry?.dispose());
                // Not cached when the renderer isn't up yet: tried again next time.
                if (!canvas) cache.delete(cacheKey);
                return canvas;
            }).catch(() => undefined);
            cache.set(cacheKey, promise);
        }
        return promise;
    },

    /** A sprite that fills in with a built object's icon (object()), `size` px across. */
    objectSprite(key: string, build: () => THREE.Object3D, size: number): PIXI.Sprite {
        return fill(this.object(key, build), size);
    },

    /** The blades of Blades level `level` (MowerBlades), seen from above at a slant: the padlocks' picture. */
    bladesCanvas(level: number): Promise<HTMLCanvasElement | undefined> {
        return this.objectCanvas(`blades:${level}`, () => {
            const blades = new MowerBlades();
            blades.set(level, 1);
            const holder = new THREE.Group();
            holder.add(blades.group);
            holder.rotation.x = 0.9;
            return holder;
        });
    },

    /** The tractor in `tool`'s colour wearing `look` (its paint and part), filling the picture, as a canvas. */
    tractorCanvas(tool: ToolDef, look: TractorLook): Promise<HTMLCanvasElement | undefined> {
        const key = `tractor:${look.paints || toolPaint(tool)}|${look.parts}`;
        let promise = cache.get(key);
        if (!promise) {
            promise = dressedTractor(tool, look).then((tractor) => {
                const canvas = snapshot(tractor, undefined, true);
                freeDressed(tractor);
                // Not cached when the renderer isn't up yet: tried again next time.
                if (!canvas) cache.delete(key);
                return canvas;
            }).catch(() => {
                cache.delete(key);
                return undefined;
            });
            cache.set(key, promise);
        }
        return promise;
    },

    /** A sprite that fills in with tractorCanvas(), `size` px across. */
    tractorSprite(tool: ToolDef, look: TractorLook, size: number): PIXI.Sprite {
        return fill(this.tractorCanvas(tool, look).then(textureOf), size);
    },

    /** sprite(), the model filling the picture (a flat hat as big as a tall one). */
    tightSprite(url: string, size: number): PIXI.Sprite {
        const key = `tight:${url}`;
        let promise = cache.get(key);
        if (!promise) {
            promise = render(url, undefined, true).catch(() => undefined);
            cache.set(key, promise);
        }
        return fill(promise.then(textureOf), size);
    },

    /** A sprite that fills in with the model's icon once it's rendered, `size` px across. */
    sprite(url: string, size: number, silhouette = false, paint?: string): PIXI.Sprite {
        return fill(this.get(url, paint), size, silhouette);
    },
};

/** A sprite that takes the texture once it's rendered, `size` px across (`silhouette`: its shape in shadow). */
function fill(promise: Promise<PIXI.Texture | undefined>, size: number, silhouette = false): PIXI.Sprite {
    const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
    sprite.anchor.set(0.5);
    void promise.then((texture) => {
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
}
