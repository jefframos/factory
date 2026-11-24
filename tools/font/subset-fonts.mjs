// subset-fonts.mjs — the built web fonts with only the characters a game can show (run by build-font.mjs and
// build-assets.mjs after the fonts are packed; on its own: `npm run font:subset`).
//
//   node tools/font/subset-fonts.mjs                 the game in .env
//   node tools/font/subset-fonts.mjs mow dig         these games
//   node tools/font/subset-fonts.mjs --all           every game with built fonts
//   ... --dry                                        only say what it would save
//
// A font often carries scripts the game never writes (Baloo 2 has all of Hindi: two thirds of the file). Kept:
//   - always: Latin with every accent (Vietnamese too), punctuation, currency, arrows, maths, shapes, symbols, icons
//     (the private use area);
//   - every other character in the game's own text (its code, locales, UI and levels, and core's code): the whole block
//     it's in up to U+1FFF (Cyrillic, Greek, Hindi, Arabic, Thai...: adding a word can't lose a letter), just the
//     characters themselves past that (Chinese, Japanese, Korean).
// A character the font hasn't got is drawn by the system's font, as before. Always cut from the source font in
// raw-assets/fonts (never from an earlier cut), so a new language only needs the script run again.
//
// A game's own exceptions: games/<game>/fonts.subset.json — { "full": ["FontName"], "keep": "extra characters" }.

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Always kept (inclusive ranges). */
const ALWAYS = [
    [0x20, 0x24f], [0x2b0, 0x36f], [0x1e00, 0x1eff], [0x2000, 0x20cf], [0x2100, 0x22ff], [0x2300, 0x23ff], [0x25a0, 0x27bf], [0xe000, 0xf8ff], [0xfb00, 0xfb06],
];
const BLOCK = 0x80;
const BLOCKS_END = 0x1fff;
const TEXT_FILES = /\.(ts|js|mjs|json|html)$/;
const SKIP_DIRS = new Set(['raw-assets', 'node_modules', 'manifests', 'registry', 'reports', 'refs', 'dist']);

/** Adds the characters past Latin in every text file under `dir`. */
function collect(dir, into) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) collect(file, into);
            continue;
        }
        if (!TEXT_FILES.test(entry.name)) continue;
        const text = fs.readFileSync(file, 'utf8');
        for (const char of text) if (char > 'ɏ') into.add(char.codePointAt(0));
        // Written as escapes in code (Р, \u{1F600}).
        for (const match of text.matchAll(/\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g)) into.add(parseInt(match[1] ?? match[2], 16));
    }
}

/** Everything a game may show, as a string of characters. */
export function charactersOf(game, keep = '') {
    const used = new Set([...keep].map((char) => char.codePointAt(0)));
    collect(path.join(ROOT, 'games', game), used);
    collect(path.join(ROOT, 'core'), used);
    const points = new Set();
    const range = (from, to) => {
        for (let c = from; c <= to; c++) points.add(c);
    };
    ALWAYS.forEach(([from, to]) => range(from, to));
    for (const c of used) {
        if (c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) continue;
        if (c <= BLOCKS_END) range(c - (c % BLOCK), c - (c % BLOCK) + BLOCK - 1);
        else points.add(c);
    }
    let text = '';
    for (const c of points) text += String.fromCodePoint(c);
    return text;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

/** Cuts a game's built fonts down. Returns the bytes before and after. */
export async function subsetFonts(game, { dry = false } = {}) {
    const rawDir = path.join(ROOT, 'games', game, 'raw-assets/fonts');
    const outDir = path.join(ROOT, 'public', game, 'fonts');
    const total = { before: 0, after: 0 };
    if (!fs.existsSync(rawDir) || !fs.existsSync(outDir)) return total;
    const configFile = path.join(ROOT, 'games', game, 'fonts.subset.json');
    const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
    const text = charactersOf(game, config.keep);
    for (const source of fs.readdirSync(rawDir).filter((name) => /\.(ttf|otf|woff2?)$/i.test(name))) {
        // `Name{wf}.ttf` is built as `Name.woff2` (AssetPack's tags dropped).
        const name = source.replace(/\{[^}]*\}/g, '').replace(/\.[^.]+$/, '');
        const out = path.join(outDir, `${name}.woff2`);
        if (!fs.existsSync(out) || config.full?.includes(name)) continue;
        const before = fs.statSync(out).size;
        try {
            const cut = await subsetFont(fs.readFileSync(path.join(rawDir, source)), text, { targetFormat: 'woff2' });
            if (!dry) fs.writeFileSync(out, cut);
            total.before += before;
            total.after += cut.length;
            console.log(`🔤 ${game}/${name}: ${kb(before)} → ${kb(cut.length)}`);
        } catch (error) {
            // The full font stays: a font that can't be cut still works.
            console.warn(`⚠️  ${game}/${name}: left whole (${error.message})`);
        }
    }
    return total;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const dry = args.includes('--dry');
    const named = args.filter((arg) => !arg.startsWith('--'));
    const games = args.includes('--all')
        ? fs.readdirSync(path.join(ROOT, 'games')).filter((game) => fs.existsSync(path.join(ROOT, 'public', game, 'fonts')))
        : named.length ? named : [dotenv.config({ path: path.join(ROOT, '.env') }).parsed?.GAME].filter(Boolean);
    if (!games.length) {
        console.error('❌ No game: set GAME in .env, or name some (or --all)');
        process.exit(1);
    }
    for (const game of games) {
        const { before, after } = await subsetFonts(game, { dry });
        if (before) console.log(`✅ ${game}: ${kb(before)} → ${kb(after)}${dry ? ' (dry run)' : ''}`);
    }
}
