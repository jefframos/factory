// Mow Town editor server — `npm run editor` with GAME=mow.
//
// Reads/writes games/mow/levels/town.json and the `tractor` section of ui/mow.json (the files the game loads), lists
// the models under public/mow/models,
// and serves the browser editor in ./public. three.js is served straight from node_modules so the editor needs no
// build step. The Town tab can also browse the 3D asset library (LIBRARY3D_DIR, default the repo's library3d submodule:
// `git submodule update --init library3d`) and import a model from it into the game.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const TOWN_FILE = path.join(__dirname, '..', 'levels', 'town.json');
const MOW_FILE = path.join(__dirname, '..', 'ui', 'mow.json');
/**
 * The Map shots tab's settings, by zone (`town` or a section id): `mode` (original: the town as it is; custom: its own
 * diorama, `custom`, a level like town.json), `camera` (yaw / pitch, degrees; `ortho`: isometric, else perspective
 * with `fov`) and `stroke` (a black outline round the small HUD picture, `strokeWidth` pixels). Read by the game's
 * snapshot scene.
 */
const MAPSHOTS_FILE = path.join(__dirname, '..', 'levels', 'mapshots.json');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'public', 'mow', 'models');
const THREE_DIR = path.join(REPO_ROOT, 'node_modules', 'three');
const THUMBS_DIR = path.join(__dirname, '.thumbs');
const LIBRARY_DIR = path.resolve(process.env.LIBRARY3D_DIR ?? path.join(REPO_ROOT, 'library3d'));
const LIBRARY_FILES = path.join(LIBRARY_DIR, 'files');
const LIBRARY_THUMBS = path.join(LIBRARY_DIR, 'library', 'thumbs');
/** Imported library models: the raw source the model build packs, and its published copy (usable right away). */
const IMPORT_RAW_DIR = path.join(REPO_ROOT, 'games', 'mow', 'raw-assets', 'models', 'town{m}', 'library');
const IMPORT_PUBLIC_DIR = path.join(MODELS_DIR, 'town', 'library');
/** The game's sounds (a sound zone plays one of these; `npm run audio` packs them for the game). */
const AUDIO_DIR = path.join(REPO_ROOT, 'games', 'mow', 'raw-assets', 'audio');
/** The town map's miniatures (baked by the game's TownSnapshotScene): the PNG source, and the webp the game loads. */
const MAP_RAW_DIR = path.join(REPO_ROOT, 'games', 'mow', 'raw-assets', 'non-preload', 'map');
const MAP_PUBLIC_DIR = path.join(REPO_ROOT, 'public', 'mow', 'images', 'non-preload', 'map');
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

/**
 * mow.json's own layout: the top two levels expanded, anything deeper on one line when it fits (one grass type, tool,
 * upgrade, wardrobe item per line), so a save from the editor keeps the file readable.
 */
function formatCompact(value, depth = 0) {
    const inline = (v) => {
        if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
        if (v && typeof v === 'object') {
            const entries = Object.entries(v);
            return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
        }
        return JSON.stringify(v);
    };
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    const pad = '  '.repeat(depth + 1);
    const one = inline(value);
    if (depth >= 2 && one.length + pad.length <= 400) return one;
    const end = '  '.repeat(depth);
    if (Array.isArray(value)) return `[\n${value.map((x) => pad + formatCompact(x, depth + 1)).join(',\n')}\n${end}]`;
    return `{\n${Object.entries(value).map(([k, x]) => `${pad}${JSON.stringify(k)}: ${formatCompact(x, depth + 1)}`).join(',\n')}\n${end}}`;
}

async function writeMow(data) {
    await fs.writeFile(MOW_FILE, formatCompact(data) + '\n', 'utf-8');
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

/** A library model's thumbnail file (library/thumbs, the library app's own naming: they share them). */
const libraryThumbName = (id) => `${id.replaceAll('/', '__')}.png`;

async function listLibrary() {
    if (libraryCache) return libraryCache;
    const index = await readJson(path.join(LIBRARY_DIR, 'library', 'index.json'), null);
    if (!index) return { available: false, dir: LIBRARY_DIR, assets: [] };
    const thumbs = new Set(await fs.readdir(LIBRARY_THUMBS).catch(() => []));
    const assets = [];
    for (const asset of index.assets ?? []) {
        const format = asset.formats?.glb ? 'glb' : asset.formats?.gltf ? 'gltf' : null;
        if (!format || asset.kind !== 'model') continue;
        const thumbName = libraryThumbName(asset.id);
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
    for (const key of ['props', 'atms', 'wardrobes', 'pavements', 'sections', 'grassPatches']) {
        if (!Array.isArray(town[key])) problems.push(`${key} must be a list`);
    }
    if (!town.start || !Number.isFinite(town.start.x) || !Number.isFinite(town.start.z)) problems.push('start needs x / z');
    if (!town.grassNoise?.rings?.length) problems.push('grassNoise needs at least one ring');
    (town.sections ?? []).forEach((section, i) => {
        if (!section.id) problems.push(`section ${i + 1} has no id`);
        if (!(section.width > 0) || !(section.depth > 0)) problems.push(`section ${section.id ?? i + 1} needs a size`);
    });
    const outline = town.island?.outline;
    if (town.sounds !== undefined && !Array.isArray(town.sounds)) problems.push('sounds must be a list');
    if (town.secrets !== undefined && !Array.isArray(town.secrets)) problems.push('secrets must be a list');
    if (town.traffic !== undefined) {
        const { waypoints, links, cars } = town.traffic ?? {};
        if (!Array.isArray(waypoints) || !Array.isArray(links) || !Array.isArray(cars)) problems.push('traffic needs waypoints, links and cars lists');
        else {
            const ids = new Set();
            waypoints.forEach((w, i) => {
                if (!w?.id || ids.has(w.id)) problems.push(`traffic waypoint ${i + 1} needs a unique id`);
                ids.add(w?.id);
            });
            links.forEach((link) => {
                if (!Array.isArray(link) || link.length !== 2 || !ids.has(link[0]) || !ids.has(link[1])) problems.push(`traffic link ${JSON.stringify(link)} joins unknown waypoints`);
            });
            cars.forEach((car, i) => { if (!ids.has(car?.at)) problems.push(`car ${i + 1} starts at unknown waypoint ${car?.at}`); });
        }
    }
    const secretIds = new Set();
    (town.secrets ?? []).forEach((secret, i) => {
        if (!secret?.id) problems.push(`secret patch ${i + 1} has no id`);
        else if (secretIds.has(secret.id)) problems.push(`two secret patches are called ${secret.id}`);
        secretIds.add(secret?.id);
        if (!(secret?.width > 0) || !(secret?.depth > 0)) problems.push(`secret patch ${secret?.id ?? i + 1} needs a size`);
    });
    (town.sounds ?? []).forEach((zone, i) => {
        if (!zone?.sound) problems.push(`sound zone ${zone?.id ?? i + 1} has no sound`);
        if (!(zone?.width > 0) || !(zone?.depth > 0)) problems.push(`sound zone ${zone?.id ?? i + 1} needs a size`);
    });
    if (outline && (!Array.isArray(outline) || outline.length < 3 || outline.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.z)))) {
        problems.push('island outline needs at least 3 points with x / z');
    }
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
    // Open to the game's origin too (its map snapshots post here).
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
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
        await writeMow(design);
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/mow/tools' && req.method === 'PUT') {
        // The Mowers tab: each walked tool's grip (with the hands' turn and offset), gap and size (matched by id; nothing else of a tool changes).
        const edits = await readBody(req);
        if (!Array.isArray(edits)) return send(res, 400, { error: 'Invalid tools' });
        const design = await readJson(MOW_FILE, null);
        if (!design) return send(res, 500, { error: 'Could not read mow.json' });
        const num = (v) => typeof v === 'number' && Number.isFinite(v);
        for (const edit of edits) {
            const tool = design.tools.find((t) => t.id === edit?.id);
            if (!tool || tool.ride) return send(res, 400, { error: `Unknown walked tool: ${edit?.id}` });
            const { grip, gap, size } = edit;
            if (!grip || !num(grip.forward) || !num(grip.height) || !num(grip.spread)) return send(res, 400, { error: `Invalid grip for ${tool.id}` });
            if (!Array.isArray(size) || size.length !== 3 || !size.every(num)) return send(res, 400, { error: `Invalid size for ${tool.id}` });
            if (!num(gap)) return send(res, 400, { error: `Invalid gap for ${tool.id}` });
            const hand = grip.hand && num(grip.hand.x) && num(grip.hand.y) && num(grip.hand.z) ? { x: grip.hand.x, y: grip.hand.y, z: grip.hand.z } : null;
            tool.grip = { forward: grip.forward, height: grip.height, spread: grip.spread };
            if (hand && (hand.x || hand.y || hand.z)) tool.grip.hand = hand;
            const offset = grip.offset && num(grip.offset.x) && num(grip.offset.y) && num(grip.offset.z) ? { x: grip.offset.x, y: grip.offset.y, z: grip.offset.z } : null;
            if (offset && (offset.x || offset.y || offset.z)) tool.grip.offset = offset;
            if (grip.mirror === false) tool.grip.mirror = false;
            tool.size = size;
            tool.gap = gap;
        }
        await writeMow(design);
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/sounds' && req.method === 'GET') {
        const files = await fs.readdir(AUDIO_DIR).catch(() => []);
        return send(res, 200, [...new Set(files.filter((f) => /\.(mp3|ogg|wav)$/i.test(f)).map((f) => f.replace(/\.[^.]+$/, '')))].sort());
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
    if (url.pathname === '/api/mapshots' && req.method === 'GET') {
        return send(res, 200, await readJson(MAPSHOTS_FILE, { zones: {} }));
    }
    if (url.pathname === '/api/mapshots' && req.method === 'PUT') {
        // A zone's mode and camera (its custom diorama is kept).
        const zone = url.searchParams.get('zone') ?? '';
        const { mode, camera, stroke, strokeWidth } = await readBody(req);
        if (!/^[\w-]+$/.test(zone)) return send(res, 400, { error: 'Bad zone' });
        if (mode !== 'original' && mode !== 'custom') return send(res, 400, { error: 'mode must be original or custom' });
        if (!Number.isFinite(camera?.yaw) || !Number.isFinite(camera?.pitch)) return send(res, 400, { error: 'camera needs yaw and pitch' });
        const shots = await readJson(MAPSHOTS_FILE, { zones: {} });
        const fov = Number.isFinite(camera.fov) ? camera.fov : undefined;
        shots.zones[zone] = { ...shots.zones[zone], mode, camera: { yaw: camera.yaw, pitch: camera.pitch, ortho: camera.ortho !== false, fov }, stroke: Boolean(stroke),
            strokeWidth: Number.isFinite(strokeWidth) ? Math.min(12, Math.max(1, Math.round(strokeWidth))) : undefined };
        await writeJson(MAPSHOTS_FILE, shots);
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/mapshots/custom' && req.method === 'GET') {
        const zone = url.searchParams.get('zone') ?? '';
        const custom = (await readJson(MAPSHOTS_FILE, { zones: {} })).zones[zone]?.custom;
        if (!custom) return send(res, 404, { error: `No custom diorama for ${zone}` });
        // The editor's save expects a version (the town's conflict check); a diorama has one editor: any will do.
        return send(res, 200, { ...custom, _version: 1 });
    }
    if (url.pathname === '/api/mapshots/custom' && req.method === 'PUT') {
        const zone = url.searchParams.get('zone') ?? '';
        if (!/^[\w-]+$/.test(zone)) return send(res, 400, { error: 'Bad zone' });
        const { _version, ...custom } = await readBody(req);
        const problems = validateTown(custom);
        if (problems.length) return send(res, 400, { error: problems.join('; ') });
        const shots = await readJson(MAPSHOTS_FILE, { zones: {} });
        shots.zones[zone] = { mode: 'custom', camera: { yaw: 0, pitch: 40 }, ...shots.zones[zone], custom };
        await writeJson(MAPSHOTS_FILE, shots);
        return send(res, 200, { ok: true, version: 1 });
    }
    if (url.pathname === '/api/map-snapshot' && req.method === 'POST') {
        // From the game (another origin): the PNG is kept as the source and published as webp right away, as
        // `npm run image` would (same quality), so the game shows it without a rebuild.
        const name = url.searchParams.get('name') ?? '';
        if (!/^[\w-]+$/.test(name)) return send(res, 400, { error: 'Bad snapshot name' });
        const png = await readRawBody(req);
        await fs.mkdir(MAP_RAW_DIR, { recursive: true });
        await fs.mkdir(MAP_PUBLIC_DIR, { recursive: true });
        await fs.writeFile(path.join(MAP_RAW_DIR, `${name}.png`), png);
        const { default: sharp } = await import('sharp');
        await sharp(png).webp({ quality: 70, alphaQuality: 100 }).toFile(path.join(MAP_PUBLIC_DIR, `${name}.webp`));
        return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/library/thumb' && req.method === 'POST') {
        // A library model the picker rendered (it had no thumbnail): kept in the library's thumbs for next time.
        const id = url.searchParams.get('id') ?? '';
        const asset = (await listLibrary()).assets.find((entry) => entry.id === id);
        if (!asset) return send(res, 404, { error: `Unknown library asset ${id}` });
        await fs.mkdir(LIBRARY_THUMBS, { recursive: true });
        await fs.writeFile(path.join(LIBRARY_THUMBS, libraryThumbName(id)), await readRawBody(req));
        asset.thumb = `/library-thumbs/${encodeURIComponent(libraryThumbName(id))}`;
        return send(res, 200, { ok: true, thumb: asset.thumb });
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
        if (req.method === 'OPTIONS') {
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Content-Type' });
            return res.end();
        }
        if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
        const routes = [
            ['/models/', MODELS_DIR],
            ['/library-files/', LIBRARY_FILES],
            ['/library-thumbs/', LIBRARY_THUMBS],
            ['/thumbs/', THUMBS_DIR],
            ['/vendor/three/', THREE_DIR],
            ['/map-images/', MAP_PUBLIC_DIR],
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
