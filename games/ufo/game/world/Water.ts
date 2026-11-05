// Water.ts
//
// The sea round the island: bright by the shore, darkening to a deep blue the further out you go, with slow wave lines
// drifting over it and a band of foam lapping at the land. How far each spot is from the shore is worked out once, into a
// small texture. Bent with the world.

import * as THREE from 'three';
import { beamLight, beamLightGlsl } from '../services/BeamLight';
import { bendUniforms } from '../services/Bend';
import type { Point } from '../data/UfoConfig';

/** Pieces per side: the plane is hundreds of units wide, and only its vertices bend. */
const SEGMENTS = 220;
/** The shore-distance texture's size, and how far out (units) the water's as dark as it gets. */
const DISTANCE_SIZE = 128;
const DEEP_AT = 130;

const vertexShader = `
uniform vec3 uBendOrigin;
uniform float uBendStrength;
varying vec2 vWorldXZ;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    vec2 away = world.xz - uBendOrigin.xz;
    world.y -= dot(away, away) * uBendStrength;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = `
uniform float time;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform sampler2D uShoreDistance;
uniform vec2 uAreaMin;
uniform vec2 uAreaSize;
uniform float uDeepAt;
varying vec2 vWorldXZ;
${beamLightGlsl}
void main() {
    // How far out: 0 at the shore, 1 at uDeepAt and beyond.
    float out_ = texture2D(uShoreDistance, (vWorldXZ - uAreaMin) / uAreaSize).r;
    vec3 color = mix(uShallow, uMid, smoothstep(0.0, 0.28, out_));
    color = mix(color, uDeep, smoothstep(0.2, 1.0, out_));

    // Wave lines: thin contours of a slowly drifting field.
    vec2 p = vWorldXZ * 0.075;
    float field = sin(p.x * 1.7 + sin(p.y * 1.3 + time * 0.13) * 1.6 + time * 0.09)
        + sin(p.y * 2.1 + sin(p.x * 1.1 - time * 0.11) * 1.8 - time * 0.07);
    float lines = 1.0 - smoothstep(0.0, 0.05, abs(fract(field * 1.6) - 0.5));
    color += lines * 0.055 * (1.0 - out_ * 0.6);

    // Foam at the shore, coming and going.
    float lap = 0.012 + 0.006 * sin(time * 0.9 + vWorldXZ.x * 0.14 + vWorldXZ.y * 0.11);
    color = mix(color, vec3(0.92, 0.98, 1.0), (1.0 - smoothstep(lap * 0.5, lap, out_)) * 0.75);

    // The beam's light where it spills past the shore (its colour is linear; this shader writes straight to the screen).
    color = mix(color, pow(uBeamColor, vec3(0.4545)), beamLightAt(vec3(vWorldXZ.x, 0.0, vWorldXZ.y)));
    gl_FragColor = vec4(color, 1.0);
}
`;

/** The colour as written on screen (a ShaderMaterial skips colour management), times `shade`. */
function tone(color: THREE.Color, r: number, g: number, b: number): THREE.Vector3 {
    const hex = color.getHex(THREE.SRGBColorSpace);
    return new THREE.Vector3((((hex >> 16) & 255) / 255) * r, (((hex >> 8) & 255) / 255) * g, ((hex & 255) / 255) * b);
}

/** Over the sea's area: each texel's distance from the shore, as a share of DEEP_AT. */
function shoreDistanceTexture(shore: readonly Point[], minX: number, minZ: number, width: number, depth: number): THREE.DataTexture {
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

/** `centreX`, `centreZ`: where the plane will be put. */
export function createWater(color: string, width: number, depth: number, shore: readonly Point[], centreX: number, centreZ: number): THREE.Mesh {
    const base = new THREE.Color(color);
    const minX = centreX - width / 2;
    const minZ = centreZ - depth / 2;
    const distance = shoreDistanceTexture(shore, minX, minZ, width, depth);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            uShallow: { value: tone(base, 0.95, 1.22, 1.12) },
            uMid: { value: tone(base, 0.32, 0.72, 1.12) },
            uDeep: { value: tone(base, 0.1, 0.24, 0.62) },
            uShoreDistance: { value: distance },
            uAreaMin: { value: new THREE.Vector2(minX, minZ) },
            uAreaSize: { value: new THREE.Vector2(width, depth) },
            uDeepAt: { value: DEEP_AT },
            uBendOrigin: bendUniforms.uBendOrigin,
            uBendStrength: bendUniforms.uBendStrength,
            ...beamLight,
        },
        vertexShader,
        fragmentShader,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2), material);
    mesh.onBeforeRender = () => {
        material.uniforms.time.value = performance.now() / 1000;
    };
    mesh.userData.free = () => distance.dispose();
    return mesh;
}
