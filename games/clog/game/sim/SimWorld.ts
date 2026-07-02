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
    /** The human-controlled entity, if any — lets queries opt out of seeing it (debug/AI-testing). */
    private static player: ISimEntity | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    static init(collectibles: CollectibleManager, chunks: BoundlessChunkManager): void {
        this.entities.clear();
        this.collectibles = collectibles;
        this.chunks       = chunks;
        this.player       = null;
    }

    static reset(): void {
        this.entities.clear();
        this.collectibles = null;
        this.chunks       = null;
        this.player       = null;
    }

    static register(entity: ISimEntity): void   { this.entities.add(entity); }
    static unregister(entity: ISimEntity): void { this.entities.delete(entity); }

    /** Tags which registered entity is the player, so queries can pass `excludePlayer` to ignore it. */
    static setPlayer(entity: ISimEntity | null): void { this.player = entity; }

    // ── Queries ───────────────────────────────────────────────────────────────

    /**
     * Returns all food positions and entity snapshots within `radius` of `origin`.
     * Pass `self` so the querying entity is excluded from the entity list.
     * Pass `opts.excludePlayer` to also hide the entity tagged via `setPlayer` —
     * used by the AI debug harness to test bot-vs-bot behaviour in isolation.
     */
    static query(
        origin: THREE.Vector3,
        radius: number,
        self?: ISimEntity,
        opts?: { excludePlayer?: boolean },
    ): SimQueryResult {
        const r2 = radius * radius;

        const food = this.collectibles?.getPositionsNear(origin, radius) ?? [];

        const entities: EntitySnapshot[] = [];
        for (const e of this.entities) {
            if (e === self) continue;
            if (opts?.excludePlayer && e === this.player) continue;
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

    /** Deflection angles (degrees) tried around the desired heading, nearest first, alternating sides. */
    private static readonly DEFLECT_ANGLES = [30, -30, 60, -60, 90, -90, 135, -135];
    private static readonly UP = new THREE.Vector3(0, 1, 0);

    /**
     * Given a desired move direction, returns the closest walkable heading to
     * it: the original direction if the path ahead is clear, otherwise the
     * nearest deflection (checked in increasing angle, alternating left/right)
     * that is. This lets an entity curve around an obstacle's edge instead of
     * being limited to the two cardinal slides (which fail whenever the
     * desired direction is already axis-aligned) or stopping dead the moment
     * every straight-line option is blocked.
     *
     * @param origin        Current world position of the entity.
     * @param dir           Desired direction, should be normalised.
     * @param probeDistance How far ahead to probe — use collisionRadius × 2.
     * @param preferred     Last frame's resolved direction, if any (see below).
     */
    static resolveDirection(
        origin: THREE.Vector3,
        dir: THREE.Vector3,
        probeDistance: number,
        preferred?: THREE.Vector3 | null,
    ): THREE.Vector3 {
        if (this.isWalkableAlong(origin, dir, probeDistance)) return dir;

        // Prefer sticking with whatever deflection worked last frame, if it's
        // still walkable, before re-deriving one from scratch. Without this,
        // a *constant* desired heading (e.g. returnToLeash always aiming
        // exactly at a fixed home point) can hunt forever between two
        // equally-valid "first walkable" deflections: moving along deflection
        // A shifts the entity a few centimetres, which — right at a grid-cell
        // boundary — can flip the straight-ahead/deflection-A probe back to
        // blocked while deflection B now clears; moving along B then flips it
        // back the other way. Since nothing about the input ever changes,
        // that 2-cycle repeats indefinitely: the entity vibrates in place and
        // never makes net progress, looking permanently stuck. Committing to
        // the previous choice breaks the cycle by not re-litigating it every
        // single frame.
        if (preferred && preferred.lengthSq() > 0 && this.isWalkableAlong(origin, preferred, probeDistance)) {
            return preferred;
        }

        for (const deg of this.DEFLECT_ANGLES) {
            const candidate = dir.clone().applyAxisAngle(this.UP, deg * Math.PI / 180);
            if (this.isWalkableAlong(origin, candidate, probeDistance)) return candidate;
        }

        // Enclosed on every side within probe range — stop rather than
        // reverse. Reversing here used to cause an every-frame flip-flop:
        // back away one tick, which un-blocks the original forward probe, so
        // next tick it drives forward again into the same wall — repeat
        // forever. Stopping breaks that loop; the caller's own target
        // selection (wander re-heading, next nearest-food pick) naturally
        // picks a new direction on a later tick.
        return new THREE.Vector3(0, 0, 0);
    }

    private static isWalkableAlong(origin: THREE.Vector3, dir: THREE.Vector3, probeDistance: number): boolean {
        return this.isWalkable(origin.x + dir.x * probeDistance, origin.z + dir.z * probeDistance);
    }
}
