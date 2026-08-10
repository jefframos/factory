// WorldConfig.ts
//
// Tunable numbers + the resource layout for WorldManager. Kept separate from
// WorldManager.ts itself so "what's in the world" (this file) stays easy to
// eyeball/edit independently of "how proximity streaming works" (the class).

import * as THREE from 'three';
import { ResourceType } from '../actions/ResourceTypes';

/** World-units square for the visible floor plane + its matching physics slab — see WorldManager.buildGround(). */
export const FLOOR_SIZE = 200;
/** BendService's shader only displaces vertices, not fragments — a default 1x1-segment PlaneGeometry has just 4 corner vertices, so bending it warps it into a twisted quad instead of curving smoothly. This gives it enough subdivision to actually curve. */
export const FLOOR_SEGMENTS = 100;
/** Thin static slab just under the visible floor plane, top face resting at world Y=0 — gives the player something to land on instead of falling forever. */
export const GROUND_HALF_THICKNESS = 0.5;

// Resource load/unload radii + pop-in/out timing moved to PerformanceConfig.ts (a mutable,
// dat.GUI-tweakable object — see its own doc) since they're exactly the kind of "how far/
// how much renders" knob that file exists to collect in one adjustable place.

export interface ResourceSpawnDef {
    id: string;
    resourceType: ResourceType;
    position: THREE.Vector3;
}

/**
 * Deterministic seeded RNG (mulberry32) — same seed always produces the same layout, so a
 * procedural spawn table is reproducible across sessions/clients without needing to store
 * every position. An alternative to TileMapConfig.buildResourceSpawnsFromTileMap() (the
 * map's resourcesLayer is the normal source of truth — see WorldManager's constructor) for
 * generating resources beyond what's hand-painted in Tiled.
 */
function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Every ResourceType procedural spawning picks evenly between — see generateProceduralResourceSpawns(). */
const PROCEDURAL_RESOURCE_TYPES = [ResourceType.Tree, ResourceType.Stone, ResourceType.Berries];

/** Scatters `count` resource nodes uniformly across a [-halfExtent, halfExtent] square, picking evenly among PROCEDURAL_RESOURCE_TYPES — same seed always yields the same layout. */
export function generateProceduralResourceSpawns(seed: number, count: number, halfExtent: number): ResourceSpawnDef[] {
    const random = mulberry32(seed);
    const spawns: ResourceSpawnDef[] = [];

    for (let i = 0; i < count; i++) {
        const resourceType = PROCEDURAL_RESOURCE_TYPES[Math.floor(random() * PROCEDURAL_RESOURCE_TYPES.length)];
        const x = (random() * 2 - 1) * halfExtent;
        const z = (random() * 2 - 1) * halfExtent;
        spawns.push({ id: `${resourceType}-${i}`, resourceType, position: new THREE.Vector3(x, 0, z) });
    }

    return spawns;
}
