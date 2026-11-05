// pixelate.mjs — turns pictures into Ant levels.
//
//   npm run ant:pixelate              every picture in games/ant/raw-assets/pictures
//   npm run ant:pixelate -- mushroom  just that one (file name without extension)
//
// Each picture (.png / .jpg / .webp / .svg) is sampled SAMPLES x SAMPLES times per cell of a small grid; the samples'
// colours are reduced to a handful with k-means (deterministic: the same picture always gives the same level), and each
// cell takes its samples' most common colour — crisp edges, no blended in-between colours. The level goes
// to games/ant/levels/<name>.json — size, palette, rows of colour indices — with a big, crisp preview next to it
// (levels/previews/<name>.png) to check by eye. Per picture settings live in raw-assets/pictures/pictures.json:
//
//   { "mushroom": { "width": 24, "height": 24, "colors": 6, "name": "Mushroom" } }
//
// (defaults: 24 x 24, 6 colours, the file name). A picture's transparent parts become `background` (default white).
// The levels' order is games/ant/levels/index.json: a new picture is added at the end, existing ones keep their place.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PICTURES = path.join(root, 'raw-assets/pictures');
const LEVELS = path.join(root, 'levels');
const PREVIEWS = path.join(LEVELS, 'previews');
const DEFAULTS = { width: 24, height: 24, colors: 6, background: '#ffffff' };
/** Preview: pixels this big, with a thin gap so the grid shows. */
const PREVIEW_CELL = 16;
/** Samples per cell, each way: a cell's colour is the most common of its SAMPLES^2. */
const SAMPLES = 8;
/** Colour indices as one character each (up to 36 colours). */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

const settings = fs.existsSync(path.join(PICTURES, 'pictures.json')) ? JSON.parse(fs.readFileSync(path.join(PICTURES, 'pictures.json'), 'utf8')) : {};
const only = process.argv[2];
const files = fs.readdirSync(PICTURES).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f) && (!only || path.parse(f).name === only));
if (!files.length) {
    console.error(only ? `No picture named ${only} in ${PICTURES}` : `No pictures in ${PICTURES}`);
    process.exit(1);
}
fs.mkdirSync(PREVIEWS, { recursive: true });

const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** k-means over the pixels' colours: k++-style start (deterministic: the most common colour, then the farthest), 30 rounds. */
function kmeans(pixels, k) {
    const counts = new Map();
    for (const p of pixels) {
        const key = p.join(',');
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const unique = [...counts.entries()].map(([key, n]) => ({ c: key.split(',').map(Number), n }));
    if (unique.length <= k) return unique.map((u) => u.c);
    unique.sort((a, b) => b.n - a.n);
    const centres = [unique[0].c.slice()];
    while (centres.length < k) {
        // The colour farthest from every centre so far, weighted by how often it appears.
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

const index = fs.existsSync(path.join(LEVELS, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(LEVELS, 'index.json'), 'utf8')) : { levels: [] };

for (const file of files) {
    const id = path.parse(file).name;
    const options = { ...DEFAULTS, name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), ...settings[id] };
    const background = parseHex(options.background);
    // Sampled SAMPLES x SAMPLES per cell (transparency flattened onto the background).
    const sampleWidth = options.width * SAMPLES;
    const sampleHeight = options.height * SAMPLES;
    const { data } = await sharp(path.join(PICTURES, file), { density: 300 })
        .flatten({ background: { r: background[0], g: background[1], b: background[2] } })
        .resize(sampleWidth, sampleHeight, { fit: 'fill', kernel: 'nearest' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const samples = [];
    for (let i = 0; i < sampleWidth * sampleHeight; i++) samples.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]);
    const centres = kmeans(samples, options.colors);
    const nearest = (p) => centres.reduce((best, c, i) => (distance2(p, c) < distance2(p, centres[best]) ? i : best), 0);
    // Each cell: the colour most of its samples are nearest to.
    const indices = [];
    for (let y = 0; y < options.height; y++) {
        for (let x = 0; x < options.width; x++) {
            const votes = new Array(centres.length).fill(0);
            for (let sy = 0; sy < SAMPLES; sy++) {
                for (let sx = 0; sx < SAMPLES; sx++) votes[nearest(samples[(y * SAMPLES + sy) * sampleWidth + x * SAMPLES + sx])]++;
            }
            indices.push(votes.indexOf(Math.max(...votes)));
        }
    }
    // Unused centres go; the palette is ordered by how many pixels use each colour (most first).
    const usage = centres.map((_, i) => indices.filter((n) => n === i).length);
    const order = centres.map((_, i) => i).filter((i) => usage[i] > 0).sort((a, b) => usage[b] - usage[a]);
    const remap = new Map(order.map((old, i) => [old, i]));
    const palette = order.map((i) => hex(centres[i]));
    const rows = [];
    for (let y = 0; y < options.height; y++) {
        rows.push(indices.slice(y * options.width, (y + 1) * options.width).map((n) => DIGITS[remap.get(n)]).join(''));
    }
    const level = { id, name: options.name, width: options.width, height: options.height, palette, rows };
    fs.writeFileSync(path.join(LEVELS, `${id}.json`), `${JSON.stringify(level, null, 2)}\n`);

    // The preview: each pixel a PREVIEW_CELL square in its palette colour, a 2px gap between them.
    const size = { width: options.width * PREVIEW_CELL, height: options.height * PREVIEW_CELL };
    const out = Buffer.alloc(size.width * size.height * 3, 40);
    for (let y = 0; y < options.height; y++) {
        for (let x = 0; x < options.width; x++) {
            const c = parseHex(palette[DIGITS.indexOf(rows[y][x])]);
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
    await sharp(out, { raw: { width: size.width, height: size.height, channels: 3 } }).png().toFile(path.join(PREVIEWS, `${id}.png`));
    if (!index.levels.includes(id)) index.levels.push(id);
    console.log(`🐜 ${id}: ${options.width}x${options.height}, ${palette.length} colours ${palette.join(' ')}`);
}
fs.writeFileSync(path.join(LEVELS, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`📋 levels/index.json: ${index.levels.join(', ')}`);
