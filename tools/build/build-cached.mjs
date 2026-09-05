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
 * Hashes a game's own source (games/<name> + public/<name>, if it exists) so
 * we can tell whether it changed since the last cached build. core/ is
 * intentionally excluded — a shared-engine edit does not invalidate a game's
 * cache under this script.
 * @param {string} game
 */
function hashGame(game) {
    const dirs = [resolve(projectRoot, 'games', game), resolve(projectRoot, 'public', game)];
    const hash = crypto.createHash('sha256');
    for (const dir of dirs) {
        for (const file of collectFiles(dir)) {
            hash.update(relative(projectRoot, file));
            hash.update(fs.readFileSync(file));
        }
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

function writeMeta(game, hash) {
    const metaPath = resolve(cachedBuildsRoot, game, '.cache-meta.json');
    fs.writeFileSync(
        metaPath,
        JSON.stringify({ hash, platform: 'default', builtAt: new Date().toISOString() }, null, 4) + '\n'
    );
}

/**
 * vite.config.ts's publicDir points at the whole public/ root (not scoped
 * per game), so a `vite build` for any game copies every other game's
 * public/<name> folder into its output too. Strips those foreign folders
 * out of the cached build so e.g. building "clog" doesn't carry a copy of
 * public/pizza. Never touches vite.config.ts, so dist/build-all are
 * unaffected.
 * @param {string} game
 * @param {string} outDir
 */
function stripForeignPublicDirs(game, outDir) {
    const publicRoot = resolve(projectRoot, 'public');
    if (!fs.existsSync(publicRoot)) return;

    for (const entry of fs.readdirSync(publicRoot, { withFileTypes: true })) {
        if (entry.name === game) continue;
        const foreign = resolve(outDir, entry.name);
        if (fs.existsSync(foreign)) {
            fs.rmSync(foreign, { recursive: true, force: true });
        }
    }
}

/**
 * Builds into a scratch dir and only swaps it into the real cache dir on
 * success, so a failing rebuild can't wipe out a previously-good cached
 * build for that game (vite's --emptyOutDir clears the target up front).
 * @param {string} game
 */
function buildGame(game) {
    const finalDir = resolve(cachedBuildsRoot, game);
    const tmpDir = resolve(cachedBuildsRoot, '.tmp', game);
    fs.rmSync(tmpDir, { recursive: true, force: true });

    console.log(`   - Compiling "${game}"...`);
    execSync(`npx vite build --outDir "${tmpDir}" --emptyOutDir`, {
        stdio: 'inherit',
        cwd: projectRoot,
        env: { ...process.env, GAME: game, VITE_PLATFORM: 'default' },
    });

    stripForeignPublicDirs(game, tmpDir);

    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, finalDir);
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

    console.log(`\n🚀 Checking ${registry.length} registered game(s)${force ? ' (--force: rebuilding all)' : ''}`);

    let rebuilt = 0;
    let skipped = 0;
    const failedGames = [];

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
                buildGame(game);
                writeMeta(game, currentHash);
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

    writeIndexPage(registry);
    console.log(`\n✨ Done. Rebuilt ${rebuilt}, reused ${skipped}, failed ${failedGames.length}.`);
    if (failedGames.length > 0) {
        console.log(`   Failed: ${failedGames.join(', ')}`);
    }
    console.log(`   Page: cachedBuilds/index.html`);
}

run();
