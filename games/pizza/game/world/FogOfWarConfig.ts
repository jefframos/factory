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
     */
    categoryDelaySec: {
        /** Ground/island meshes — IslandMeshBuilder's own registerWithZones() calls (implicitly, via the default). */
        terrain: 0,
        /** Everything placed ON the terrain but not alive — resources, buildings, gates, shops, queues, craft tables, mesh-layer props. */
        props: 0.35,
        /** Animals/NPCs — the last thing to rise, so it visually reads as "the world settles, THEN life shows up in it." */
        creatures: 0.7,
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
};
