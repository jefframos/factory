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

/**
 * Direct id lookup, regardless of role — lets an island override the
 * DEFAULT role-based base/milestone piece with a specific one of its own
 * (see IslandConfig.basePieceId) instead of only ever getting the single
 * global 'base'/'milestone' entry getStaticPiece() resolves to.
 */
export function getStaticPieceById(id: string): StaticPieceDefinition | undefined {
    return STATIC_PIECES.find(piece => piece.id === id);
}

/**
 * Overrides every currently-loaded static piece's `color` for `role` — used
 * by IslandViewScene's theme toggle (see GameThemeStorage) to recolor the
 * base/trapdoor panels and side walls per theme. Needed because
 * TowerBaseSync3D/TowerWallSync3D always prefer a configured piece's own
 * `color` over Tower3DConfig's baseColor/poleColor (which are only a
 * fallback for an unconfigured role — see that config's own doc), so just
 * changing baseColor/poleColor is otherwise a no-op whenever a role IS
 * configured, as every role in static-pieces-config.json currently is.
 * Mutates every matching entry, not just the one getStaticPiece() would
 * resolve to, so an island's basePieceId override (see IslandConfig)
 * picking a different 'milestone' variant (e.g. "base-2") still gets the
 * current theme's color too.
 */
export function setStaticPieceColor(role: StaticPieceRole, colorHex: string): void {
    for (const piece of STATIC_PIECES) {
        if (piece.role === role) {
            piece.color = colorHex;
        }
    }
}
