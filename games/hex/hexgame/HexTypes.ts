import * as PIXI from "pixi.js";

export interface HexPos {
    q: number; // Column
    r: number; // Row
}

export interface LevelData {
    id: string;
    name: string;
    gridType: string;
    matrix: number[][];
    pieces?: ClusterData[];
    difficulty?: Difficulty;
}

export interface WorldManifestEntry {
    id: string;
    name: string;
    icon: string;       // e.g., "icon_forest"
    background: string; // e.g., "bg_forest"
    enabled: boolean;
    levelFile: string;  // e.g., "world1.json"
    customData?: any;   // Extra properties for gameplay logic
}

export interface WorldData extends WorldManifestEntry {
    levels: LevelData[];
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

export type PieceColorEntry = {
    id: string;     // stable id for UI/debug (optional)
    name: string;   // UI label
    value: number;  // 0xRRGGBB
};

// IMPORTANT:
// First 6 match your ClusterGenerator current colors EXACTLY.
export const PIECE_COLOR_PALETTE: PieceColorEntry[] = [
    { id: "coral", name: "Coral", value: 0xFF5733 },
    { id: "lime", name: "Lime", value: 0x33FF57 },
    { id: "blue", name: "Blue", value: 0x3357FF },
    { id: "magenta", name: "Magenta", value: 0xF333FF },
    { id: "yellow", name: "Yellow", value: 0xFFF333 },
    { id: "cyan", name: "Cyan", value: 0x00CED1 },

    { id: "white", name: "White", value: 0xFFFFFF },
    { id: "darkGrey", name: "Dark Grey", value: 0x3A3A3C },
    { id: "brown", name: "Brown", value: 0x8E6E53 },
    { id: "pink", name: "Pink", value: 0xFF2D55 },
];

export function colorToHex6(value: number): string {
    // returns "RRGGBB"
    return (value >>> 0).toString(16).padStart(6, "0").toUpperCase();
}

export function parseHex6(hex: string): number {
    // accepts "RRGGBB" or "#RRGGBB"
    const clean = hex.startsWith("#") ? hex.slice(1) : hex;
    return parseInt(clean, 16);
}

export function clampToPalette(value: number): number {
    // If exact match exists, return it. Otherwise return the closest by RGB distance.
    // (So dropdown always snaps to something valid.)
    let best = PIECE_COLOR_PALETTE[0]?.value ?? value;
    let bestD = Number.POSITIVE_INFINITY;

    const vr = (value >> 16) & 0xff;
    const vg = (value >> 8) & 0xff;
    const vb = value & 0xff;

    for (const c of PIECE_COLOR_PALETTE) {
        const cr = (c.value >> 16) & 0xff;
        const cg = (c.value >> 8) & 0xff;
        const cb = c.value & 0xff;

        const dr = vr - cr;
        const dg = vg - cg;
        const db = vb - cb;
        const d = dr * dr + dg * dg + db * db;

        if (d < bestD) {
            bestD = d;
            best = c.value;
        }
    }

    return best;
}

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
