// Water.ts
//
// The sea round the island: a cartoon surface whose colour snaps into three tiers of slowly drifting blobs, bent with
// the world.

import * as THREE from 'three';
import { beamLight, beamLightGlsl } from '../services/BeamLight';
import { bendUniforms } from '../services/Bend';

/** Pieces per side: the plane is hundreds of units wide, and only its vertices bend. */
const SEGMENTS = 220;

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
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uBright;
varying vec2 vWorldXZ;
${beamLightGlsl}
void main() {
    float x = vWorldXZ.x * 2.5;
    float z = vWorldXZ.y * 2.5;
    float h = sin(x * 0.35 + time * 1.4) * 0.14 + sin(z * 0.28 + time) * 0.10 + sin((x - z) * 0.22 + time * 1.8) * 0.06;
    float blob = clamp((h + 0.3) / 0.6, 0.0, 1.0);
    vec3 color = blob < 0.35 ? uDeep : blob < 0.7 ? uMid : uBright;
    // The beam's light where it spills past the shore (its colour is linear; this shader writes straight to the screen).
    color = mix(color, pow(uBeamColor, vec3(0.4545)), beamLightAt(vec3(vWorldXZ.x, 0.0, vWorldXZ.y)));
    gl_FragColor = vec4(color, 1.0);
}
`;

/** The hex as written on screen (a ShaderMaterial skips colour management). */
function tone(color: THREE.Color, shade: number): THREE.Vector3 {
    const hex = color.getHex(THREE.SRGBColorSpace);
    const channel = (c: number) => (shade >= 0 ? c + (255 - c) * shade : c * (1 + shade)) / 255;
    return new THREE.Vector3(channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255));
}

export function createWater(color: string, width: number, depth: number): THREE.Mesh {
    const base = new THREE.Color(color);
    const material = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, uDeep: { value: tone(base, -0.12) }, uMid: { value: tone(base, 0) }, uBright: { value: tone(base, 0.12) }, uBendOrigin: bendUniforms.uBendOrigin, uBendStrength: bendUniforms.uBendStrength, ...beamLight },
        vertexShader,
        fragmentShader,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2), material);
    mesh.onBeforeRender = () => {
        material.uniforms.time.value = performance.now() / 1000;
    };
    return mesh;
}
