// build-catalog.mjs
//
// Bakes tools/ui-kit/sprites.json: a line of facts about every sprite in the Layer Lab pack (library3d/2d/ResourcesData/Sprites),
// measured from its pixels, so UI gets built from data rather than guesses:
//
//   size     [w, h]
//   slice    [left, top, right, bottom]: nine-slice borders, where the sprite's stretchable middle starts and ends (the
//            longest run of identical columns and of identical rows). null on an axis's pair if it has no such run: don't
//            stretch it that way. Ribbons etc. get their ends kept this way too.
//   tint     'white': a greyscale sprite made to be tinted (it reads as plain white untinted!). 'color': has its own colours.
//   stretch  'both' | 'x' | 'y' | 'none': the ways it can be stretched without smearing.
//
// node tools/ui-kit/build-catalog.mjs   (from the repo root). See README.md here for what the elements are for.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..', 'library3d', '2d', 'ResourcesData', 'Sprites');
const OUT = path.join(HERE, 'sprites.json');
/** Pixels this close count as the same (compression noise). */
const SAME = 2;
/** A run must be at least this long, and this share of the side, to count as stretchable. */
const MIN_RUN = 2;
const MIN_SHARE = 0.05;
/** Sizes we don't list: the same picture smaller or bigger. */
const SKIP_DIRS = new Set(['64', '256', '512', 'Original']);

async function walk(dir) {
    const found = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) found.push(...await walk(full));
        } else if (/\.png$/i.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}

/** The longest run of lines (indices) where each equals the one before it: [start, end] inclusive, or null. */
function longestRun(count, same) {
    let best = null;
    let start = 0;
    for (let i = 1; i <= count; i++) {
        if (i < count && same(i - 1, i)) continue;
        if (i - 1 - start >= (best ? best[1] - best[0] : 0) && i - 1 > start) best = [start, i - 1];
        start = i;
    }
    if (!best) return null;
    const length = best[1] - best[0] + 1;
    return length >= MIN_RUN && length >= count * MIN_SHARE ? best : null;
}

async function measure(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const close = (a, b) => Math.abs(data[a] - data[b]) <= SAME && Math.abs(data[a + 1] - data[b + 1]) <= SAME && Math.abs(data[a + 2] - data[b + 2]) <= SAME && Math.abs(data[a + 3] - data[b + 3]) <= SAME;
    const columns = longestRun(w, (a, b) => {
        for (let y = 0; y < h; y++) if (!close((y * w + a) * 4, (y * w + b) * 4)) return false;
        return true;
    });
    const rows = longestRun(h, (a, b) => {
        for (let x = 0; x < w; x++) if (!close((a * w + x) * 4, (b * w + x) * 4)) return false;
        return true;
    });
    // Greyscale and mostly bright: it's meant to be tinted. Dark sprites are colours of their own.
    let solid = 0;
    let grey = 0;
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        solid++;
        if (Math.abs(data[i] - data[i + 1]) <= 6 && Math.abs(data[i + 1] - data[i + 2]) <= 6) grey++;
        if (data[i] > 225) bright++;
    }
    const white = solid > 0 && grey / solid > 0.98 && bright / solid > 0.5;
    const slice = [columns ? columns[0] : null, rows ? rows[0] : null, columns ? w - 1 - columns[1] : null, rows ? h - 1 - rows[1] : null];
    return {
        size: [w, h],
        slice,
        tint: white ? 'white' : 'color',
        stretch: columns && rows ? 'both' : columns ? 'x' : rows ? 'y' : 'none',
    };
}

const files = await walk(ROOT);
const catalog = {};
for (const file of files.sort()) {
    const relative = path.relative(ROOT, file).replace(/\\/g, '/');
    try {
        catalog[relative] = await measure(file);
    } catch (error) {
        console.warn(`skipped ${relative}: ${error.message}`);
    }
}
// One sprite a line: greppable.
const lines = Object.entries(catalog).map(([name, facts]) => `  ${JSON.stringify(name)}: ${JSON.stringify(facts)}`);
await fs.writeFile(OUT, `{\n${lines.join(',\n')}\n}\n`);
console.log(`${lines.length} sprites -> ${path.relative(process.cwd(), OUT)}`);
