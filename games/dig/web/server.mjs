// Level editor server — `npm run level` (or `npm run editor` with GAME=dig).
//
// Reads/writes games/dig/levels/*.json (the same files the game loads), lists
// the models under public/dig/models, and serves the browser editor in ./public.
// three.js is served straight from node_modules so the editor needs no build step.
// The 3D Hub tab can also browse the 3D asset library (LIBRARY3D_DIR, default
// D:/projects/PIXI3d/library3d) and import a model from it into the game.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec, execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEVELS_DIR = path.join(__dirname, '..', 'levels');
const INDEX_FILE = path.join(LEVELS_DIR, 'index.json');
const WORLDS_FILE = path.join(LEVELS_DIR, 'worlds.json');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'public', 'dig', 'models');
const THREE_DIR = path.join(REPO_ROOT, 'node_modules', 'three');
const STYLES_FILE = path.join(__dirname, '..', 'ui', 'worldstyles.json');
const UIKIT_FILE = path.join(__dirname, '..', 'ui', 'uikit.json');
const HATFITS_FILE = path.join(__dirname, '..', 'ui', 'hatfits.json');
const DIG_FILE = path.join(__dirname, '..', 'ui', 'dig.json');
const FONTS_DIR = path.join(REPO_ROOT, 'public', 'dig', 'fonts');
const THUMBS_DIR = path.join(__dirname, '.thumbs');
const LIBRARY_DIR = path.resolve(process.env.LIBRARY3D_DIR ?? 'D:/projects/PIXI3d/library3d');
const LIBRARY_FILES = path.join(LIBRARY_DIR, 'files');
const LIBRARY_THUMBS = path.join(LIBRARY_DIR, 'library', 'thumbs');
/** Imported library models: the raw source the model build packs, and its published copy (usable right away). */
const HUB_RAW_DIR = path.join(REPO_ROOT, 'games', 'dig', 'raw-assets', 'models', 'hub{m}');
const HUB_PUBLIC_DIR = path.join(MODELS_DIR, 'hub');
const UI_SOURCES = {
    game: path.join(REPO_ROOT, 'games', 'dig', 'raw-assets', 'images', 'ui{tps}'),
    pizza: path.join(REPO_ROOT, 'games', 'pizza', 'raw-assets', 'images', 'ui{tps}'),
};
const SAFE_NAME = /^[\w.\- ]+$/;
const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4700;
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:9001/';
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
    '.fbx': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.woff2': 'font/woff2',
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

async function readOrder() {
    const index = await readJson(INDEX_FILE, { levels: [] });
    return Array.isArray(index.levels) ? index.levels : [];
}

async function listLevels() {
    const files = (await fs.readdir(LEVELS_DIR)).filter((file) => /\.json$/.test(file) && !['index.json', 'worlds.json'].includes(file));
    const byId = new Map();
    for (const file of files) {
        const level = await readJson(path.join(LEVELS_DIR, file), null);
        if (level?.id) {
            byId.set(level.id, level);
        }
    }
    const order = await readOrder();
    const ordered = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
    const unlisted = [...byId.values()].filter((level) => !order.includes(level.id));
    return [...ordered, ...unlisted];
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
    return (await listModels()).map((model) => ({ ...model, thumb: existing.has(thumbFile(model)) ? thumbFile(model) : null, thumbName: thumbFile(model) }));
}

async function listUiImages() {
    const images = [];
    for (const [source, dir] of Object.entries(UI_SOURCES)) {
        const entries = await fs.readdir(dir).catch(() => []);
        for (const file of entries.filter((name) => /\.png$/i.test(name)).sort()) {
            images.push({ name: file.replace(/\.png$/i, ''), source });
        }
    }
    return images;
}

/** Copies kit images that only exist in another game's UI folder into this game's atlas source folder. */
async function importMissingImages(kit) {
    const names = new Set();
    for (const screen of Object.values(kit.screens ?? {})) {
        for (const element of Object.values(screen.elements ?? {})) {
            if (element.type === 'image' && element.image) names.add(element.image);
        }
    }
    const imported = [];
    for (const name of names) {
        if (!SAFE_NAME.test(name)) continue;
        const target = path.join(UI_SOURCES.game, `${name}.png`);
        const exists = await fs.stat(target).then(() => true, () => false);
        if (!exists) {
            await fs.copyFile(path.join(UI_SOURCES.pizza, `${name}.png`), target).then(() => imported.push(name), () => {});
        }
    }
    return imported;
}

function runAtlasBuild() {
    return new Promise((resolve) => {
        execFile('npm', ['run', 'image'], { cwd: REPO_ROOT, env: { ...process.env, GAME: 'dig' }, timeout: 240000 }, (error, stdout, stderr) => {
            resolve({ ok: !error, log: `${stdout}\n${stderr}`.trim().split('\n').slice(-12).join('\n') });
        });
    });
}

// ---------------------------------------------------------------- 3D asset library

let libraryCache = null;

/** The library's glTF/GLB assets (the formats the game loads), slimmed down for the browser. */
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
 * Copies a library model (and every file it needs: .bin, textures) into games/dig/raw-assets/models/hub{m}/<slug>/
 * and its published copy public/dig/models/hub/<slug>/, the model file renamed to the slug so its registry name
 * is unique. Returns the path the level uses (under models/).
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
    for (const base of [path.join(HUB_RAW_DIR, slug), path.join(HUB_PUBLIC_DIR, slug)]) {
        for (const file of files) {
            const out = file.out === modelOut ? `${slug}${ext}` : file.out;
            const target = path.join(base, out);
            if (path.relative(base, target).startsWith('..')) continue;
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(path.join(LIBRARY_FILES, file.src), target);
        }
    }
    return { path: `hub/${slug}/${slug}${ext}`, warnings };
}

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function newLevelTemplate(id, name) {
    return {
        id,
        name,
        grid: { cell: 0.5 },
        floor: { width: 16, depth: 20 },
        styles: { floor: 'floorStyle1', wall: 'wallStyle1', door: 'doorStyle1', window: 'windowStyle1', ground: 'groundStyle1', path: 'pathStyle1' },
        start: { x: 0, z: 14 },
        waypoints: [{ x: 0, z: 0 }, { x: 0, z: -7 }],
        entryPath: { x: 0, z: 14, width: 4.8, depth: 6 },
        walls: [{
            closed: true,
            points: [{ x: -8, z: 10 }, { x: 8, z: 10 }, { x: 8, z: -10 }, { x: -8, z: -10 }],
            openings: [{ kind: 'door', minX: -1.25, maxX: 1.25, minZ: 9.7, maxZ: 10.3 }],
        }],
        props: [],
        loot: [],
        guards: [],
    };
}

function nextLevelId(existing) {
    let number = existing.length + 1;
    while (existing.includes(`level-${String(number).padStart(2, '0')}`)) {
        number++;
    }
    return `level-${String(number).padStart(2, '0')}`;
}

function validateLevel(level) {
    const problems = [];
    if (!level || typeof level !== 'object') {
        return ['Level must be an object'];
    }
    if (!ID_PATTERN.test(level.id ?? '')) problems.push('Invalid id');
    if (!level.floor || !(level.floor.width > 0) || !(level.floor.depth > 0)) problems.push('Floor needs a positive width/depth');
    if (!level.start) problems.push('Missing start');
    for (const key of ['walls', 'props', 'loot']) {
        if (!Array.isArray(level[key])) problems.push(`"${key}" must be an array`);
    }
    return problems;
}

async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};
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
    const levelMatch = url.pathname.match(/^\/api\/levels\/([^/]+)$/);

    if (url.pathname === '/api/config' && req.method === 'GET') {
        return send(res, 200, { gameUrl: GAME_URL });
    }
    if (url.pathname === '/api/dig' && req.method === 'GET') {
        return send(res, 200, await readJson(DIG_FILE, { zones: [], finds: [] }));
    }
    if (url.pathname === '/api/dig/tractor' && req.method === 'PUT') {
        const tractor = await readBody(req);
        if (!tractor || typeof tractor.model !== 'string' || typeof tractor.seat !== 'object') {
            return send(res, 400, { error: 'Invalid tractor' });
        }
        // Only the tractor section changes; the rest of dig.json is written back as it was read.
        const design = await readJson(DIG_FILE, null);
        if (!design) return send(res, 500, { error: 'Could not read dig.json' });
        design.tractor = tractor;
        await writeJson(DIG_FILE, design);
        return send(res, 200, { ok: true });
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
        if (!/^[\w.\-]+\.png$/.test(name)) {
            return send(res, 400, { error: 'Bad thumbnail name' });
        }
        await fs.mkdir(THUMBS_DIR, { recursive: true });
        await fs.writeFile(path.join(THUMBS_DIR, name), await readRawBody(req));
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/ui/images' && req.method === 'GET') {
        return send(res, 200, await listUiImages());
    }
    if (url.pathname === '/api/fonts' && req.method === 'GET') {
        const files = await fs.readdir(FONTS_DIR).catch(() => []);
        return send(res, 200, files.filter((name) => name.endsWith('.woff2')).map((name) => name.replace(/\.woff2$/, '')).sort());
    }
    if (url.pathname === '/api/worldstyles' && req.method === 'GET') {
        return send(res, 200, await readJson(STYLES_FILE, { version: 1 }));
    }
    if (url.pathname === '/api/worldstyles' && req.method === 'PUT') {
        const styles = await readBody(req);
        if (!styles || typeof styles.floor !== 'object' || typeof styles.wall !== 'object') {
            return send(res, 400, { error: 'Invalid styles' });
        }
        await writeJson(STYLES_FILE, styles);
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/hatfits' && req.method === 'GET') {
        return send(res, 200, await readJson(HATFITS_FILE, { version: 1, default: { x: 0, y: -0.03, z: 0, scale: 1.05, rotationY: 0 }, hats: {} }));
    }
    if (url.pathname === '/api/hatfits' && req.method === 'PUT') {
        const fits = await readBody(req);
        if (!fits || typeof fits.default !== 'object' || typeof fits.hats !== 'object') {
            return send(res, 400, { error: 'Invalid hat fits' });
        }
        await writeJson(HATFITS_FILE, fits);
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/hats' && req.method === 'GET') {
        const files = await fs.readdir(path.join(MODELS_DIR, 'hats')).catch(() => []);
        return send(res, 200, files.filter((name) => /.(glb|gltf)$/i.test(name)).sort());
    }
    if (url.pathname === '/api/uikit' && req.method === 'GET') {
        return send(res, 200, await readJson(UIKIT_FILE, { version: 1, screens: {} }));
    }
    if (url.pathname === '/api/uikit' && req.method === 'PUT') {
        const kit = await readBody(req);
        if (!kit || typeof kit.screens !== 'object') {
            return send(res, 400, { error: 'Invalid UI kit' });
        }
        await fs.mkdir(path.dirname(UIKIT_FILE), { recursive: true });
        await writeJson(UIKIT_FILE, kit);
        return send(res, 200, { ok: true, imported: await importMissingImages(kit) });
    }
    if (url.pathname === '/api/ui/atlas' && req.method === 'POST') {
        return send(res, 200, await runAtlasBuild());
    }
    if (url.pathname === '/api/levels' && req.method === 'GET') {
        return send(res, 200, await listLevels());
    }
    if (url.pathname === '/api/levels' && req.method === 'POST') {
        const body = await readBody(req);
        const levels = await listLevels();
        const order = levels.map((level) => level.id);
        const id = nextLevelId(order);
        const source = body.copyOf ? levels.find((candidate) => candidate.id === body.copyOf) : null;
        const level = source
            ? { ...source, id, name: body.name || `${source.name} copy` }
            : newLevelTemplate(id, body.name || `Level ${order.length + 1}`);
        await writeJson(path.join(LEVELS_DIR, `${id}.json`), level);
        await writeJson(INDEX_FILE, { levels: [...order, id] });
        return send(res, 201, level);
    }
    if (url.pathname === '/api/worlds' && req.method === 'GET') {
        return send(res, 200, await readJson(WORLDS_FILE, { worlds: [] }));
    }
    if (url.pathname === '/api/worlds' && req.method === 'PUT') {
        const body = await readBody(req);
        if (!Array.isArray(body.worlds) || !body.worlds.every((w) => Array.isArray(w.levels) && w.levels.every((id) => ID_PATTERN.test(id)))) {
            return send(res, 400, { error: 'Invalid worlds' });
        }
        await writeJson(WORLDS_FILE, body);
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/order' && req.method === 'PUT') {
        const body = await readBody(req);
        if (!Array.isArray(body.levels) || !body.levels.every((id) => ID_PATTERN.test(id))) {
            return send(res, 400, { error: 'Invalid order' });
        }
        await writeJson(INDEX_FILE, { levels: body.levels });
        return send(res, 200, { ok: true });
    }
    if (levelMatch && ID_PATTERN.test(levelMatch[1])) {
        const id = levelMatch[1];
        const file = path.join(LEVELS_DIR, `${id}.json`);
        if (req.method === 'PUT') {
            const level = await readBody(req);
            const problems = validateLevel(level);
            if (problems.length || level.id !== id) {
                return send(res, 400, { error: problems.join('; ') || 'Id mismatch' });
            }
            await writeJson(file, level);
            const order = await readOrder();
            if (!order.includes(id)) {
                await writeJson(INDEX_FILE, { levels: [...order, id] });
            }
            return send(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
            await fs.rm(file, { force: true });
            await writeJson(INDEX_FILE, { levels: (await readOrder()).filter((entry) => entry !== id) });
            const worlds = await readJson(WORLDS_FILE, null);
            if (worlds?.worlds) {
                worlds.worlds.forEach((w) => (w.levels = w.levels.filter((entry) => entry !== id)));
                await writeJson(WORLDS_FILE, worlds);
            }
            return send(res, 200, { ok: true });
        }
    }
    return send(res, 404, { error: 'Unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
        if (url.pathname.startsWith('/api/')) {
            return await handleApi(req, res, url);
        }
        if (url.pathname.startsWith('/models/')) {
            return await serveFile(res, MODELS_DIR, decodeURIComponent(url.pathname.slice('/models/'.length)));
        }
        if (url.pathname.startsWith('/library-files/')) {
            return await serveFile(res, LIBRARY_FILES, decodeURIComponent(url.pathname.slice('/library-files/'.length)));
        }
        if (url.pathname.startsWith('/library-thumbs/')) {
            return await serveFile(res, LIBRARY_THUMBS, decodeURIComponent(url.pathname.slice('/library-thumbs/'.length)));
        }
        if (url.pathname.startsWith('/fonts/')) {
            return await serveFile(res, FONTS_DIR, decodeURIComponent(url.pathname.slice('/fonts/'.length)));
        }
        if (url.pathname.startsWith('/thumbs/')) {
            return await serveFile(res, THUMBS_DIR, decodeURIComponent(url.pathname.slice('/thumbs/'.length)));
        }
        if (url.pathname.startsWith('/ui-images/')) {
            const [, , source, file] = url.pathname.split('/');
            if (UI_SOURCES[source] && file) {
                return await serveFile(res, UI_SOURCES[source], decodeURIComponent(file));
            }
        }
        if (url.pathname.startsWith('/vendor/three/')) {
            return await serveFile(res, THREE_DIR, decodeURIComponent(url.pathname.slice('/vendor/three/'.length)));
        }
        return await serveFile(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
    } catch (error) {
        console.error('[level-editor]', error);
        send(res, 500, { error: String(error.message ?? error) });
    }
});

server.listen(PORT, () => {
    const address = `http://localhost:${PORT}`;
    console.log(`[level-editor] ${address}  (levels: ${LEVELS_DIR})`);
    if (!process.env.NO_OPEN) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
        exec(`${opener} ${address}`);
    }
});
