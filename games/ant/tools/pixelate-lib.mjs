// pixelate-lib.mjs — builds Ant levels (used by tools/pixelate.mjs and the level editor, web/server.mjs).
//
// buildLevel(file, id, settings, master) makes a level from a picture file — or from nothing, for a level drawn by hand
// (`file` null: the grid starts empty and the edits draw it):
//   1. The picture is sampled SAMPLES x SAMPLES times per cell of a small grid.
//   2. The background can be removed: `background: 'remove'` clears the colour round the picture (the most common on
//      its border, flood-filled in from the edges); 'auto' does that for a picture without transparency of its own;
//      'keep' leaves it. Transparent parts are empty cells (no block: '.').
//   3. The opaque samples' colours are reduced to `colors` with k-means (deterministic), then — `palette` — snapped to
//      the game's MASTER palette ('master', its closest tones), a preset (PALETTES) or left as they are ('none').
//      "Closest" is measured in OKLab, so it's the tone that looks nearest, not the nearest RGB numbers.
//   4. Each cell takes its samples' most common colour.
//   5. The hand edits go on top (`edits`: { "x,y": "#hex" } paints a cell, { "x,y": "." } empties it) — snapped to the
//      same palette, so a palette change carries them along — except "!#hex", a custom colour kept exactly as it is. `padding` cells all round (plus one more with a stroke)
//      are left empty: the picture is sampled that much smaller, inside them.
//   6. The whole grid, edits and all, is shifted by `offsetX` / `offsetY` cells (what slides off the edge is gone).
//   7. `stroke` (a colour, snapped to the palette; '' = none) outlines the picture: every empty cell touching it (sides
//      or corners) becomes a block of that colour. With a stroke the picture is sampled a cell smaller all round (1),
//      so the outline has room at the grid's edges.
//   7b. `autoShade` (on unless set false) gives each colour area depth, lit from the top left: its pixels along a top or
//      left edge a lighter tone, along a bottom or right edge a darker one (areas of at least SHADE.minArea, where the
//      area goes on past the edge pixel). Distinct colours, not snapped: they make a picture less flat, and its areas
//      onions — the inside of an area is shut in by its own rims until they're taken. `shadeColors` limits it to that
//      many colours (the biggest first; -1: all): each shaded colour adds up to two tones to the level's colours.
//   8. The level's colours get its `saturation` / `brightness` steps (each step +-15% saturation / +-6% lightness, up
//      to MAX_STEPS either way) — after the palette, so a master-palette level keeps the master's tones, just more or
//      less vivid (before it, the snapping would put most colours straight back on the same tone). Then the shading
//      brushes (`shades`: { "x,y": [saturation, brightness] } steps per cell, in the same coordinates as the edits):
//      shading for depth — not snapped, so each shade is a colour of its own (its own tiles in the game).
//   9. The tiles are baked (solver.mjs's bakeDeck: `seed`, `mix`, `columns`) and checked: can it be cleared?
// Returns the level (id, name, size, palette by use, rows, columns, deck, check), the final grid (hex colours, null =
// empty: the editor's paint canvas), the pixel count, and a crisp preview PNG.

import sharp from 'sharp';
import { bakeDeck, difficultyTarget } from './solver.mjs';

const SAMPLES = 8;
const ALPHA_CUTOFF = 128;
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BACKGROUND_TOLERANCE = 48;
const PREVIEW_CELL = 16;
/** One step of the colour adjustments. */
const SATURATION_STEP = 0.15;
const BRIGHTNESS_STEP = 0.06;
export const MAX_STEPS = 5;

export const DEFAULT_SETTINGS = { width: 24, height: 24, colors: 6, palette: 'master', background: 'auto', saturation: 0, brightness: 0, offsetX: 0, offsetY: 0, edits: {}, shades: {}, padding: 0, stroke: '', autoShade: true, shadeColors: -1, columns: 0, seed: 0, mix: 0 };
/** Auto-shading: the smallest area shaded, and the edge tones' steps (as the brushes': [saturation, brightness]). */
const SHADE = { minArea: 10, light: [-1, 2], dark: [1, -2], maxLight: 0.93 };

/** Fixed colour sets a picture can use instead of the master palette. */
export const PALETTES = {
    cozy: ['#f28b8b', '#f7a8b8', '#ffe08a', '#f9c48f', '#9ed59a', '#6fb27a', '#8fbfe3', '#cfe3f2', '#b8a4d8', '#fdf0dc', '#fff4e4', '#d9a37e', '#7a5646', '#6d7fa8', '#ffffff', '#4a4a5a'],
    candy: ['#ff6b8b', '#ff9ec7', '#ffd166', '#06d6a0', '#4cc9f0', '#7b6cf6', '#c77dff', '#ffffff', '#2b2d42', '#ff8c42'],
    garden: ['#5fa35a', '#9ed59a', '#cfe8b5', '#f6d365', '#f28b8b', '#fdf0dc', '#a07850', '#6b4a2f', '#8fbfe3', '#ffffff'],
    sea: ['#1f5fa8', '#3e8ed0', '#8fbfe3', '#cfe3f2', '#ffe08a', '#f9c48f', '#fdf0dc', '#ffffff', '#2b3a55', '#f28b8b'],
    night: ['#2b2d6e', '#4b4fa8', '#8f8fd8', '#ffe08a', '#fff4c2', '#ffffff', '#1a1a2e', '#f7a8b8', '#6fd3c8'],
};

const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** sRGB (0-255) to OKLab: distances there match how different two colours look. */
function oklab([r, g, b]) {
    const lin = (v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** The palette colour that looks closest to `c` (an RGB triple); returns its hex. */
export function closest(c, palette) {
    const lab = oklab(c);
    let best = palette[0];
    let bestDistance = Infinity;
    for (const p of palette) {
        const d = distance2(lab, oklab(parseHex(p)));
        if (d < bestDistance) {
            bestDistance = d;
            best = p;
        }
    }
    return best;
}

/** A colour with its saturation and lightness moved by `saturation` / `brightness` steps (HSL). */
function adjust([r, g, b], saturation, brightness) {
    if (!saturation && !brightness) return [r, g, b];
    const R = r / 255;
    const G = g / 255;
    const B = b / 255;
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    let l = (max + min) / 2;
    let s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
    let h = 0;
    if (max !== min) {
        const d = max - min;
        h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
        h /= 6;
    }
    s = Math.max(0, Math.min(1, s * (1 + saturation * SATURATION_STEP)));
    l = Math.max(0, Math.min(1, l + brightness * BRIGHTNESS_STEP));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t) => {
        const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
        if (u < 1 / 6) return p + (q - p) * 6 * u;
        if (u < 1 / 2) return q;
        if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
        return p;
    };
    return s === 0 ? [l * 255, l * 255, l * 255] : [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255];
}

/** k-means over colours: deterministic start (the most common, then the farthest, weighted), 30 rounds. */
function kmeans(pixels, k) {
    const counts = new Map();
    for (const p of pixels) {
        const key = p.map(Math.round).join(',');
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const unique = [...counts.entries()].map(([key, n]) => ({ c: key.split(',').map(Number), n }));
    if (!unique.length) return [];
    if (unique.length <= k) return unique.map((u) => u.c);
    unique.sort((a, b) => b.n - a.n);
    const centres = [unique[0].c.slice()];
    while (centres.length < k) {
        let best = unique[0];
        let bestScore = -1;
        for (const u of unique) {
            const score = Math.min(...centres.map((c) => distance2(c, u.c))) * Math.sqrt(u.n);
            if (score > bestScore) {
                bestScore = score;
                best = u;
            }
        }
        centres.push(best.c.slice());
    }
    for (let round = 0; round < 30; round++) {
        const sums = centres.map(() => [0, 0, 0, 0]);
        for (const u of unique) {
            let nearest = 0;
            for (let i = 1; i < k; i++) if (distance2(u.c, centres[i]) < distance2(u.c, centres[nearest])) nearest = i;
            sums[nearest][0] += u.c[0] * u.n;
            sums[nearest][1] += u.c[1] * u.n;
            sums[nearest][2] += u.c[2] * u.n;
            sums[nearest][3] += u.n;
        }
        sums.forEach((s, i) => {
            if (s[3] > 0) centres[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
        });
    }
    return centres;
}

/** Clears the background: the most common border colour, flood-filled in from the edges (within a tolerance). */
function removeBackground(samples, opaque, width, height) {
    const border = new Map();
    const add = (i) => {
        if (!opaque[i]) return;
        const key = samples[i].map(Math.round).join(',');
        border.set(key, (border.get(key) ?? 0) + 1);
    };
    for (let x = 0; x < width; x++) {
        add(x);
        add((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        add(y * width);
        add(y * width + width - 1);
    }
    if (!border.size) return;
    const background = [...border.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    const limit = BACKGROUND_TOLERANCE * BACKGROUND_TOLERANCE;
    const seen = new Uint8Array(width * height);
    const queue = [];
    const push = (i) => {
        if (seen[i] || !opaque[i] || distance2(samples[i], background) > limit) return;
        seen[i] = 1;
        queue.push(i);
    };
    for (let x = 0; x < width; x++) {
        push(x);
        push((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
        push(y * width);
        push(y * width + width - 1);
    }
    while (queue.length) {
        const i = queue.pop();
        opaque[i] = false;
        const x = i % width;
        if (x > 0) push(i - 1);
        if (x < width - 1) push(i + 1);
        if (i >= width) push(i - width);
        if (i + width < width * height) push(i + width);
    }
}

/** The colours a picture's settings snap to: the master palette, a preset, or none (its own). */
function paletteFor(settings, master) {
    if (settings.palette === 'master') return master;
    return PALETTES[settings.palette] ?? [];
}

/** A picture file's cells as hex colours (or null: empty), from the settings; `file` null = an empty grid. */
async function sampleGrid(file, width, height, settings, palette) {
    const grid = new Array(width * height).fill(null);
    if (!file) return grid;
    const sampleWidth = width * SAMPLES;
    const sampleHeight = height * SAMPLES;
    const meta = await sharp(file, { density: 300 }).metadata();
    const { data } = await sharp(file, { density: 300 }).resize(sampleWidth, sampleHeight, { fit: 'fill', kernel: 'nearest' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const samples = [];
    const opaque = [];
    for (let i = 0; i < sampleWidth * sampleHeight; i++) {
        samples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
        opaque.push(data[i * 4 + 3] >= ALPHA_CUTOFF);
    }
    const hasAlpha = meta.hasAlpha && opaque.some((o) => !o);
    if (settings.background === 'remove' || (settings.background === 'auto' && !hasAlpha)) removeBackground(samples, opaque, sampleWidth, sampleHeight);
    const centres = kmeans(samples.filter((_, i) => opaque[i]), Math.max(2, Math.min(16, Math.round(settings.colors))));
    // Each centre as its final colour: snapped to the palette (closest tone), or itself.
    const finals = centres.map((c) => (palette.length ? closest(c, palette) : hex(c)));
    const nearest = (p) => centres.reduce((best, c, i) => (distance2(p, c) < distance2(p, centres[best]) ? i : best), 0);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const votes = new Array(centres.length).fill(0);
            let empty = 0;
            for (let sy = 0; sy < SAMPLES; sy++) {
                for (let sx = 0; sx < SAMPLES; sx++) {
                    const s = (y * SAMPLES + sy) * sampleWidth + x * SAMPLES + sx;
                    if (opaque[s]) votes[nearest(samples[s])]++;
                    else empty++;
                }
            }
            // Two centres snapped to the same palette colour vote together.
            const byColour = new Map();
            votes.forEach((v, i) => byColour.set(finals[i], (byColour.get(finals[i]) ?? 0) + v));
            if (!centres.length || empty * 2 > SAMPLES * SAMPLES) continue;
            grid[x + y * width] = [...byColour.entries()].sort((a, b) => b[1] - a[1])[0][0];
        }
    }
    return grid;
}

/** The grid shifted by (dx, dy) cells: what slides off is gone, what slides in is empty. */
function shift(grid, width, height, dx, dy) {
    if (!dx && !dy) return grid;
    const out = new Array(width * height).fill(null);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const tx = x + dx;
            const ty = y + dy;
            if (tx >= 0 && ty >= 0 && tx < width && ty < height) out[tx + ty * width] = grid[x + y * width];
        }
    }
    return out;
}

/** A grid of hex colours (null = empty) as a level's palette (by use) and rows. */
function toLevel(grid, width, height) {
    const usage = new Map();
    for (const c of grid) if (c) usage.set(c, (usage.get(c) ?? 0) + 1);
    const palette = [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const rows = [];
    for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
            const c = grid[x + y * width];
            row += c ? DIGITS[palette.indexOf(c)] : '.';
        }
        rows.push(row);
    }
    return { palette, rows };
}

/**
 * Builds a level from a picture `file` (null for a level drawn by hand) with `settings` (DEFAULT_SETTINGS) and the
 * game's `master` palette.
 */
export async function buildLevel(file, id, settings, master) {
    const options = { ...DEFAULT_SETTINGS, name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), ...settings };
    const width = Math.max(4, Math.min(64, Math.round(options.width)));
    const height = Math.max(4, Math.min(64, Math.round(options.height)));
    const palette = paletteFor(options, master);
    // Padding, and with an outline one cell more: the picture is sampled that much smaller all round (at least 2 x 2).
    const stroked = !!options.stroke && /^#[0-9a-f]{6}$/i.test(options.stroke);
    const margin = Math.max(0, Math.min(Math.floor((Math.min(width, height) - 2) / 2), Math.round(options.padding ?? 0) + (stroked ? 1 : 0)));
    const inner = await sampleGrid(file, width - 2 * margin, height - 2 * margin, options, palette);
    const grid = new Array(width * height).fill(null);
    const innerWidth = width - 2 * margin;
    for (let i = 0; i < inner.length; i++) grid[(Math.floor(i / innerWidth) + margin) * width + (i % innerWidth) + margin] = inner[i];
    for (const [key, value] of Object.entries(options.edits ?? {})) {
        const [x, y] = key.split(',').map(Number);
        if (!(x >= 0 && y >= 0 && x < width && y < height)) continue;
        grid[x + y * width] = value === '.' || !value ? null : value[0] === '!' ? value.slice(1).toLowerCase() : palette.length ? closest(parseHex(value), palette) : value;
    }
    const steps = (v) => Math.max(-MAX_STEPS, Math.min(MAX_STEPS, Math.round(v ?? 0)));
    // The brushes' shading, per cell, moved with the picture.
    const shadeGrid = new Array(width * height).fill(null);
    for (const [key, value] of Object.entries(options.shades ?? {})) {
        const [x, y] = key.split(',').map(Number);
        if (!(x >= 0 && y >= 0 && x < width && y < height) || !Array.isArray(value)) continue;
        const shade = [steps(value[0]), steps(value[1])];
        if (shade[0] || shade[1]) shadeGrid[x + y * width] = shade;
    }
    const dx = Math.round(options.offsetX ?? 0);
    const dy = Math.round(options.offsetY ?? 0);
    const final = shift(grid, width, height, dx, dy);
    const shading = shift(shadeGrid, width, height, dx, dy);
    const strokeColor = stroked ? (palette.length ? closest(parseHex(options.stroke), palette) : options.stroke) : null;
    if (strokeColor) outline(final, width, height, strokeColor);
    const baseColors = new Set(final.filter(Boolean)).size;
    if (options.autoShade !== false) autoShade(final, width, height, strokeColor, Math.round(options.shadeColors ?? -1));
    const saturation = steps(options.saturation);
    const brightness = steps(options.brightness);
    if (saturation || brightness) {
        const adjusted = new Map();
        for (let i = 0; i < final.length; i++) {
            if (!final[i]) continue;
            if (!adjusted.has(final[i])) adjusted.set(final[i], hex(adjust(parseHex(final[i]), saturation, brightness)));
            final[i] = adjusted.get(final[i]);
        }
    }
    for (let i = 0; i < final.length; i++) if (final[i] && shading[i]) final[i] = hex(adjust(parseHex(final[i]), shading[i][0], shading[i][1]));
    const { palette: levelPalette, rows } = toLevel(final, width, height);
    const indices = final.map((c) => (c ? levelPalette.indexOf(c) : -1));
    // Difficulty: 'auto' (the default) aims at the goal for the level's place in the play order (`order`, when known);
    // 'manual' uses its own mix.
    const target = options.difficulty === 'manual' || options.order === undefined ? null : difficultyTarget(options.order);
    const baked = bakeDeck(indices, width, height, levelPalette.length, {
        id, seed: Math.round(options.seed ?? 0), mix: Math.max(0, Math.min(5, Math.round(options.mix ?? 0))), columns: Math.round(options.columns ?? 0),
        target, quick: !!options.quick,
    });
    const level = {
        id, name: options.name, width, height, palette: levelPalette, rows,
        columns: baked.columns, deck: baked.deck.map((t) => `${DIGITS[t.color]}x${t.count}`).join(' '), check: baked.check,
    };
    return { level, grid: final, preview: await previewPng(level), pixels: final.filter(Boolean).length, baseColors };
}

/** Depth for each colour area (not the outline's): lighter along its top and left edges, darker along its bottom and
 *  right ones, where the area goes on past that pixel (a one-pixel-thin line stays as it is). See SHADE. */
function autoShade(grid, width, height, skip, limit = -1) {
    // Which colours get shaded: the biggest (by pixels), up to `limit` of them.
    const counts = new Map();
    for (const c of grid) if (c && c !== skip) counts.set(c, (counts.get(c) ?? 0) + 1);
    const allowed = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit < 0 ? Infinity : limit).map(([c]) => c));
    const area = new Int32Array(width * height).fill(-1);
    const sizes = [];
    for (let start = 0; start < grid.length; start++) {
        if (!grid[start] || area[start] >= 0) continue;
        const id = sizes.length;
        const stack = [start];
        area[start] = id;
        let size = 0;
        while (stack.length) {
            const i = stack.pop();
            size++;
            const x = i % width;
            for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
                if (n < 0 || n >= grid.length || area[n] >= 0 || grid[n] !== grid[start]) continue;
                area[n] = id;
                stack.push(n);
            }
        }
        sizes.push(size);
    }
    const tone = (hexColor, [saturation, brightness], light) => {
        const rgb = adjust(parseHex(hexColor), saturation, brightness);
        // A light tone's kept off pure white.
        const top = 255 * SHADE.maxLight;
        return hex(light ? rgb.map((v) => Math.min(v, top + (v - top) * 0.2)) : rgb);
    };
    const tones = new Map();
    const shaded = grid.slice();
    for (let i = 0; i < grid.length; i++) {
        const c = grid[i];
        if (!c || c === skip || !allowed.has(c) || sizes[area[i]] < SHADE.minArea) continue;
        const x = i % width;
        const y = Math.floor(i / width);
        const same = (dx, dy) => {
            const nx = x + dx;
            const ny = y + dy;
            return nx >= 0 && ny >= 0 && nx < width && ny < height && grid[nx + ny * width] === c;
        };
        let kind = null;
        if ((!same(0, 1) && same(0, -1)) || (!same(1, 0) && same(-1, 0))) kind = 'dark';
        else if ((!same(0, -1) && same(0, 1)) || (!same(-1, 0) && same(1, 0))) kind = 'light';
        if (!kind) continue;
        const key = `${c}${kind}`;
        if (!tones.has(key)) tones.set(key, tone(c, SHADE[kind], kind === 'light'));
        shaded[i] = tones.get(key);
    }
    for (let i = 0; i < grid.length; i++) grid[i] = shaded[i];
}

/** Outlines the picture in `color`: each empty cell next to a block (sides or corners) gets one. */
function outline(grid, width, height, color) {
    const around = [];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (grid[x + y * width]) continue;
            let touches = false;
            for (let dy = -1; dy <= 1 && !touches; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && ny >= 0 && nx < width && ny < height && grid[nx + ny * width]) {
                        touches = true;
                        break;
                    }
                }
            }
            if (touches) around.push(x + y * width);
        }
    }
    for (const i of around) grid[i] = color;
}

/** A level drawn big: each pixel a PREVIEW_CELL square in its colour (2px gaps), empty cells left dark. */
export async function previewPng(level) {
    const size = { width: level.width * PREVIEW_CELL, height: level.height * PREVIEW_CELL };
    const out = Buffer.alloc(size.width * size.height * 3, 40);
    for (let y = 0; y < level.height; y++) {
        for (let x = 0; x < level.width; x++) {
            if (level.rows[y][x] === '.') continue;
            const c = parseHex(level.palette[DIGITS.indexOf(level.rows[y][x])]);
            for (let py = 1; py < PREVIEW_CELL - 1; py++) {
                for (let px = 1; px < PREVIEW_CELL - 1; px++) {
                    const o = ((y * PREVIEW_CELL + py) * size.width + x * PREVIEW_CELL + px) * 3;
                    out[o] = c[0];
                    out[o + 1] = c[1];
                    out[o + 2] = c[2];
                }
            }
        }
    }
    return sharp(out, { raw: { width: size.width, height: size.height, channels: 3 } }).png().toBuffer();
}
