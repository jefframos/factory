// Mow Town editor server — `npm run editor` with GAME=mow.
//
// Reads/writes games/mow/levels/town.json and the `tractor` section of ui/mow.json (the files the game loads), lists
// the models under public/mow/models,
// and serves the browser editor in ./public. three.js is served straight from node_modules so the editor needs no
// build step. The Town tab can also browse the 3D asset library (LIBRARY3D_DIR, default D:/projects/PIXI3d/library3d)
// and import a model from it into the game.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TOWN_FILE = path.join(__dirname, '..', 'levels', 'town.json');
const MOW_FILE = path.join(__dirname, '..', 'ui', 'mow.json');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'public', 'mow', 'models');
const THREE_DIR = path.join(REPO_ROOT, 'node_modules', 'three');
const THUMBS_DIR = path.join(__dirname, '.thumbs');
const LIBRARY_DIR = path.resolve(process.env.LIBRARY3D_DIR ?? 'D:/projects/PIXI3d/library3d');
const LIBRARY_FILES = path.join(LIBRARY_DIR, 'files');
const LIBRARY_THUMBS = path.join(LIBRARY_DIR, 'library', 'thumbs');
/** Imported library models: the raw source the model build packs, and its published copy (usable right away). */
const IMPORT_RAW_DIR = path.join(REPO_ROOT, 'games', 'mow', 'raw-assets', 'models', 'town{m}', 'library');
const IMPORT_PUBLIC_DIR = path.join(MODELS_DIR, 'town', 'library');
const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4710;
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:9001/';

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

/** The file's version (mtime): a save from a tab that loaded an older copy is refused (see PUT /api/town). */
async function fileVersion(file) {
    return fs.stat(file).then((stat) => Math.round(stat.mtimeMs), () => 0);
}

async function listModels(dir = MODELS_DIR, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const models = [];
    for (const entry of entries) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
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
    // The player's rig and animations aren't placeable.
    return (await listModels()).filter((model) => !/^(characters|hats)\//.test(model.path))
        .map((model) => ({ ...model, thumb: existing.has(thumbFile(model)) ? thumbFile(model) : null, thumbName: thumbFile(model) }));
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

/**
 * Copies a library model (and every file it needs: .bin, textures) into games/mow/raw-assets/models/town{m}/library/
 * <slug>/ and its published copy public/mow/models/town/library/<slug>/, the model file renamed to the slug so its
 * registry name is unique. Returns the path the level uses (under models/).
 */
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
    return { path: `town/library/${slug}/${slug}${ext}`, warnings };
}

/** What a town needs to load in the game (the rest is checked by the game's own types). */
function validateTown(town) {
    const problems = [];
    if (!town || typeof town !== 'object') return ['Not a town'];
    for (const key of ['props', 'atms', 'pavements', 'sections', 'grassPatches']) {
        if (!Array.isArray(town[key])) problems.push(`${key} must be a list`);
    }
    if (!town.start || !Number.isFinite(town.start.x) || !Number.isFinite(town.start.z)) problems.push('start needs x / z');
    if (!town.grassNoise?.rings?.length) problems.push('grassNoise needs at least one ring');
    (town.sections ?? []).forEach((section, i) => {
        if (!section.id) problems.push(`section ${i + 1} has no id`);
        if (!(section.width > 0) || !(section.depth > 0)) problems.push(`section ${section.id ?? i + 1} needs a size`);
    });
    return problems;
}

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function readBody(req) {
    const raw = await readRawBody(req);
    return raw.length ? JSON.parse(raw.toString('utf-8')) : {};
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
        res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
        res.end(content);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
}

async function handleApi(req, res, url) {
    if (url.pathname === '/api/config' && req.method === 'GET') {
        return send(res, 200, { gameUrl: GAME_URL });
    }
    if (url.pathname === '/api/mow' && req.method === 'GET') {
        return send(res, 200, await readJson(MOW_FILE, { grass: [] }));
    }
    if (url.pathname === '/api/mow/tractor' && req.method === 'PUT') {
        const tractor = await readBody(req);
        if (!tractor || typeof tractor.model !== 'string' || typeof tractor.seat !== 'object') {
            return send(res, 400, { error: 'Invalid tractor' });
        }
        // Only the tractor section changes; the rest of mow.json is written back as it was read.
        const design = await readJson(MOW_FILE, null);
        if (!design) return send(res, 500, { error: 'Could not read mow.json' });
        design.tractor = tractor;
        await writeJson(MOW_FILE, design);
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/town' && req.method === 'GET') {
        const town = await readJson(TOWN_FILE, null);
        if (!town) return send(res, 500, { error: 'Could not read levels/town.json' });
        return send(res, 200, { ...town, _version: await fileVersion(TOWN_FILE) });
    }
    if (url.pathname === '/api/town' && req.method === 'PUT') {
        const { _version: loaded, ...town } = await readBody(req);
        const problems = validateTown(town);
        if (problems.length) return send(res, 400, { error: problems.join('; ') });
        // Refuse to overwrite a newer file: another tab saved since this copy was loaded.
        const current = await fileVersion(TOWN_FILE);
        if (loaded === undefined || (current && loaded !== current)) {
            return send(res, 409, { error: 'town.json was changed since you opened it (another tab saved). Reload to get the latest, then redo your change.' });
        }
        await writeJson(TOWN_FILE, town);
        return send(res, 200, { ok: true, version: await fileVersion(TOWN_FILE) });
    }
    if (url.pathname === '/api/library' && req.method === 'GET') {
        return send(res, 200, await listLibrary());
    }
    if (url.pathname === '/api/library/import' && req.method === 'POST') {
        const body = await readBody(req);
        return send(res, 200, await importLibraryModel(String(body.id ?? '')));
    }
    if (url.pathname === '/api/models' && req.method === 'GET') {
        return send(res, 200, await listModelsWithThumbs());
    }
    if (url.pathname === '/api/thumb' && req.method === 'POST') {
        const name = url.searchParams.get('name') ?? '';
        if (!/^[\w.\-]+\.png$/.test(name)) return send(res, 400, { error: 'Bad thumbnail name' });
        await fs.mkdir(THUMBS_DIR, { recursive: true });
        await fs.writeFile(path.join(THUMBS_DIR, name), await readRawBody(req));
        return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
        if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
        const routes = [
            ['/models/', MODELS_DIR],
            ['/library-files/', LIBRARY_FILES],
            ['/library-thumbs/', LIBRARY_THUMBS],
            ['/thumbs/', THUMBS_DIR],
            ['/vendor/three/', THREE_DIR],
        ];
        for (const [prefix, dir] of routes) {
            if (url.pathname.startsWith(prefix)) return await serveFile(res, dir, decodeURIComponent(url.pathname.slice(prefix.length)));
        }
        return await serveFile(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
    } catch (error) {
        console.error('[mow-editor]', error);
        send(res, 500, { error: String(error.message ?? error) });
    }
});

server.listen(PORT, () => {
    const address = `http://localhost:${PORT}`;
    console.log(`[mow-editor] ${address}  (town: ${TOWN_FILE})`);
    if (!process.env.NO_OPEN) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
        exec(`${opener} ${address}`);
    }
});
