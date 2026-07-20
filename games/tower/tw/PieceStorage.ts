// PieceStorage.ts

import * as PIXI from 'pixi.js';

export interface PieceDefinition {
    id: string;
    /** Level a piece first becomes eligible to spawn at — see PieceManager. */
    level: number;
    /** Not currently used for geometry (blocks render as a single cube) — kept for future multi-cell shapes. */
    shape: number[][];
    /** Multiplies blockWidth/blockHeight (2D) and cube size (3D) — 1 is the standard block, >1 is a bigger cube. */
    scale: number;
    /** Hex color applied to the block's body. */
    color: string;
    /** Relative path under images/non-preload/ — e.g. "skins/dog.webp". Resolve with resolvePieceImagePath(). */
    texture: string;
}

/**
 * Piece art is served straight from the asset pipeline's non-preload output
 * (raw-assets/non-preload/skins/*.webp), not bundled by Vite — same
 * convention as IslandStorage.resolveIslandImagePath / ShopStorage's icons.
 */
const NON_PRELOAD_IMAGE_BASE = 'tower/images/non-preload/';

export function resolvePieceImagePath(relativePath: string): string {
    return `${NON_PRELOAD_IMAGE_BASE}${relativePath}`;
}

/**
 * Populated in place from the 'json' PIXI bundle (raw-assets/json/pieces-config.json)
 * once it finishes loading — see MyGame.loadAssets() in index.ts. Kept as a
 * mutated const array (rather than reassigned) so existing imports of
 * PIECES stay valid references.
 */
export const PIECES: PieceDefinition[] = [];

/** Call once the 'json' PIXI.Assets bundle has loaded — see index.ts loadAssets(). */
export function loadPieces(): void {
    const pieces = PIXI.Assets.get('pieces-config.json') as PieceDefinition[];
    PIECES.splice(0, PIECES.length, ...pieces);
}
