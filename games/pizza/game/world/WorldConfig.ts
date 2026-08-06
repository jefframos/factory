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

/**
 * A resource only gets a live ResourceNode (mesh + physics) once the player is within
 * this radius — see WorldManager.update(). Squared once here so the per-resource check
 * every frame is a cheap distanceToSquared() compare, no sqrt.
 */
export const LOAD_RADIUS = 20;
/**
 * ...and stays materialized until the player drifts out past this LARGER radius —
 * deliberately wider than LOAD_RADIUS so a resource sitting right at the boundary
 * doesn't load/unload every frame as the player jitters back and forth across one line.
 */
export const UNLOAD_RADIUS = 28;

export const LOAD_RADIUS_SQ = LOAD_RADIUS * LOAD_RADIUS;
export const UNLOAD_RADIUS_SQ = UNLOAD_RADIUS * UNLOAD_RADIUS;

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

/** Scatters `count` resource nodes uniformly across a [-halfExtent, halfExtent] square, picking Tree/Stone with even odds — same seed always yields the same layout. */
export function generateProceduralResourceSpawns(seed: number, count: number, halfExtent: number): ResourceSpawnDef[] {
    const random = mulberry32(seed);
    const spawns: ResourceSpawnDef[] = [];

    for (let i = 0; i < count; i++) {
        const resourceType = random() < 0.5 ? ResourceType.Tree : ResourceType.Stone;
        const x = (random() * 2 - 1) * halfExtent;
        const z = (random() * 2 - 1) * halfExtent;
        spawns.push({ id: `${resourceType}-${i}`, resourceType, position: new THREE.Vector3(x, 0, z) });
    }

    return spawns;
}
