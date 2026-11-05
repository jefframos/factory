// Levels.ts
//
// The pictures to clear, in play order (levels/index.json), each made by the pixelate script (tools/pixelate.mjs) or
// the level editor: size, palette, rows of colour indices (one character per pixel: 0-9 then a-z), and the baked
// tiles — the deck, its columns, and the solver's check (tools/solver.mjs) — so every play of a level is the same.

import index from '../../levels/index.json';
import type { Tile } from './Board';

export interface LevelData {
    id: string;
    name: string;
    width: number;
    height: number;
    /** Hex colours, most used first. */
    palette: string[];
    /** One string per row, top first; each character a palette index, or '.' for an empty cell (transparent). */
    rows: string[];
    /** Tile columns under the slots (3 to 5). */
    columns?: number;
    /** The tiles in order, dealt round-robin into the columns: "<colour digit>x<count>" separated by spaces. */
    deck?: string;
    /** What the solver found when it was baked. */
    check?: { clearable: boolean; slots: number; robust: boolean; randomWins: number };
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const files = import.meta.glob<{ default: LevelData }>('../../levels/*.json', { eager: true });

/** Every level, in index.json's order (a level listed there without its file is skipped). */
export const LEVELS: LevelData[] = (index as { levels: string[] }).levels
    .map((id) => files[`../../levels/${id}.json`]?.default)
    .filter((level): level is LevelData => !!level);

/** A level's pixels as palette indices, row by row from the top (index = x + y * width); -1 for an empty cell. */
export function pixelsOf(level: LevelData): Int8Array {
    const pixels = new Int8Array(level.width * level.height);
    level.rows.forEach((row, y) => {
        for (let x = 0; x < level.width; x++) pixels[x + y * level.width] = DIGITS.indexOf(row[x] ?? '0');
    });
    return pixels;
}

/** A level's baked tiles, or undefined (an old level file: the game deals them). */
export function deckOf(level: LevelData): Tile[] | undefined {
    if (!level.deck) return undefined;
    return level.deck.split(' ').map((entry) => {
        const [color, count] = entry.split('x');
        return { color: DIGITS.indexOf(color), count: Number(count) };
    });
}
