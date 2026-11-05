// pixelate-lib.mjs — a picture to an Ant level (used by tools/pixelate.mjs and the level editor, web/server.mjs).
//
// pixelate(file, settings) samples the picture SAMPLES x SAMPLES times per cell of a small grid, reduces the opaque
// samples' colours to `colors` with k-means (deterministic), optionally snaps those to a palette (PALETTES: so
// pictures keep to a few friendly colours), and gives each cell its samples' most common colour. A cell whose samples
// are mostly transparent is empty ('.': no block). The background can be removed: `background: 'remove'` clears the
// colour around the picture (the most common colour on its border, flood-filled in from the edges, within a tolerance)
// so only the subject is left; 'auto' does that for a picture without transparency of its own; a hex colour fills
// transparency instead; 'keep' (default) leaves the picture as it is.
//
// Returns the level (id, name, size, palette by use, rows of palette indices) and a crisp preview PNG.

import sharp from 'sharp';

/** Samples per cell, each way: a cell's colour is the most common of its SAMPLES^2. */
const SAMPLES = 8;
/** A sample this transparent (alpha below this) counts as empty. */
const ALPHA_CUTOFF = 128;
/** Colour indices as one character each (up to 36 colours); '.' = empty. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
/** Background removal: how close (RGB distance) a colour must be to the border's to be cleared. */
const BACKGROUND_TOLERANCE = 48;
/** Preview: pixels this big, with a thin gap so the grid shows. */
const PREVIEW_CELL = 16;

export const DEFAULT_SETTINGS = { width: 24, height: 24, colors: 6, palette: 'none', background: 'auto' };

/** Colour sets a picture can be snapped to (the editor's "Palette"): soft and friendly first. */
export const PALETTES = {
    none: [],
    cozy: ['#f28b8b', '#f7a8b8', '#ffe08a', '#f9c48f', '#9ed59a', '#6fb27a', '#8fbfe3', '#cfe3f2', '#b8a4d8', '#fdf0dc', '#fff4e4', '#d9a37e', '#7a5646', '#6d7fa8', '#ffffff', '#4a4a5a'],
    candy: ['#ff6b8b', '#ff9ec7', '#ffd166', '#06d6a0', '#4cc9f0', '#7b6cf6', '#c77dff', '#ffffff', '#2b2d42', '#ff8c42'],
    garden: ['#5fa35a', '#9ed59a', '#cfe8b5', '#f6d365', '#f28b8b', '#fdf0dc', '#a07850', '#6b4a2f', '#8fbfe3', '#ffffff'],
    sea: ['#1f5fa8', '#3e8ed0', '#8fbfe3', '#cfe3f2', '#ffe08a', '#f9c48f', '#fdf0dc', '#ffffff', '#2b3a55', '#f28b8b'],
    night: ['#2b2d6e', '#4b4fa8', '#8f8fd8', '#ffe08a', '#fff4c2', '#ffffff', '#1a1a2e', '#f7a8b8', '#6fd3c8'],
};

const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means over colours: deterministic start (the most common, then the farthest, weighted), 30 rounds. */
function kmeans(pixels, k) {
    const counts = new Map();
    for (const p of pixels) {
        const key = p.join(',');
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

/**
 * Clears the background: the most common colour on the sample grid's border, flood-filled in from the edges through
 * samples within BACKGROUND_TOLERANCE of it (so a colour inside the subject that happens to match stays).
 */
function removeBackground(samples, opaque, width, height) {
    const border = new Map();
    const add = (i) => {
        if (!opaque[i]) return;
        const key = samples[i].join(',');
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

/** A picture file to a level ({ id, name, width, height, palette, rows }) and its preview PNG (a Buffer). */
export async function pixelate(file, id, settings) {
    const options = { ...DEFAULT_SETTINGS, name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), ...settings };
    const width = Math.max(4, Math.min(64, Math.round(options.width)));
    const height = Math.max(4, Math.min(64, Math.round(options.height)));
    const colors = Math.max(2, Math.min(16, Math.round(options.colors)));
    const sampleWidth = width * SAMPLES;
    const sampleHeight = height * SAMPLES;
    let image = sharp(file, { density: 300 });
    const fill = /^#[0-9a-f]{6}$/i.test(options.background) ? parseHex(options.background) : null;
    if (fill) image = image.flatten({ background: { r: fill[0], g: fill[1], b: fill[2] } });
    const meta = await sharp(file, { density: 300 }).metadata();
    const { data } = await image.resize(sampleWidth, sampleHeight, { fit: 'fill', kernel: 'nearest' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const samples = [];
    const opaque = [];
    for (let i = 0; i < sampleWidth * sampleHeight; i++) {
        samples.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
        opaque.push(data[i * 4 + 3] >= ALPHA_CUTOFF);
    }
    // 'auto': a picture with transparency of its own keeps it; one without gets its background removed.
    const hasAlpha = meta.hasAlpha && opaque.some((o) => !o);
    if (options.background === 'remove' || (options.background === 'auto' && !hasAlpha)) removeBackground(samples, opaque, sampleWidth, sampleHeight);

    let centres = kmeans(samples.filter((_, i) => opaque[i]), colors);
    // Snapped to the palette: each colour becomes the palette's nearest (two that land on the same one merge).
    const palette = PALETTES[options.palette] ?? (Array.isArray(options.palette) ? options.palette : []);
    if (palette.length) {
        const snapped = new Map();
        for (const c of centres) {
            const near = palette.map(parseHex).reduce((best, p) => (distance2(p, c) < distance2(best, c) ? p : best));
            snapped.set(near.join(','), near);
        }
        centres = [...snapped.values()];
    }
    const nearest = (p) => centres.reduce((best, c, i) => (distance2(p, c) < distance2(p, centres[best]) ? i : best), 0);
    const indices = [];
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
            indices.push(!centres.length || empty * 2 > SAMPLES * SAMPLES ? -1 : votes.indexOf(Math.max(...votes)));
        }
    }
    // Unused colours go; the palette is ordered by use (most first).
    const usage = centres.map((_, i) => indices.filter((n) => n === i).length);
    const order = centres.map((_, i) => i).filter((i) => usage[i] > 0).sort((a, b) => usage[b] - usage[a]);
    const remap = new Map(order.map((old, i) => [old, i]));
    const levelPalette = order.map((i) => hex(centres[i]));
    const rows = [];
    for (let y = 0; y < height; y++) {
        rows.push(indices.slice(y * width, (y + 1) * width).map((n) => (n < 0 ? '.' : DIGITS[remap.get(n)])).join(''));
    }
    const level = { id, name: options.name, width, height, palette: levelPalette, rows };
    return { level, preview: await previewPng(level), pixels: indices.filter((n) => n >= 0).length };
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
