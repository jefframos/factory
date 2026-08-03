// PhysicsConstants.ts
//
// Global tuning + the debug toggle for the kinematic physics module (see
// PhysicsWorld.ts/RigidBody.ts). This is a simple collide-and-slide system
// for top-down games, not a real simulation — no mass, no impulses, no
// rotation, just AABB overlap + push-out per axis.

/** Flip to true to render a wireframe box over every RigidBody's collider (see RigidBody.onAdded()). */
export const PHYSICS_DEBUG = true;

/** World-units/second^2 downward acceleration applied to every RigidBody with useGravity=true. */
export const GRAVITY = -20;

/**
 * Hard cap (seconds) on the delta PhysicsWorld.step() will ever integrate in one call.
 * Game.loop() computes delta from a raw performance.now() diff with no clamping (see
 * core/Game.ts) — any real stall on the main thread (e.g. the FBX character/animation
 * loads in PizzaScene.setupThirdPersonCharacter(), or the tab losing focus) reports one
 * huge delta on the frame it resumes. Since gravity/position integration is delta
 * multiplied twice (velocity += GRAVITY*delta, then position += velocity*delta), an
 * unclamped multi-second delta launches bodies clear across the map in a single step.
 */
export const MAX_PHYSICS_DELTA = 1 / 20;

/** Color used for the debug wireframe boxes. */
export const DEBUG_COLLIDER_COLOR = 0x00ff66;
/** Color used for the debug wireframe boxes of RigidBodies with isTrigger=true — kept visually distinct from solid colliders. */
export const DEBUG_TRIGGER_COLOR = 0xffee00;

/**
 * Very simple layer system: each RigidBody has one `layer` (which bucket it's in) and a
 * `mask` (which layers it's willing to interact with — physically collide with, or
 * trigger-overlap with). Two bodies only ever interact (solid push-out OR trigger events)
 * if EACH one's mask includes the other's layer — see PhysicsWorld.shouldInteract(). Bits,
 * not an enum, so a body can belong to exactly one layer but a mask can combine several
 * with `|`, e.g. `mask: Layers.Environment | Layers.Player`.
 */
export const Layers = {
    Default: 1 << 0,
    Player: 1 << 1,
    Environment: 1 << 2,
    Trigger: 1 << 3,
} as const;

/** Default mask — interacts with every layer. Pass an explicit `mask` on a RigidBody to narrow this. */
export const ALL_LAYERS = 0xffffffff;

/**
 * Small positive expansion applied only to the contact/event overlap query (see
 * PhysicsWorld.updateContacts()) — NOT to the push-out resolution check, which must stay
 * exactly as strict as it already is (see RigidBody.getMin/getMax's callers in
 * PhysicsWorld.step()). Without this, a body resting exactly touching another (the normal
 * steady state once push-out resolves a gap to zero) would read as "not overlapping" by
 * the strict `<` check and never fire onCollisionStay/onTriggerStay while at rest.
 */
export const CONTACT_SKIN = 0.01;
