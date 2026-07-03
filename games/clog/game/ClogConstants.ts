export const SCALE_STEP = 0.15;
export const BOUNCE_DURATION = 0.4;
export const BOUNCE_AMPLITUDE = 0.3;
export const CUBE_GAP = 0.2; // extra breathing room between adjacent cubes

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
