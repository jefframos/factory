// Ant level editor server — `npm run editor` with GAME=ant (tools/editor/run-editor.mjs starts it).
//
// Serves the editor page (web/public) and a small JSON API over the game's level files:
//   GET  /api/levels           every level in play order (levels/index.json) with its settings and stats, + the
//                              preset PALETTES and the master palette (raw-assets/pictures/palette.json)
//   POST /api/preview          { id, settings, master? } -> the level built (not saved): PNG data URL, pixels, palette,
//                              its grid (hex colours, null = empty: the paint canvas) and pickGrid (the same before
//                              the level's saturation / brightness and brushes: the colour picker), its baked tiles (columns, deck)
//                              and the solver's check; `master` tries a palette unsaved
//   POST /api/save             { id, settings } -> writes levels/<id>.json, its preview, and pictures.json's settings
//   POST /api/palette          { colors } -> saves the master palette and rebuilds every level that uses it
//   POST /api/order            { levels: [ids] } -> levels/index.json
//   POST /api/upload           { id, filename, data (base64) } -> a new picture in raw-assets/pictures, pixelated, last
//   POST /api/create           { id, width, height } -> a new empty level to draw (no picture), last
//   POST /api/delete           { id } -> out of the game (the source picture moves to raw-assets/pictures/removed)
//   GET  /previews/<id>.png, /sources/<file>
// The game (vite dev server) picks the level files up on its own. The page opens in the browser on start (NO_OPEN=1 to
// skip), like the other games' editors.

import http from 'node:http';
import { exec } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLevel, PALETTES, DEFAULT_SETTINGS } from '../tools/pixelate-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const PICTURES = path.join(ROOT, 'raw-assets/pictures');
const SETTINGS_FILE = path.join(PICTURES, 'pictures.json');
const PALETTE_FILE = path.join(PICTURES, 'palette.json');
const LEVELS = path.join(ROOT, 'levels');
const PREVIEWS = path.join(LEVELS, 'previews');
const INDEX = path.join(LEVELS, 'index.json');
const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4720;
const IMAGE = /\.(png|jpe?g|webp|svg)$/i;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const readJson = async (file, fallback) => {
    try {
        return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
        return fallback;
    }
};
const writeJson = (file, data) => fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
/** The source picture of a level (its file in raw-assets/pictures), or undefined. */
const sourceOf = (id) => fsSync.readdirSync(PICTURES).find((f) => IMAGE.test(f) && path.parse(f).name === id);
const validId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-_]*$/.test(id);
const titleOf = (id) => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const HEX = /^#[0-9a-f]{6}$/i;
const readMaster = async () => (await readJson(PALETTE_FILE, { colors: [] })).colors;

async function listLevels() {
    const index = await readJson(INDEX, { levels: [] });
    const settings = await readJson(SETTINGS_FILE, {});
    const levels = [];
    for (const id of index.levels) {
        const level = await readJson(path.join(LEVELS, `${id}.json`), null);
        if (!level) continue;
        const pixels = level.rows.join('').replace(/\./g, '').length;
        levels.push({
            id, name: level.name, width: level.width, height: level.height, palette: level.palette, pixels, check: level.check,
            settings: { ...DEFAULT_SETTINGS, name: level.name, ...settings[id] }, source: sourceOf(id),
        });
    }
    return { levels, palettes: PALETTES, master: await readMaster() };
}

/** Builds a level from its picture (none: drawn by hand) with `settings`; `save` writes the level, its preview and its
 *  settings. `master` overrides the saved master palette (trying one out). */
async function run(id, settings, save, master) {
    const source = sourceOf(id);
    // Its place in the play order sets its difficulty goal; the live preview searches for it quickly, Save fully.
    const levels = (await readJson(INDEX, { levels: [] })).levels;
    const order = levels.includes(id) ? levels.indexOf(id) : levels.length;
    const result = await buildLevel(source ? path.join(PICTURES, source) : null, id, { ...settings, order, quick: !save }, master ?? (await readMaster()));
    if (save) {
        await fs.mkdir(PREVIEWS, { recursive: true });
        await writeJson(path.join(LEVELS, `${id}.json`), result.level);
        await fs.writeFile(path.join(PREVIEWS, `${id}.png`), result.preview);
        const all = await readJson(SETTINGS_FILE, {});
        all[id] = settings;
        await writeJson(SETTINGS_FILE, all);
    }
    return { png: `data:image/png;base64,${result.preview.toString('base64')}`, pixels: result.pixels, palette: result.level.palette, width: result.level.width, height: result.level.height, grid: result.grid, pickGrid: result.pickGrid,
        columns: result.level.columns, deck: result.level.deck, check: result.level.check, baseColors: result.baseColors, mergedTones: result.mergedTones };
}

/** Adds a level at the end of the play order. */
async function append(id) {
    const index = await readJson(INDEX, { levels: [] });
    if (!index.levels.includes(id)) index.levels.push(id);
    await writeJson(INDEX, index);
}

const api = {
    'GET /api/levels': () => listLevels(),
    'POST /api/preview': ({ id, settings, master }) => run(id, settings, false, Array.isArray(master) ? master.filter((c) => HEX.test(c)) : undefined),
    'POST /api/save': ({ id, settings }) => run(id, settings, true),
    'POST /api/palette': async ({ colors }) => {
        if (!Array.isArray(colors) || !colors.length || !colors.every((c) => HEX.test(c))) throw new Error('The palette needs at least one #rrggbb colour');
        const file = await readJson(PALETTE_FILE, {});
        await writeJson(PALETTE_FILE, { ...file, colors: colors.map((c) => c.toLowerCase()) });
        // Every level on the master palette is rebuilt in the new tones.
        const all = await readJson(SETTINGS_FILE, {});
        const rebuilt = [];
        for (const id of (await readJson(INDEX, { levels: [] })).levels) {
            const settings = { ...DEFAULT_SETTINGS, name: titleOf(id), ...all[id] };
            if (settings.palette !== 'master') continue;
            await run(id, all[id] ?? settings, true);
            rebuilt.push(id);
        }
        return { rebuilt };
    },
    'POST /api/order': async ({ levels }) => {
        const known = (await readJson(INDEX, { levels: [] })).levels;
        // Only reorders: every level stays, none is added by mistake.
        if (!Array.isArray(levels) || levels.length !== known.length || !levels.every((id) => known.includes(id))) throw new Error('Order must list every level once');
        await writeJson(INDEX, { levels });
        return { ok: true };
    },
    'POST /api/upload': async ({ id, filename, data }) => {
        if (!validId(id)) throw new Error('Id: lower-case letters, digits, - or _');
        const ext = path.extname(filename ?? '').toLowerCase();
        if (!IMAGE.test(ext)) throw new Error('A .png, .jpg, .webp or .svg picture');
        if (sourceOf(id)) throw new Error(`There's already a picture called ${id}`);
        await fs.writeFile(path.join(PICTURES, `${id}${ext}`), Buffer.from(data, 'base64'));
        await run(id, { ...DEFAULT_SETTINGS, name: titleOf(id) }, true);
        await append(id);
        return { ok: true };
    },
    'POST /api/create': async ({ id, width, height }) => {
        if (!validId(id)) throw new Error('Id: lower-case letters, digits, - or _');
        if (sourceOf(id) || fsSync.existsSync(path.join(LEVELS, `${id}.json`))) throw new Error(`There's already a level called ${id}`);
        await run(id, { ...DEFAULT_SETTINGS, name: titleOf(id), width: Number(width) || 16, height: Number(height) || 16 }, true);
        await append(id);
        return { ok: true };
    },
    'POST /api/delete': async ({ id }) => {
        const index = await readJson(INDEX, { levels: [] });
        index.levels = index.levels.filter((l) => l !== id);
        await writeJson(INDEX, index);
        await fs.rm(path.join(LEVELS, `${id}.json`), { force: true });
        await fs.rm(path.join(PREVIEWS, `${id}.png`), { force: true });
        const source = sourceOf(id);
        if (source) {
            await fs.mkdir(path.join(PICTURES, 'removed'), { recursive: true });
            await fs.rename(path.join(PICTURES, source), path.join(PICTURES, 'removed', source));
        }
        const all = await readJson(SETTINGS_FILE, {});
        delete all[id];
        await writeJson(SETTINGS_FILE, all);
        return { ok: true };
    },
};

async function serveFile(res, dir, name) {
    const file = path.join(dir, name);
    if (!file.startsWith(dir)) return notFound(res);
    try {
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
    } catch {
        notFound(res);
    }
}

function notFound(res) {
    res.writeHead(404);
    res.end('Not found');
}

http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const handler = api[`${req.method} ${url.pathname}`];
    if (handler) {
        try {
            let body = '';
            for await (const chunk of req) body += chunk;
            const result = await handler(body ? JSON.parse(body) : {});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }
    if (url.pathname.startsWith('/previews/')) return serveFile(res, PREVIEWS, decodeURIComponent(url.pathname.slice('/previews/'.length)));
    if (url.pathname.startsWith('/sources/')) return serveFile(res, PICTURES, decodeURIComponent(url.pathname.slice('/sources/'.length)));
    return serveFile(res, PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
}).listen(PORT, () => {
    const address = `http://localhost:${PORT}`;
    console.log(`🐜 Ant level editor: ${address}`);
    // Opens in the browser like the other games' editors (NO_OPEN=1 to skip).
    if (!process.env.NO_OPEN) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
        exec(`${opener} ${address}`);
    }
});
