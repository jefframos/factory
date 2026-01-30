import Pool from "@core/Pool";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { EntityGridView } from "../entity/EntityGridView";
import { MergeTile } from "./MergeTile";

export class EntityGridView2 extends EntityGridView {
    public readonly onGridRebuilt: Signal = new Signal();

    // Exposed for ZoomService and EntityManager
    public targetScale: number = 1.0;
    public centerOffset: PIXI.Point = new PIXI.Point();
    public gridLogicalSize: PIXI.Point = new PIXI.Point();

    public tiles: MergeTile[] = [];
    //private tileContainer: PIXI.Container = new PIXI.Container();
    private lastKnownMax: number = -1;

    // Grid Layout Constants
    private readonly COL_LIMIT = 5;
    private readonly START_COLS = 3;
    private readonly MAX_HEIGHT_BEFORE_WIDEN = 5;
    private readonly TILE_SIZE = 140;
    private readonly SPACING = 0;
    private gr: PIXI.Graphics;
    constructor(
        private maxSlotsGetter: () => number,
        private walkBounds: PIXI.Rectangle,
        private gridFit: PIXI.Rectangle,
        private tileContainer: PIXI.Container
    ) {
        super();
        //this.addChildAt(this.tileContainer, 0);
        this.rebuildGrid();

        this.tileContainer.zIndex = -1000; // Force it way below entities
        this.sortableChildren = true;

        this.x = walkBounds.x + walkBounds.width / 2
        this.y = walkBounds.y + walkBounds.height / 2

        this.tileContainer.x = walkBounds.x + walkBounds.width / 2
        this.tileContainer.y = walkBounds.y + walkBounds.height / 2


        // this.gr = new PIXI.Graphics();
        // this.updateDebugRect();
        // this.addChild(this.gr);
    }

    private updateDebugRect(): void {
        this.gr.clear();
        this.gr.beginFill(0xFF0000, 0.25);
        // Note: gridFit is likely in "world" or "parent" space
        this.gr.drawRect(this.gridFit.x, this.gridFit.y, this.gridFit.width, this.gridFit.height);
        this.gr.endFill();
    }
    public update(delta: number, bounds: PIXI.Rectangle): void {
        super.update(delta, bounds);

        const currentMax = this.maxSlotsGetter();
        if (this.lastKnownMax !== currentMax) {
            this.rebuildGrid();
        }
    }

    /**
     * Logic to determine Row/Col based on index
     */
    private getGridInfoFromIndex(index: number): { col: number, row: number } {
        let col = 0;
        let row = 0;

        // Pattern: Fill middle 3 columns first up to 6 rows, then fill side columns
        if (index < this.START_COLS * this.MAX_HEIGHT_BEFORE_WIDEN) {
            col = (index % this.START_COLS) + 1; // Middle columns: 1, 2, 3
            row = Math.floor(index / this.START_COLS);
        } else {
            const overflowIndex = index - (this.START_COLS * this.MAX_HEIGHT_BEFORE_WIDEN);
            const overflowCols = [0, 4]; // Side columns: 0 and 4
            col = overflowCols[overflowIndex % 2];
            row = Math.floor(overflowIndex / 2);
        }

        return { col, row };
    }

    public rebuildGrid(): void {
        const newMax = this.maxSlotsGetter();

        // 1. GUARD: Only rebuild if the count actually changed
        if (this.lastKnownMax === newMax && this.tiles.length === newMax) {
            return;
        }

        // 2. POOLING LOGIC: Return excess tiles to pool if newMax is smaller
        if (this.tiles.length > newMax) {
            const removedTiles = this.tiles.splice(newMax);
            removedTiles.forEach(tile => {
                this.tileContainer.removeChild(tile);
                Pool.instance.returnElement(tile);
            });
        }

        // 3. POOLING LOGIC: Get new tiles from pool if newMax is larger
        while (this.tiles.length < newMax) {
            const newTile = Pool.instance.getElement<MergeTile>(MergeTile);
            // Ensure tile is initialized/reset if necessary
            newTile.init(this.TILE_SIZE)
            this.tileContainer.addChild(newTile);
            this.tiles.push(newTile);
        }

        this.lastKnownMax = newMax;

        // 4. RE-CALCULATE LAYOUT
        let maxRow = 0;
        let minCol = this.COL_LIMIT;
        let maxCol = 0;

        for (let i = 0; i < newMax; i++) {
            const info = this.getGridInfoFromIndex(i);
            maxRow = Math.max(maxRow, info.row);
            minCol = Math.min(minCol, info.col);
            maxCol = Math.max(maxCol, info.col);
        }

        const step = this.TILE_SIZE + this.SPACING;
        const rowCount = maxRow + 1;
        const colSpan = (maxCol - minCol) + 1;

        this.gridLogicalSize.set(
            colSpan * step - this.SPACING,
            rowCount * step - this.SPACING
        );

        const scaleX = this.gridFit.width / this.gridLogicalSize.x;
        const scaleY = this.gridFit.height / this.gridLogicalSize.y;
        this.targetScale = Math.min(Math.min(scaleX, scaleY), 1.25);

        // 5. RE-POSITION ALL TILES
        const gridFitCenterX = this.gridFit.x + this.gridFit.width / 2;
        const gridFitCenterY = this.gridFit.y + this.gridFit.height / 2;

        for (let i = 0; i < this.tiles.length; i++) {
            const tile = this.tiles[i];
            const gridInfo = this.getGridInfoFromIndex(i);
            const pos = this.calculateTilePositionFromGridInfo(gridInfo.col, gridInfo.row);

            tile.data = { index: i, row: gridInfo.row, col: gridInfo.col };
            tile.x = pos.x + gridFitCenterX;
            tile.y = pos.y + gridFitCenterY - (this.gridLogicalSize.y / 2) + (this.TILE_SIZE / 2);
        }

        this.onGridRebuilt.dispatch();
    }

    private calculateTilePositionFromGridInfo(col: number, row: number): PIXI.Point {
        const step = this.TILE_SIZE + this.SPACING;

        // We calculate position relative to the center of the total 5-column logical span
        // But the gridLogicalSize.x used in rebuildGrid handles the final framing.
        const fullSpanWidth = this.COL_LIMIT * step - this.SPACING;
        const offsetX = -(fullSpanWidth / 2) + (this.TILE_SIZE / 2);

        return new PIXI.Point(
            col * step + offsetX,
            row * step
        );
    }

    public override getTileAt(globalPos: PIXI.Point): MergeTile | null {
        for (let i = 0; i < this.tiles.length; i++) {
            const tile = this.tiles[i];
            if (tile.getBounds().contains(globalPos.x, globalPos.y)) {
                return tile;
            }
        }
        return null;
    }
}