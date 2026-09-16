// PhysicsConstants.ts
//
// Global tuning for the kinematic physics module (see PhysicsWorld.ts/
// RigidBody.ts). This is a simple collide-and-slide system for top-down/
// platformer-lite games, not a real simulation — no mass, no impulses, no
// rotation, just AABB overlap + push-out per axis.

/** World-units/second^2 downward acceleration applied to every RigidBody with useGravity=true. */
export const GRAVITY = -20;

/**
 * Hard cap (seconds) on the delta PhysicsWorld.step() will ever integrate in one call.
 * Since gravity/position integration is delta multiplied twice (velocity += GRAVITY*delta,
 * then position += velocity*delta), an unclamped multi-second delta (e.g. a tab losing
 * focus mid FBX load) would launch bodies clear across the map in a single step.
 */
export const MAX_PHYSICS_DELTA = 1 / 20;

/** Color used for the debug wireframe boxes, when PHYSICS_DEBUG is on. */
export const DEBUG_COLLIDER_COLOR = 0xff0066;
export const DEBUG_TRIGGER_COLOR = 0xffee00;
export const PHYSICS_DEBUG = false;
export const PHYSICS_TRIGGER_DEBUG = false;

/**
 * Very simple layer system: each RigidBody has one `layer` (which bucket it's in) and a
 * `mask` (which layers it's willing to interact with). Two bodies only ever interact
 * (solid push-out OR trigger events) if EACH one's mask includes the other's layer — see
 * PhysicsWorld.shouldInteract().
 */
export const Layers = {
    Default: 1 << 0,
    Player: 1 << 1,
    Environment: 1 << 2,
} as const;

/** Default mask — interacts with every layer. Pass an explicit `mask` on a RigidBody to narrow this. */
export const ALL_LAYERS = 0xffffffff;

/**
 * Small positive expansion applied only to the contact/event overlap query (see
 * PhysicsWorld.updateContacts()) — NOT to the push-out resolution check. Without this, a
 * body resting exactly touching another (push-out's steady state) would read as "not
 * overlapping" by the strict `<` check and never fire onCollisionStay while at rest.
 */
export const CONTACT_SKIN = 0.01;
