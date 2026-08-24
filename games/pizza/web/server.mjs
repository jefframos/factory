// server.mjs
//
// Standalone local editor server for the pizza game's design data — no
// framework, plain Node `http` (this repo has no server-side web framework
// dependency and this tool doesn't need one). Serves the static UI from
// ./public and a tiny JSON read/write API over the mirrored data files in
// ./data (see manifest.json for the list of entity types and which file
// backs each one).
//
// IMPORTANT: this edits the JSON files under games/pizza/web/data/ ONLY.
// Those are currently a hand-seeded MIRROR of the real config in
// games/pizza/game/**/*Types.ts, not the source of truth — the game does
// not read from here yet. Syncing changes back into the actual TS config
// (or having the game read this JSON directly) is a deliberate follow-up,
// not part of this first pass. See ../README-editor.md.

import http from 'node:http';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execSync, spawn } from 'node:child_process';
import { syncToSource } from './sync/syncToSource.mjs';
import { validateMap } from './sync/validateMap.mjs';
import { scanImageAssets } from './sync/imageAssets.mjs';
import { readSpawnerTileTypes } from './sync/tiledMap.mjs';
import { generateTilesetImage, GROUND_NUMBER_STYLE, RESOURCE_NUMBER_STYLE } from './sync/tilesetImage.mjs';
import { readModelsCatalog } from './sync/modelsCatalog.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_ROOT = path.join(__dirname, '..', 'raw-assets', 'images');
const MAP_FILE = path.join(__dirname, '..', 'raw-assets', 'json', 'map', 'testMap1.json');
const TILES_FILE = path.join(__dirname, '..', 'raw-assets', 'json', 'map', 'tiles.json');
const TILED_DIR = path.join(__dirname, '..', 'tiled');
/** The two tileset spritesheets the Map tab crops swatches from — see readTileImage() below; an allowlist (not a path-traversal guard) since these are the only two images that tab ever asks for. */
const TILED_IMAGE_FILES = new Set(['grounds.png', 'resources.png']);
const MODELS_REGISTRY_FILE = path.join(__dirname, '..', 'registry', 'assetsRegistry', 'modelsRegistry.ts');
const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4600;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};

/** Loads manifest.json fresh every call — this is a dev tool, not a hot path, and it lets manifest.json itself be hand-edited without restarting the server. */
async function loadManifest() {
    const raw = await fs.readFile(path.join(DATA_DIR, 'manifest.json'), 'utf-8');
    return JSON.parse(raw);
}

/** Resolves an entity type id to its backing JSON file path, refusing anything not listed in manifest.json — the one guard against a request path escaping DATA_DIR. */
async function resolveDataFile(id) {
    const manifest = await loadManifest();
    const entry = manifest.find(e => e.id === id);
    if (!entry) {
        return null;
    }
    return path.join(DATA_DIR, entry.file);
}

/** Reads every tab's current on-disk JSON mirror, keyed by tab id — the same shape app.js's own `allData` keeps in memory, but read fresh from disk here since the server has no persistent view of what's currently open in the browser. */
async function loadAllData() {
    const manifest = await loadManifest();
    const allData = {};
    for (const entry of manifest) {
        const raw = await fs.readFile(path.join(DATA_DIR, entry.file), 'utf-8');
        allData[entry.id] = JSON.parse(raw);
    }
    return allData;
}

async function serveStatic(req, res) {
    const requestedPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = path.join(PUBLIC_DIR, path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, ''));

    try {
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
        res.end(content);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8') || 'null');
}

function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/api/manifest' && req.method === 'GET') {
        return sendJson(res, 200, await loadManifest());
    }

    if (url.pathname === '/api/restart' && req.method === 'POST') {
        sendJson(res, 200, { ok: true });
        // Give the response a moment to actually reach the browser before this
        // process exits — see restartServer()'s own doc for why the respawned
        // child skips auto-open (the page making this request already has a tab
        // open and is about to poll it back into existence).
        setTimeout(() => restartServer('requested from the editor page'), 100);
        return;
    }

    if (url.pathname === '/api/images' && req.method === 'GET') {
        const { assets, error } = scanImageAssets(IMAGES_ROOT);
        return sendJson(res, 200, {
            error,
            // relPath segments (e.g. "survive{tps}") contain characters (the curly braces)
            // that aren't valid raw URL path characters — encode each segment individually
            // so "/" stays a path separator rather than becoming "%2F".
            assets: assets.map(a => ({
                ...a,
                url: `/asset-preview/${a.relPath.split('/').map(encodeURIComponent).join('/')}`,
            })),
        });
    }

    if (url.pathname.startsWith('/asset-preview/') && req.method === 'GET') {
        const relPath = decodeURIComponent(url.pathname.slice('/asset-preview/'.length));
        // Same traversal guard as serveStatic() — strip any leading "../" segments before
        // joining, so this can never be used to read a file outside IMAGES_ROOT.
        const filePath = path.join(IMAGES_ROOT, path.normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
        try {
            const content = await fs.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
            res.end(content);
        } catch {
            res.writeHead(404);
            res.end();
        }
        return;
    }

    if (url.pathname.startsWith('/tiled-asset/') && req.method === 'GET') {
        const name = decodeURIComponent(url.pathname.slice('/tiled-asset/'.length));
        if (!TILED_IMAGE_FILES.has(name)) {
            res.writeHead(404);
            res.end();
            return;
        }
        try {
            const content = await fs.readFile(path.join(TILED_DIR, name));
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(content);
        } catch {
            res.writeHead(404);
            res.end();
        }
        return;
    }

    if (url.pathname === '/api/models' && req.method === 'GET') {
        return sendJson(res, 200, readModelsCatalog(MODELS_REGISTRY_FILE));
    }

    if (url.pathname === '/api/spawner-tile-types' && req.method === 'GET') {
        return sendJson(res, 200, readSpawnerTileTypes(MAP_FILE, TILES_FILE));
    }

    if (url.pathname === '/api/validate-map' && req.method === 'GET') {
        try {
            const allData = await loadAllData();
            return sendJson(res, 200, validateMap(allData));
        } catch (err) {
            return sendJson(res, 500, { error: String(err) });
        }
    }

    const dataMatch = url.pathname.match(/^\/api\/data\/([\w-]+)$/);
    if (dataMatch) {
        const [, id] = dataMatch;
        const filePath = await resolveDataFile(id);
        if (!filePath) {
            return sendJson(res, 404, { error: `Unknown entity type "${id}"` });
        }

        if (req.method === 'GET') {
            try {
                const raw = await fs.readFile(filePath, 'utf-8');
                return sendJson(res, 200, JSON.parse(raw));
            } catch (err) {
                return sendJson(res, 500, { error: String(err) });
            }
        }

        if (req.method === 'PUT') {
            try {
                const body = await readJsonBody(req);
                // The JSON mirror is written FIRST and unconditionally — it's what every
                // other GET on this tab reads back, and keeping it in sync with what was
                // actually submitted matters even if the source-file patch below fails.
                await fs.writeFile(filePath, JSON.stringify(body, null, 4) + '\n', 'utf-8');

                // mapTiles has no TS source for syncToSource to patch — its real runtime
                // source of truth is map/tiles.json itself (read straight as JSON by
                // TileMapConfig.ts at runtime, via PIXI.Assets), so a save writes there
                // directly instead of going through the AST-patch path below.
                if (id === 'mapTiles') {
                    await fs.writeFile(TILES_FILE, JSON.stringify(body, null, 4) + '\n', 'utf-8');
                    // The Tiled spritesheets are DERIVED from tiles.json's own `color` fields
                    // (see tilesetImage.mjs's own doc) — regenerate both every save so a color
                    // edit (or a `showTileNumbers` toggle) actually shows up when painting the
                    // map in Tiled, not just in the flat-quad in-game renderer.
                    const tileSize = body.tileSize ?? 32;
                    const showNumbers = !!body.showTileNumbers;
                    await Promise.all([
                        fs.writeFile(path.join(TILED_DIR, 'grounds.png'), generateTilesetImage(body.grounds ?? [], tileSize, { showNumbers, numberStyle: GROUND_NUMBER_STYLE })),
                        fs.writeFile(path.join(TILED_DIR, 'resources.png'), generateTilesetImage(body.resources ?? [], tileSize, { showNumbers, numberStyle: RESOURCE_NUMBER_STYLE })),
                    ]);
                    return sendJson(res, 200, { ok: true, syncedToSource: true });
                }

                let sourceSync;
                try {
                    sourceSync = await syncToSource(id, body);
                } catch (err) {
                    console.error(`[pizza-editor] failed to sync "${id}" back to its source .ts file:`, err);
                    return sendJson(res, 200, {
                        ok: true,
                        warning: `Saved to the editor's own data file, but writing the change into the real source file failed: ${err.message}`,
                    });
                }

                return sendJson(res, 200, {
                    ok: true,
                    syncedToSource: !sourceSync.skipped,
                    warnings: sourceSync.warnings,
                });
            } catch (err) {
                return sendJson(res, 400, { error: String(err) });
            }
        }
    }

    if (req.method === 'GET') {
        return serveStatic(req, res);
    }

    res.writeHead(405);
    res.end();
});

/**
 * `npm run editor` re-run while a previous instance is still bound to PORT (e.g. after this
 * process's terminal was closed instead of Ctrl+C'd, or a crash left it orphaned) used to just
 * sit there retrying EADDRINUSE — meaning that old, possibly stale-code process kept serving
 * every request instead of the fresh one you just started (exactly what caused the Map tab's
 * "why didn't my color/image change" bug — the code that fixed it wasn't the code running).
 * Killing whatever already holds PORT before this process's own listenWithRetry() runs means a
 * plain re-run of `npm run editor` is always guaranteed to end up on the code on disk right now,
 * with no separate "restart" step required. Best-effort: if nothing's listening (the normal
 * case), the lookup command exits non-zero and this is a silent no-op.
 */
function killStaleServerOnPort(port) {
    try {
        if (process.platform === 'win32') {
            const output = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf-8' });
            const pids = new Set(
                output
                    .split('\n')
                    .map(line => line.trim().match(/(\d+)$/)?.[1])
                    .filter(Boolean),
            );
            for (const pid of pids) {
                if (pid === String(process.pid)) continue;
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
                    console.log(`[pizza-editor] killed stale editor process ${pid} still holding port ${port}`);
                } catch {
                    // Already gone by the time we got here, or not ours to kill — either way, not fatal.
                }
            }
        } else {
            const output = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' });
            for (const pid of output.split('\n').map(s => s.trim()).filter(Boolean)) {
                if (pid === String(process.pid)) continue;
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
                    console.log(`[pizza-editor] killed stale editor process ${pid} still holding port ${port}`);
                } catch {
                    // Same as above — a race with the process exiting on its own isn't an error.
                }
            }
        }
    } catch {
        // netstat/findstr (or lsof) exits non-zero when nothing matches the port — the common
        // case of "nothing stale to clean up," not a failure worth logging.
    }
}

/**
 * A respawned child (see restartServer() below) starts trying to bind before
 * the old process has necessarily released the port yet — retries EADDRINUSE
 * for a few seconds instead of dying immediately, since "the old one hasn't
 * let go yet" is the expected case on every restart, not a real failure.
 */
function listenWithRetry(attemptsLeft = 20) {
    server.once('error', err => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
            setTimeout(() => listenWithRetry(attemptsLeft - 1), 250);
            return;
        }
        console.error(`[pizza-editor] failed to bind port ${PORT}: ${err.message}`);
        process.exit(1);
    });
    server.listen(PORT, () => {
        const url = `http://localhost:${PORT}`;
        console.log(`[pizza-editor] serving at ${url}`);
        // EDITOR_SKIP_OPEN is set by restartServer() below when respawning after
        // an edit or a button-triggered restart — the whole point of a restart is
        // that an existing tab is already open and about to reconnect, so opening
        // a second one every time this file is saved would get old fast.
        if (process.env.EDITOR_SKIP_OPEN !== '1') {
            openBrowser(url);
        }
    });
}

killStaleServerOnPort(PORT);
listenWithRetry();

/** Best-effort auto-open — a dev convenience, so a failure here (e.g. no GUI/headless CI box) should never crash the server, just skip opening. */
function openBrowser(url) {
    const command = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`;
    exec(command, err => {
        if (err) {
            console.warn(`[pizza-editor] could not auto-open browser: ${err.message}`);
        }
    });
}

let restarting = false;

/**
 * Spawns a fresh `node server.mjs` (detached + unref'd, so it survives this
 * process exiting) bound to the SAME port, then exits this process. The new
 * child retries the listen() bind for a couple seconds (see the retry loop
 * near the bottom of this file) since the old process holding the port
 * hasn't necessarily released it by the time the child starts trying.
 * `restarting` guards against the fs.watch below firing more than once for
 * a single save (editors commonly emit several 'change' events per write) —
 * without it, two overlapping spawns would both try to grab the same port.
 */
function restartServer(reason) {
    if (restarting) {
        return;
    }
    restarting = true;
    console.log(`[pizza-editor] restarting (${reason})...`);

    const child = spawn(process.execPath, [__filename], {
        stdio: 'inherit',
        detached: true,
        env: { ...process.env, EDITOR_SKIP_OPEN: '1' },
    });
    child.unref();

    server.close(() => process.exit(0));
    // server.close() waits for in-flight requests to finish, which can hang if
    // one never completes — force the exit either way after a short grace
    // period so a restart can never get stuck.
    setTimeout(() => process.exit(0), 500);
}

// Watching this file itself (not the whole directory) keeps this scoped to
// "the server's own code changed" — edits to public/*.html|js|css are picked
// up on the next request with no restart needed (serveStatic() reads fresh
// off disk every time), and edits to data/*.json are the editor's own normal
// read/write path, not a code change.
fsSync.watch(__filename, { persistent: false }, eventType => {
    if (eventType === 'change') {
        restartServer('server.mjs changed');
    }
});
