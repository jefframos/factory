import { WaterSplashSystem } from "../vfx/WaterSplashSystem";

const SPAWN_INTERVAL_DIST = 0.35; // world units of travel between splash bursts
const MIN_MOVE_EPS = 0.001;       // below this counts as "not moving" (ignore floating-point jitter)
const BACK_OFFSET = 0.4;          // world units behind the entity's center where the splash appears

/**
 * Water-splash trigger — watches an entity's own XZ position frame to frame
 * and kicks a burst into the shared WaterSplashSystem pool every
 * SPAWN_INTERVAL_DIST of actual travel. Standing still (or barely drifting)
 * emits nothing; no separate "isMoving" flag needed from the caller.
 *
 * Attach one instance per water-riding entity — e.g. PlayerEntity's head
 * today, TailCube later — and call update(x, z) once per frame with its
 * current world position. Everything else (the shared draw call, particle
 * pool, physics) lives in WaterSplashSystem and needs no per-entity wiring.
 */
export class WaterSplashEmitter {
    private lastX: number | null = null;
    private lastZ: number | null = null;
    private distSinceLastSpawn = 0;

    update(x: number, z: number): void {
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
        if (moved < MIN_MOVE_EPS) return;

        this.distSinceLastSpawn += moved;
        if (this.distSinceLastSpawn < SPAWN_INTERVAL_DIST) return;
        this.distSinceLastSpawn = 0;

        const dirX = dx / moved;
        const dirZ = dz / moved;
        WaterSplashSystem.spawn(x - dirX * BACK_OFFSET, z - dirZ * BACK_OFFSET, dirX, dirZ);
    }
}
