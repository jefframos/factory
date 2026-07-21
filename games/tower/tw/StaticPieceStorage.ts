// StaticPieceStorage.ts

import * as PIXI from 'pixi.js';
import type { PieceDefinition } from './PieceStorage';

/**
 * Which always-present structural slot a static piece fills:
 *  - 'base': the very first floor panel the tower starts on (see
 *    TowerBaseSync3D) — the "wide arch with two tall pieces on the sides"
 *    setup lives here (paired with 'column' below).
 *  - 'column': the side containment poles flush against a base's edges
 *    (see TowerWallSync3D — mirrors TowerDeadZoneController's walls). Same
 *    piece definition is reused for both poles.
 *  - 'milestone': the fresh floor panel placed every time a zone completes
 *    (see FaceTowerBlockController.addBase / FaceTowerGameController.completeTurn).
 */
export type StaticPieceRole = 'base' | 'column' | 'milestone';

export interface StaticPieceDefinition extends PieceDefinition {
    role: StaticPieceRole;
}

/**
 * Populated in place from the 'json' PIXI bundle
 * (raw-assets/json/static-pieces-config.json) once it finishes loading —
 * see MyGame.loadAssets() in index.ts. Kept as a mutated const array (rather
 * than reassigned) so existing imports of STATIC_PIECES stay valid references
 * — same convention as PieceStorage.PIECES.
 */
export const STATIC_PIECES: StaticPieceDefinition[] = [];

/** Call once the 'json' PIXI.Assets bundle has loaded — see index.ts loadAssets(). */
export function loadStaticPieces(): void {
    const pieces = PIXI.Assets.get('static-pieces-config.json') as StaticPieceDefinition[];
    STATIC_PIECES.splice(0, STATIC_PIECES.length, ...pieces);
}

/** First registered piece for `role`, or undefined if none configured — callers should fall back to a plain default look rather than throw, since these are optional visual overrides. */
export function getStaticPiece(role: StaticPieceRole): StaticPieceDefinition | undefined {
    return STATIC_PIECES.find(piece => piece.role === role);
}
