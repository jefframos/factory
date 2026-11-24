// GrassBlades.ts
//
// The grass's look: each grass cell is one instance of a clump of real blades (clumpGeometry(): curved, tapering to a
// point, each its own height, lean and shade, dark at the root and bright at the tip), and one material for them all
// (bladeMaterial()) whose vertex shader moves the blades:
//   - wind: a slow wave rolling across the field plus gusts (a drifting noise) that push harder and light the tips up
//     as they pass, and a small flutter so nothing is ever quite still;
//   - push: the player and the mower part the grass round them (setPushers()), so walking into a lawn reads.
// Only the upper part of a blade moves (by its height squared), and a blade bent far sinks a little so it doesn't
// stretch. The displacement is worked out in world space and turned back into the instance's own frame (its rotation
// and scale come from its instance matrix), so the world bend (BendService) still applies after it.
// Lighting: every blade is lit as the ground under it (straight up: UP_LIGHT, so it's an unlit material), both faces the
// same, so the blades match the lawn and read through their colour gradient rather than noisy per-blade shading.
//
// Cheap to draw: two clumps, a full one near the player and a lighter one further away (GrassField picks per chunk); on
// low quality (phones) both have fewer, wider blades with fewer segments, and plainer gusts.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { ColorGrade } from 'core/scene/ColorGrade';
import { QUALITY } from '../config/Quality';
import { UP_LIGHT } from './TownLight';

export interface ClumpLook {
    /** Blades in a clump, and segments per blade (the last ends in a point). */
    blades: number;
    segments: number;
    /** Their width, times the usual (fewer blades cover as much). */
    wide?: number;
}

/** Near the player: full blades. Far: fewer, plainer ones (mostly off screen anyway). */
export const NEAR_CLUMP: ClumpLook = QUALITY.low ? { blades: 6, segments: 2, wide: 1.35 } : { blades: 9, segments: 4 };
export const FAR_CLUMP: ClumpLook = QUALITY.low ? { blades: 4, segments: 1, wide: 1.6 } : { blades: 5, segments: 2 };

/** Root and tip brightness (times the grass type's colour, per instance). */
const ROOT_SHADE = 0.4;
const TIP_SHADE = 1.18;

/** Seeded random in [0, 1). */
function seeded(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

/**
 * A clump of blades in a unit space: roots inside a disc of radius ~0.45 round the origin, at most 1 tall. Each blade
 * is a strip narrowing to its tip, bowed forward (its lean grows with the height squared). Vertex colours carry the root-to-tip gradient and each blade's own shade.
 */
export function clumpGeometry(look: ClumpLook, seed = 7): THREE.BufferGeometry {
    const random = seeded(seed);
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const { blades, segments } = look;
    for (let b = 0; b < blades; b++) {
        // Spread round the disc (golden angle), the tallest towards the middle.
        const ring = Math.sqrt((b + 0.5) / blades) * 0.42;
        const around = b * 2.39996 + random() * 0.6;
        const rootX = Math.cos(around) * ring;
        const rootZ = Math.sin(around) * ring;
        const height = 0.62 + random() * 0.38 - ring * 0.25;
        const width = (0.09 + random() * 0.06) * (look.wide ?? 1);
        const facing = random() * Math.PI * 2;
        // Across the blade (its width) and the way it bows (its face's normal).
        const sideX = Math.cos(facing);
        const sideZ = Math.sin(facing);
        const bowX = -sideZ;
        const bowZ = sideX;
        const bow = (random() - 0.35) * 0.45;
        const shade = 0.86 + random() * 0.26;
        const base = positions.length / 3;
        for (let k = 0; k <= segments; k++) {
            const t = k / segments;
            const y = height * t;
            const curve = bow * t * t;
            const cx = rootX + bowX * curve;
            const cz = rootZ + bowZ * curve;
            const light = (ROOT_SHADE + (TIP_SHADE - ROOT_SHADE) * Math.pow(t, 0.8)) * shade;
            if (k === segments) {
                positions.push(cx, y, cz);
                colors.push(light, light, light);
                break;
            }
            const half = (width / 2) * Math.pow(1 - t, 0.85);
            positions.push(cx - sideX * half, y, cz - sideZ * half, cx + sideX * half, y, cz + sideZ * half);
            colors.push(light, light, light, light, light, light);
        }
        for (let k = 0; k < segments - 1; k++) {
            const a = base + k * 2;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
        const last = base + (segments - 1) * 2;
        indices.push(last, last + 1, last + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
}

/** The wind: direction on the ground (x, z) and strength (the share of a blade's height its tip moves). */
const WIND = { x: 0.86, z: -0.5, strength: 0.32 };

const uniforms = {
    uWind: { value: new THREE.Vector3(WIND.x, WIND.z, WIND.strength) },
    /** Up to two things parting the grass: (x, z, radius); radius 0 = none. */
    uPushA: { value: new THREE.Vector3(0, 0, 0) },
    uPushB: { value: new THREE.Vector3(0, 0, 0) },
};

/** Who parts the grass this frame: the player (feet) and the mower (its cutting point, its reach). */
export function setPushers(player: THREE.Vector3 | undefined, playerRadius: number, tool: THREE.Vector3 | undefined, toolRadius: number): void {
    uniforms.uPushA.value.set(player?.x ?? 0, player?.z ?? 0, player ? playerRadius : 0);
    uniforms.uPushB.value.set(tool?.x ?? 0, tool?.z ?? 0, tool ? toolRadius : 0);
}

const VERTEX_HEAD = /* glsl */ `
    uniform float uTime;
    uniform vec3 uWind;
    uniform vec3 uPushA;
    uniform vec3 uPushB;
    varying float vGust;
    float grassHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float grassNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(grassHash(i), grassHash(i + vec2(1.0, 0.0)), f.x),
                   mix(grassHash(i + vec2(0.0, 1.0)), grassHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    vec2 grassPush(vec2 root, vec3 pusher) {
        if (pusher.z <= 0.0) return vec2(0.0);
        vec2 away = root - pusher.xy;
        float near = 1.0 - smoothstep(pusher.z * 0.3, pusher.z, length(away));
        return normalize(away + vec2(1e-4)) * near * 1.1;
    }
`;

/** Low quality's gusts: crossing waves instead of noise. */
const GUST_PLAIN = '0.5 + 0.26 * sin(gRoot.x * 0.21 - uTime * 0.8) + 0.26 * sin(gRoot.z * 0.17 + gRoot.x * 0.06 + uTime * 0.55)';

const VERTEX_BODY = /* glsl */ `
    vGust = 0.0;
    #ifdef USE_INSTANCING
        vec3 gRoot = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
        vec2 gAcross = instanceMatrix[0].xz;
        vec2 gAlong = instanceMatrix[2].xz;
        float gHeight = length(instanceMatrix[1].xyz);
        float gH = clamp(position.y, 0.0, 1.0);
        vec2 gDir = uWind.xy;
        // A wave rolling across the field, gusts drifting with the wind, a flutter on top.
        float gWave = sin(dot(gRoot.xz, gDir) * 0.45 - uTime * 2.1) * 0.5 + 0.5;
        float gGust = smoothstep(0.3, 0.95, ${QUALITY.low ? GUST_PLAIN : 'grassNoise(gRoot.xz * 0.07 - gDir * uTime * 0.9)'});
        vec2 gSway = gDir * uWind.z * (0.3 + 0.7 * gGust) * (0.55 + 0.45 * gWave);
        gSway += vec2(sin(uTime * 3.1 + gRoot.x * 2.3 + gRoot.z), cos(uTime * 2.7 + gRoot.z * 2.1 - gRoot.x)) * 0.045;
        gSway += grassPush(gRoot.xz, uPushA) + grassPush(gRoot.xz, uPushB);
        float gLen = min(length(gSway), 1.2);
        gSway = normalize(gSway + vec2(1e-5)) * gLen;
        // In world units: the tip moves the most (height squared), as far as the blade is tall.
        vec2 gDisp = gSway * gH * gH * gHeight;
        transformed.x += dot(gDisp, gAcross) / max(dot(gAcross, gAcross), 1e-5);
        transformed.z += dot(gDisp, gAlong) / max(dot(gAlong, gAlong), 1e-5);
        // Bent over, it's lower (not longer).
        transformed.y *= 1.0 - 0.32 * gLen * gLen * gH;
        vGust = gGust * gH * uWind.z;
    #endif
`;

/** The blades' material: vertex-coloured, unlit (the instance colour is the grass type's), moved by the wind. */
export function bladeMaterial(): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    material.customProgramCacheKey = () => 'mow-grass-blades';
    material.onBeforeCompile = (shader) => {
        ColorGrade.apply(shader);
        shader.uniforms.uTime = BendService.uniforms.uTime;
        shader.uniforms.uWind = uniforms.uWind;
        shader.uniforms.uPushA = uniforms.uPushA;
        shader.uniforms.uPushB = uniforms.uPushB;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>\n${VERTEX_HEAD}`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vGust;')
            // A gust brightens the tips it passes (a sheen running over the field).
            .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = (diffuseColor.rgb + vec3(0.16, 0.2, 0.05) * vGust) * ${UP_LIGHT.toFixed(4)};`);
    };
    // The world bend after the wind (it rewrites the projection; the wind moved `transformed` before it).
    BendService.applyBend(material);
    return material;
}
