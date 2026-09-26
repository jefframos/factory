// PixiIconToThree.ts
//
// Turns a PIXI texture (an icon out of one of the packed spritesheets — see
// AssetLibraryRegistry.getAssetIcon()) into an upright canvas / THREE texture,
// so 3D-world UI (see FloorLabelComponent.ts) can draw the exact same icons
// the 2D UI uses. Handles what TexturePacker does to a frame:
//   - rotated frames (stored 90° clockwise in the atlas — PIXI's rotate = 2),
//   - trimmed frames (transparent border cut off — restored from `trim`),
//   - the base texture's resolution (frame rects are in resolution-scaled units).
// Results are cached per PIXI texture; never dispose them.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';

const canvasCache = new Map<PIXI.Texture, HTMLCanvasElement | null>();
const threeCache = new Map<PIXI.Texture, THREE.Texture | null>();

/** The icon drawn upright on its own canvas at its original (untrimmed) size — null if the texture has no drawable image (e.g. PIXI.Texture.WHITE, a missing icon). */
export function pixiTextureToCanvas(texture: PIXI.Texture): HTMLCanvasElement | null {
    if (canvasCache.has(texture)) {
        return canvasCache.get(texture)!;
    }

    const base = texture.baseTexture;
    const source = (base.resource as { source?: CanvasImageSource } | undefined)?.source;
    if (!source || texture === PIXI.Texture.WHITE || texture === PIXI.Texture.EMPTY) {
        canvasCache.set(texture, null);
        return null;
    }

    const res = base.resolution || 1;
    const frame = texture.frame;
    const rotated = texture.rotate !== 0;
    // Frame rect in the atlas image's own pixels. For a rotated frame this is the rotated (atlas) region.
    const sx = frame.x * res;
    const sy = frame.y * res;
    const sw = frame.width * res;
    const sh = frame.height * res;

    // Upright trimmed image: a rotated frame's width/height are swapped back.
    const trimmed = document.createElement('canvas');
    trimmed.width = Math.max(1, Math.round(rotated ? sh : sw));
    trimmed.height = Math.max(1, Math.round(rotated ? sw : sh));
    const tctx = trimmed.getContext('2d')!;
    if (rotated) {
        // TexturePacker stores it rotated 90° clockwise — undo with a 90° counter-clockwise turn.
        tctx.translate(0, trimmed.height);
        tctx.rotate(-Math.PI / 2);
    }
    tctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

    // Put the trimmed image back at its offset inside the original (untrimmed) size.
    const orig = texture.orig;
    const trim = texture.trim;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(orig.width * res));
    out.height = Math.max(1, Math.round(orig.height * res));
    out.getContext('2d')!.drawImage(trimmed, trim ? trim.x * res : 0, trim ? trim.y * res : 0);

    canvasCache.set(texture, out);
    return out;
}

/** Same as pixiTextureToCanvas(), wrapped as a THREE texture (sRGB). Shared — do not dispose. */
export function pixiTextureToThree(texture: PIXI.Texture): THREE.Texture | null {
    if (threeCache.has(texture)) {
        return threeCache.get(texture)!;
    }
    const canvas = pixiTextureToCanvas(texture);
    const result = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (result) {
        result.colorSpace = THREE.SRGBColorSpace;
    }
    threeCache.set(texture, result);
    return result;
}
