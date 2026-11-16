// Water.ts
//
// Water in the town: a lawn marked `water` (a pond, a lake, a river: drawn in the editor's 🌊 Water) — the UFO game's
// sea (its Water.ts), turned inward: bright by the edge, darkening to a deep blue toward the middle, slow wave lines
// drifting over it and a band of foam lapping at the edge. How far each spot is from the edge is worked out once, into
// a small texture. Bent with the world (the restaurant's bend: core BendService's uniforms).

import * as THREE from 'three';
import { BendService } from 'core/services/BendService';
import { subdivideOwn } from 'core/town/Subdivide';

/** The edge-distance texture's size; how far in (x the water's smaller side) it's as deep as it gets. */
const DISTANCE_SIZE = 128;
const DEEP_SHARE = 0.32;
export const WATER_COLOR = '#2f9df0';

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
uniform sampler2D uEdgeDistance;
uniform vec2 uAreaMin;
uniform vec2 uAreaSize;
varying vec2 vWorldXZ;
void main() {
    // How far in: 0 at the edge, 1 at its deepest.
    float in_ = texture2D(uEdgeDistance, (vWorldXZ - uAreaMin) / uAreaSize).r;
    vec3 color = mix(uShallow, uMid, smoothstep(0.0, 0.28, in_));
    color = mix(color, uDeep, smoothstep(0.2, 1.0, in_));

    // Wave lines: thin contours of a slowly drifting field.
    vec2 p = vWorldXZ * 0.12;
    float field = sin(p.x * 1.7 + sin(p.y * 1.3 + time * 0.13) * 1.6 + time * 0.09)
        + sin(p.y * 2.1 + sin(p.x * 1.1 - time * 0.11) * 1.8 - time * 0.07);
    float lines = 1.0 - smoothstep(0.0, 0.05, abs(fract(field * 1.6) - 0.5));
    color += lines * 0.055 * (1.0 - in_ * 0.6);

    // Foam at the edge, coming and going.
    float lap = 0.05 + 0.025 * sin(time * 0.9 + vWorldXZ.x * 0.3 + vWorldXZ.y * 0.25);
    color = mix(color, vec3(0.92, 0.98, 1.0), (1.0 - smoothstep(lap * 0.5, lap, in_)) * 0.75);
    gl_FragColor = vec4(color, 1.0);
}
`;

/** The colour as written on screen (a ShaderMaterial skips colour management), times `r`, `g`, `b`. */
function tone(color: THREE.Color, r: number, g: number, b: number): THREE.Vector3 {
    const hex = color.getHex(THREE.SRGBColorSpace);
    return new THREE.Vector3((((hex >> 16) & 255) / 255) * r, (((hex >> 8) & 255) / 255) * g, ((hex & 255) / 255) * b);
}

/** Over the water's bounds: each texel's distance from the nearest edge, as a share of `deepAt`. */
function edgeDistanceTexture(points: readonly { x: number; z: number }[], minX: number, minZ: number, width: number, depth: number, deepAt: number): THREE.DataTexture {
    const data = new Uint8Array(DISTANCE_SIZE * DISTANCE_SIZE);
    for (let r = 0; r < DISTANCE_SIZE; r++) {
        const z = minZ + ((r + 0.5) / DISTANCE_SIZE) * depth;
        for (let c = 0; c < DISTANCE_SIZE; c++) {
            const x = minX + ((c + 0.5) / DISTANCE_SIZE) * width;
            let best = Infinity;
            for (let i = 0; i < points.length; i++) {
                const a = points[i];
                const b = points[(i + 1) % points.length];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
                best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
            }
            data[r * DISTANCE_SIZE + c] = Math.round(Math.min(1, best / deepAt) * 255);
        }
    }
    const texture = new THREE.DataTexture(data, DISTANCE_SIZE, DISTANCE_SIZE, THREE.RedFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

/** A water area: its outline filled with water at height `y` (cut small enough to bend). Null for fewer than 3 corners. */
export function buildWater(points: readonly { x: number; z: number }[], color: string | undefined, y: number): THREE.Mesh | null {
    if (points.length < 3) return null;
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const width = Math.max(0.1, Math.max(...xs) - minX);
    const depth = Math.max(0.1, Math.max(...zs) - minZ);
    const distance = edgeDistanceTexture(points, minX, minZ, width, depth, Math.max(2, Math.min(width, depth) * DEEP_SHARE));
    const base = new THREE.Color(color ?? WATER_COLOR);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            uShallow: { value: tone(base, 0.95, 1.22, 1.12) },
            uMid: { value: tone(base, 0.32, 0.72, 1.12) },
            uDeep: { value: tone(base, 0.1, 0.24, 0.62) },
            uEdgeDistance: { value: distance },
            uAreaMin: { value: new THREE.Vector2(minX, minZ) },
            uAreaSize: { value: new THREE.Vector2(width, depth) },
            uBendOrigin: BendService.uniforms.uBendOrigin,
            uBendStrength: BendService.uniforms.uBendStrength,
        },
        vertexShader,
        fragmentShader,
    });
    // Drawn in x / y, then laid flat (its y becomes -z), as a lawn is.
    const geometry = new THREE.ShapeGeometry(new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z))));
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    subdivideOwn(mesh);
    mesh.onBeforeRender = () => {
        material.uniforms.time.value = performance.now() / 1000;
    };
    mesh.userData.free = () => distance.dispose();
    return mesh;
}
