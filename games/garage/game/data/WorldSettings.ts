// WorldSettings.ts
//
// This game's own live-tunable physics settings — read LIVE (not copied at
// import time) by PhysicsWorld.step() every tick (see WorldEnvironment.ts,
// which passes this same object into `new World(WORLD_SETTINGS)`), so
// editing these values (by hand, or via the dev-GUI sliders HubScene wires
// up — ?dev in the URL) takes effect immediately with no rebuild.

export type { WorldSettings } from 'core/physics/WorldSettings';
import type { WorldSettings } from 'core/physics/WorldSettings';

export const WORLD_SETTINGS: WorldSettings = {
    gravity: -30,
    maxPhysicsDelta: 1 / 20,
};
