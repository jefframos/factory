import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import { dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '../../');

const cachedBuildsRoot = resolve(projectRoot, 'cachedBuilds');
const registryPath = resolve(cachedBuildsRoot, 'registry.json');
const envPath = resolve(projectRoot, '.env');

const force = process.argv.includes('--force');

/**
 * Recursively collects all files under a directory, returned as paths
 * relative to `projectRoot` (stable across machines), sorted.
 * @param {string} dir Absolute path
 * @returns {string[]}
 */
function collectFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectFiles(full));
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
    return out.sort();
}

/**
 * Hashes a game's own source (games/<name>, including its raw-assets) so we
 * can tell whether it changed since the last cached build. public/<name> is
 * intentionally NOT hashed: it's a derived artifact that `npm run all`
 * regenerates from raw-assets on every rebuild, and it gets deleted for
 * every OTHER game each time `npm run all` runs, so it isn't a stable input.
 * core/ is also excluded — a shared-engine edit does not invalidate a game's
 * cache under this script.
 * @param {string} game
 */
function hashGame(game) {
    const hash = crypto.createHash('sha256');
    for (const file of collectFiles(resolve(projectRoot, 'games', game))) {
        hash.update(relative(projectRoot, file));
        hash.update(fs.readFileSync(file));
    }
    return hash.digest('hex');
}

function loadRegistry() {
    if (!fs.existsSync(registryPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    } catch {
        return [];
    }
}

function readMeta(game) {
    const metaPath = resolve(cachedBuildsRoot, game, '.cache-meta.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
        return null;
    }
}

function writeMeta(game, hash, platform) {
    const metaPath = resolve(cachedBuildsRoot, game, '.cache-meta.json');
    fs.writeFileSync(
        metaPath,
        JSON.stringify({ hash, platform, builtAt: new Date().toISOString() }, null, 4) + '\n'
    );
}

// Mirrors vite.config.ts's own fallback: merge1 has no generic "default"
// platform entry and only ships on YouTube Playables, so a plain `npm run
// build` (no VITE_PLATFORM set) lands in dist/_builds_merge1/youtube instead
// of .../default. Every other game lands in .../default.
function defaultPlatformFor(game) {
    return game === 'merge1' ? 'youtube' : 'default';
}

/**
 * Runs the real pipeline for one game, exactly as you'd run it by hand:
 * `npm run all --<game>` (switches .env's GAME, deletes every other game's
 * public/<name> folder, repacks assets) then `npm run build` (the normal
 * single-platform build). Only once that succeeds do we copy the real
 * dist/_builds_<game>/<platform> output into a scratch dir and swap it into
 * the cache dir — so a failing rebuild can't wipe out a previously-good
 * cached build for that game.
 * @param {string} game
 */
function buildGame(game) {
    console.log(`   - Packing assets for "${game}"...`);
    execSync(`npm run all -- "--${game}"`, { stdio: 'inherit', cwd: projectRoot });

    console.log(`   - Building "${game}"...`);
    execSync('npm run build', { stdio: 'inherit', cwd: projectRoot });

    const platform = defaultPlatformFor(game);
    const distDir = resolve(projectRoot, 'dist', `_builds_${game}`, platform);
    if (!fs.existsSync(distDir)) {
        throw new Error(`Expected build output at ${distDir}, but it doesn't exist.`);
    }

    const finalDir = resolve(cachedBuildsRoot, game);
    const tmpDir = resolve(cachedBuildsRoot, '.tmp', game);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(dirname(tmpDir), { recursive: true });
    fs.cpSync(distDir, tmpDir, { recursive: true });

    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, finalDir);

    return platform;
}

function writeIndexPage(games) {
    const links = games
        .filter((game) => fs.existsSync(resolve(cachedBuildsRoot, game, 'index.html')))
        .map((game) => `        <li><a href="./${game}/index.html">${game}</a></li>`)
        .join('\n');

    const html = `<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Cached game builds</title>
</head>
<body>
    <h1>Cached game builds</h1>
    <ul>
${links}
    </ul>
</body>
</html>
`;
    fs.writeFileSync(resolve(cachedBuildsRoot, 'index.html'), html);
}

function run() {
    fs.mkdirSync(cachedBuildsRoot, { recursive: true });
    const registry = loadRegistry();

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

            const currentHash = hashGame(game);
            const previousMeta = readMeta(game);
            const needsBuild = force || !previousMeta || previousMeta.hash !== currentHash;

            if (needsBuild) {
                try {
                    const platform = buildGame(game);
                    writeMeta(game, currentHash, platform);
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

    writeIndexPage(registry);
    console.log(`\n✨ Done. Rebuilt ${rebuilt}, reused ${skipped}, failed ${failedGames.length}.`);
    if (failedGames.length > 0) {
        console.log(`   Failed: ${failedGames.join(', ')}`);
    }
    console.log(`   Page: cachedBuilds/index.html`);
}

run();
