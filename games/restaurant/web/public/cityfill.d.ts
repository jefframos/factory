// cityfill.d.ts — the types of cityfill.js (filling a city block with buildings; shared by the game and the editor).

export type BlockKind = 'living' | 'business' | 'mixed';

/** A lawn that's a city block: its buildings' kind, the seed that picks them, how far in from its sides, how far apart. */
export interface BlockFill {
    kind?: BlockKind;
    seed?: number;
    setback?: number;
    gap?: number;
}

/** A building that can stand on a block: its model, its kind, its height, and its size there (along its own x and z). */
export interface PoolBuilding {
    model: string;
    kind: 'living' | 'business';
    height: number;
    width: number;
    depth: number;
}

export interface PlacedBuilding {
    model: string;
    height: number;
    x: number;
    z: number;
    rotationY: number;
}

export function fillBlock(lawn: { points: { x: number; z: number }[]; buildings?: BlockFill }, pool: readonly PoolBuilding[]): PlacedBuilding[];
