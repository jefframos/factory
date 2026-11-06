// Vivid.ts
//
// The picture's colours, a bit more vivid on screen than in the level file: the lights' warmth and the jelly's sheen
// wash colours out, so the blocks, the tiles and the ants are drawn this much more saturated (THREE's HSL).

import * as THREE from 'three';

/** How much more saturated (x the colour's own saturation, capped at full). */
const SATURATION = 1.25;

const hsl = { h: 0, s: 0, l: 0 };

/** `hex` (a level palette colour), more vivid. Into `out` if given. */
export function vivid(hex: string | number, out = new THREE.Color()): THREE.Color {
    out.set(hex).getHSL(hsl);
    return out.setHSL(hsl.h, Math.min(1, hsl.s * SATURATION), hsl.l);
}
