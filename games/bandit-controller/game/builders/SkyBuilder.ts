// SkyBuilder.ts
//
// A cheap "sky" backdrop: a small canvas painted with a four-corner
// gradient (deeper blue at the top corners, paling toward the bottom
// corners like a hazy horizon), assigned directly as THREE.Scene.background.
// A plain (non-equirectangular) Texture assigned to Scene.background
// renders as a flat, camera-facing quad that always fills the whole
// viewport regardless of camera angle — so this reads as a full sky
// without needing an actual 3D dome/skybox mesh.

import * as THREE from 'three';

/** Small — this is stretched to fill the whole screen and only ever interpolated smoothly, so extra resolution buys nothing. */
const TEXTURE_SIZE = 64;

function lerpChannel(a: number, b: number, t: number): number {
    return Math.round(a + (b - a) * t);
}

/** Builds one shared CanvasTexture painted with a bilinear blend of the four corner colors (each an [r, g, b] 0-255 triple). */
function buildGradientTexture(topLeft: number[], topRight: number[], bottomLeft: number[], bottomRight: number[]): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;

    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(TEXTURE_SIZE, TEXTURE_SIZE);

    for (let y = 0; y < TEXTURE_SIZE; y++) {
        const v = y / (TEXTURE_SIZE - 1);

        for (let x = 0; x < TEXTURE_SIZE; x++) {
            const u = x / (TEXTURE_SIZE - 1);

            const index = (y * TEXTURE_SIZE + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                const top = lerpChannel(topLeft[channel], topRight[channel], u);
                const bottom = lerpChannel(bottomLeft[channel], bottomRight[channel], u);
                image.data[index + channel] = lerpChannel(top, bottom, v);
            }
            image.data[index + 3] = 255;
        }
    }

    ctx.putImageData(image, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

let cachedSkyTexture: THREE.CanvasTexture | undefined;

/** A shared blue-sky gradient texture — deep sky blue at the top corners, paling to a soft horizon haze at the bottom corners. Built once and reused across every scene (cheap, and there's no reason for each scene to repaint its own copy). */
export function buildBlueSkyTexture(): THREE.CanvasTexture {
    if (!cachedSkyTexture) {
        cachedSkyTexture = buildGradientTexture(
            [58, 121, 214],
            [72, 140, 226],
            [186, 224, 255],
            [206, 233, 255],
        );
    }
    return cachedSkyTexture;
}
