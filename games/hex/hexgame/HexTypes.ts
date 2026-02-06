import * as PIXI from "pixi.js";

export interface HexPos {
    q: number; // Column
    r: number; // Row
}

export interface GridCellData {
    id: number;
    type: number; // 1 = playable, 0 = empty
    config?: any;
}

export type GridMatrix = number[][];

export interface ClusterData {
    coords: HexPos[]; // Relative to (0,0)
    color: number;
    rootPos: HexPos;
}

export enum Difficulty { EASY, MEDIUM, HARD }

export class HexUtils {
    static readonly HEX_SIZE = 50;

    // The width of a pointy-top hex
    static readonly WIDTH = Math.sqrt(3) * HexUtils.HEX_SIZE;

    // The full height of a hex
    static readonly HEIGHT = 2 * HexUtils.HEX_SIZE;

    // The distance between the centers of two rows (3/4 of height)
    static readonly VERTICAL_SPACING = HexUtils.HEIGHT * 0.75;

    /**
     * Converts grid coordinates to pixel positions
     */
    static offsetToPixel(q: number, r: number): PIXI.Point {
        const x = this.HEX_SIZE * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
        const y = this.HEX_SIZE * (3 / 2 * r);
        return new PIXI.Point(x, y);
    }
    // static offsetToPixel(q: number, r: number): PIXI.Point {
    //     const xOffset = (r & 1) ? (HexUtils.WIDTH * 0.5) : 0;
    //     return new PIXI.Point(
    //         q * HexUtils.WIDTH + xOffset,
    //         r * HexUtils.VERTICAL_SPACING
    //     );
    // }

    static pixelToOffset(p: PIXI.IPointData): { q: number; r: number } {
        const r = Math.round(p.y / HexUtils.VERTICAL_SPACING);
        const xOffset = (r & 1) ? (HexUtils.WIDTH * 0.5) : 0;
        const q = Math.round((p.x - xOffset) / HexUtils.WIDTH);
        return { q, r };
    }
}
