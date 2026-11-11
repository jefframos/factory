// Water.ts
//
// The sea round the battlefield (UFO's water, without its tractor-beam light): bright by the shore, darkening to a deep
// blue further out, with slow wave lines drifting over it and a band of foam lapping at the land. How far each spot is
// from the shore is worked out once, into a small texture. Bent with the world.

import * as THREE from 'three';
import { bendUniforms } from './Bend';

/** Pieces per side: the plane is a hundred-odd units wide, and only its vertices bend. */
const SEGMENTS = 160;
/** Ground (createGround): its colour's shade by the field, part way out and far off; its pattern's strength; the moment
 *  its (still) pattern is drawn at; how far out it's as dark as it gets. */
const GROUND = { near: 1.06, mid: 0.9, far: 0.66, lines: 0.035, moment: 37, deepAt: 70 };
/** The shore-distance texture's size, and how far out (units) the water's as dark as it gets. */
const DISTANCE_SIZE = 128;
const DEEP_AT = 45;

/** A smaller patch of water (a hole in the field): deep sooner, a round mesh for a round hole, set a little higher. */
export interface WaterOptions {
    deepAt?: number;
    /** How fine the ripple lines are (1: the battle's; more: smaller, for a smaller world like the main screen's map). */
    pattern?: number;
    round?: boolean;
    /** A polygon hole: the mesh is the outline itself (`shore`), not a box or a circle. */
    polygon?: boolean;
    y?: number;
    segments?: number;
    /** Land, not water (createGround): still (no drift, no foam), its colour shaded light by the field to dark far off. */
    ground?: boolean;
}

export interface Point { x: number; z: number }

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
uniform float uPattern;
uniform float uFoam;
uniform float uLines;
varying vec2 vWorldXZ;
void main() {
    // How far out: 0 at the shore, 1 at deepAt and beyond.
    float out_ = texture2D(uShoreDistance, (vWorldXZ - uAreaMin) / uAreaSize).r;
    vec3 color = mix(uShallow, uMid, smoothstep(0.0, 0.28, out_));
    color = mix(color, uDeep, smoothstep(0.2, 1.0, out_));

    // Wave lines: thin contours of a slowly drifting field.
    vec2 p = vWorldXZ * 0.11 * uPattern;
    float field = sin(p.x * 1.7 + sin(p.y * 1.3 + time * 0.13) * 1.6 + time * 0.09)
        + sin(p.y * 2.1 + sin(p.x * 1.1 - time * 0.11) * 1.8 - time * 0.07);
    float lines = 1.0 - smoothstep(0.0, 0.05, abs(fract(field * 1.6) - 0.5));
    color += lines * uLines * (1.0 - out_ * 0.6);

    // Foam at the shore, coming and going.
    float lap = 0.03 + 0.012 * sin(time * 0.9 + vWorldXZ.x * 0.3 + vWorldXZ.y * 0.25);
    color = mix(color, vec3(0.92, 0.98, 1.0), (1.0 - smoothstep(lap * 0.5, lap, out_)) * 0.8 * uFoam);
    gl_FragColor = vec4(color, 1.0);
}
`;

/** The colour as written on screen (a ShaderMaterial skips colour management), times a shade per channel. */
function tone(color: THREE.Color, r: number, g: number, b: number): THREE.Vector3 {
    const hex = color.getHex(THREE.SRGBColorSpace);
    return new THREE.Vector3((((hex >> 16) & 255) / 255) * r, (((hex >> 8) & 255) / 255) * g, ((hex & 255) / 255) * b);
}

/** Over the sea's area: each texel's distance from the shore (a closed outline), as a share of DEEP_AT. */
function shoreDistanceTexture(shore: readonly Point[], minX: number, minZ: number, width: number, depth: number, deepAt: number): THREE.DataTexture {
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
            data[r * DISTANCE_SIZE + c] = Math.round(Math.min(1, best / deepAt) * 255);
        }
    }
    const texture = new THREE.DataTexture(data, DISTANCE_SIZE, DISTANCE_SIZE, THREE.RedFormat);
    texture.magFilter = texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

/** A sea `width` x `depth`, centred on (`centreX`, `centreZ`), round the land outlined by `shore` (or, for a hole, inside it). */
export function createWater(color: string | number, width: number, depth: number, shore: readonly Point[], centreX: number, centreZ: number, options: WaterOptions = {}): THREE.Mesh {
    const base = new THREE.Color(color);
    const minX = centreX - width / 2;
    const minZ = centreZ - depth / 2;
    const distance = shoreDistanceTexture(shore, minX, minZ, width, depth, options.deepAt ?? DEEP_AT);
    const ground = !!options.ground;
    const material = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            // Water: pale by the shore, deep blue far out. Ground: its own colour, a little lighter by the field, darker off.
            uShallow: { value: ground ? tone(base, GROUND.near, GROUND.near, GROUND.near) : tone(base, 0.95, 1.22, 1.12) },
            uMid: { value: ground ? tone(base, GROUND.mid, GROUND.mid, GROUND.mid) : tone(base, 0.32, 0.72, 1.12) },
            uDeep: { value: ground ? tone(base, GROUND.far, GROUND.far, GROUND.far) : tone(base, 0.1, 0.24, 0.62) },
            uFoam: { value: ground ? 0 : 1 },
            uLines: { value: ground ? GROUND.lines : 0.06 },
            uShoreDistance: { value: distance },
            uAreaMin: { value: new THREE.Vector2(minX, minZ) },
            uAreaSize: { value: new THREE.Vector2(width, depth) },
            uPattern: { value: options.pattern ?? 1 },
            uBendOrigin: bendUniforms.uBendOrigin,
            uBendStrength: bendUniforms.uBendStrength,
        },
        vertexShader,
        fragmentShader,
    });
    const segments = options.segments ?? SEGMENTS;
    const geometry = options.polygon
        ? polygonGeometry(shore, centreX, centreZ)
        : options.round
        ? new THREE.CircleGeometry(width / 2, Math.max(24, segments * 2), 0, Math.PI * 2).rotateX(-Math.PI / 2)
        : new THREE.PlaneGeometry(width, depth, segments, segments).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(centreX, options.y ?? -0.05, centreZ);
    // (Ground stays still: its pattern drawn at one moment.)
    if (!ground) {
        mesh.onBeforeRender = () => {
            material.uniforms.time.value = performance.now() / 1000;
        };
    } else material.uniforms.time.value = GROUND.moment;
    mesh.userData.free = () => distance.dispose();
    return mesh;
}

/** A flat mesh filling an outline (points in world X/Z), centred on (cx, cz) like the other water meshes. */
function polygonGeometry(outline: readonly Point[], cx: number, cz: number): THREE.BufferGeometry {
    // Drawn in x / y, then laid flat: y becomes -z.
    const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x - cx, -(p.z - cz))));
    return new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
}

/** Land round a field in `color` (a valley's ground: desert, grass, ice): the water's shading and pattern, still, no foam
 *  — light by the `edge` outline, darker further off. */
export function createGround(color: string | number, width: number, depth: number, edge: readonly Point[], centreX: number, centreZ: number, y = -0.01, segments = SEGMENTS): THREE.Mesh {
    return createWater(color, width, depth, edge, centreX, centreZ, { ground: true, deepAt: GROUND.deepAt, y, segments });
}
