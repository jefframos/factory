export const SCALE_STEP = 0.15;
export const BOUNCE_DURATION = 0.4;
export const BOUNCE_AMPLITUDE = 0.3;
export const CUBE_GAP = 0.2; // extra breathing room between adjacent cubes

/** Starting value a fresh join gets — the boot menu's parked player preview, and handleJoinServer's default (unboosted) spawn size. */
export const DEFAULT_START_VALUE = 2;
/** Multiplier applied to DEFAULT_START_VALUE once the boot menu's "Start bigger" ad offer is claimed — see PlayerFlowController.renderBoost/handleClaimBoost. */
export const START_BOOST_MULTIPLIER = 16;

/** Seconds the real player is unkillable (no head-eats-head, no tail-snipe) right after spawning or reviving — see PlayerEntity.isInvincible / EntityEating.ts. */
export const SPAWN_INVINCIBILITY_DURATION = 5;

/** Base speed shared by every value — the player and every bot (PlayerEntity.moveSpeed is shared) move at the same speed regardless of size. */
export const MOVE_SPEED = 5;
/** Values at/below this get SMALL_VALUE_SPEED_BOOST — a small early-game edge so a fresh spawn (2/4/8/16) can outrun bigger threats instead of just being an easy first kill. */
export const SMALL_VALUE_SPEED_THRESHOLD = 16;
/** Speed multiplier applied at/below SMALL_VALUE_SPEED_THRESHOLD. */
export const SMALL_VALUE_SPEED_BOOST = 1.2;

/** Multiplier applied to moveSpeed for a short burst right after movement input starts from a standstill — see PlayerEntity.TAP_BOOST_DURATION. */
export const TAP_BOOST_MULTIPLIER = 1.5;
/** Seconds the tap-start speed boost lasts. */
export const TAP_BOOST_DURATION = 3;

/** Seconds to fully drain the manual (held) boost meter from full — see PlayerEntity.setBoosting. */
export const MANUAL_BOOST_DRAIN_DURATION = 3;
/** Seconds to fully refill the manual boost meter from empty. */
export const MANUAL_BOOST_RECHARGE_DURATION = 4;
/** Fraction of the meter that must refill after a full drain before holding can re-engage the boost — prevents an empty meter from instantly re-triggering on the next frame. */
export const MANUAL_BOOST_REENGAGE_THRESHOLD = 0.15;

export function sizeForValue(value: number): number {
    return 1 + (Math.log2(value) - 1) * SCALE_STEP;
}

/** Center-to-center follow distance between two cubes with the given values. */
export function followDist(valueA: number, valueB: number): number {
    return (sizeForValue(valueA) + sizeForValue(valueB)) * 0.5 + CUBE_GAP;
}

/** Abbreviate large numbers so they always fit on cube/gate textures. */
export function formatValue(n: number): string {
    if (n > 4096) {
        if (n >= 1e9) return `${Math.round(n / 1e9)}B`;
        if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
        return `${Math.round(n / 1e3)}k`;
    }
    return String(n);
}
