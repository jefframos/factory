// PieceIconRenderer.ts

import * as PIXI from 'pixi.js';
import { DEFAULT_FACE_TOWER_CONFIG } from '../FaceTowerConfig';
import { resolvePieceImagePath, type PieceDefinition } from '../PieceStorage';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Draws a piece's REAL look (shape/color + face texture) into `icon`, sized
 * off `size` — shared by PieceProgressionBar (each catalog slot) and
 * GateProgressPanel (the single "next requirement" box), so both read as
 * the exact same piece art instead of two independent approximations.
 * Callers own any further treatment (PieceProgressionBar's locked black-tint
 * overlay, for instance) — this only ever draws the plain, real piece.
 */
export class PieceIconRenderer {
    /** Matches PieceSnapshotTool's default `size` setting — see NextPiecePreview's own identical constant. */
    private static readonly SNAPSHOT_SIZE = 128;

    /**
     * With the 3D layer active and shapeMode 'circle', shows the piece's
     * real pre-rendered PieceSnapshotTool image (same asset
     * NextPiecePreview's "next piece" swatch uses) instead of a flat drawn
     * shape — reads as the actual polished piece rather than an
     * approximation. Falls back to the flat draw otherwise: 'cube' mode
     * (the snapshot is baked for the circle outline specifically — see
     * PieceShapeMode — so it would show the wrong shape while cubes are
     * active), 2D-only mode (no 3D render to have snapshotted), or if the
     * image simply fails to load.
     *
     * `onDrawn`, if given, fires once synchronously after the icon's
     * content is added (tint/alpha are sprite-level properties, safe to
     * apply immediately even before a still-loading texture's pixels
     * arrive) — AND, only for a snapshot that then fails to load, fires
     * AGAIN once the flat-draw fallback replaces it. Callers that apply
     * further treatment on top (PieceProgressionBar's locked black-tint
     * overlay, for instance) should do it from `onDrawn` and make that
     * treatment idempotent (safe to re-run), rather than applying it right
     * after this call returns — otherwise a fallback swap silently drops
     * the treatment from the freshly-added content.
     */
    public static draw(
        icon: PIXI.Container,
        piece: PieceDefinition,
        size: number,
        shapeMode: 'circle' | 'cube',
        onDrawn?: () => void,
    ): void {
        if (piece.icon) {
            PieceIconRenderer.drawIcon(icon, piece, size);
            onDrawn?.();
            return;
        }

        if (shapeMode === 'circle' && DEFAULT_FACE_TOWER_CONFIG.render3D) {
            PieceIconRenderer.drawSnapshot(icon, piece, size, onDrawn);
            return;
        }

        PieceIconRenderer.drawFlat(icon, piece, size);
        onDrawn?.();
    }

    /**
     * `piece.icon` (a bare frame name, same PIXI.Sprite.from() convention as
     * PowerupDefinition.icon) takes priority over both the pre-rendered 3D
     * snapshot and the flat shape+face draw — no colored shape drawn behind
     * it, since the icon image is already the complete piece art.
     * `piece.iconScale` multiplies its default size, same convention as
     * `faceScale`.
     */
    private static drawIcon(icon: PIXI.Container, piece: PieceDefinition, size: number): void {
        const spriteSize = size * 0.85;
        const scale = piece.iconScale ?? { x: 1, y: 1 };
        const sprite = PIXI.Sprite.from(piece.icon!);

        sprite.anchor.set(0.5);
        sprite.width = spriteSize * scale.x;
        sprite.height = spriteSize * scale.y;
        icon.addChild(sprite);
    }

    private static resolveSnapshotPath(pieceId: string): string {
        return resolvePieceImagePath(`pieces/tower-piece-snapshots_${pieceId}_${PieceIconRenderer.SNAPSHOT_SIZE}x${PieceIconRenderer.SNAPSHOT_SIZE}.webp`);
    }

    private static drawSnapshot(icon: PIXI.Container, piece: PieceDefinition, size: number, onDrawn?: () => void): void {
        const spriteSize = size * 0.85;
        const texture = PIXI.Texture.from(PieceIconRenderer.resolveSnapshotPath(piece.id));
        const sprite = new PIXI.Sprite(texture);

        sprite.anchor.set(0.5);
        sprite.width = spriteSize;
        sprite.height = spriteSize;
        icon.addChild(sprite);
        onDrawn?.();

        if (!texture.baseTexture.valid) {
            texture.baseTexture.once('error', () => {
                // Still showing (i.e. this icon hasn't already been redrawn
                // for something else since) — this piece just has no
                // pre-rendered snapshot, fall back to the flat draw instead
                // of a broken image.
                if (icon.children.includes(sprite)) {
                    sprite.destroy();
                    PieceIconRenderer.drawFlat(icon, piece, size);
                    onDrawn?.();
                }
            });
        }
    }

    /** Same shape+face draw NextPiecePreview.showDrawn() uses. */
    public static drawFlat(icon: PIXI.Container, piece: PieceDefinition, size: number): void {
        const shapeSize = size * 0.7;
        const longestAxis = Math.max(piece.scale.x, piece.scale.y);
        const pixelsPerUnit = shapeSize / longestAxis;
        const w = piece.scale.x * pixelsPerUnit;
        const h = piece.scale.y * pixelsPerUnit;

        const shape = new PIXI.Graphics();

        shape.lineStyle(1.5, 0x000000, 1);
        shape.beginFill(hexStringToNumber(piece.color), 1);

        if (piece.polygon) {
            shape.drawPolygon(piece.polygon.flatMap(p => [p.x * w, p.y * h]));
        } else {
            shape.drawRect(0, 0, w, h);
        }

        shape.endFill();
        shape.pivot.set(w * 0.5, h * 0.5);
        shape.visible = !piece.hideMesh;
        icon.addChild(shape);

        if (piece.texture) {
            const face = PIXI.Sprite.from(resolvePieceImagePath(piece.texture));
            const faceScale = piece.faceScale ?? { x: 1, y: 1 };
            const faceSize = Math.min(w, h) * 0.8;

            face.anchor.set(0.5);
            face.width = faceSize * faceScale.x;
            face.height = faceSize * faceScale.y;
            icon.addChild(face);
        }
    }
}
