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

/** Abbreviate large numbers so they always fit on cube/gate textures. */
export function formatValue(n: number): string {
    if (n > 4096) {
        if (n >= 1e9) return `${Math.round(n / 1e9)}B`;
        if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
        return `${Math.round(n / 1e3)}k`;
    }
    return String(n);
}
