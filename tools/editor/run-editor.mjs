// run-editor.mjs
//
// `npm run editor` entry point. Reads GAME from .env the same way
// vite.config.ts does, then checks whether games/<GAME>/web/server.mjs
// exists — if it does, this is a game with a local design-data editor and
// we spawn its server; if not, this game hasn't been set up for one yet, so
// this exits with a clear message instead of guessing.
//
// Deliberately per-game rather than one shared editor server: each game's
// design-data shape (gates/queues/shops/... for pizza) is different enough
// that a shared editor would just be a pile of per-game special cases — see
// games/pizza/web/ for the concrete pattern to copy into another game's own
// web/ folder when it needs one.
//
// Only one editor runs at a time: each run records itself (launcher pid, server
// pid, port) in node_modules/.cache/factory-editor.json, and the next run kills
// that previous editor — whatever game it was for — plus anything still holding
// its port or the new one (an editor that respawned itself, or one started
// before this file kept a record), then starts the new one.

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// dotenv never overrides a variable already set in the shell, so a stale
// `$env:GAME=...` silently wins over .env — say where GAME came from.
const shellGame = process.env.GAME;
const fileGame = dotenv.config().parsed?.GAME;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const GAME = process.env.GAME;
if (!GAME) {
    console.error('[editor] Please specify the GAME environment variable in your .env file (GAME=pizza)');
    process.exit(1);
}
if (shellGame && fileGame && shellGame !== fileGame) {
    console.warn(`[editor] GAME=${shellGame} from the shell overrides GAME=${fileGame} in .env — run \`Remove-Item Env:GAME\` (PowerShell) to use .env.`);
}
console.log(`[editor] GAME=${GAME} (${shellGame ? 'shell environment' : '.env'})`);

const webDir = path.join(REPO_ROOT, 'games', GAME, 'web');
const serverEntry = path.join(webDir, 'server.mjs');

if (!fs.existsSync(webDir) || !fs.existsSync(serverEntry)) {
    console.error(
        `[editor] No web editor found for game "${GAME}" — expected games/${GAME}/web/server.mjs.\n` +
        `[editor] See games/pizza/web/ for the pattern (manifest.json + data/*.json + server.mjs + public/).`,
    );
    process.exit(1);
}

const STATE_FILE = path.join(REPO_ROOT, 'node_modules', '.cache', 'factory-editor.json');

/** The server's port: EDITOR_PORT, else the default in its `const PORT = ... : 4700` line. */
function editorPort() {
    if (process.env.EDITOR_PORT) return Number(process.env.EDITOR_PORT);
    const match = fs.readFileSync(serverEntry, 'utf-8').match(/const PORT\s*=.*?:\s*(\d+)/);
    return match ? Number(match[1]) : undefined;
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === 'EPERM';
    }
}

/** The pids listening on `port` (best-effort: none if the lookup finds nothing or fails). */
function pidsOnPort(port) {
    try {
        if (process.platform === 'win32') {
            const output = execSync(`netstat -ano -p tcp | findstr LISTENING | findstr :${port}`, { encoding: 'utf-8' });
            return output.split('\n')
                .filter(line => line.trim().split(/\s+/)[1]?.endsWith(`:${port}`))
                .map(line => Number(line.trim().match(/(\d+)$/)?.[1]))
                .filter(Boolean);
        }
        return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf-8' })
            .split('\n').map(Number).filter(Boolean);
    } catch {
        return [];
    }
}

function kill(pid, force) {
    try {
        if (process.platform === 'win32') execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        else process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch {
        // Already gone: nothing to do.
    }
}

/** Stops the previous editor (and anything on its port or ours), waiting until they're gone. */
async function stopPreviousEditor(port) {
    let previous = {};
    try {
        previous = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
        // No record: first run, or the cache was cleared.
    }
    const pids = new Set([previous.launcher, previous.server].filter((pid) => pid && isAlive(pid)));
    for (const p of new Set([previous.port, port])) {
        if (p) pidsOnPort(p).forEach((pid) => pids.add(pid));
    }
    pids.delete(process.pid);
    if (!pids.size) return;
    console.log(`[editor] stopping the previous editor (${previous.game ?? 'unknown game'}, pid ${[...pids].join(', ')})`);
    pids.forEach((pid) => kill(pid, false));
    for (let i = 0; i < 20 && [...pids].some(isAlive); i++) await new Promise((r) => setTimeout(r, 100));
    [...pids].filter(isAlive).forEach((pid) => kill(pid, true));
    for (let i = 0; i < 20 && port && pidsOnPort(port).length; i++) await new Promise((r) => setTimeout(r, 100));
}

const port = editorPort();
await stopPreviousEditor(port);

const child = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    cwd: webDir,
});

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
fs.writeFileSync(STATE_FILE, JSON.stringify({ game: GAME, launcher: process.pid, server: child.pid, port }));

/** Forget this editor on the way out, unless a newer run has already replaced the record. */
function clearState() {
    try {
        if (JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).launcher === process.pid) fs.rmSync(STATE_FILE);
    } catch {
        // Nothing to clear.
    }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
        child.kill(signal);
        clearState();
        process.exit(0);
    });
}

child.on('exit', code => {
    clearState();
    process.exit(code ?? 0);
});
