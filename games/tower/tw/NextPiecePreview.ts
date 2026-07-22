// NextPiecePreview.ts

import { Game } from 'core/Game';
import * as PIXI from 'pixi.js';
import { resolvePieceImagePath, type PieceDefinition } from './PieceStorage';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
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
 * Pinned to the ACTUAL visible top-left corner via pinTopLeft(), not a
 * fixed (x, y) — this scene's own container lives under Game.stageContainer
 * (see IslandViewScene → gameContainer → stageContainer in index.ts), so
 * Game.gameScreenData.topLeft (recomputed on every resize/orientation
 * change — see Game.onResize()) is the corner that actually matches this
 * container's local space, not the nominal (0, 0) of the fixed
 * DESIGN_WIDTH/DESIGN_HEIGHT box, which the letterbox-fit scale can leave
 * short of the real screen edge on an aspect ratio other than 720:1080.
 */
export class NextPiecePreview extends PIXI.Container {
    private static readonly BOX_SIZE = 80;
    private static readonly MARGIN = 20;

    private readonly container: PIXI.Container;
    private readonly swatch: PIXI.Container;

    public constructor() {
        super();
        this.container = new PIXI.Container();

        const label = new PIXI.Text('NEXT', {
            fill: 0xffffff,
            fontSize: 16,
            fontWeight: 'bold',
            stroke: 0x000000,
            strokeThickness: 3,
        });

        label.anchor.set(0.5, 0);
        label.position.set(NextPiecePreview.BOX_SIZE * 0.5, 0);
        this.container.addChild(label);

        const background = new PIXI.Graphics();
        background.beginFill(0x000000, 0.35);
        background.drawRoundedRect(0, label.height + 4, NextPiecePreview.BOX_SIZE, NextPiecePreview.BOX_SIZE, 8);
        background.endFill();
        this.container.addChild(background);

        this.swatch = new PIXI.Container();
        this.swatch.position.set(0, label.height + 4);
        this.container.addChild(this.swatch);

        this.addChild(this.container);
    }

    /** Call every frame — repositions against the CURRENT visible top-left corner, so it stays put across a resize/orientation change instead of only being placed once at construction. */
    public pinTopLeft(): void {
        const topLeft = Game.gameScreenData.topLeft;
        this.container.position.set(topLeft.x + NextPiecePreview.MARGIN, topLeft.y + NextPiecePreview.MARGIN);
    }

    /** Redraws the swatch for `piece` — call on construction and every FaceTowerGameEvents.onNextPieceChanged. */
    public show(piece: PieceDefinition): void {
        for (const child of this.swatch.removeChildren()) {
            child.destroy();
        }

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
