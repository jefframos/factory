// ParticleBatch.ts
//
// One shared THREE.Points draw call per texture — every emitter using the
// same art (regardless of tint/size/timing) writes into the SAME geometry's
// attribute arrays instead of getting its own mesh, so any number of
// crafting tables glowing at once still costs exactly one draw call for that
// texture. Aging/fade-in/fade-out/rise-drift are all computed on the GPU
// from a per-particle spawn timestamp plus a single uTime uniform — spawn()
// only writes a handful of floats per particle, update() only advances
// uTime. Billboarding is free: THREE.Points quads are always camera-facing,
// no per-particle rotation math needed.
//
// Dead slots are never explicitly tracked/freed: spawn() claims the next
// index in a fixed-size ring buffer and overwrites whatever was there,
// dead or not. For an ambient decorative effect (not a gameplay-critical
// one) that's a fine tradeoff — a particle occasionally getting cut a beat
// short under heavy simultaneous spawning is invisible, and it avoids any
// per-frame "sweep for dead slots" bookkeeping entirely.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { ParticleEffectDescriptor } from './ParticleRegistry';

const VERTEX_SHADER = `
attribute vec3 aVelocity;
attribute vec3 aColor;
attribute float aSize;
attribute float aSpawnTime;
attribute float aLifetime;
attribute float aFadeIn;
attribute float aFadeOut;
attribute float aMaxOpacity;
attribute float aGravity;

uniform float uTime;
uniform vec3 uBendOrigin;
uniform float uBendStrength;

varying vec3 vColor;
varying float vAlpha;

void main() {
    float age = uTime - aSpawnTime;
    vColor = aColor;

    if (age < 0.0 || age > aLifetime) {
        // Not alive — push offscreen and zero-size rather than branch around the
        // draw call itself; cheaper than any CPU-side liveness bookkeeping.
        vAlpha = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        return;
    }

    float fadeInT = aFadeIn > 0.0 ? clamp(age / aFadeIn, 0.0, 1.0) : 1.0;
    float fadeOutT = aFadeOut > 0.0 ? clamp((aLifetime - age) / aFadeOut, 0.0, 1.0) : 1.0;
    vAlpha = min(fadeInT, fadeOutT) * aMaxOpacity;

    vec3 worldPos = position + aVelocity * age;
    // Constant downward acceleration — 0 for every particle spawn()'s continuous ambient mode
    // ever creates (see ParticleSystem.spawn(), which never sets aGravity), so this term is a
    // no-op there; burst() sets it per ParticleEffectDescriptor.gravity, pulling the launch
    // velocity back down into an arc (basic projectile motion: -1/2 * g * t^2).
    worldPos.y -= 0.5 * aGravity * age * age;

    // Same world-space bend BendService.applyBend() injects into every other material's
    // #include <project_vertex> — reproduced by hand here since this is a raw ShaderMaterial
    // with no such chunk to patch. uBendOrigin/uBendStrength are BendService's OWN uniform
    // objects (shared by reference from ParticleBatch's constructor), so this stays in sync
    // with BendService.updateOrigin()/setEnabled() automatically, same as every bent mesh.
    vec4 bentWorld = modelMatrix * vec4(worldPos, 1.0);
    float dx = bentWorld.x - uBendOrigin.x;
    float dz = bentWorld.z - uBendOrigin.z;
    bentWorld.y -= (dx * dx + dz * dz) * uBendStrength;

    vec4 mvPosition = viewMatrix * bentWorld;
    // 800 (not some smaller "true to world size" factor) is tuned against this game's
    // ~15-unit follow-camera distance (see PizzaScene's CAMERA_SETTINGS.distance) — a
    // physically-correct projection would render these as a few px, unreadable as a "glow".
    gl_PointSize = aSize * (800.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D uMap;

varying vec3 vColor;
varying float vAlpha;

void main() {
    vec4 tex = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
}
`;

export class ParticleBatch {
    public readonly points: THREE.Points;

    private readonly geometry: THREE.BufferGeometry;
    private readonly material: THREE.ShaderMaterial;
    private readonly capacity: number;
    private cursor = 0;
    private elapsedSec = 0;
    /** Set by spawn(), cleared by update() — batches every needsUpdate flip from a frame's spawns into a single pass instead of re-flagging per spawn. */
    private dirty = false;

    private readonly positions: Float32Array;
    private readonly velocities: Float32Array;
    private readonly colors: Float32Array;
    private readonly sizes: Float32Array;
    private readonly spawnTimes: Float32Array;
    private readonly lifetimes: Float32Array;
    private readonly fadeIns: Float32Array;
    private readonly fadeOuts: Float32Array;
    private readonly maxOpacities: Float32Array;
    private readonly gravities: Float32Array;

    public constructor(texture: THREE.Texture, capacity: number, blendMode: 'normal' | 'additive') {
        this.capacity = capacity;

        this.positions = new Float32Array(capacity * 3);
        this.velocities = new Float32Array(capacity * 3);
        this.colors = new Float32Array(capacity * 3);
        this.sizes = new Float32Array(capacity);
        // -9999 so every slot starts already "dead" (age hugely negative) instead of
        // rendering a particle at the origin before its first real spawn.
        this.spawnTimes = new Float32Array(capacity).fill(-9999);
        this.lifetimes = new Float32Array(capacity);
        this.fadeIns = new Float32Array(capacity);
        this.fadeOuts = new Float32Array(capacity);
        this.maxOpacities = new Float32Array(capacity);
        this.gravities = new Float32Array(capacity);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
        this.geometry.setAttribute('aVelocity', new THREE.BufferAttribute(this.velocities, 3));
        this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
        this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
        this.geometry.setAttribute('aSpawnTime', new THREE.BufferAttribute(this.spawnTimes, 1));
        this.geometry.setAttribute('aLifetime', new THREE.BufferAttribute(this.lifetimes, 1));
        this.geometry.setAttribute('aFadeIn', new THREE.BufferAttribute(this.fadeIns, 1));
        this.geometry.setAttribute('aFadeOut', new THREE.BufferAttribute(this.fadeOuts, 1));
        this.geometry.setAttribute('aMaxOpacity', new THREE.BufferAttribute(this.maxOpacities, 1));
        this.geometry.setAttribute('aGravity', new THREE.BufferAttribute(this.gravities, 1));

        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uMap: { value: texture },
                // Shared BY REFERENCE with BendService's own uniforms (not copied) — see the
                // vertex shader's own doc on why this material can't just call
                // BendService.applyBend() itself.
                uBendOrigin: BendService.uniforms.uBendOrigin,
                uBendStrength: BendService.uniforms.uBendStrength,
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            // Real depth testing against the rest of the scene — a particle further from the
            // camera than solid geometry in front of it (a wall, the ground, the table itself)
            // correctly sits behind it instead of always drawing on top.
            depthTest: true,
            blending: blendMode === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        });

        this.points = new THREE.Points(this.geometry, this.material);
        // Every particle's own age already keeps it clipped offscreen once dead (see the
        // vertex shader) — frustumCulled would instead cull the WHOLE batch the instant its
        // static bounding sphere (computed from wherever slots happen to sit) falls outside
        // view, hiding every currently-live particle at once.
        this.points.frustumCulled = false;
    }

    public spawn(worldPos: THREE.Vector3, velocity: THREE.Vector3, descriptor: ParticleEffectDescriptor, size: number, gravity = 0): void {
        const i = this.cursor;
        this.cursor = (this.cursor + 1) % this.capacity;

        this.positions.set([worldPos.x, worldPos.y, worldPos.z], i * 3);
        this.velocities.set([velocity.x, velocity.y, velocity.z], i * 3);
        const color = new THREE.Color(descriptor.color);
        this.colors.set([color.r, color.g, color.b], i * 3);
        this.sizes[i] = size;
        this.spawnTimes[i] = this.elapsedSec;
        this.lifetimes[i] = descriptor.lifetimeSec;
        this.fadeIns[i] = descriptor.fadeInSec;
        this.fadeOuts[i] = descriptor.fadeOutSec;
        this.maxOpacities[i] = descriptor.maxOpacity;
        this.gravities[i] = gravity;

        this.dirty = true;
    }

    public update(delta: number): void {
        this.elapsedSec += delta;
        this.material.uniforms.uTime.value = this.elapsedSec;

        if (this.dirty) {
            for (const attribute of Object.values(this.geometry.attributes)) {
                (attribute as THREE.BufferAttribute).needsUpdate = true;
            }
            this.dirty = false;
        }
    }

    public dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
        this.points.removeFromParent();
    }
}
