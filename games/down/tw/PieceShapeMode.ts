// PieceShapeMode.ts

import { PIECES, type PieceDefinition } from './PieceStorage';

export type PieceShapeMode = 'circle' | 'cube';

let currentMode: PieceShapeMode = 'circle';

/**
 * Each piece's ORIGINAL (circle) polygon, stashed the first time
 * setPieceShapeMode() runs. loadPieces() (see PieceStorage) populates
 * PIECES fresh from its catalog, already carrying its authored circle
 * `polygon` — this just captures that once, before 'cube' mode clears it, so
 * switching back to 'circle' restores it exactly instead of needing a
 * second copy of the circle geometry anywhere.
 *
 * Keyed by the piece OBJECT itself (WeakMap), not `piece.id` — GameThemeStorage's
 * catalogs (pieces-config.json vs pieces-config-cats.json) reuse the same
 * ids for their tier ladder but are genuinely different piece objects (each
 * loadPieces() call swaps PIECES to a different catalog's own objects). A
 * plain Map keyed by id would have one catalog's cached original bleed into
 * the other's same-named piece — harmless while every catalog happens to
 * share the same circle radius, but wrong the moment one doesn't.
 */
const originalPolygons = new WeakMap<PieceDefinition, PieceDefinition['polygon']>();

export function getPieceShapeMode(): PieceShapeMode {
    return currentMode;
}

/**
 * Swaps every catalog piece's `polygon` between its authored circle outline
 * and `undefined` — an unset `polygon` is already a fully supported path
 * throughout the piece pipeline (FaceTowerBlockController.buildBoxEntity/
 * PieceBoxBuilder/BlockBodyTextureCache all fall back to a plain rect for
 * both the 2D collision shape and the 3D mesh when `polygon` is absent), so
 * "cube mode" needs no new shape code at all — just clearing the field.
 *
 * Only affects pieces spawned AFTER this call — the caller (see
 * ShapeModeToggleButton's sole consumer, IslandViewScene) is expected to
 * also reset the run for a clean visual switch, same as GameOverPopup's
 * Replay button already does, rather than leaving old-shaped pieces mixed
 * in on the current board.
 */
export function setPieceShapeMode(mode: PieceShapeMode): void {
    currentMode = mode;

    for (const piece of PIECES) {
        if (!originalPolygons.has(piece)) {
            originalPolygons.set(piece, piece.polygon);
        }

        piece.polygon = mode === 'cube' ? undefined : originalPolygons.get(piece);
    }
}
