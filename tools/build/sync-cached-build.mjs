import dotenv from 'dotenv';
import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
    defaultPlatformFor,
    ensureRegistered,
    hashGame,
    promoteToCache,
    writeIndexPage,
    writeMeta,
} from './cache-lib.mjs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../');

const cachedBuildsRoot = resolve(projectRoot, 'cachedBuilds');
const registryPath = resolve(cachedBuildsRoot, 'registry.json');

const GAME = process.env.GAME;
if (!GAME) {
    process.exit(0);
}

// Only sync the plain single-platform build the cached page actually
// publishes. If VITE_PLATFORM was explicitly set to something else (e.g. a
// one-off `VITE_PLATFORM=poki npm run build`), skip — that output isn't the
// one this cache tracks.
const platform = defaultPlatformFor(GAME);
if (process.env.VITE_PLATFORM && process.env.VITE_PLATFORM !== platform) {
    process.exit(0);
}

const distDir = resolve(projectRoot, 'dist', `_builds_${GAME}`, platform);
if (!fs.existsSync(distDir)) {
    process.exit(0);
}

// `npm run all -- --<game>` deletes every OTHER game's public/<name> folder
// each time it runs. If public/<GAME> isn't there right now, the build that
// just ran did NOT have fresh assets to bundle (e.g. you last packed a
// different game) — its dist output is silently incomplete, so don't let it
// clobber a previously-good cached build.
const publicDir = resolve(projectRoot, 'public', GAME);
if (!fs.existsSync(publicDir)) {
    console.warn(
        `⚠️  Skipping cache sync: public/${GAME} doesn't exist, so this build likely has stale/missing assets. ` +
        `Run \`npm run all -- "--${GAME}"\` (or \`npm run build:cached\`) first.`
    );
    process.exit(0);
}

fs.mkdirSync(cachedBuildsRoot, { recursive: true });
promoteToCache(cachedBuildsRoot, GAME, distDir);
writeMeta(cachedBuildsRoot, GAME, hashGame(projectRoot, GAME), platform);

const registry = ensureRegistered(registryPath, GAME);
writeIndexPage(cachedBuildsRoot, registry);

console.log(`📦 Synced cachedBuilds/${GAME} from dist/_builds_${GAME}/${platform}`);
