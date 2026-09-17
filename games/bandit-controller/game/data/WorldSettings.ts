// WorldSettings.ts
//
// Global physics tuning — single source of truth, read LIVE (not copied at
// import time) by PhysicsWorld.step() every tick, so editing these values
// (by hand, or via the dev-GUI sliders HubScene wires up — ?dev in the
// URL) takes effect immediately with no rebuild.

export interface WorldSettings {
    /** World-units/second^2 downward acceleration applied to every RigidBody with useGravity=true. */
    gravity: number;
    /**
     * Hard cap (seconds) on the delta PhysicsWorld.step() will ever integrate in one call.
     * Since gravity/position integration is delta multiplied twice (velocity += gravity*delta,
     * then position += velocity*delta), an unclamped multi-second delta (e.g. a tab losing
     * focus mid FBX load) would launch bodies clear across the map in a single step.
     */
    maxPhysicsDelta: number;
}

export const WORLD_SETTINGS: WorldSettings = {
    gravity: -30,
    maxPhysicsDelta: 1 / 20,
};
