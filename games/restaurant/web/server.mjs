// Restaurant editor server — `npm run editor` with GAME=restaurant.
//
// Reads/writes games/restaurant/levels/restaurant.json and levels/market.json (`/api/layout?level=market`: the
// supermarket's) — the layouts the game loads: floors, walls with their windows and
// doors, props, the stations and their camera shots — Vite reloads the game when it's saved), lists the models under
// public/restaurant/models, and serves the browser editor in ./public (as Dig's editor: three.js straight from
// node_modules, no build step). Models can be imported from the 3D asset library (LIBRARY3D_DIR, default the repo's
// library3d submodule): copied into raw-assets/models/library{m}/<slug>/ and published to models/library/<slug>/ at once.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const GAME_DIR = path.join(__dirname, '..');
/** The layouts the editor edits (`?level=`): the restaurant, the supermarket. */
const LEVELS = { restaurant: 'restaurant.json', market: 'market.json' };
const layoutFile = (level) => path.join(GAME_DIR, 'levels', LEVELS[level] ?? LEVELS.restaurant);
const SETTINGS_FILE = path.join(GAME_DIR, 'settings.json');
const REPO_ROOT = path.join(GAME_DIR, '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'public', 'restaurant', 'models');
const THREE_DIR = path.join(REPO_ROOT, 'node_modules', 'three');
const THUMBS_DIR = path.join(__dirname, '.thumbs');
const LIBRARY_DIR = path.resolve(process.env.LIBRARY3D_DIR ?? path.join(REPO_ROOT, 'library3d'));
const LIBRARY_FILES = path.join(LIBRARY_DIR, 'files');
const LIBRARY_THUMBS = path.join(LIBRARY_DIR, 'library', 'thumbs');
/** Imported library models: the raw source the model build packs, and its published copy (usable right away). */
const IMPORT_RAW_DIR = path.join(GAME_DIR, 'raw-assets', 'models', 'library{m}');
const IMPORT_PUBLIC_DIR = path.join(MODELS_DIR, 'library');
const SAFE_NAME = /^[\w.\- ]+$/;
const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4730;
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:9001/?dev=1';

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
};

async function readJson(file, fallback) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
        return fallback;
    }
}

async function writeJson(file, data) {
    await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

const fileVersion = (file) => fs.stat(file).then((stat) => Math.round(stat.mtimeMs), () => 0);

async function listModels(dir = MODELS_DIR, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const models = [];
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            // (The customers aren't props.)
            if (relative === 'people') continue;
            models.push(...await listModels(path.join(dir, entry.name), relative));
        } else if (/\.(gltf|glb)$/i.test(entry.name)) {
            const stat = await fs.stat(path.join(dir, entry.name));
            models.push({ path: relative, mtime: Math.round(stat.mtimeMs), size: stat.size });
        }
    }
    return models.sort((a, b) => a.path.localeCompare(b.path));
}

const thumbFile = (model) => `${model.path.replaceAll('/', '__')}.${model.mtime}.png`;

async function listModelsWithThumbs() {
    const existing = new Set(await fs.readdir(THUMBS_DIR).catch(() => []));
    return (await listModels()).map((model) => ({ ...model, thumb: existing.has(thumbFile(model)) ? thumbFile(model) : null, thumbName: thumbFile(model) }));
}

let libraryCache = null;
async function listLibrary() {
    if (libraryCache) return libraryCache;
    const index = await readJson(path.join(LIBRARY_DIR, 'library', 'index.json'), null);
    if (!index) return { available: false, dir: LIBRARY_DIR, assets: [] };
    const thumbs = new Set(await fs.readdir(LIBRARY_THUMBS).catch(() => []));
    const assets = [];
    for (const asset of index.assets ?? []) {
        const format = asset.formats?.glb ? 'glb' : asset.formats?.gltf ? 'gltf' : null;
        if (!format || asset.kind !== 'model') continue;
        const thumbName = `${asset.id.replaceAll('/', '__')}.png`;
        assets.push({
            id: asset.id,
            name: asset.name,
            pack: asset.pack,
            collection: asset.collection,
            tags: asset.tags ?? [],
            file: asset.formats[format],
            thumb: thumbs.has(thumbName) ? `/library-thumbs/${encodeURIComponent(thumbName)}` : asset.preview ? `/library-files/${asset.preview}` : null,
        });
    }
    libraryCache = { available: true, dir: LIBRARY_DIR, assets };
    return libraryCache;
}

const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Copies a library model (and its .bin, textures) into the game: raw and published. Returns the layout's model path. */
async function importLibraryModel(id) {
    const library = await listLibrary();
    const asset = library.assets.find((entry) => entry.id === id);
    if (!asset) throw new Error(`Unknown library asset ${id}`);
    const { resolveDeps } = await import(pathToFileURL(path.join(LIBRARY_DIR, 'server', 'deps.mjs')).href);
    const { files, warnings } = await resolveDeps(LIBRARY_FILES, asset.file);
    const slug = slugify(`${asset.collection || asset.pack}-${asset.name}`);
    const ext = path.extname(asset.file).toLowerCase();
    const modelOut = path.basename(asset.file);
    for (const base of [path.join(IMPORT_RAW_DIR, slug), path.join(IMPORT_PUBLIC_DIR, slug)]) {
        for (const file of files) {
            const out = file.out === modelOut ? `${slug}${ext}` : file.out;
            const target = path.join(base, out);
            if (path.relative(base, target).startsWith('..')) continue;
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(path.join(LIBRARY_FILES, file.src), target);
        }
    }
    const { loadShrinkOptions, shrinkModelsFolder } = await import(pathToFileURL(path.join(REPO_ROOT, 'tools', 'models', 'shrink-textures.mjs')).href);
    const compression = loadShrinkOptions(GAME_DIR);
    if (compression) await shrinkModelsFolder(path.join(IMPORT_PUBLIC_DIR, slug), compression);
    return { path: `library/${slug}/${slug}${ext}`, warnings };
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};
}

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

async function serveFile(res, baseDir, requestPath) {
    const filePath = path.join(baseDir, path.normalize(requestPath));
    if (!filePath.startsWith(baseDir)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    try {
        const content = await fs.readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(content);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
}

function validateLayout(layout, level) {
    const problems = [];
    for (const key of ['floors', 'walls', 'props', ...(level === 'market' ? [] : ['stations'])]) {
        if (!Array.isArray(layout?.[key])) problems.push(`"${key}" must be an array`);
    }
    if (!layout?.styles || !layout?.setups) problems.push('Missing styles / setups');
    for (const station of layout?.stations ?? []) {
        if (!station.cameras?.order || !station.cameras?.bench) problems.push(`Station "${station.id}" needs its order and bench cameras`);
    }
    if (level === 'market' && (!layout?.market?.crates || !layout?.market?.cashier)) problems.push('The market needs its crates and cashier');
    return problems;
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/config' && req.method === 'GET') {
        return send(res, 200, { gameUrl: GAME_URL });
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') {
        return send(res, 200, await readJson(SETTINGS_FILE, {}));
    }
    const level = LEVELS[url.searchParams.get('level')] ? url.searchParams.get('level') : 'restaurant';
    const file = layoutFile(level);
    const fileName = `levels/${LEVELS[level]}`;
    if (url.pathname === '/api/layout' && req.method === 'GET') {
        const layout = await readJson(file, null);
        if (!layout) return send(res, 500, { error: `Could not read ${fileName}` });
        return send(res, 200, { layout, version: await fileVersion(file) });
    }
    if (url.pathname === '/api/layout' && req.method === 'PUT') {
        const { layout, version } = await readBody(req);
        const problems = validateLayout(layout, level);
        if (problems.length) return send(res, 400, { error: problems.join('; ') });
        // Changed on disk since this tab loaded it (another tab, a hand edit): refused, so nothing's lost.
        const current = await fileVersion(file);
        if (version && current && version !== current) {
            return send(res, 409, { error: `${fileName} changed since it was loaded: reload the editor (your changes are still on screen: copy what you need)` });
        }
        await writeJson(file, layout);
        return send(res, 200, { ok: true, version: await fileVersion(file) });
    }
    if (url.pathname === '/api/models' && req.method === 'GET') {
        return send(res, 200, await listModelsWithThumbs());
    }
    if (url.pathname === '/api/thumb' && req.method === 'POST') {
        const name = url.searchParams.get('name') ?? '';
        if (!SAFE_NAME.test(name) || !name.endsWith('.png')) return send(res, 400, { error: 'Bad thumbnail name' });
        await fs.mkdir(THUMBS_DIR, { recursive: true });
        await fs.writeFile(path.join(THUMBS_DIR, name), await readRawBody(req));
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/library' && req.method === 'GET') {
        return send(res, 200, await listLibrary());
    }
    if (url.pathname === '/api/library/import' && req.method === 'POST') {
        const body = await readBody(req);
        return send(res, 200, await importLibraryModel(String(body.id ?? '')));
    }
    return send(res, 404, { error: 'Unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
        if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
        if (url.pathname.startsWith('/models/')) return await serveFile(res, MODELS_DIR, decodeURIComponent(url.pathname.slice('/models/'.length)));
        if (url.pathname.startsWith('/library-files/')) return await serveFile(res, LIBRARY_FILES, decodeURIComponent(url.pathname.slice('/library-files/'.length)));
        if (url.pathname.startsWith('/library-thumbs/')) return await serveFile(res, LIBRARY_THUMBS, decodeURIComponent(url.pathname.slice('/library-thumbs/'.length)));
        if (url.pathname.startsWith('/thumbs/')) return await serveFile(res, THUMBS_DIR, decodeURIComponent(url.pathname.slice('/thumbs/'.length)));
        if (url.pathname.startsWith('/vendor/three/')) return await serveFile(res, THREE_DIR, decodeURIComponent(url.pathname.slice('/vendor/three/'.length)));
        return await serveFile(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
    } catch (error) {
        console.error('[restaurant-editor]', error);
        send(res, 500, { error: String(error.message ?? error) });
    }
});

server.listen(PORT, () => {
    const address = `http://localhost:${PORT}`;
    console.log(`[restaurant-editor] ${address}  (layouts: ${Object.values(LEVELS).map((name) => `levels/${name}`).join(', ')})`);
    if (!process.env.NO_OPEN) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
        exec(`${opener} ${address}`);
    }
});
