// ParticleRegistry.ts
//
// Central catalog of particle effects — one entry per named effect, each
// pointing at a texture under images/non-preload/ (browsable via the
// "Texture" field's asset picker, same convention as CharacterViewTypes'
// `face` field — see /api/non-preload-images in web/server.mjs). Multiple
// effect ids can point at the SAME texture (e.g. two different tints/
// timings built off one piece of art) — ParticleSystem batches by TEXTURE
// **and blendMode together** (see ParticleSystem.batchKey()), not by effect
// id, so any number of effects sharing both are still one draw call; two
// effects sharing a texture but picking different blend modes just end up
// in two batches instead of one, since blending is a whole-material/whole-
// draw-call setting, not something that can vary per particle.
//
// Editable via the web editor's "Particle Effects" tab (see
// games/pizza/web/data/manifest.json / sync/entityMap.mjs — this file is
// kept in sync the same way CraftTypes.ts/ShopTypes.ts are: the editor
// patches this object literal in place via ts-morph, it does not read a
// separate JSON file at runtime). Any entity that wants to emit one of
// these picks it from a dropdown wherever a schema exposes a `source:
// 'particleEffects'` select field (see schemas.js's `crafting` tab's
// `particleEffectId` field) — nothing else needs to change to make a new
// effect spawnable via ParticleSystem.spawn(id, worldPos) /
// ParticleEmitterComponent.
//
// Two independent ways to spawn an effect, both reading the SAME descriptor:
//   spawn(id, worldPos)          — one particle drifting straight up within
//                                   spreadRadius (riseSpeedMin/Max) — the
//                                   continuous "ambient emitter" mode
//                                   ParticleEmitterComponent ticks on a timer.
//   burst(id, worldPos, count)   — `count` particles launched at once in
//                                   random directions across the UPPER
//                                   hemisphere (never downward), each at a
//                                   random speed (burstSpeedMin/Max) and
//                                   pulled back down by `gravity` over its
//                                   lifetime — see ParticleBurstOnDestroyComponent.
// burstSpeedMin/burstSpeedMax/gravity are OPTIONAL and only read by burst()
// — an existing ambient-only effect (like craftingMyst below) needs no
// changes at all to keep working exactly as it did; burst() just falls back
// to sensible defaults (see ParticleSystem.burst()) for any effect that
// never bothered to set them.

export interface ParticleEffectDescriptor {
    /** Editor-facing display name — shown in the "Particle Effect" dropdown wherever this effect is picked. */
    name: string;
    /** Relative path under images/non-preload/ — e.g. "particles/magic_04.webp". */
    texture: string;
    /** CSS hex color multiplied into the (greyscale/white) source art — the only color source, e.g. "#c77dff". */
    color: string;
    /** Seconds to ease from 0 -> maxOpacity right after spawn. */
    fadeInSec: number;
    /** Seconds to ease from maxOpacity -> 0 right before the particle's lifetime ends. */
    fadeOutSec: number;
    /** Total seconds a particle lives, fadeIn/fadeOut included. */
    lifetimeSec: number;
    /** World-space size (billboard edge length) lower bound — one value picked per particle between sizeMin/sizeMax. */
    sizeMin: number;
    /** World-space size (billboard edge length) upper bound. */
    sizeMax: number;
    /** Upward drift speed lower bound, world units/sec. */
    riseSpeedMin: number;
    /** Upward drift speed upper bound, world units/sec. */
    riseSpeedMax: number;
    /** Particles spawn at a random point within this XZ radius of the emitter's own position. */
    spreadRadius: number;
    /** Opacity at the peak of the fade envelope (0-1) — lets an effect stay translucent even at full fade. */
    maxOpacity: number;
    /** [x, y, z] world-unit nudge applied on top of wherever the attaching entity's own ParticleEmitterComponent already places the emitter — e.g. drop this a bit to sit lower on the table without touching CraftZone's own offset. Plain numbers (not THREE.Vector3), same convention as EntityViewRegistry.ts's own `offset`, so this data file stays engine-import-free. */
    offset: [number, number, number];
    /** 'additive' glows/brightens overlapping particles (good for magic/fire/light effects) — the previous hardcoded behavior. 'normal' composites with regular alpha blending instead, which reads flatter/more cartoonish and doesn't blow out to white when particles overlap. */
    blendMode: 'normal' | 'additive';
    /** burst()-only: initial launch speed lower bound, world units/sec. Ignored by spawn() (the continuous ambient mode uses riseSpeedMin/Max instead). undefined falls back to ParticleSystem's own default — an existing ambient-only effect needs no changes to keep working. */
    burstSpeedMin?: number;
    /** burst()-only: initial launch speed upper bound, world units/sec. */
    burstSpeedMax?: number;
    /** burst()-only: downward acceleration applied over each particle's lifetime, world units/sec² — pulls the burst back down into an arc instead of particles flying off in a straight line forever. undefined falls back to ParticleSystem's own default. Has NO effect on spawn()'s continuous ambient mode (that mode's particles never carry gravity). */
    gravity?: number;
}

export const PARTICLE_REGISTRY: Record<string, ParticleEffectDescriptor> = {
    /** Ambient purple "myst" drifting up off a crafting table — see CraftZone.awake(). */
    craftingMyst: {
        name: "Crafting Myst (Purple)",
        texture: "particles/star_06.webp",
        color: "#c77dff",
        fadeInSec: 0.5,
        fadeOutSec: 1,
        lifetimeSec: 2.2,
        sizeMin: 0.9,
        sizeMax: 1.4,
        riseSpeedMin: 0.15,
        riseSpeedMax: 1.3,
        spreadRadius: 1,
        maxOpacity: 1,
        offset: [
            0,
            -0.5,
            0
        ],
        blendMode: "additive",
    },
    /** Demo burst preset — a neutral spark shower for anything using ParticleBurstOnDestroyComponent (see Gate.ts's own `destroyBurstEffectId`) that hasn't picked its own effect yet. */
    destroyBurst: {
        name: 'Destroy Burst (Spark)',
        texture: 'particles/spark_03.webp',
        color: '#ffe8a3',
        blendMode: 'normal',
        fadeInSec: 0.05,
        fadeOutSec: 0.35,
        lifetimeSec: 0.6,
        sizeMin: 0.3,
        sizeMax: 0.6,
        riseSpeedMin: 0,
        riseSpeedMax: 0,
        spreadRadius: 0,
        maxOpacity: 1,
        offset: [0, 0, 0],
        burstSpeedMin: 2,
        burstSpeedMax: 4.5,
        gravity: 9,
    },
    /** Same setup as craftingMyst (same texture/blend/fade/size shape) tuned as a burst instead of an ambient drift, tinted leaf-green for a tree — see ProviderTypes.ts's Tree entry's own `destroyParticleEffectId`. */
    treeLeafBurst: {
        name: 'Tree Leaf Burst (Green)',
        texture: 'particles/star_06.webp',
        color: '#8bc34a',
        blendMode: 'additive',
        fadeInSec: 0.05,
        fadeOutSec: 0.6,
        lifetimeSec: 0.9,
        sizeMin: 0.4,
        sizeMax: 0.8,
        riseSpeedMin: 0,
        riseSpeedMax: 0,
        spreadRadius: 0,
        maxOpacity: 1,
        offset: [0, 0, 0],
        burstSpeedMin: 2,
        burstSpeedMax: 4,
        gravity: 8,
    },
};

export function getParticleEffect(id: string): ParticleEffectDescriptor {
    const effect = PARTICLE_REGISTRY[id];
    if (!effect) {
        throw new Error(`ParticleRegistry: no effect registered for id "${id}" — see PARTICLE_REGISTRY`);
    }
    return effect;
}
