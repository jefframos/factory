// WorldSettings.ts
//
// Global physics tuning, read LIVE (not copied at import time) by
// PhysicsWorld.step() every tick, so editing these values (by hand, or via
// a dev-GUI) takes effect immediately with no rebuild. PhysicsWorld takes
// one of these per instance (see its constructor) instead of importing a
// single shared object, so each game can own/tune its own live copy —
// pass DEFAULT_WORLD_SETTINGS through as-is for anything that doesn't need
// custom tuning.

export interface WorldSettings {
    /** World-units/second^2 downward acceleration applied to every RigidBody with useGravity=true. */
    gravity: number;
    /**
     * Hard cap (seconds) on the delta PhysicsWorld.step() will ever integrate in one call.
     * Since gravity/position integration is delta multiplied twice (velocity += gravity*delta,
     * then position += velocity*delta), an unclamped multi-second delta (e.g. a tab losing
     * focus mid asset load) would launch bodies clear across the map in a single step.
     */
    maxPhysicsDelta: number;
}

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
    gravity: -30,
    maxPhysicsDelta: 1 / 20,
};
