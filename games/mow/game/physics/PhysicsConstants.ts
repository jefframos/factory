// PhysicsConstants.ts
//
// Global tuning + the debug toggle for the kinematic physics module (see
// PhysicsWorld.ts/RigidBody.ts). This is a simple collide-and-slide system
// for top-down games, not a real simulation — no mass, no impulses, no
// rotation, just AABB overlap + push-out per axis.

/**
 * Whether to render a wireframe box over every RigidBody's collider — `PHYSICS_DEBUG` for
 * solid colliders, `PHYSICS_TRIGGER_DEBUG` for triggers (see RigidBody.awake()). `let`, not
 * `const`, so setPhysicsDebugFlags() below can flip them at runtime — see that function's own
 * doc for why (the pizza web editor's two header toggles, read via a cookie in dev mode).
 * Both false by default, same as before either was runtime-settable.
 */
export let PHYSICS_DEBUG = false;
export let PHYSICS_TRIGGER_DEBUG = false;

/**
 * Sets PHYSICS_DEBUG/PHYSICS_TRIGGER_DEBUG at runtime — called once at boot, in dev mode only,
 * from the game's own cookie read (see game/utils/DebugPhysicsCookie.ts), which mirrors the
 * pizza web editor header's two "Debug Colliders"/"Debug Triggers" toggles. A field omitted
 * from `flags` leaves that flag exactly as it already was — undefined never means "turn this
 * one off," only "this call has nothing to say about it." Must run BEFORE any RigidBody
 * awake()s (i.e. before the world's entities spawn — see PizzaScene setup), since awake() only
 * reads these once, at construction time, not every frame.
 */
export function setPhysicsDebugFlags(flags: { collider?: boolean; trigger?: boolean }): void {
    if (flags.collider !== undefined) {
        PHYSICS_DEBUG = flags.collider;
    }
    if (flags.trigger !== undefined) {
        PHYSICS_TRIGGER_DEBUG = flags.trigger;
    }
}

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
export const DEBUG_COLLIDER_COLOR = 0xff0066;
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
    /** ResourceNode's own gather-radius trigger — see game/player/ResourceNode.ts. */
    Resource: 1 << 4,
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
