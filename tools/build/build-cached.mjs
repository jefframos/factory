import { execSync } from 'child_process';
import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
    defaultPlatformFor,
    hashGame,
    loadRegistry,
    promoteToCache,
    readMeta,
    writeIndexPage,
    writeMeta,
} from './cache-lib.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../');

const cachedBuildsRoot = resolve(projectRoot, 'cachedBuilds');
const registryPath = resolve(cachedBuildsRoot, 'registry.json');
const envPath = resolve(projectRoot, '.env');

const force = process.argv.includes('--force');

/**
 * Runs the real pipeline for one game, exactly as you'd run it by hand:
 * `npm run all --<game>` (switches .env's GAME, deletes every other game's
 * public/<name> folder, repacks assets) then `vite build` (the normal
 * single-platform build — called directly, not via `npm run build`, so this
 * loop doesn't also trigger the postbuild cache-sync hook per game). Only
 * once that succeeds do we copy the real dist/_builds_<game>/<platform>
 * output into the cache — so a failing rebuild can't wipe out a
 * previously-good cached build for that game.
 * @param {string} game
 */
function buildGame(game) {
    console.log(`   - Packing assets for "${game}"...`);
    execSync(`npm run all -- "--${game}"`, { stdio: 'inherit', cwd: projectRoot });

    console.log(`   - Building "${game}"...`);
    execSync('npx vite build', { stdio: 'inherit', cwd: projectRoot });

    const platform = defaultPlatformFor(game);
    const distDir = resolve(projectRoot, 'dist', `_builds_${game}`, platform);
    if (!fs.existsSync(distDir)) {
        throw new Error(`Expected build output at ${distDir}, but it doesn't exist.`);
    }

    promoteToCache(cachedBuildsRoot, game, distDir);
    return platform;
}

function run() {
    fs.mkdirSync(cachedBuildsRoot, { recursive: true });
    const registry = loadRegistry(registryPath);

    if (registry.length === 0) {
        console.log(
            'No games registered yet. Run `npm run dev` (or `npm start`) with GAME=<name> in .env at least once per game to register it.'
        );
        return;
    }

    // npm run all rewrites .env's GAME line as it cycles through games;
    // restore your actual local GAME selection when this script is done.
    const originalEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : null;

    console.log(`\n🚀 Checking ${registry.length} registered game(s)${force ? ' (--force: rebuilding all)' : ''}`);

    let rebuilt = 0;
    let skipped = 0;
    const failedGames = [];

    try {
        for (const game of registry) {
            const gameDir = resolve(projectRoot, 'games', game);
            if (!fs.existsSync(gameDir)) {
                console.warn(`⚠️  Skipping "${game}": games/${game} no longer exists.`);
                continue;
            }

            const currentHash = hashGame(projectRoot, game);
            const previousMeta = readMeta(cachedBuildsRoot, game);
            const needsBuild = force || !previousMeta || previousMeta.hash !== currentHash;

            if (needsBuild) {
                try {
                    const platform = buildGame(game);
                    writeMeta(cachedBuildsRoot, game, currentHash, platform);
                    console.log(`✅ Rebuilt "${game}"`);
                    rebuilt++;
                } catch (err) {
                    console.error(`❌ Failed to build "${game}", skipping it. Previous cache (if any) left untouched.`);
                    console.error(`   ${err.message}`);
                    failedGames.push(game);
                }
            } else {
                console.log(`⏭️  Using cached build for "${game}" (unchanged)`);
                skipped++;
            }
        }
    } finally {
        if (originalEnv !== null) {
            fs.writeFileSync(envPath, originalEnv);
        } else {
            fs.rmSync(envPath, { force: true });
        }
    }

    writeIndexPage(cachedBuildsRoot, registry);
    console.log(`\n✨ Done. Rebuilt ${rebuilt}, reused ${skipped}, failed ${failedGames.length}.`);
    if (failedGames.length > 0) {
        console.log(`   Failed: ${failedGames.join(', ')}`);
    }
    console.log(`   Page: cachedBuilds/index.html`);
}

run();
