// Paint.ts
//
// The tractor's paint: which of it is bodywork (isBodyMaterial, regionOf), and repainting RGBA pixels:
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

/** The tractor's two painted regions: its body (hood and roof) and its frame (cab and fenders). */
export type BodyRegion = 'body' | 'frame';

/** The tractor's bodywork (TractorDress.wrapBody() marks it, `userData.region`): what takes a colour or a pattern. */
export function isBodyMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
    return material instanceof THREE.MeshStandardMaterial && !!material.userData.region;
}

/** The region a palette colour (0..255) of the tractor's is: the gold swatches its body, the mid blue-grey ones its frame. */
export function regionOf(r: number, g: number, b: number): BodyRegion | undefined {
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const saturation = max ? (max - Math.min(r, g, b)) / max : 0;
    if (luma > 88 && luma < 215 && saturation < 0.35) return 'frame';
    // (Gold: red over green over blue, vivid.)
    return saturation > 0.6 && r > g && g > b * 1.6 && g > r * 0.6 && luma > 90 ? 'body' : undefined;
}

/** Paints the body materials of `object` (isBodyMaterial()) `paint`: a colour, or 'grey'. Returns whether any were. */
export function paintBody(object: THREE.Object3D, paint: string): boolean {
    let painted = false;
    object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        child.material = materials.map((material: THREE.Material) => {
            if (!isBodyMaterial(material)) return material;
            painted = true;
            const copy = material.clone();
            if (paint === 'grey') copy.color.setRGB(0.55, 0.55, 0.55);
            else copy.color.set(paint);
            return copy;
        });
        if (child.material.length === 1) child.material = child.material[0];
    });
    return painted;
}

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
