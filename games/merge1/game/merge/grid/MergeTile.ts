import * as PIXI from "pixi.js";

export interface TileData {
    id: string;      // Unique ID for saving/loading
    index: number;   // 0, 1, 2...
    row: number;
    col: number;
    occupantId: string | null; // ID of the BlockMergeEntity or Egg
}

export class MergeTile extends PIXI.Graphics {
    public data!: TileData;

    constructor(size: number) {
        super();
        // Visual representation
        this.beginFill(0x000000, 0.1);
        this.drawRoundedRect(-size / 2 + 5, -size / 2 + 5, size - 10, size - 10, 15);
        this.endFill();
    }
}