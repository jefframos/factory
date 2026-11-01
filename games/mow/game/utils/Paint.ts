// Paint.ts
//
// Repaints RGBA pixels for a ridden mower's tractor (ToolDef greyscale / tint, see toolPaint; after dig's Paint.ts):
// 'grey' desaturates (the Digger); a colour keeps each pixel's brightness and gives it that colour, so the shading
// stays. Only the bodywork is painted: the palette's mid-tone, unsaturated swatches (the tractor's blue-grey). The tyres
// and dark parts, near-white highlights and the coloured trim (gold) keep their own colours.

import * as THREE from 'three';

/** Brightens the colour so a mid-grey pixel lands on the colour itself, not a darker shade of it. */
const TINT_LIFT = 1.7;
/** Luma (0..255) the paint fades in over (darker: tyres, seat) and out over (lighter: highlights). */
const DARK = [78, 98];
const LIGHT = [215, 240];
/** Saturation (0..1) the paint fades out over: trim already in a colour keeps it. */
const SATURATED = [0.3, 0.45];

const smooth = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

export function paintPixels(data: Uint8ClampedArray, paint: string): void {
    const color = paint === 'grey' ? undefined : new THREE.Color(paint);
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        const max = Math.max(r, g, b);
        const saturation = max ? (max - Math.min(r, g, b)) / max : 0;
        const weight = smooth(DARK[0], DARK[1], luma) * (1 - smooth(LIGHT[0], LIGHT[1], luma)) * (1 - smooth(SATURATED[0], SATURATED[1], saturation));
        if (weight <= 0) continue;
        let pr = luma;
        let pg = luma;
        let pb = luma;
        if (color) {
            const k = (luma / 255) * TINT_LIFT;
            pr = Math.min(255, color.r * 255 * k);
            pg = Math.min(255, color.g * 255 * k);
            pb = Math.min(255, color.b * 255 * k);
        }
        data[i] = r + (pr - r) * weight;
        data[i + 1] = g + (pg - g) * weight;
        data[i + 2] = b + (pb - b) * weight;
    }
}
