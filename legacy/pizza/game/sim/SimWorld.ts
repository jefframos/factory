import * as THREE from 'three';
import type { CollectibleManager } from '../systems/CollectibleManager';
import type { BoundlessChunkManager } from '../world/BoundlessChunkManager';
import { PlayerEntity } from '../entities/PlayerEntity';

// ── Public types ──────────────────────────────────────────────────────────────

/** One cube from an entity's tail: position + value. Weakest is always last. */
export type TailEntry = { position: THREE.Vector3; value: number };

/** Read-only view of a nearby entity returned by SimWorld.query(). */
export type EntitySnapshot = {
    position: THREE.Vector3;
    /** World-space point just in front of this entity's face — lets callers work out which way it's facing (eatPosition - position) without needing its raw rotation. */
    eatPosition: THREE.Vector3;
    value: number;
    /** Sorted descending by value. tail[last] is the weakest cube — the snipe target. */
    tail: TailEntry[];
    /** True for the one entity tagged via SimWorld.setPlayer — lets a query tell the real player apart from every bot without an identity check of its own. */
    isPlayer: boolean;
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
    readonly eatPosition: THREE.Vector3;
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
    private static entities = new Set<ISimEntity>();
    private static collectibles: CollectibleManager | null = null;
    private static chunks: BoundlessChunkManager | null = null;
    /** The human-controlled entity, if any — lets queries opt out of seeing it (debug/AI-testing). */
    private static player: ISimEntity | null = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    static init(collectibles: CollectibleManager, chunks: BoundlessChunkManager): void {
        this.entities.clear();
        this.collectibles = collectibles;
        this.chunks = chunks;
        this.player = null;
    }

    static reset(): void {
        this.entities.clear();
        this.collectibles = null;
        this.chunks = null;
        this.player = null;
    }

    static register(entity: ISimEntity): void { this.entities.add(entity); }
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
            if ((this.player as PlayerEntity).isInvincible) continue;
            const dx = e.position.x - origin.x;
            const dz = e.position.z - origin.z;
            if (dx * dx + dz * dz <= r2) {
                entities.push({
                    position: e.position,
                    eatPosition: e.eatPosition,
                    value: e.value,
                    tail: e.tailSnapshot(),
                    isPlayer: e === this.player,
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
     * Deflection angles (degrees) tried around the desired heading, nearest
     * first, alternating sides. 180 (full reverse) is last-resort only — it's
     * a real U-turn, not a slide, for when every forward-ish option is boxed in.
     */
    private static readonly DEFLECT_ANGLES = [30, -30, 60, -60, 90, -90, 135, -135, 180];
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
     * @param radius        Entity's own collision radius — widens each probe
     *                      to check the entity's shoulders, not just its
     *                      center ray (see isWalkableAlong). Defaults to a
     *                      quarter of probeDistance if not given.
     */
    static resolveDirection(
        origin: THREE.Vector3,
        dir: THREE.Vector3,
        probeDistance: number,
        preferred?: THREE.Vector3 | null,
        radius: number = probeDistance / 4,
    ): THREE.Vector3 {
        if (this.isWalkableAlong(origin, dir, probeDistance, radius)) return dir;

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
        if (preferred && preferred.lengthSq() > 0 && this.isWalkableAlong(origin, preferred, probeDistance, radius)) {
            return preferred;
        }

        for (const deg of this.DEFLECT_ANGLES) {
            const candidate = dir.clone().applyAxisAngle(this.UP, deg * Math.PI / 180);
            if (this.isWalkableAlong(origin, candidate, probeDistance, radius)) return candidate;
        }

        // Enclosed on every side within probe range (even the 180 U-turn) —
        // truly nowhere to go right now. The caller's own target selection
        // (wander re-heading, next nearest-food pick) naturally picks a new
        // direction on a later tick.
        return new THREE.Vector3(0, 0, 0);
    }

    /**
     * Checks not just the center point at the end of the ray but also the two
     * points offset ±radius perpendicular to it — i.e. the entity's left/right
     * "shoulders" at that distance, not just a single infinitely-thin ray.
     * A bare center-point probe reports "clear" for a heading that grazes past
     * a corner with room for a point but not the entity's actual body, and
     * right at a grid-cell boundary that single point flickers between
     * walkable/blocked as the entity shifts by fractions of a unit — this is
     * what caused the "resolved direction jumps between unrelated headings
     * every frame while the desired heading stays fixed" flicker at corners.
     */
    private static isWalkableAlong(origin: THREE.Vector3, dir: THREE.Vector3, probeDistance: number, radius: number): boolean {
        const cx = origin.x + dir.x * probeDistance;
        const cz = origin.z + dir.z * probeDistance;
        if (!this.isWalkable(cx, cz)) return false;

        const perpX = -dir.z, perpZ = dir.x; // dir is normalised & flat (y=0), so this is its 2D perpendicular
        if (!this.isWalkable(cx + perpX * radius, cz + perpZ * radius)) return false;
        if (!this.isWalkable(cx - perpX * radius, cz - perpZ * radius)) return false;
        return true;
    }

    private static readonly RECOVERY_SAMPLE_COUNT = 16; // directions scanned around the full circle
    private static readonly RECOVERY_STEP = 1;           // world-units per march step while scanning

    /**
     * Wide-arc recovery scan for a stuck watchdog (see BotController's
     * applyStuckEscape tier 2): samples RECOVERY_SAMPLE_COUNT directions
     * around a full circle — starting from a random offset each call so a
     * repeat failure doesn't keep re-probing the exact same angles — and
     * marches each one outward in RECOVERY_STEP increments (using the same
     * width-aware check as resolveDirection) until it hits something or
     * reaches maxProbe. Returns the direction that got furthest before being
     * blocked, or null if every sampled direction is blocked immediately
     * (fully enclosed within probe range).
     *
     * This is a one-shot "where's the open space" scan for escalated stuck
     * recovery, not per-frame steering — resolveDirection's short-range,
     * incremental deflection is what normally handles obstacle avoidance.
     */
    static findClearDirection(origin: THREE.Vector3, radius: number, maxProbe: number): THREE.Vector3 | null {
        const startAngle = Math.random() * Math.PI * 2;
        let bestDir: THREE.Vector3 | null = null;
        let bestDist = 0;

        for (let i = 0; i < this.RECOVERY_SAMPLE_COUNT; i++) {
            const angle = startAngle + (i / this.RECOVERY_SAMPLE_COUNT) * Math.PI * 2;
            const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));

            let dist = 0;
            while (dist + this.RECOVERY_STEP <= maxProbe && this.isWalkableAlong(origin, dir, dist + this.RECOVERY_STEP, radius)) {
                dist += this.RECOVERY_STEP;
            }
            if (dist > bestDist) { bestDist = dist; bestDir = dir; }
        }

        return bestDist > 0 ? bestDir : null;
    }
}
