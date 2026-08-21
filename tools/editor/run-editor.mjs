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

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const GAME = process.env.GAME;
if (!GAME) {
    console.error('[editor] Please specify the GAME environment variable in your .env file (GAME=pizza)');
    process.exit(1);
}

const webDir = path.join(REPO_ROOT, 'games', GAME, 'web');
const serverEntry = path.join(webDir, 'server.mjs');

if (!fs.existsSync(webDir) || !fs.existsSync(serverEntry)) {
    console.error(
        `[editor] No web editor found for game "${GAME}" — expected games/${GAME}/web/server.mjs.\n` +
        `[editor] See games/pizza/web/ for the pattern (manifest.json + data/*.json + server.mjs + public/).`,
    );
    process.exit(1);
}

const child = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    cwd: webDir,
});

child.on('exit', code => process.exit(code ?? 0));
