// Level editor server — `npm run level` (or `npm run editor` with GAME=bandit-controller).
//
// Reads/writes games/bandit-controller/levels/*.json (the same files the game loads), lists
// the models under public/bandit-controller/models, and serves the browser editor in ./public.
// three.js is served straight from node_modules so the editor needs no build step.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const LEVELS_DIR = path.join(__dirname, '..', 'levels');
const INDEX_FILE = path.join(LEVELS_DIR, 'index.json');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MODELS_DIR = path.join(REPO_ROOT, 'public', 'bandit-controller', 'models');
const THREE_DIR = path.join(REPO_ROOT, 'node_modules', 'three');
const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4700;
const GAME_URL = process.env.GAME_URL ?? 'http://localhost:9001/';
const ID_PATTERN = /^level-[a-z0-9-]+$/;

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

async function readOrder() {
    const index = await readJson(INDEX_FILE, { levels: [] });
    return Array.isArray(index.levels) ? index.levels : [];
}

async function listLevels() {
    const files = (await fs.readdir(LEVELS_DIR)).filter((file) => /^level-.*\.json$/.test(file));
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
            models.push(relative);
        }
    }
    return models.sort();
}

function newLevelTemplate(id, name) {
    return {
        id,
        name,
        grid: { cell: 0.5 },
        floor: { width: 16, depth: 20, colorA: '#c8f0e1', colorB: '#67b39e', checkerScale: 1.5 },
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
    if (!Array.isArray(level.waypoints) || level.waypoints.length < 1) problems.push('Needs at least one checkpoint (the exit)');
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
    if (url.pathname === '/api/models' && req.method === 'GET') {
        return send(res, 200, await listModels());
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
