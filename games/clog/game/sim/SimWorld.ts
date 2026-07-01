import * as THREE from 'three';
import type { CollectibleManager } from '../systems/CollectibleManager';
import type { BoundlessChunkManager } from '../world/BoundlessChunkManager';

// ── Public types ──────────────────────────────────────────────────────────────

/** One cube from an entity's tail: position + value. Weakest is always last. */
export type TailEntry = { position: THREE.Vector3; value: number };

/** Read-only view of a nearby entity returned by SimWorld.query(). */
export type EntitySnapshot = {
    position: THREE.Vector3;
    value: number;
    /** Sorted descending by value. tail[last] is the weakest cube — the snipe target. */
    tail: TailEntry[];
};

export type SimQueryResult = {
    /** Live position refs for collectibles within the query radius. */
    food: THREE.Vector3[];
    /** Snapshots of all registered entities within the query radius, excluding the caller. */
    entities: EntitySnapshot[];
};

// ── ISimEntity ────────────────────────────────────────────────────────────────

/**
 * Implemented by PlayerEntity and any bot entity.
 * SimWorld uses this to answer queries without depending on concrete classes.
 */
export interface ISimEntity {
    readonly position: THREE.Vector3;
    readonly value: number;
    tailSnapshot(): TailEntry[];
}

// ── SimWorld ──────────────────────────────────────────────────────────────────

/**
 * Central world-query singleton.
 *
 * Lifecycle:
 *   SimWorld.init(collectibles, chunks)   ← scene.build()
 *   SimWorld.register(entity)             ← per entity, after creating it
 *   SimWorld.unregister(entity)           ← per entity, before destroying it
 *   SimWorld.reset()                      ← scene.destroy()
 *
 * Query (called by bots each frame):
 *   SimWorld.query(pos, radius, self)     → { food, entities }
 *   SimWorld.isWalkable(x, z)             → boolean
 *   SimWorld.resolveDirection(pos, dir, probe) → adjusted direction
 */
export class SimWorld {
    private static entities  = new Set<ISimEntity>();
    private static collectibles: CollectibleManager | null = null;
    private static chunks:       BoundlessChunkManager | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    static init(collectibles: CollectibleManager, chunks: BoundlessChunkManager): void {
        this.entities.clear();
        this.collectibles = collectibles;
        this.chunks       = chunks;
    }

    static reset(): void {
        this.entities.clear();
        this.collectibles = null;
        this.chunks       = null;
    }

    static register(entity: ISimEntity): void   { this.entities.add(entity); }
    static unregister(entity: ISimEntity): void { this.entities.delete(entity); }

    // ── Queries ───────────────────────────────────────────────────────────────

    /**
     * Returns all food positions and entity snapshots within `radius` of `origin`.
     * Pass `self` so the querying entity is excluded from the entity list.
     */
    static query(origin: THREE.Vector3, radius: number, self?: ISimEntity): SimQueryResult {
        const r2 = radius * radius;

        const food = this.collectibles?.getPositionsNear(origin, radius) ?? [];

        const entities: EntitySnapshot[] = [];
        for (const e of this.entities) {
            if (e === self) continue;
            const dx = e.position.x - origin.x;
            const dz = e.position.z - origin.z;
            if (dx * dx + dz * dz <= r2) {
                entities.push({
                    position: e.position,
                    value:    e.value,
                    tail:     e.tailSnapshot(),
                });
            }
        }

        return { food, entities };
    }

    /**
     * Returns true when (x, z) is not occupied by a solid obstacle tile.
     * Open water and unloaded chunks are always walkable.
     */
    static isWalkable(x: number, z: number): boolean {
        return this.chunks?.isWalkable(x, z) ?? true;
    }

    /**
     * Given a desired move direction, returns either the original direction
     * (path is clear) or a wall-slid fallback (one axis at a time).
     *
     * @param origin        Current world position of the entity.
     * @param dir           Desired direction, should be normalised.
     * @param probeDistance How far ahead to probe — use collisionRadius × 2.
     */
    static resolveDirection(
        origin: THREE.Vector3,
        dir: THREE.Vector3,
        probeDistance: number,
    ): THREE.Vector3 {
        const px = origin.x + dir.x * probeDistance;
        const pz = origin.z + dir.z * probeDistance;
        if (this.isWalkable(px, pz)) return dir;

        // Try sliding along X only
        if (Math.abs(dir.x) > 0 && this.isWalkable(origin.x + dir.x * probeDistance, origin.z)) {
            return new THREE.Vector3(dir.x, 0, 0).normalize();
        }
        // Try sliding along Z only
        if (Math.abs(dir.z) > 0 && this.isWalkable(origin.x, origin.z + dir.z * probeDistance)) {
            return new THREE.Vector3(0, 0, dir.z).normalize();
        }
        // Fully cornered — back away
        return dir.clone().negate();
    }
}
