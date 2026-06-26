export const SCALE_STEP = 0.15;
export const BOUNCE_DURATION = 0.4;
export const BOUNCE_AMPLITUDE = 0.3;
export const CUBE_GAP = 0.2; // extra breathing room between adjacent cubes

export function sizeForValue(value: number): number {
    return 1 + (Math.log2(value) - 1) * SCALE_STEP;
}

/** Center-to-center follow distance between two cubes with the given values. */
export function followDist(valueA: number, valueB: number): number {
    return (sizeForValue(valueA) + sizeForValue(valueB)) * 0.5 + CUBE_GAP;
}
