// ParticleSystem.ts
//
// Static entry point for spawning registry-driven particle effects (see
// ParticleRegistry.ts) into the THREE scene — same "static utility, not an
// entity/component" convention as TextureBuilder/BendService, since this is
// purely a rendering-side service any number of unrelated callers share.
//
// Owns exactly one ParticleBatch per unique (texture, blendMode) PAIR — see
// ParticleRegistry.ts's own doc for why blendMode is part of the batch key:
// two effect ids sharing one texture AND blend mode (different tint/timing
// off the same art) still cost one draw call between them; two effects
// sharing only the texture but picking different blend modes get separate
// batches, since blending is a whole-draw-call setting.
//
// init() must run once, right after the scene's THREE.Scene exists (see
// PizzaScene.build()); update() must run every frame from the scene's own
// update() (see PizzaScene.update()) so every live batch's aging uniform
// advances. spawn() is safe to call before init(), or before a given
// effect's texture has finished loading — it's a no-op until then, so a
// continuously-emitting caller (ParticleEmitterComponent) just starts
// succeeding on whichever tick the batch becomes ready.

import * as THREE from 'three';
import { TextureBuilder } from '../builders/TextureBuilder';
import { ParticleBatch } from './ParticleBatch';
import { getParticleEffect } from './ParticleRegistry';

/** Same convention as IslandStorage/ShopStorage's own NON_PRELOAD_IMAGE_BASE — non-preload art is served straight from the asset pipeline's output, not bundled by Vite. */
const NON_PRELOAD_IMAGE_BASE = 'pizza/images/non-preload/';
/** Particles per texture, shared across every effect/emitter using it — generous enough for several ambient emitters at once without ever needing to be reasoned about per-caller. */
const BATCH_CAPACITY = 256;
/** burst()'s own fallback for ParticleEffectDescriptor.burstSpeedMin/Max/gravity when an effect never set them (they're optional — see that interface's own doc). */
const DEFAULT_BURST_SPEED_MIN = 1.5;
const DEFAULT_BURST_SPEED_MAX = 3.5;
const DEFAULT_BURST_GRAVITY = 6;

/** Uniformly-distributed unit vector on the UPPER hemisphere (y >= 0, world-up) — burst()'s "random direction, semi-sphere facing up" spread. Standard uniform-hemisphere sampling: a uniform azimuth around the up axis, and z (here: y) uniform in [0, 1] rather than the polar angle itself, which is what keeps the distribution uniform per unit AREA of the hemisphere instead of bunching near the pole. */
function randomHemisphereDirection(): THREE.Vector3 {
    const y = Math.random();
    const radius = Math.sqrt(1 - y * y);
    const azimuth = Math.random() * Math.PI * 2;
    return new THREE.Vector3(radius * Math.cos(azimuth), y, radius * Math.sin(azimuth));
}

export class ParticleSystem {
    private static group: THREE.Group | null = null;
    private static readonly batches = new Map<string, ParticleBatch>();
    private static readonly pendingLoads = new Set<string>();

    public static init(scene: THREE.Scene): void {
        if (ParticleSystem.group) {
            return;
        }
        ParticleSystem.group = new THREE.Group();
        scene.add(ParticleSystem.group);
    }

    public static update(delta: number): void {
        for (const batch of ParticleSystem.batches.values()) {
            batch.update(delta);
        }
    }

    /** Spawns one particle of `effectId` at `worldPos`, offset by that effect's own spreadRadius/riseSpeedRange — fire-and-forget, see this file's own doc for the pre-load/pre-init no-op case. */
    public static spawn(effectId: string, worldPos: THREE.Vector3): void {
        const descriptor = getParticleEffect(effectId);
        const key = ParticleSystem.batchKey(descriptor.texture, descriptor.blendMode);
        const batch = ParticleSystem.batches.get(key);
        if (!batch) {
            ParticleSystem.ensureBatch(descriptor.texture, descriptor.blendMode);
            return;
        }

        const [offsetX, offsetY, offsetZ] = descriptor.offset;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * descriptor.spreadRadius;
        const spawnPos = worldPos.clone().add(new THREE.Vector3(offsetX + Math.cos(angle) * radius, offsetY, offsetZ + Math.sin(angle) * radius));

        const speed = descriptor.riseSpeedMin + Math.random() * (descriptor.riseSpeedMax - descriptor.riseSpeedMin);
        const size = descriptor.sizeMin + Math.random() * (descriptor.sizeMax - descriptor.sizeMin);

        batch.spawn(spawnPos, new THREE.Vector3(0, speed, 0), descriptor, size);
    }

    /**
     * Launches `count` particles of `effectId` at once from `worldPos`, each shot in a random
     * direction across the UPPER hemisphere (see randomHemisphereDirection() — never downward)
     * at a random speed between burstSpeedMin/Max, then pulled back down by `gravity` over its
     * lifetime (see ParticleBatch's own vertex shader). Fire-and-forget, same pre-load/pre-init
     * no-op case as spawn() — see this file's own doc.
     */
    public static burst(effectId: string, worldPos: THREE.Vector3, count: number): void {
        const descriptor = getParticleEffect(effectId);
        const key = ParticleSystem.batchKey(descriptor.texture, descriptor.blendMode);
        const batch = ParticleSystem.batches.get(key);
        if (!batch) {
            ParticleSystem.ensureBatch(descriptor.texture, descriptor.blendMode);
            return;
        }

        const [offsetX, offsetY, offsetZ] = descriptor.offset;
        const origin = worldPos.clone().add(new THREE.Vector3(offsetX, offsetY, offsetZ));
        const speedMin = descriptor.burstSpeedMin ?? DEFAULT_BURST_SPEED_MIN;
        const speedMax = descriptor.burstSpeedMax ?? DEFAULT_BURST_SPEED_MAX;
        const gravity = descriptor.gravity ?? DEFAULT_BURST_GRAVITY;

        for (let i = 0; i < count; i++) {
            const speed = speedMin + Math.random() * (speedMax - speedMin);
            const velocity = randomHemisphereDirection().multiplyScalar(speed);
            const size = descriptor.sizeMin + Math.random() * (descriptor.sizeMax - descriptor.sizeMin);
            batch.spawn(origin, velocity, descriptor, size, gravity);
        }
    }

    private static batchKey(texturePath: string, blendMode: 'normal' | 'additive'): string {
        return `${texturePath}::${blendMode}`;
    }

    private static ensureBatch(texturePath: string, blendMode: 'normal' | 'additive'): void {
        const key = ParticleSystem.batchKey(texturePath, blendMode);
        if (ParticleSystem.batches.has(key) || ParticleSystem.pendingLoads.has(key)) {
            return;
        }
        ParticleSystem.pendingLoads.add(key);

        void TextureBuilder.load(`${NON_PRELOAD_IMAGE_BASE}${texturePath}`).then((texture) => {
            const batch = new ParticleBatch(texture, BATCH_CAPACITY, blendMode);
            ParticleSystem.group?.add(batch.points);
            ParticleSystem.batches.set(key, batch);
            ParticleSystem.pendingLoads.delete(key);
        });
    }
}
