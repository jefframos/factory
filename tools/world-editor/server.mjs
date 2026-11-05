// The shared world editor's server: the Town tab (3D view, props, pavements, shore, road builder, traffic, collider
// cubes) and the 3D library import, for any game whose levels are shaped like that (props, pavements, start …).
//
// A game keeps a small web/server.mjs that calls startWorldEditor() with its own folders and adds its own endpoints
// (`api`), and a web/public/index.html with its own tabs. The browser modules (town3d.js, library.js, modelPicker.js,
// shared.js, gltf.js, style.css) come from `sharedPublic`, anything of the same name in the game's own public folder
// winning. They currently live in games/mow/web/public, which the mow editor serves itself.
//
// The Town tab asks for its game's settings at /api/mow whatever the game (its roadKit, traffic, grass, cell, seed).

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const THREE_DIR = path.join(REPO_ROOT, 'node_modules', 'three');
const CORE_DIR = path.join(REPO_ROOT, 'core');
const LIBRARY_DIR = path.resolve(process.env.LIBRARY3D_DIR ?? path.join(REPO_ROOT, 'library3d'));
const LIBRARY_FILES = path.join(LIBRARY_DIR, 'files');
const LIBRARY_THUMBS = path.join(LIBRARY_DIR, 'library', 'thumbs');
const DEFAULT_SHARED_PUBLIC = path.join(REPO_ROOT, 'games', 'mow', 'web', 'public');

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
    '.ogg': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
};

export async function readJson(file, fallback) {
    try {
        return JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
        return fallback;
    }
}

export async function writeJson(file, data) {
    await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

export async function readBody(req) {
    const raw = await readRawBody(req);
    return raw.length ? JSON.parse(raw.toString('utf-8')) : {};
}

export function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
}

const fileVersion = (file) => fs.stat(file).then((stat) => Math.round(stat.mtimeMs), () => 0);
const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const libraryThumbName = (id) => `${id.replaceAll('/', '__')}.png`;
const thumbFile = (model) => `${model.path.replaceAll('/', '__')}.${model.mtime}.png`;

/** What any level needs to be drawn and saved (the rest is checked by the game's own types). */
function validateLevel(level) {
    const problems = [];
    if (!level || typeof level !== 'object') return ['Not a level'];
    for (const key of ['props', 'pavements']) {
        if (!Array.isArray(level[key])) problems.push(`${key} must be a list`);
    }
    if (!level.start || !Number.isFinite(level.start.x) || !Number.isFinite(level.start.z)) problems.push('start needs x / z');
    (level.colliders ?? []).forEach((cube, i) => {
        if (!(cube?.width > 0) || !(cube?.depth > 0)) problems.push(`collider cube ${i + 1} needs a size`);
    });
    const outline = level.island?.outline;
    if (outline && (!Array.isArray(outline) || outline.length < 3 || outline.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.z)))) {
        problems.push('island outline needs at least 3 points with x / z');
    }
    if (level.traffic) {
        const { waypoints, links, cars } = level.traffic;
        if (!Array.isArray(waypoints) || !Array.isArray(links) || !Array.isArray(cars)) problems.push('traffic needs waypoints, links and cars lists');
        else {
            const ids = new Set(waypoints.map((point) => point?.id));
            links.forEach((link) => {
                if (!Array.isArray(link) || link.length !== 2 || !ids.has(link[0]) || !ids.has(link[1])) problems.push(`traffic link ${JSON.stringify(link)} joins unknown waypoints`);
            });
            cars.forEach((car, i) => { if (!ids.has(car?.at)) problems.push(`car ${i + 1} starts at unknown waypoint ${car?.at}`); });
        }
    }
    return problems;
}

/**
 * Starts a game's editor.
 * - `game`: its folder under games/ and public/.
 * - `port`, `title`: where it listens, and its name in the log.
 * - `settingsFile`: its settings (what the Town tab reads at /api/mow).
 * - `api(req, res, url)`: its own endpoints; returns true if it handled the request.
 * - `sharedPublic`: where the shared browser modules are.
 */
export function startWorldEditor({ game, port, title, settingsFile, api, sharedPublic = DEFAULT_SHARED_PUBLIC }) {
    const gameDir = path.join(REPO_ROOT, 'games', game);
    const webDir = path.join(gameDir, 'web');
    const publicDir = path.join(webDir, 'public');
    const levelsDir = path.join(gameDir, 'levels');
    const modelsDir = path.join(REPO_ROOT, 'public', game, 'models');
    const thumbsDir = path.join(webDir, '.thumbs');
    const audioDir = path.join(gameDir, 'raw-assets', 'audio');
    const importRawDir = path.join(gameDir, 'raw-assets', 'models', 'town{m}', 'library');
    const importPublicDir = path.join(modelsDir, 'town', 'library');
    const gameUrl = process.env.GAME_URL ?? 'http://localhost:9001/';
    let libraryCache = null;

    /** A level's file from `?level=` (every json in levels/ is a level). */
    const levelFile = (url) => {
        const level = url.searchParams.get('level') || 'town';
        return /^[\w-]+$/.test(level) ? path.join(levelsDir, `${level}.json`) : null;
    };

    async function listLevels() {
        const files = (await fs.readdir(levelsDir).catch(() => [])).filter((file) => file.endsWith('.json')).sort();
        return Promise.all(files.map(async (file) => {
            const level = file.replace(/\.json$/, '');
            const data = await readJson(path.join(levelsDir, file), {});
            return { id: level, name: data.name ?? level, level, map: level };
        }));
    }

    async function listModels(dir = modelsDir, prefix = '') {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
        const models = [];
        for (const entry of entries) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) models.push(...await listModels(path.join(dir, entry.name), relative));
            else if (/\.(gltf|glb)$/i.test(entry.name)) {
                const stat = await fs.stat(path.join(dir, entry.name));
                models.push({ path: relative, mtime: Math.round(stat.mtimeMs), size: stat.size });
            }
        }
        return models.sort((a, b) => a.path.localeCompare(b.path));
    }

    async function listModelsWithThumbs() {
        const existing = new Set(await fs.readdir(thumbsDir).catch(() => []));
        return (await listModels()).map((model) => ({ ...model, thumb: existing.has(thumbFile(model)) ? thumbFile(model) : null, thumbName: thumbFile(model) }));
    }

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
                id: asset.id, name: asset.name, pack: asset.pack, collection: asset.collection, tags: asset.tags ?? [], file: asset.formats[format],
                thumb: thumbs.has(thumbName) ? `/library-thumbs/${encodeURIComponent(thumbName)}` : asset.preview ? `/library-files/${asset.preview}` : null,
            });
        }
        libraryCache = { available: true, dir: LIBRARY_DIR, assets };
        return libraryCache;
    }

    /** A library model and what it needs, copied into the game's raw assets and its published models. */
    async function importLibraryModel(id) {
        const asset = (await listLibrary()).assets.find((entry) => entry.id === id);
        if (!asset) throw new Error(`Unknown library asset ${id}`);
        const { resolveDeps } = await import(pathToFileURL(path.join(LIBRARY_DIR, 'server', 'deps.mjs')).href);
        const { files, warnings } = await resolveDeps(LIBRARY_FILES, asset.file);
        const slug = slugify(`${asset.collection || asset.pack}-${asset.name}`);
        const ext = path.extname(asset.file).toLowerCase();
        const modelOut = path.basename(asset.file);
        for (const base of [path.join(importRawDir, slug), path.join(importPublicDir, slug)]) {
            for (const file of files) {
                const target = path.join(base, file.out === modelOut ? `${slug}${ext}` : file.out);
                if (path.relative(base, target).startsWith('..')) continue;
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.copyFile(path.join(LIBRARY_FILES, file.src), target);
            }
        }
        return { path: `town/library/${slug}/${slug}${ext}`, warnings };
    }

    async function handleApi(req, res, url) {
        if (await api?.(req, res, url)) return undefined;
        if (url.pathname === '/api/config' && req.method === 'GET') return send(res, 200, { gameUrl });
        if (url.pathname === '/api/mow' && req.method === 'GET') return send(res, 200, await readJson(settingsFile, { grass: [] }));
        if (url.pathname === '/api/levels' && req.method === 'GET') return send(res, 200, await listLevels());
        if (url.pathname === '/api/sounds' && req.method === 'GET') {
            const files = await fs.readdir(audioDir).catch(() => []);
            return send(res, 200, [...new Set(files.filter((f) => /\.(mp3|ogg|wav)$/i.test(f)).map((f) => f.replace(/\.[^.]+$/, '')))].sort());
        }
        if (url.pathname === '/api/town' && req.method === 'GET') {
            const file = levelFile(url);
            const level = file && await readJson(file, null);
            if (!level) return send(res, 404, { error: `Could not read levels/${url.searchParams.get('level') || 'town'}.json` });
            return send(res, 200, { ...level, _version: await fileVersion(file) });
        }
        if (url.pathname === '/api/town' && req.method === 'PUT') {
            const file = levelFile(url);
            if (!file) return send(res, 400, { error: 'Bad level' });
            const { _version: loaded, ...level } = await readBody(req);
            const problems = validateLevel(level);
            if (problems.length) return send(res, 400, { error: problems.join('; ') });
            // Refuse to overwrite a newer file: another tab saved since this copy was loaded.
            const current = await fileVersion(file);
            if (loaded === undefined || (current && loaded !== current)) {
                return send(res, 409, { error: `${path.basename(file)} was changed since you opened it. Reload to get the latest, then redo your change.` });
            }
            await writeJson(file, level);
            return send(res, 200, { ok: true, version: await fileVersion(file) });
        }
        if (url.pathname === '/api/library' && req.method === 'GET') return send(res, 200, await listLibrary());
        if (url.pathname === '/api/library/import' && req.method === 'POST') {
            const body = await readBody(req);
            return send(res, 200, await importLibraryModel(String(body.id ?? '')));
        }
        if (url.pathname === '/api/models' && req.method === 'GET') return send(res, 200, await listModelsWithThumbs());
        if (url.pathname === '/api/library/thumb' && req.method === 'POST') {
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
            await fs.mkdir(thumbsDir, { recursive: true });
            await fs.writeFile(path.join(thumbsDir, name), await readRawBody(req));
            return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: 'Unknown endpoint' });
    }

    /** `requestPath` from the first of `dirs` that has it. */
    async function serveFrom(res, dirs, requestPath) {
        for (const dir of dirs) {
            const filePath = path.join(dir, path.normalize(requestPath));
            if (!filePath.startsWith(dir)) return res.writeHead(403).end('Forbidden');
            const content = await fs.readFile(filePath).catch(() => null);
            if (content) {
                res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
                return res.end(content);
            }
        }
        return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }

    /** A core module as JavaScript (types stripped): the road code the games and the editor share. */
    async function serveCore(res, requestPath) {
        const filePath = path.join(CORE_DIR, path.normalize(requestPath));
        if (!filePath.startsWith(CORE_DIR)) return res.writeHead(403).end('Forbidden');
        try {
            const { transform } = await import('esbuild');
            const { code } = await transform(await fs.readFile(filePath, 'utf-8'), { loader: 'ts', format: 'esm' });
            res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
            return res.end(code);
        } catch (error) {
            return res.writeHead(404, { 'Content-Type': 'text/plain' }).end(String(error.message ?? error));
        }
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        try {
            if (req.method === 'OPTIONS') {
                res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT', 'Access-Control-Allow-Headers': 'Content-Type' });
                return res.end();
            }
            if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
            if (url.pathname.startsWith('/core/') && url.pathname.endsWith('.ts')) return await serveCore(res, decodeURIComponent(url.pathname.slice('/core/'.length)));
            const routes = [
                ['/models/', modelsDir],
                ['/library-files/', LIBRARY_FILES],
                ['/library-thumbs/', LIBRARY_THUMBS],
                ['/thumbs/', thumbsDir],
                ['/vendor/three/', THREE_DIR],
                ['/audio/', audioDir],
            ];
            for (const [prefix, dir] of routes) {
                if (url.pathname.startsWith(prefix)) return await serveFrom(res, [dir], decodeURIComponent(url.pathname.slice(prefix.length)));
            }
            return await serveFrom(res, [publicDir, sharedPublic], url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1)));
        } catch (error) {
            console.error(`[${title}]`, error);
            return send(res, 500, { error: String(error.message ?? error) });
        }
    });

    server.listen(port, () => {
        const address = `http://localhost:${port}`;
        console.log(`[${title}] ${address}`);
        if (!process.env.NO_OPEN) {
            const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
            exec(`${opener} ${address}`);
        }
    });
    return server;
}
