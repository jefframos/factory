// WaterMaterial.ts
//
// The pizza game's cartoon water (games/pizza/game/builders/WaterMaterial.ts): a rippling surface whose colour snaps
// into three tiers of world-anchored blobs, bent with the world like everything else. Used for the sea around the
// town's island (Town.buildIsland()).

import * as THREE from 'three';
import { BendService } from '../services/BendService';

const vertexShader = `
uniform vec3  uBendOrigin;
uniform float uBendStrength;
uniform float uElevation;
uniform float time;

varying vec2 vWorldXZ;

void main() {
    vec3 pos = position;
    pos.y += uElevation;

    vec4 wbase = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
    float wx = wbase.x;
    float wz = wbase.z;
    vWorldXZ = vec2(wx, wz);

    pos.y += sin(wx * 0.35 + time * 1.40) * 0.14
           + sin(wz * 0.28 + time * 1.00) * 0.10
           + sin((wx - wz) * 0.22 + time * 1.80) * 0.06;

    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    float dx = worldPos.x - uBendOrigin.x;
    float dz = worldPos.z - uBendOrigin.z;
    worldPos.y -= (dx * dx + dz * dz) * uBendStrength;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = `
uniform float time;
uniform float opacity;
uniform float uBlobScale;
uniform vec3  uColorDeep;
uniform vec3  uColorMid;
uniform vec3  uColorBright;

varying vec2 vWorldXZ;

void main() {
    float bx = vWorldXZ.x * uBlobScale;
    float bz = vWorldXZ.y * uBlobScale;

    float n1 = sin(bx * 0.35 + time * 1.40) * 0.14;
    float n2 = sin(bz * 0.28 + time * 1.00) * 0.10;
    float n3 = sin((bx - bz) * 0.22 + time * 1.80) * 0.06;
    float blobH = clamp((n1 + n2 + n3 + 0.30) / 0.60, 0.0, 1.0);

    float tier = step(0.35, blobH) + step(0.70, blobH);
    vec3 color = uColorDeep;
    color = mix(color, uColorMid,    step(1.0, tier));
    color = mix(color, uColorBright, step(2.0, tier));

    gl_FragColor = vec4(color, opacity);
}
`;

/** Raw sRGB (no colour-management linearisation): the hex written is what shows. */
const srgb = (hex: number) => new THREE.Vector3(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);

/** Lightens (t > 0) or darkens (t < 0) a colour. */
function shade(color: number, t: number): number {
    const mix = (c: number) => Math.max(0, Math.min(255, Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t))));
    return (mix((color >> 16) & 0xff) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff);
}

/** The water for one base colour (its three tones derived like pizza's), `elevation` below / above the plane. */
export function createWaterMaterial(baseColor: string, elevation: number, opacity = 1, blobScale = 2.5): THREE.ShaderMaterial {
    const base = new THREE.Color(baseColor).getHex(THREE.SRGBColorSpace);
    return new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            opacity: { value: opacity },
            uElevation: { value: elevation },
            uBlobScale: { value: blobScale },
            uColorDeep: { value: srgb(shade(base, -0.12)) },
            uColorMid: { value: srgb(base) },
            uColorBright: { value: srgb(shade(base, 0.12)) },
            uBendOrigin: BendService.uniforms.uBendOrigin,
            uBendStrength: BendService.uniforms.uBendStrength,
        },
        vertexShader,
        fragmentShader,
        transparent: opacity < 1,
    });
}
