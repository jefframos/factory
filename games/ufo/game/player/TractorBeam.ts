// TractorBeam.ts
//
// The saucer's beam: a green cone from its belly to the ground, as wide there as what the saucer can eat, with a spiral
// winding down it and motes rising up it. The spiral turns faster and brighter on the move; sucking something up widens
// the cone and thickens the spiral, and the motes pour. Trying for something too big turns it all orange. It's blended
// normally, not added to what's behind it, so it keeps its colour over bright ground instead of going white. Both
// shaders bend with the world. Where it lands, a pool of the same light falls on whatever's there (BeamLight.ts).

import * as THREE from 'three';
import SetupThree from 'core/scene/SetupThree';
import { beamLight } from '../services/BeamLight';
import { bendUniforms } from '../services/Bend';

/** The cone's top, as a share of the saucer's radius. */
const CONE_TOP = 0.28;
const CONE_SEGMENTS = { round: 64, down: 14 };
/** How much wider it gets while sucking. */
const SUCK_WIDEN = 0.22;
/** The spiral's turns per second: at rest, added at full speed, added while sucking. */
const SPIN = { rest: 0.12, moving: 0.75, sucking: 1 };
/** How visible it all is: at rest, added at full speed, added while sucking. */
const STRENGTH = { rest: 0.4, moving: 0.3, sucking: 0.5 };
/** How strong the pool on the ground is: at rest, added at full speed, added while sucking. And its colours. */
const POOL = { rest: 0.8, moving: 0.15, sucking: 0.45 };
const POOL_GREEN = new THREE.Color(0x4df273);
const POOL_ORANGE = new THREE.Color(0xff9926);
/** How quickly it eases to moving and to sucking, and back. */
const EASE = { moving: 5, suckingUp: 12, suckingDown: 3, warningUp: 14, warningDown: 3 };

const MOTES = 60;
/** The share of the motes showing: at rest, added at full speed, added while sucking. */
const MOTE_SHARE = { rest: 0.15, moving: 0.2, sucking: 0.45 };
/** Rises per second (bottom to top): at rest, and added while sucking; their own speed varies this much. */
const MOTE_RISE = { rest: 0.22, sucking: 0.65, spread: 0.5 };
/** Their circling (radians per second) and their size (world units, at radius 1, growing slowly with the saucer). */
const MOTE_ORBIT = 1.8;
const MOTE_SIZE = 0.2;

const coneVertex = `
uniform vec3 uBendOrigin;
uniform float uBendStrength;
varying vec2 vUv;
void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 away = world.xz - uBendOrigin.xz;
    world.y -= dot(away, away) * uBendStrength;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const coneFragment = `
uniform float uPhase;
uniform float uStrength;
uniform float uSuck;
uniform float uWarn;
varying vec2 vUv;
void main() {
    // Two arms winding down the cone (u round it, v 0 at the ground, 1 at the saucer).
    float wave = fract(vUv.x * 2.0 + vUv.y * 2.4 - uPhase);
    float width = mix(0.16, 0.34, uSuck);
    float arm = 1.0 - smoothstep(0.0, width, abs(wave - 0.5));
    // A soft edge at both ends: no hard line on the ground.
    float ends = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
    float haze = mix(0.1, 0.2, uSuck);
    vec3 green = mix(vec3(0.1, 0.8, 0.3), vec3(0.3, 0.95, 0.45), arm);
    vec3 orange = mix(vec3(0.95, 0.42, 0.05), vec3(1.0, 0.6, 0.15), arm);
    gl_FragColor = vec4(mix(green, orange, uWarn), (haze + arm * 0.5) * ends * uStrength);
}
`;

const moteVertex = `
uniform vec3 uBendOrigin;
uniform float uBendStrength;
uniform float uPixelHeight;
attribute float aAlpha;
attribute float aSize;
varying float vAlpha;
void main() {
    vAlpha = aAlpha;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 away = world.xz - uBendOrigin.xz;
    world.y -= dot(away, away) * uBendStrength;
    vec4 view = viewMatrix * world;
    gl_Position = projectionMatrix * view;
    gl_PointSize = aSize * projectionMatrix[1][1] * uPixelHeight * 0.5 / -view.z;
}
`;

const moteFragment = `
uniform float uWarn;
varying float vAlpha;
void main() {
    float glow = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
    vec3 green = mix(vec3(0.15, 0.85, 0.35), vec3(0.45, 1.0, 0.55), glow);
    vec3 orange = mix(vec3(0.95, 0.45, 0.05), vec3(1.0, 0.7, 0.25), glow);
    gl_FragColor = vec4(mix(green, orange, uWarn), glow * vAlpha);
}
`;

interface Mote {
    /** Round the cone (radians), up it (0..1), and how far out from its middle (0..1). */
    angle: number;
    height: number;
    out: number;
    rise: number;
    size: number;
}

export class TractorBeam {
    private readonly coneMaterial = new THREE.ShaderMaterial({
        uniforms: { uPhase: { value: 0 }, uStrength: { value: STRENGTH.rest }, uSuck: { value: 0 }, uWarn: { value: 0 }, uBendOrigin: bendUniforms.uBendOrigin, uBendStrength: bendUniforms.uBendStrength },
        vertexShader: coneVertex,
        fragmentShader: coneFragment,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    private readonly cone = new THREE.Mesh(new THREE.CylinderGeometry(CONE_TOP, 1, 1, CONE_SEGMENTS.round, CONE_SEGMENTS.down, true), this.coneMaterial);
    private readonly moteMaterial = new THREE.ShaderMaterial({
        uniforms: { uPixelHeight: { value: 1 }, uWarn: { value: 0 }, uBendOrigin: bendUniforms.uBendOrigin, uBendStrength: bendUniforms.uBendStrength },
        vertexShader: moteVertex,
        fragmentShader: moteFragment,
        transparent: true,
        depthWrite: false,
    });
    private readonly moteGeometry = new THREE.BufferGeometry();
    private readonly motePoints: THREE.Points;
    private readonly motes: Mote[];
    private readonly positions = new Float32Array(MOTES * 3);
    private readonly alphas = new Float32Array(MOTES);
    private readonly sizes = new Float32Array(MOTES);
    private phase = 0;
    private moving = 0;
    private suck = 0;
    private warn = 0;

    public constructor(threeScene: THREE.Scene) {
        this.motes = Array.from({ length: MOTES }, () => ({
            angle: Math.random() * Math.PI * 2,
            height: Math.random(),
            out: 0.25 + Math.random() * 0.75,
            rise: 1 + (Math.random() - 0.5) * MOTE_RISE.spread * 2,
            size: 0.6 + Math.random() * 0.8,
        }));
        this.moteGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.moteGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
        this.moteGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
        this.motePoints = new THREE.Points(this.moteGeometry, this.moteMaterial);
        // They move every frame, and the bend moves them further: never culled (they're always by the saucer anyway).
        this.motePoints.frustumCulled = false;
        this.cone.frustumCulled = false;
        threeScene.add(this.cone, this.motePoints);
    }

    /** `speedShare`: how fast it's going (0..1); `sucking`: 1 while something's on its way up; `warning`: trying for something too big. */
    public update(delta: number, x: number, z: number, radius: number, altitude: number, speedShare: number, sucking: number, warning: boolean): void {
        this.moving += (speedShare - this.moving) * Math.min(1, delta * EASE.moving);
        this.suck += (sucking - this.suck) * Math.min(1, delta * (sucking > this.suck ? EASE.suckingUp : EASE.suckingDown));
        this.warn += ((warning ? 1 : 0) - this.warn) * Math.min(1, delta * (warning ? EASE.warningUp : EASE.warningDown));
        const { moving, suck } = this;
        this.phase = (this.phase + delta * (SPIN.rest + SPIN.moving * moving + SPIN.sucking * suck)) % 1;

        const wide = radius * (1 + SUCK_WIDEN * suck);
        this.cone.position.set(x, altitude / 2, z);
        this.cone.scale.set(wide, altitude, wide);
        const { uniforms } = this.coneMaterial;
        uniforms.uPhase.value = this.phase;
        uniforms.uSuck.value = suck;
        uniforms.uWarn.value = this.warn;
        uniforms.uStrength.value = STRENGTH.rest + STRENGTH.moving * moving + STRENGTH.sucking * suck;

        beamLight.uBeamPool.value.set(x, z, wide, altitude);
        beamLight.uBeamColor.value.lerpColors(POOL_GREEN, POOL_ORANGE, this.warn);
        beamLight.uBeamStrength.value = POOL.rest + POOL.moving * moving + POOL.sucking * suck;
        beamLight.uBeamPhase.value = this.phase;

        const showing = MOTES * Math.min(1, MOTE_SHARE.rest + MOTE_SHARE.moving * moving + MOTE_SHARE.sucking * suck);
        const rise = MOTE_RISE.rest + MOTE_RISE.sucking * suck;
        const orbit = MOTE_ORBIT * (1 + moving + suck);
        const size = MOTE_SIZE * Math.sqrt(radius);
        this.motes.forEach((mote, i) => {
            mote.height += delta * rise * mote.rise;
            if (mote.height >= 1) mote.height -= 1;
            mote.angle += delta * orbit * (0.6 + mote.out * 0.4);
            // Out at the cone's width where it is, narrowing as it rises.
            const reach = wide * (1 + (CONE_TOP - 1) * mote.height) * mote.out;
            this.positions.set([x + Math.cos(mote.angle) * reach, altitude * mote.height, z + Math.sin(mote.angle) * reach], i * 3);
            // Fading in at the ground and out at the saucer; the ones over the share eased out, not popping.
            const shown = Math.max(0, Math.min(1, showing - i));
            this.alphas[i] = Math.sin(mote.height * Math.PI) * shown;
            this.sizes[i] = size * mote.size;
        });
        this.moteGeometry.getAttribute('position').needsUpdate = true;
        this.moteGeometry.getAttribute('aAlpha').needsUpdate = true;
        this.moteGeometry.getAttribute('aSize').needsUpdate = true;
        this.moteMaterial.uniforms.uPixelHeight.value = SetupThree.renderer.domElement.height;
        this.moteMaterial.uniforms.uWarn.value = this.warn;
    }

    public destroy(): void {
        beamLight.uBeamStrength.value = 0;
        this.cone.removeFromParent();
        this.motePoints.removeFromParent();
        this.cone.geometry.dispose();
        this.coneMaterial.dispose();
        this.moteGeometry.dispose();
        this.moteMaterial.dispose();
    }
}
