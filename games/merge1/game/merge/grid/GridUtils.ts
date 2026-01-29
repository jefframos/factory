
import * as PIXI from "pixi.js";
export interface GridPos { row: number; col: number; }
export class GridUtils {
    public static readonly CELL_SIZE = 120;
    public static readonly COLS = 5; // Example fixed width


    public static getIndexFromPos(row: number, col: number): number {
        return row * this.COLS + col;
    }

    public static getCenterOffset(maxSlots: number, walkBounds: PIXI.Rectangle): PIXI.Point {
        const rows = Math.ceil(maxSlots / this.COLS);
        const gridWidth = this.COLS * this.CELL_SIZE;
        const gridHeight = rows * this.CELL_SIZE;

        return new PIXI.Point(
            walkBounds.x + (walkBounds.width - gridWidth) / 2,
            walkBounds.y + (walkBounds.height - gridHeight) / 2
        );
    }

    public static getGridDimensions(maxSlots: number) {
        const rows = Math.ceil(maxSlots / this.COLS);
        return {
            width: this.COLS * this.CELL_SIZE,
            height: rows * this.CELL_SIZE
        };
    }

    public static getPosFromIndex(index: number) {
        return { row: Math.floor(index / this.COLS), col: index % this.COLS };
    }

    public static gridToLocal(row: number, col: number, walkBounds: PIXI.Rectangle, maxSlots: number): PIXI.Point {
        const dim = this.getGridDimensions(maxSlots);
        // Calculate top-left of the grid relative to walkBounds center
        const startX = walkBounds.x + (walkBounds.width - dim.width) / 2;
        const startY = walkBounds.y + (walkBounds.height - dim.height) / 2;

        return new PIXI.Point(
            startX + (col * this.CELL_SIZE) + this.CELL_SIZE / 2,
            startY + (row * this.CELL_SIZE) + this.CELL_SIZE / 2
        );
    }

    public static localToGrid(x: number, y: number, walkBounds: PIXI.Rectangle, maxSlots: number): GridPos {
        const dim = this.getGridDimensions(maxSlots);
        const startX = walkBounds.x + (walkBounds.width - dim.width) / 2;
        const startY = walkBounds.y + (walkBounds.height - dim.height) / 2;

        return {
            row: Math.floor((y - startY) / this.CELL_SIZE),
            col: Math.floor((x - startX) / this.CELL_SIZE)
        };
    }
}