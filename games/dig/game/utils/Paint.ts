// Paint.ts
//
// Repaints RGBA pixels for a vehicle's look (ToolDef greyscale / tint, see toolPaint): 'grey' desaturates (the
// Digger); a colour keeps each pixel's brightness and gives it that colour (the Red Tractor), so the shading and the
// details stay.

import * as THREE from 'three';

/** Brightens the colour so a mid-grey pixel lands on the colour itself, not a darker shade of it. */
const TINT_LIFT = 1.7;

export function paintPixels(data: Uint8ClampedArray, paint: string): void {
    const color = paint === 'grey' ? undefined : new THREE.Color(paint);
    for (let i = 0; i < data.length; i += 4) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (!color) {
            data[i] = data[i + 1] = data[i + 2] = luma;
            continue;
        }
        const k = (luma / 255) * TINT_LIFT;
        data[i] = Math.min(255, color.r * 255 * k);
        data[i + 1] = Math.min(255, color.g * 255 * k);
        data[i + 2] = Math.min(255, color.b * 255 * k);
    }
}
