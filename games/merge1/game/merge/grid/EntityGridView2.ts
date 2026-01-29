import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { EntityGridView } from "../entity/EntityGridView";
import { MergeTile } from "./MergeTile";

export class EntityGridView2 extends EntityGridView {
    public readonly onGridRebuilt: Signal = new Signal();
    public tiles: MergeTile[] = [];
    private tileContainer: PIXI.Container = new PIXI.Container();
    private lastKnownMax: number = -1;

    // Configuration for the growth logic
    private readonly COL_LIMIT = 5;
    private readonly START_COLS = 3;
    private readonly MAX_HEIGHT_BEFORE_WIDEN = 6;
    private readonly TILE_SIZE = 120;
    private readonly SPACING = 15;

    constructor(private maxSlotsGetter: () => number, private walkBounds: PIXI.Rectangle) {
        super();
        this.addChildAt(this.tileContainer, 0);

        // Center the view container itself within the walk bounds
        this.x = this.walkBounds.x + this.walkBounds.width / 2;
        this.y = this.walkBounds.y + this.walkBounds.height / 2; // Starting Y margin from the top

        this.rebuildGrid();
    }

    public update(delta: number, bounds: PIXI.Rectangle): void {
        super.update(delta, bounds);

        const currentMax = this.maxSlotsGetter();
        if (this.lastKnownMax !== currentMax) {
            this.rebuildGrid();
        }
    }

    public override getTileAt(localPos: PIXI.Point): MergeTile | null {
        // Since this container is centered (this.x is at middle), 
        // localPos is already relative to our center.
        for (let i = 0; i < this.tiles.length; i++) {
            const tile = this.tiles[i];
            const bounds = tile.getBounds();
            if (bounds.contains(localPos.x, localPos.y)) {
                return tile;
            }
        }
        return null;
    }

    public rebuildGrid(): void {
        const newMax = this.maxSlotsGetter();
        this.lastKnownMax = newMax;

        // Clean up old tile views
        this.tiles.forEach(t => t.destroy());
        this.tileContainer.removeChildren();
        this.tiles = [];

        for (let i = 0; i < newMax; i++) {
            // 1. Calculate the logic and the visual position
            const gridInfo = this.getGridInfoFromIndex(i);
            const pos = this.calculateTilePositionFromGridInfo(gridInfo.col, gridInfo.row);

            const tile = new MergeTile(this.TILE_SIZE);

            // 2. Assign the complete data object
            tile.data = {
                id: `tile_${i}`,
                index: i,
                row: gridInfo.row,
                col: gridInfo.col,
                occupantId: null
            };

            tile.x = pos.x;
            tile.y = pos.y;

            this.tileContainer.addChild(tile);
            this.tiles.push(tile);
        }

        this.onGridRebuilt.dispatch();
    }

    /**
     * Determines which logical Row and Column an index belongs to
     * based on your "Center-First" rules.
     */
    private getGridInfoFromIndex(index: number): { col: number, row: number } {
        let col = 0;
        let row = 0;

        if (index < this.START_COLS * this.MAX_HEIGHT_BEFORE_WIDEN) {
            col = (index % this.START_COLS) + 1; // Middle columns (1, 2, 3)
            row = Math.floor(index / this.START_COLS);
        } else {
            const overflowIndex = index - (this.START_COLS * this.MAX_HEIGHT_BEFORE_WIDEN);
            const overflowCols = [0, 4]; // Side columns (0 and 4)
            col = overflowCols[overflowIndex % 2];
            row = Math.floor(overflowIndex / 2);
        }

        return { col, row };
    }

    /**
     * Translates grid coordinates to local pixel coordinates
     */
    private calculateTilePositionFromGridInfo(col: number, row: number): PIXI.Point {
        const step = this.TILE_SIZE + this.SPACING;
        const totalWidth = this.COL_LIMIT * step;
        const offsetX = -(totalWidth / 2) + (step / 2);

        return new PIXI.Point(
            col * step + offsetX,
            row * step
        );
    }
}