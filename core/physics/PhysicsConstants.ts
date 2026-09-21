// PhysicsConstants.ts
//
// Global tuning for the kinematic physics module (see PhysicsWorld.ts/
// RigidBody.ts). This is a simple collide-and-slide system for top-down/
// platformer-lite games, not a real simulation — no mass, no impulses, no
// rotation, just AABB overlap + push-out per axis.
//
// Gravity/max-physics-delta live in WorldSettings.ts instead of here — see
// that file's own doc.

/** Color used for the debug wireframe boxes, when PHYSICS_DEBUG is on. */
export const DEBUG_COLLIDER_COLOR = 0xff0066;
export const DEBUG_TRIGGER_COLOR = 0xffee00;
/**
 * Opacity of the debug wireframe boxes (see RigidBody.awake()) — well under 1 for two
 * reasons: it reads less like a solid outline glued onto the mesh it wraps, and (paired with
 * `depthTest: false` on the same material) it stays visible where a collider box is sized/
 * positioned exactly the same as its own opaque visual mesh — e.g. ObstacleBuilder's
 * full-height hit-zone trigger, which is coincident with the obstacle's own solid box and
 * would otherwise just z-fight against it and mostly disappear.
 */
export const DEBUG_COLLIDER_OPACITY = 0.35;

/**
 * Whether to render a wireframe box over every RigidBody's collider — `PHYSICS_DEBUG` for
 * solid colliders, `PHYSICS_TRIGGER_DEBUG` for triggers (see RigidBody.awake()). `let`, not
 * `const`, so setPhysicsDebugFlags() below can flip them at runtime. Both false by default.
 */
export let PHYSICS_DEBUG = false;
export let PHYSICS_TRIGGER_DEBUG = false;

/**
 * Sets PHYSICS_DEBUG/PHYSICS_TRIGGER_DEBUG at runtime — call once at boot, before any
 * RigidBody awake()s (i.e. before a scene's entities spawn), since awake() only reads these
 * once, at construction time, not every frame. A field omitted from `flags` leaves that flag
 * exactly as it already was.
 */
export function setPhysicsDebugFlags(flags: { collider?: boolean; trigger?: boolean }): void {
    if (flags.collider !== undefined) {
        PHYSICS_DEBUG = flags.collider;
    }
    if (flags.trigger !== undefined) {
        PHYSICS_TRIGGER_DEBUG = flags.trigger;
    }
}

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
