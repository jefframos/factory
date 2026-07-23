import { Game } from 'core/Game';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import * as PIXI from 'pixi.js';
import type { FaceTowerGameController } from '../../tw/FaceTowerGameController';
import type { PieceDefinition } from '../../tw/PieceStorage';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Dev-only piece tooling for the tower minigame:
 *  - a dat.GUI button per piece (see PieceStorage.PIECES) — clicking one
 *    replaces whatever's currently hovering over the drop area (see
 *    FaceTowerGameController.replaceHeldBlockWithPiece), so any piece can be
 *    tried on demand instead of waiting for PieceManager's level-gated
 *    random pool to hand it out. Buttons instead of a dropdown so picking a
 *    piece is a single click, not open-scroll-click.
 *  - a toggleable on-screen gallery docked to the right edge, previewing
 *    every piece's shape/color/relative-size at once.
 *
 * Pulled out of IslandViewScene so the scene doesn't own piece-preview
 * layout details — construct once with the screen-space layer to draw the
 * gallery into, then call setup() during scene build.
 */
export class PieceDevGui {
    private static readonly PREVIEW_SIZE = 40;
    private static readonly ROW_HEIGHT = 52;
    private static readonly PANEL_WIDTH = 170;

    private readonly gallery: PIXI.Container;

    public constructor(
        private readonly pieces: readonly PieceDefinition[],
        private readonly faceTower: FaceTowerGameController,
        previewLayer: PIXI.Container,
    ) {
        this.gallery = this.buildGallery();
        this.gallery.visible = false;
        previewLayer.addChild(this.gallery);
    }

    /** Registers the "Tower Pieces" dat.GUI folder — the gallery toggle plus one button per piece. Call once during scene setup. */
    public setup(): void {
        if (this.pieces.length === 0) {
            return;
        }

        const gui = DevGuiManager.instance;
        const folder = 'Tower Pieces';

        gui.addToggle('Show All Pieces', false, visible => {
            this.gallery.visible = visible;
        }, folder);

        for (const piece of this.pieces) {
            gui.addButton(piece.id, () => {
                this.faceTower.replaceHeldBlockWithPiece(piece);
            }, folder);
        }
    }

    /**
     * One row per piece (shape preview + id label) behind a flat background
     * panel for legibility, docked to the screen's right edge and vertically
     * centered — visibility toggled by the "Show All Pieces" GUI entry.
     */
    private buildGallery(): PIXI.Container {
        const container = new PIXI.Container();
        const panelHeight = this.pieces.length * PieceDevGui.ROW_HEIGHT + 16;

        const background = new PIXI.Graphics();
        background.beginFill(0x000000, 0.55);
        background.drawRect(0, 0, PieceDevGui.PANEL_WIDTH, panelHeight);
        background.endFill();
        container.addChild(background);

        this.pieces.forEach((piece, index) => {
            const row = this.buildRow(piece);
            console.log(piece)
            row.position.set(12, 12 + index * PieceDevGui.ROW_HEIGHT);
            container.addChild(row);
        });

        container.position.set(
            Game.DESIGN_WIDTH - PieceDevGui.PANEL_WIDTH,
            (Game.DESIGN_HEIGHT - panelHeight) * 0.5,
        );

        return container;
    }

    private buildRow(piece: PieceDefinition): PIXI.Container {
        const row = new PIXI.Container();
        const size = PieceDevGui.PREVIEW_SIZE;

        const preview = this.buildPreviewGraphic(piece, size);
        preview.position.set(size * 0.5, size * 0.5);
        row.addChild(preview);

        const label = new PIXI.Text(piece.id + '-' + piece.level, {
            fill: 0xffffff,
            fontSize: 14,
        });

        label.anchor.set(0, 0.5);
        label.position.set(size + 10, size * 0.5);
        row.addChild(label);

        return row;
    }

    /**
     * Same rect-or-polygon draw as BlockBodyTextureCache, but normalized to
     * fit within `maxSize` on its longest axis while keeping the piece's own
     * width/height ratio — so the gallery conveys relative shape/size at a
     * glance instead of every entry rendering at the same square footprint.
     */
    private buildPreviewGraphic(piece: PieceDefinition, maxSize: number): PIXI.Graphics {
        const longestAxis = Math.max(piece.scale.x, piece.scale.y);
        const pixelsPerUnit = maxSize / longestAxis;
        const w = piece.scale.x * pixelsPerUnit;
        const h = piece.scale.y * pixelsPerUnit;

        const graphic = new PIXI.Graphics();

        graphic.lineStyle(1.5, 0x000000, 1);
        graphic.beginFill(hexStringToNumber(piece.color), 1);

        if (piece.polygon) {
            graphic.drawPolygon(piece.polygon.flatMap(p => [p.x * w, p.y * h]));
        } else {
            graphic.drawRect(0, 0, w, h);
        }

        graphic.endFill();
        graphic.pivot.set(w / 2, h / 2);

        return graphic;
    }
}
