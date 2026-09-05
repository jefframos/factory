import crypto from 'crypto';
import fs from 'fs';
import { dirname, relative, resolve } from 'path';

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
 * @param {string} projectRoot
 * @param {string} game
 */
export function hashGame(projectRoot, game) {
    const hash = crypto.createHash('sha256');
    for (const file of collectFiles(resolve(projectRoot, 'games', game))) {
        hash.update(relative(projectRoot, file));
        hash.update(fs.readFileSync(file));
    }
    return hash.digest('hex');
}

// Mirrors vite.config.ts's own fallback: merge1 has no generic "default"
// platform entry and only ships on YouTube Playables, so a plain `npm run
// build` (no VITE_PLATFORM set) lands in dist/_builds_merge1/youtube instead
// of .../default. Every other game lands in .../default.
export function defaultPlatformFor(game) {
    return game === 'merge1' ? 'youtube' : 'default';
}

export function loadRegistry(registryPath) {
    if (!fs.existsSync(registryPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    } catch {
        return [];
    }
}

/**
 * Adds `game` to the registry file if it isn't already there.
 * @param {string} registryPath
 * @param {string} game
 * @returns {string[]} the resulting registry
 */
export function ensureRegistered(registryPath, game) {
    const registry = loadRegistry(registryPath);
    if (!registry.includes(game)) {
        registry.push(game);
        fs.mkdirSync(dirname(registryPath), { recursive: true });
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 4) + '\n');
    }
    return registry;
}

export function readMeta(cachedBuildsRoot, game) {
    const metaPath = resolve(cachedBuildsRoot, game, '.cache-meta.json');
    if (!fs.existsSync(metaPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
        return null;
    }
}

export function writeMeta(cachedBuildsRoot, game, hash, platform) {
    const metaPath = resolve(cachedBuildsRoot, game, '.cache-meta.json');
    fs.writeFileSync(
        metaPath,
        JSON.stringify({ hash, platform, builtAt: new Date().toISOString() }, null, 4) + '\n'
    );
}

/**
 * Copies `sourceDir` (a real dist/_builds_<game>/<platform> build) into the
 * cache dir for `game` via a scratch dir + swap, so a caller that fails
 * partway through never leaves the cache dir half-written.
 * @param {string} cachedBuildsRoot
 * @param {string} game
 * @param {string} sourceDir
 */
export function promoteToCache(cachedBuildsRoot, game, sourceDir) {
    const finalDir = resolve(cachedBuildsRoot, game);
    const tmpDir = resolve(cachedBuildsRoot, '.tmp', game);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(dirname(tmpDir), { recursive: true });
    fs.cpSync(sourceDir, tmpDir, { recursive: true });

    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, finalDir);
}

// Deterministic hue from the game's name, so a given game always gets the
// same tile color across rebuilds instead of a random one each time.
function hueForGame(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 360;
}

function displayName(game) {
    return game.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function writeIndexPage(cachedBuildsRoot, games) {
    const playable = games.filter((game) => fs.existsSync(resolve(cachedBuildsRoot, game, 'index.html')));

    const cards = playable
        .map((game) => {
            const hue = hueForGame(game);
            const gradient = `linear-gradient(155deg, hsl(${hue}, 70%, 58%), hsl(${(hue + 40) % 360}, 75%, 42%))`;
            return `        <a class="card" href="./${game}/index.html">
            <div class="tile" style="background:${gradient}">
                <span class="icon">🎮</span>
            </div>
            <div class="label">${displayName(game)}</div>
        </a>`;
        })
        .join('\n');

    const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Game Builds</title>
    <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            background: #0e0e16;
            color: #f2f2f7;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 48px 24px 64px;
        }
        header {
            max-width: 1200px;
            margin: 0 auto 36px;
        }
        h1 {
            margin: 0 0 6px;
            font-size: 32px;
            letter-spacing: -0.02em;
        }
        p.subtitle {
            margin: 0;
            color: #9a9aab;
            font-size: 15px;
        }
        .grid {
            max-width: 1200px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 20px;
        }
        .card {
            display: block;
            text-decoration: none;
            color: inherit;
            border-radius: 16px;
            overflow: hidden;
            background: #1a1a26;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
            transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .card:hover {
            transform: translateY(-4px) scale(1.03);
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
        }
        .tile {
            aspect-ratio: 1 / 1;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .icon {
            font-size: 42px;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.35));
        }
        .label {
            padding: 10px 12px;
            font-size: 14px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .empty {
            max-width: 1200px;
            margin: 0 auto;
            color: #9a9aab;
        }
    </style>
</head>
<body>
    <header>
        <h1>🎮 Game Builds</h1>
        <p class="subtitle">${playable.length} game${playable.length === 1 ? '' : 's'} · last updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
    </header>
    <div class="grid">
${cards || '        <p class="empty">No cached builds yet.</p>'}
    </div>
</body>
</html>
`;
    fs.writeFileSync(resolve(cachedBuildsRoot, 'index.html'), html);
}
