// Levels.ts
//
// The pictures to clear, in play order (levels/index.json), each made by the pixelate script (tools/pixelate.mjs):
// size, palette, and rows of colour indices (one character per pixel: 0-9 then a-z).

import index from '../../levels/index.json';

export interface LevelData {
    id: string;
    name: string;
    width: number;
    height: number;
    /** Hex colours, most used first. */
    palette: string[];
    /** One string per row, top first; each character a palette index. */
    rows: string[];
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const files = import.meta.glob<{ default: LevelData }>('../../levels/*.json', { eager: true });

/** Every level, in index.json's order (a level listed there without its file is skipped). */
export const LEVELS: LevelData[] = (index as { levels: string[] }).levels
    .map((id) => files[`../../levels/${id}.json`]?.default)
    .filter((level): level is LevelData => !!level);

/** A level's pixels as palette indices, row by row from the top (index = x + y * width). */
export function pixelsOf(level: LevelData): Int8Array {
    const pixels = new Int8Array(level.width * level.height);
    level.rows.forEach((row, y) => {
        for (let x = 0; x < level.width; x++) pixels[x + y * level.width] = DIGITS.indexOf(row[x] ?? '0');
    });
    return pixels;
}
