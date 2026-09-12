// PieceShapeMode.ts

import { PIECES, type PieceDefinition } from './PieceStorage';

export type PieceShapeMode = 'circle' | 'cube';

let currentMode: PieceShapeMode = 'circle';

/**
 * Each piece's ORIGINAL (circle) polygon, stashed the first time
 * setPieceShapeMode() runs. loadPieces() (see PieceStorage) populates
 * PIECES fresh from pieces-config.json, already carrying its authored
 * circle `polygon` — this just captures that once, before 'cube' mode
 * clears it, so switching back to 'circle' restores it exactly instead of
 * needing a second copy of the circle geometry anywhere.
 */
const originalPolygons = new Map<string, PieceDefinition['polygon']>();

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
        if (!originalPolygons.has(piece.id)) {
            originalPolygons.set(piece.id, piece.polygon);
        }

        piece.polygon = mode === 'cube' ? undefined : originalPolygons.get(piece.id);
    }
}
