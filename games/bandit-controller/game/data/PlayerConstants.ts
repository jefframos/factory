// PlayerConstants.ts
//
// Small movement constants shared by BOTH player movement controllers
// (PlayerMovementController and SwipeRunnerController) — kept in one place
// so tuning one (e.g. jump height) can't silently drift out of sync
// between the two.

/** Vertical launch speed applied to the RigidBody on jump, world units/second — with GRAVITY = -20 (see PhysicsConstants.ts) this reaches an apex of speed^2 / (2 * 20) world units up. */
export const JUMP_SPEED = 11;
