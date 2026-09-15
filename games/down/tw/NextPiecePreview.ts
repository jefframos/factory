// NextPiecePreview.ts

import { Game } from 'core/Game';
import * as PIXI from 'pixi.js';
import { resolvePieceImagePath, type PieceDefinition } from './PieceStorage';
import { DEFAULT_FACE_TOWER_CONFIG } from './FaceTowerConfig';
import Assets from '../Assets';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/** Matches PieceSnapshotTool's default `size` setting at the time these pre-rendered images were generated — the swatch always requests this exact size, so regenerating at a different size means re-pointing this too. */
const SNAPSHOT_SIZE = 128;

/** e.g. "arch-1" → "tower/images/non-preload/pieces/tower-piece-snapshots_arch-1_256x256.webp" — see PieceSnapshotTool's DOWNLOAD_FOLDER/filenameFor(), just flattened into one filename (folder name + id + size) and converted to .webp once it lands in raw-assets. */
function resolvePieceSnapshotPath(pieceId: string): string {
    return resolvePieceImagePath(`pieces/tower-piece-snapshots_${pieceId}_${SNAPSHOT_SIZE}x${SNAPSHOT_SIZE}.webp`);
}

/**
 * Small HUD swatch showing the piece that will spawn once the currently
 * held one is dropped — a shape (rect or polygon, tinted to the piece's
 * color) plus its face texture, normalized to fit a fixed box regardless of
 * the piece's own aspect ratio (same draw approach as PieceDevGui's
 * gallery). Purely cosmetic — FaceTowerGameController.getNextPiece() stays
 * the actual source of truth for what spawns next; call show() whenever
 * FaceTowerGameEvents.onNextPieceChanged fires.
 *
 * Laid out HORIZONTALLY — the "NEXT" label to the left, the swatch box to
 * its right — so the whole widget reads as a compact wide strip rather
 * than a tall stack, meant to sit right beside the mute button (see
 * GameHud.layout()) instead of below it.
 *
 * pinTopLeft() is unused (GameHud.layout() explicitly positions this every
 * frame instead) — kept only because it's part of this class's existing
 * public surface, not because anything still calls it.
 */
export class NextPiecePreview extends PIXI.Container {
    private static readonly BOX_SIZE = 56;
    private static readonly LABEL_GAP = 6;
    private static readonly MARGIN = 20;

    private readonly container: PIXI.Container;
    private readonly swatch: PIXI.Container;

    public constructor() {
        super();
        this.container = new PIXI.Container();

        const label = new PIXI.Text('NEXT', {
            ...Assets.TextStyles.NextLabel
        });

        label.anchor.set(0, 0.5);
        label.position.set(0, NextPiecePreview.BOX_SIZE * 0.5);
        this.container.addChild(label);

        const swatchX = label.width + NextPiecePreview.LABEL_GAP;

        const background = new PIXI.NineSlicePlane(PIXI.Texture.from('Button01_s_White_Light1'), 30, 30, 30, 30);
        background.width = NextPiecePreview.BOX_SIZE
        background.height = NextPiecePreview.BOX_SIZE
        background.x = swatchX
        this.container.addChild(background);

        this.swatch = new PIXI.Container();
        this.swatch.position.set(swatchX, 0);
        this.container.addChild(this.swatch);

        this.addChild(this.container);
    }

    /** Call every frame — repositions against the CURRENT visible top-left corner, so it stays put across a resize/orientation change instead of only being placed once at construction. */
    public pinTopLeft(): void {
        const topLeft = Game.gameScreenData.topLeft;
        this.container.position.set(topLeft.x + NextPiecePreview.MARGIN, topLeft.y + NextPiecePreview.MARGIN);
    }

    /**
     * Redraws the swatch for `piece` — call on construction and every
     * FaceTowerGameEvents.onNextPieceChanged. When the 3D layer is active
     * (DEFAULT_FACE_TOWER_CONFIG.render3D), shows the piece's pre-rendered
     * PieceSnapshotTool image instead of the flat 2D shape+face draw — a
     * real 3D-lit render reads better alongside the 3D gameplay view than
     * the flat swatch does. Falls back to the drawn 2D swatch if that
     * image fails to load (e.g. a piece with no pre-rendered snapshot yet,
     * like a powerup's synthesized id) so a missing file never shows a
     * broken image.
     */
    public show(piece: PieceDefinition): void {
        for (const child of this.swatch.removeChildren()) {
            child.destroy();
        }

        if (piece.icon) {
            this.showIcon(piece);
        } else if (DEFAULT_FACE_TOWER_CONFIG.render3D) {
            this.showSnapshot(piece);
        } else {
            this.showDrawn(piece);
        }
    }

    /**
     * `piece.icon` (a bare frame name, same PIXI.Sprite.from() convention as
     * PowerupDefinition.icon) takes priority over everything else this class
     * can show — no colored shape drawn behind it, unlike
     * showSnapshot/showDrawn, since the icon image is already the complete
     * piece art. `piece.iconScale` multiplies its default size on top of
     * that, same convention as `faceScale`.
     */
    private showIcon(piece: PieceDefinition): void {
        const size = NextPiecePreview.BOX_SIZE;
        const scale = piece.iconScale ?? { x: 1, y: 1 };
        const sprite = PIXI.Sprite.from(piece.icon!);

        sprite.anchor.set(0.5);
        sprite.width = size * 0.9 * scale.x;
        sprite.height = size * 0.9 * scale.y;
        sprite.position.set(size * 0.5, size * 0.5);
        this.swatch.addChild(sprite);
    }

    private showSnapshot(piece: PieceDefinition): void {
        const size = NextPiecePreview.BOX_SIZE;
        const texture = PIXI.Texture.from(resolvePieceSnapshotPath(piece.id));
        const sprite = new PIXI.Sprite(texture);

        sprite.anchor.set(0.5);
        sprite.width = size * 0.9;
        sprite.height = size * 0.9;
        sprite.position.set(size * 0.5, size * 0.5);
        this.swatch.addChild(sprite);

        if (!texture.baseTexture.valid) {
            texture.baseTexture.once('error', () => {
                // Still showing (i.e. hasn't been swapped for a newer piece
                // since) — this piece just has no pre-rendered snapshot,
                // fall back to the drawn 2D swatch instead of a broken image.
                if (this.swatch.children.includes(sprite)) {
                    sprite.destroy();
                    this.showDrawn(piece);
                }
            });
        }
    }

    private showDrawn(piece: PieceDefinition): void {
        const size = NextPiecePreview.BOX_SIZE;
        const longestAxis = Math.max(piece.scale.x, piece.scale.y);
        const pixelsPerUnit = (size * 0.8) / longestAxis;
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
        shape.position.set(size * 0.5, size * 0.5);
        shape.visible = !piece.hideMesh;
        this.swatch.addChild(shape);

        if (piece.texture) {
            const face = PIXI.Sprite.from(resolvePieceImagePath(piece.texture));
            const faceScale = piece.faceScale ?? { x: 1, y: 1 };
            const faceSize = Math.min(w, h) * 0.8;

            face.anchor.set(0.5);
            face.width = faceSize * faceScale.x;
            face.height = faceSize * faceScale.y;
            face.position.set(size * 0.5, size * 0.5);
            this.swatch.addChild(face);
        }
    }

    public destroy(): void {
        this.container.destroy({ children: true });
    }
}
