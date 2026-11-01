// ModelIcons.ts
//
// Renders a model once into a small transparent texture for UI cards (the collection's artifacts, the
// wardrobe's hats, the shop's mowers) — bandit-controller's HatIcons, for any model or a built object (`object()`). Uses its own GLTF load (not the shared
// model cache) so the world-bend shader never touches it, and renders through the game's renderer into
// an offscreen target.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { paintPixels } from '../utils/Paint';
import SetupThree from 'core/scene/SetupThree';
import { MOW, ToolDef, toolPaint } from '../data/MowConfig';
import { addHandle, buildMower, handleOf } from '../player/MowerModel';

/** Render size: about twice the largest size an icon is shown at, so it stays crisp. */
const SIZE = 256;
const cache = new Map<string, Promise<HTMLCanvasElement | undefined>>();
const textures = new WeakMap<HTMLCanvasElement, PIXI.Texture>();
let loader: GLTFLoader | undefined;

async function render(url: string, paint: string | undefined): Promise<HTMLCanvasElement | undefined> {
    if (!SetupThree.renderer) return undefined;
    loader ??= new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    return snapshot(gltf.scene, paint);
}

/** Draws `object` (centred, framed by its bounds, seen from the front-right and above) into a canvas. */
function snapshot(object: THREE.Object3D, paint?: string): HTMLCanvasElement | undefined {
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
    // The same model repainted (a ridden mower's tractor: grey, purple, red).
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
    /** The icon for a model (a ./mow/models/... url), optionally repainted ('grey' or a colour: Paint); undefined if it can't be drawn. */
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

    /**
     * A mower's icon as a canvas: a ridden one is its tractor in its paint (as in game); a walked one its placeholder
     * mower with its handle (MowerModel.ts, as the player pushes it), turned a little so its side and the handle show.
     */
    toolCanvas(tool: ToolDef): Promise<HTMLCanvasElement | undefined> {
        if (tool.ride) return this.canvas(`./mow/models/${MOW.tractor.model}`, toolPaint(tool));
        const { grip, gripZ } = handleOf(tool);
        const key = `mower:${tool.id}:${tool.size.join(',')}:${tool.color}:${grip.forward},${grip.height},${grip.spread}:${tool.gap ?? ''}`;
        return this.objectCanvas(key, () => {
            const model = buildMower(tool);
            addHandle(model, tool, grip, gripZ, new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6 }));
            model.group.rotation.y = -0.5;
            const holder = new THREE.Group();
            holder.add(model.group);
            return holder;
        });
    },

    /** A sprite that fills in with a mower's icon (toolCanvas()), about `size` px across. */
    toolSprite(tool: ToolDef, size: number): PIXI.Sprite {
        return fill(this.toolCanvas(tool).then(textureOf), size * (tool.ride ? 1.15 : 1.2));
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
