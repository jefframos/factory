// Ant level editor server — `npm run editor` with GAME=ant (tools/editor/run-editor.mjs starts it).
//
// Serves the editor page (web/public) and a small JSON API over the game's level files:
//   GET  /api/levels           every level in play order (levels/index.json) with its settings and stats, + PALETTES
//   POST /api/preview          { id, settings } -> a pixelated preview (not saved): PNG data URL, pixels, palette
//   POST /api/save             { id, settings } -> writes levels/<id>.json, its preview, and pictures.json's settings
//   POST /api/order            { levels: [ids] } -> levels/index.json
//   POST /api/upload           { id, filename, data (base64) } -> a new picture in raw-assets/pictures, pixelated, last
//   POST /api/delete           { id } -> out of the game (the source picture moves to raw-assets/pictures/removed)
//   GET  /previews/<id>.png, /sources/<file>
// The game (vite dev server) picks the level files up on its own.

import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pixelate, PALETTES, DEFAULT_SETTINGS } from '../tools/pixelate-lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(__dirname, 'public');
const PICTURES = path.join(ROOT, 'raw-assets/pictures');
const SETTINGS_FILE = path.join(PICTURES, 'pictures.json');
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

async function listLevels() {
    const index = await readJson(INDEX, { levels: [] });
    const settings = await readJson(SETTINGS_FILE, {});
    const levels = [];
    for (const id of index.levels) {
        const level = await readJson(path.join(LEVELS, `${id}.json`), null);
        if (!level) continue;
        const pixels = level.rows.join('').replace(/\./g, '').length;
        levels.push({
            id, name: level.name, width: level.width, height: level.height, palette: level.palette, pixels,
            settings: { ...DEFAULT_SETTINGS, name: level.name, ...settings[id] }, source: sourceOf(id),
        });
    }
    return { levels, palettes: PALETTES };
}

/** Pixelates a level's source with `settings`; `save` writes the level, its preview and its settings. */
async function run(id, settings, save) {
    const source = sourceOf(id);
    if (!source) throw new Error(`No picture for ${id} in raw-assets/pictures`);
    const result = await pixelate(path.join(PICTURES, source), id, settings);
    if (save) {
        await fs.mkdir(PREVIEWS, { recursive: true });
        await writeJson(path.join(LEVELS, `${id}.json`), result.level);
        await fs.writeFile(path.join(PREVIEWS, `${id}.png`), result.preview);
        const all = await readJson(SETTINGS_FILE, {});
        all[id] = settings;
        await writeJson(SETTINGS_FILE, all);
    }
    return { png: `data:image/png;base64,${result.preview.toString('base64')}`, pixels: result.pixels, palette: result.level.palette, width: result.level.width, height: result.level.height };
}

const api = {
    'GET /api/levels': () => listLevels(),
    'POST /api/preview': ({ id, settings }) => run(id, settings, false),
    'POST /api/save': ({ id, settings }) => run(id, settings, true),
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
        const settings = { ...DEFAULT_SETTINGS, name: id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), palette: 'cozy' };
        await run(id, settings, true);
        const index = await readJson(INDEX, { levels: [] });
        if (!index.levels.includes(id)) index.levels.push(id);
        await writeJson(INDEX, index);
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
}).listen(PORT, () => console.log(`🐜 Ant level editor: http://localhost:${PORT}`));
