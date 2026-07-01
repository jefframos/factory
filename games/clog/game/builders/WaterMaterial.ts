import * as THREE from 'three';
import { BendService } from '../services/BendService';

export interface WaterColors {
    deep: number;
    mid: number;
    bright: number;
    foam: number;
}

const vertexShader = `
uniform vec3  uBendOrigin;
uniform float uBendStrength;
uniform float uElevation;
uniform float time;

varying vec2 vWorldXZ;

void main() {
    vec3 pos = position;
    pos.y += uElevation;

    // World XZ anchors the fragment blob pattern to the world grid so it
    // stays still as the floor mesh follows the player.
    vec4 wbase = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
    float wx = wbase.x;
    float wz = wbase.z;
    vWorldXZ = vec2(wx, wz);

    // Geometry-only waves — purely for the surface ripple displacement.
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
uniform float uBlobScale; // 1 = default size  >1 = finer blobs  <1 = coarser blobs
uniform vec3  uColorDeep;
uniform vec3  uColorMid;
uniform vec3  uColorBright;
uniform vec3  uColorFoam;

varying vec2 vWorldXZ;

void main() {
    // Blob noise — three overlapping sine waves in world space.
    // uBlobScale multiplies spatial frequency: tweak it to resize the blobs.
    float bx = vWorldXZ.x * uBlobScale;
    float bz = vWorldXZ.y * uBlobScale;

    float n1 = sin(bx * 0.35 + time * 1.40) * 0.14;
    float n2 = sin(bz * 0.28 + time * 1.00) * 0.10;
    float n3 = sin((bx - bz) * 0.22 + time * 1.80) * 0.06;
    float blobH = clamp((n1 + n2 + n3 + 0.30) / 0.60, 0.0, 1.0);

    // Snap into 3 discrete tiers for a cartoony cel-shaded look.
    float tier = step(0.35, blobH) + step(0.70, blobH);
    vec3 color = uColorDeep;
    color = mix(color, uColorMid,    step(1.0, tier));
    color = mix(color, uColorBright, step(2.0, tier));

    gl_FragColor = vec4(color, opacity);
}
`;

// Raw sRGB helper — bypasses THREE.js ColorManagement linearization so the hex
// values you write here are exactly what the shader receives and the monitor shows.
const srgb = (hex: number) => new THREE.Vector3(
    ((hex >> 16) & 0xff) / 255,
    ((hex >> 8) & 0xff) / 255,
    (hex & 0xff) / 255,
);

export function createWaterMaterial(
    opacity: number,
    elevation: number,
    colors: WaterColors,
    blobScale = 2.5,  // 1 = default  >1 = finer blobs  <1 = coarser blobs
): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            opacity: { value: opacity },
            uElevation: { value: elevation },
            uBlobScale: { value: blobScale },
            uColorDeep: { value: srgb(colors.deep) },
            uColorMid: { value: srgb(colors.mid) },
            uColorBright: { value: srgb(colors.bright) },
            uColorFoam: { value: srgb(colors.foam) },
            uBendOrigin: BendService.uniforms.uBendOrigin,
            uBendStrength: BendService.uniforms.uBendStrength,
        },
        vertexShader,
        fragmentShader,
        transparent: opacity < 1,
    });
}
