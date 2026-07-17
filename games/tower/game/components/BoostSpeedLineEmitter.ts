import { BoostSpeedLineSystem } from "../vfx/BoostSpeedLineSystem";

const SPAWN_INTERVAL_DIST = 0.3; // world units of travel between streak bursts
const MIN_MOVE_EPS = 0.001;      // below this counts as "not moving" (ignore floating-point jitter)

/**
 * Boost speed-line trigger — watches an entity's own XZ position frame to
 * frame and kicks a burst into the shared BoostSpeedLineSystem pool every
 * SPAWN_INTERVAL_DIST of travel, but only while `boosting` is true. Mirrors
 * WaterSplashEmitter's shape; the difference is the boosting gate instead of
 * an always-on "is it moving" check, since these should only appear during a
 * boost, not regular cruising.
 *
 * Attach one instance per entity that can boost (currently just the player —
 * see PlayerEntity) and call update() once per frame with its current world
 * position, boost state, and current size (ClogConstants.sizeForValue(value))
 * so streaks stay scaled to that entity.
 */
export class BoostSpeedLineEmitter {
    private lastX: number | null = null;
    private lastZ: number | null = null;
    private distSinceLastSpawn = 0;

    update(x: number, z: number, boosting: boolean, size: number): void {
        if (this.lastX === null || this.lastZ === null) {
            this.lastX = x;
            this.lastZ = z;
            return;
        }

        const dx = x - this.lastX;
        const dz = z - this.lastZ;
        const moved = Math.hypot(dx, dz);
        this.lastX = x;
        this.lastZ = z;

        if (!boosting) {
            this.distSinceLastSpawn = 0;
            return;
        }
        if (moved < MIN_MOVE_EPS) return;

        this.distSinceLastSpawn += moved;
        if (this.distSinceLastSpawn < SPAWN_INTERVAL_DIST) return;
        this.distSinceLastSpawn = 0;

        const dirX = dx / moved;
        const dirZ = dz / moved;
        BoostSpeedLineSystem.spawn(x, z, dirX, dirZ, size);
    }
}
