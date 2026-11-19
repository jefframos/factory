// SeaWater.ts
//
// The sea round the island, the UFO game's (games/ufo/game/world/Water.ts): bright by the shore, darkening to a deep
// blue the further out, with slow wave lines drifting over it and a band of foam lapping at the land. How far each spot
// is from the shore is worked out once, into a small texture. Bent with the world (BendService's uniforms).

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import type { ShorePoint } from '../world/Shore';

/** The shore-distance texture's size, and how far out (units) the water's as dark as it gets. */
const DISTANCE_SIZE = 128;
const DEEP_AT = 110;

const vertexShader = /* glsl */ `
uniform vec3 uBendOrigin;
uniform float uBendStrength;
uniform float uLevel;
varying vec2 vWorldXZ;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += uLevel;
    vWorldXZ = world.xz;
    vec2 away = world.xz - uBendOrigin.xz;
    world.y -= dot(away, away) * uBendStrength;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
uniform float time;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uLines;
uniform sampler2D uShoreDistance;
uniform vec2 uAreaMin;
uniform vec2 uAreaSize;
varying vec2 vWorldXZ;
void main() {
    // How far out: 0 at the shore, 1 at DEEP_AT and beyond.
    float out_ = texture2D(uShoreDistance, (vWorldXZ - uAreaMin) / uAreaSize).r;
    vec3 color = mix(uShallow, uMid, smoothstep(0.0, 0.28, out_));
    color = mix(color, uDeep, smoothstep(0.2, 1.0, out_));

    // Wave lines: thin contours of a slowly drifting field.
    vec2 p = vWorldXZ * 0.075;
    float field = sin(p.x * 1.7 + sin(p.y * 1.3 + time * 0.13) * 1.6 + time * 0.09)
        + sin(p.y * 2.1 + sin(p.x * 1.1 - time * 0.11) * 1.8 - time * 0.07);
    float lines = 1.0 - smoothstep(0.0, 0.05, abs(fract(field * 1.6) - 0.5));
    color += lines * uLines * (1.0 - out_ * 0.6);

    // Foam at the shore, coming and going.
    float lap = 0.014 + 0.007 * sin(time * 0.9 + vWorldXZ.x * 0.14 + vWorldXZ.y * 0.11);
    color = mix(color, uFoam, (1.0 - smoothstep(lap * 0.5, lap, out_)) * 0.75);
    gl_FragColor = vec4(color, 1.0);
}
`;

/** The colour as written on screen (a ShaderMaterial skips colour management), times a shade per channel. */
function tone(color: THREE.Color, r: number, g: number, b: number): THREE.Vector3 {
    const hex = color.getHex(THREE.SRGBColorSpace);
    return new THREE.Vector3((((hex >> 16) & 255) / 255) * r, (((hex >> 8) & 255) / 255) * g, ((hex & 255) / 255) * b);
}

/** Over the sea's area: each texel's distance from the shore, as a share of DEEP_AT. */
function shoreDistanceTexture(shore: readonly ShorePoint[], minX: number, minZ: number, width: number, depth: number): THREE.DataTexture {
    const data = new Uint8Array(DISTANCE_SIZE * DISTANCE_SIZE);
    for (let r = 0; r < DISTANCE_SIZE; r++) {
        const z = minZ + ((r + 0.5) / DISTANCE_SIZE) * depth;
        for (let c = 0; c < DISTANCE_SIZE; c++) {
            const x = minX + ((c + 0.5) / DISTANCE_SIZE) * width;
            let best = Infinity;
            for (let i = 0; i < shore.length; i++) {
                const a = shore[i];
                const b = shore[(i + 1) % shore.length];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
                best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
            }
            data[r * DISTANCE_SIZE + c] = Math.round(Math.min(1, best / DEEP_AT) * 255);
        }
    }
    const texture = new THREE.DataTexture(data, DISTANCE_SIZE, DISTANCE_SIZE, THREE.RedFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

/**
 * The sea: a plane `width` x `depth` round (centreX, centreZ) at `level` (negative: below the ground), in `color`
 * (the island's `water`), its shading by the distance from `shore`.
 */
export function createSeaWater(color: string, width: number, depth: number, shore: readonly ShorePoint[], centreX: number, centreZ: number, level: number): THREE.Mesh {
    const base = new THREE.Color(color);
    const minX = centreX - width / 2;
    const minZ = centreZ - depth / 2;
    const distance = shoreDistanceTexture(shore, minX, minZ, width, depth);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            uLevel: { value: level },
            uShallow: { value: tone(base, 0.95, 1.22, 1.12) },
            uMid: { value: tone(base, 0.32, 0.72, 1.12) },
            uDeep: { value: tone(base, 0.1, 0.24, 0.62) },
            uFoam: { value: new THREE.Vector3(0.92, 0.98, 1.0) },
            uLines: { value: 0.055 },
            uShoreDistance: { value: distance },
            uAreaMin: { value: new THREE.Vector2(minX, minZ) },
            uAreaSize: { value: new THREE.Vector2(width, depth) },
            uBendOrigin: BendService.uniforms.uBendOrigin,
            uBendStrength: BendService.uniforms.uBendStrength,
        },
        vertexShader,
        fragmentShader,
    });
    const geometry = new THREE.PlaneGeometry(width, depth, BendService.segmentsForSpan(width), BendService.segmentsForSpan(depth));
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centreX, 0, centreZ);
    mesh.onBeforeRender = () => {
        material.uniforms.time.value = performance.now() / 1000;
    };
    mesh.userData.free = () => distance.dispose();
    return mesh;
}
