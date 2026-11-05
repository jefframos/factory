// Snapshots.ts
//
// Pictures of the UFO styles and aliens for the shop: each rendered once into a small transparent texture, through the
// game's renderer into an offscreen target, then kept (the mow game's ModelIcons). No bend here: they're their own copies.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { buildPiece, placePiece } from 'core/pieces/Pieces';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import SetupThree from 'core/scene/SetupThree';
import { AlienStyle, MODEL_BASE, UfoStyle } from '../data/UfoConfig';
import { applyPop, popStyle, removePop } from '../player/PopMaterial';
import { loadSaucerModel, saucerTexture } from '../player/Saucer';

/** About twice the largest size a picture's shown at, so it stays crisp. */
const SIZE = 256;
const cache = new Map<string, Promise<PIXI.Texture | null>>();
const loadPiece = (path: string) => ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${path}`);

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
    scene.add(holder, new THREE.AmbientLight(0xffffff, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 4, 4);
    scene.add(sun);
    const radius = Math.max(size.x, size.y, size.z) * 0.62;
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 10);
    camera.position.set(0, radius * 1.3, radius * 2.6);
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

async function renderUfo(style: UfoStyle): Promise<PIXI.Texture | null> {
    const [scene, skin] = await Promise.all([loadSaucerModel(), saucerTexture(style.skin, true)]);
    const hull = scene.clone(true);
    const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    hull.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const source = child.material as THREE.MeshStandardMaterial;
        let copy = copies.get(source);
        if (!copy) {
            copy = source.clone();
            copies.set(source, copy);
            if (source.name === 'Glass') {
                copy.color.set(style.domeColor);
                copy.opacity = style.domeOpacity;
            } else {
                copy.map = skin;
            }
        }
        child.material = copy;
    });
    const guns = hull.getObjectByName('guns');
    if (guns && style.guns !== true) guns.removeFromParent();
    const group = new THREE.Group();
    group.add(hull);
    for (const piece of style.pieces) {
        const object = await buildPiece(piece, loadPiece);
        if (object) group.add(object);
    }
    const texture = stylisedSnapshot(group);
    copies.forEach((material) => material.dispose());
    return texture;
}

async function renderAlien(style: AlienStyle): Promise<PIXI.Texture | null> {
    const group = new THREE.Group();
    for (const piece of style.pieces) {
        const object = await buildPiece(piece, loadPiece);
        if (object) group.add(object);
    }
    if (style.root) placePiece(group, { ...style.root, x: 0, y: 0, z: 0 });
    return stylisedSnapshot(group);
}

/** As the saucers look in the game. */
function stylisedSnapshot(object: THREE.Object3D): PIXI.Texture | null {
    const style = popStyle();
    if (!style) return snapshot(object);
    const applied = applyPop(object, style);
    const texture = snapshot(object);
    removePop(applied);
    return texture;
}

function cached(key: string, render: () => Promise<PIXI.Texture | null>): Promise<PIXI.Texture | null> {
    let promise = cache.get(key);
    if (!promise) {
        promise = render().catch((error) => {
            console.warn(`[Snapshots] could not draw ${key}`, error);
            return null;
        });
        cache.set(key, promise);
    }
    return promise;
}

export const Snapshots = {
    ufo: (style: UfoStyle): Promise<PIXI.Texture | null> => cached(`ufo:${style.id}`, () => renderUfo(style)),
    alien: (style: AlienStyle): Promise<PIXI.Texture | null> => cached(`alien:${style.id}`, () => renderAlien(style)),
};
