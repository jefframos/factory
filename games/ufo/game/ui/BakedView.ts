// BakedView.ts
//
// A picture of what a camera sees right now: rendered once with multisampling, at a multiple of the screen's resolution,
// through the game's renderer, shrunk smoothly to the screen's, and cropped to what's there. It's smooth where the live view,
// without antialiasing, is jagged. For the home screen's miniature (HomeScene.ts).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import SetupThree from 'core/scene/SetupThree';

/** How many times the screen's resolution it's rendered at, the largest side a render target gets, and the multisampling. */
const SUPERSAMPLE = 3;
const MAX_SIDE = 4096;
const MSAA_SAMPLES = 4;
/** Kept round what's there, in screen pixels: a soft edge isn't cut off. */
const CROP_PAD = 2;

export interface Baked {
    texture: PIXI.Texture;
    /** Where it goes, as shares of the screen. */
    left: number;
    top: number;
    width: number;
    height: number;
}

/** What `scene` shows through `camera`, on a clear background; null if there's nothing. */
export function bakeView(scene: THREE.Scene, camera: THREE.Camera): Baked | null {
    const { renderer } = SetupThree;
    const screen = renderer.getDrawingBufferSize(new THREE.Vector2());
    const scale = Math.min(SUPERSAMPLE, MAX_SIDE / Math.max(screen.x, screen.y));
    const width = Math.round(screen.x * scale);
    const height = Math.round(screen.y * scale);

    const target = new THREE.WebGLRenderTarget(width, height, { samples: MSAA_SAMPLES });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const previous = {
        target: renderer.getRenderTarget(),
        clear: renderer.getClearColor(new THREE.Color()),
        alpha: renderer.getClearAlpha(),
        background: scene.background,
    };
    scene.background = null;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(previous.clear, previous.alpha);
    scene.background = previous.background;
    target.dispose();

    // Upside down as read, and see-through colours come out already multiplied by their alpha. Where there's anything?
    const flipped = new Uint8ClampedArray(pixels.length);
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        const from = (height - 1 - y) * width * 4;
        const to = y * width * 4;
        for (let x = 0; x < width; x++) {
            const alpha = pixels[from + x * 4 + 3];
            if (alpha === 0) continue;
            const unmultiply = alpha === 255 ? 1 : 255 / alpha;
            flipped[to + x * 4] = pixels[from + x * 4] * unmultiply;
            flipped[to + x * 4 + 1] = pixels[from + x * 4 + 1] * unmultiply;
            flipped[to + x * 4 + 2] = pixels[from + x * 4 + 2] * unmultiply;
            flipped[to + x * 4 + 3] = alpha;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    if (maxX < 0) return null;

    const full = document.createElement('canvas');
    full.width = width;
    full.height = height;
    full.getContext('2d')!.putImageData(new ImageData(flipped, width, height), 0, 0);

    const pad = CROP_PAD * scale;
    const cropX = Math.max(0, Math.floor(minX - pad));
    const cropY = Math.max(0, Math.floor(minY - pad));
    const cropWidth = Math.min(width, Math.ceil(maxX + 1 + pad)) - cropX;
    const cropHeight = Math.min(height, Math.ceil(maxY + 1 + pad)) - cropY;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cropWidth / scale));
    canvas.height = Math.max(1, Math.round(cropHeight / scale));
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(full, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

    return { texture: PIXI.Texture.from(canvas), left: cropX / width, top: cropY / height, width: cropWidth / width, height: cropHeight / height };
}
