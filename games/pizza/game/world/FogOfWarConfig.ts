// FogOfWarConfig.ts
//
// Picks which of the two zone-lock visual solutions is active, and how a tile/entity that
// overlaps more than one zone should resolve its own visibility — one switch here (not
// scattered across FogOfWarManager/ZoneVisibilityManager/WorldManager) so trying the other
// solution, or the other overlap rule, for comparison/testing is a one-line edit.

export enum FogOfWarStyle {
    /**
     * Solution 1 — an opaque, cloud-shaded box volume covers every unrevealed land cell (see
     * FogOfWarManager.ts). The real ground/props underneath keep rendering normally; the box
     * just visually hides them.
     */
    BoxCloud = 'boxCloud',
    /**
     * Solution 2 — nothing in a closed zone renders at all: no ground mesh, no resource/
     * building/shop/queue mesh (see ZoneVisibilityManager.ts). No placeholder sits over the gap.
     */
    HideEntities = 'hideEntities',
}

export type ZoneOverlapMode = 'any' | 'all';

export interface FogOfWarConfig {
    style: FogOfWarStyle;
    /**
     * How a tile/entity whose footprint touches MORE than one zone decides its own visibility:
     * 'any' shows it the moment ONE of those zones is revealed; 'all' waits until EVERY zone it
     * touches is revealed. Only matters for something straddling a zone boundary — most tiles/
     * entities sit fully inside a single zone, where both modes agree.
     */
    overlapMode: ZoneOverlapMode;
}

export const FOG_OF_WAR_CONFIG: FogOfWarConfig = {
    style: FogOfWarStyle.HideEntities,
    overlapMode: 'all',
};

/**
 * Tuning for the zone-reveal shockwave effect (see ZoneRevealEffect.ts and
 * ZoneVisibilityManager.revealZone()'s own `origin` param) — a ring expands outward from
 * wherever the player was standing when the zone unlocked, and each newly-visible object rises
 * up from below the ground with a delay proportional to its OWN distance from that same
 * origin, so the rising objects visually line up with the ring passing over them. One shared
 * config so the ring's expansion speed and the rise delay's speed can never drift apart.
 */
export const ZONE_REVEAL_CONFIG = {
    /** World units/second the shockwave ring (and the per-object rise delay) travels outward. */
    waveSpeed: 50,
    /** How far below its resting Y an object starts before rising into place. */
    riseDistance: 4,
    /** Seconds the rise tween itself takes, once it starts (on top of the wave-travel delay). */
    riseDurationSec: 0.5,
    /** Ring mesh's own outer radius — generous enough to sweep past anything a zone could realistically span. */
    shockwaveMaxRadius: 220,
    /** Ring thickness, in world units. */
    shockwaveBandWidth: 3,
    /**
     * Extra flat delay (seconds), ON TOP of the wave-travel delay, stacked by "layer" so
     * terrain always rises first, then whatever sits on top of it, then creatures last — see
     * ZoneVisibilityManager's own doc on `categoryDelaySec`. Every register()/registerWithZones()
     * caller picks one of these; IslandMeshBuilder (ground) doesn't pass one at all, which is
     * exactly `terrain`'s own value (0) by default.
     *
     * Each later category's own value MUST be at least `riseDurationSec` more than the one
     * before it (props >= riseDurationSec, creatures >= props + riseDurationSec) — anything
     * smaller and the two rise-tweens visibly OVERLAP in time (a prop starts lifting while the
     * ground under it hasn't even finished settling yet), which reads as "everything popping up
     * together," not the "ground settles, THEN props rise, THEN creatures" sequence this is
     * supposed to produce. The values below leave a small ~0.1s pause on top of that minimum so
     * one category is visibly at full rest before the next starts, rather than the two rises
     * merely not overlapping by zero seconds.
     */
    categoryDelaySec: {
        /** Ground/island meshes — IslandMeshBuilder's own registerWithZones() calls (implicitly, via the default). */
        terrain: 0,
        /** Everything placed ON the terrain but not alive — resources, buildings, gates, shops, queues, craft tables, mesh-layer props. Starts only once terrain's own rise (0 to riseDurationSec) has fully finished. */
        props: 0.8,
        /** Animals/NPCs — the last thing to rise, so it visually reads as "the world settles, THEN life shows up in it." Starts only once props' own rise has fully finished. */
        creatures: 1.2,
    },
    /**
     * How long (ms) after a zone's reveal a LATE registration (a resource/animal that only
     * gets created once its own materialize() gate opens, one or more frames after
     * revealZone() itself already ran — see WorldManager/DynamicResourceSpawner/
     * ShapeResourceSpawner's own materialize() doc) still counts as part of THAT reveal's wave,
     * rather than just popping in instantly. Generous relative to the worst-case delay
     * (shockwaveMaxRadius / waveSpeed, ~12s here) so nothing anywhere in a freshly-revealed
     * zone can outrun this window and pop in without its rise animation.
     */
    revealEchoWindowMs: 20000,
    /**
     * gsap ease name(s) for the rise-into-place tween itself — see
     * ZoneVisibilityManager.Registrant.riseEase's own doc for why this can't just be one value
     * for everything. `default` (a bouncy overshoot — rises PAST its resting Y before settling
     * back) is what every register()/registerWithZones() caller gets unless it explicitly
     * overrides the `riseEase` param; `terrain` (a plain decelerating ease, no overshoot) is
     * what IslandMeshBuilder passes for ground meshes specifically, since an overshooting ground
     * blob visibly rises above its final height for a moment — tall enough to poke up through a
     * resource/building sitting right where it's rising even though their footprints never
     * actually overlap. A prop/creature rising through empty air has nothing to clip into, so
     * the overshoot stays purely a nice cosmetic "pop" for those.
     */
    riseEase: {
        default: 'back.out(1.4)',
        /** Swap to 'none' here for a perfectly straight linear rise instead, if the cubic deceleration still reads as too "alive" for a terrain reveal. */
        terrain: 'power3.out',
    },
};
