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

/** Published icon size (px, square) — the sources are ~628px PNGs, far too heavy for a page of them. */
const ICON_SIZE = 256;

/**
 * Writes both published pages: the store (cachedBuilds/index.html — the games listed in
 * games/store.json, with their icons) and every cached build (cachedBuilds/all/index.html).
 * Each game's games/<id>/icon/icon.png is published as cachedBuilds/icons/<id>.webp first.
 * @param {string} cachedBuildsRoot
 * @param {string[]} games The registry (every cached game)
 */
export async function writeIndexPage(cachedBuildsRoot, games) {
    const playable = games.filter((game) => fs.existsSync(resolve(cachedBuildsRoot, game, 'index.html')));
    const projectRoot = dirname(cachedBuildsRoot);
    const icons = await publishIcons(projectRoot, cachedBuildsRoot, playable);
    const store = readStoreList(projectRoot);
    writeAllGamesPage(cachedBuildsRoot, playable, icons, store.names);
    writeStorePage(cachedBuildsRoot, store, playable, icons);
}

/** games/<id>/icon/icon.png -> cachedBuilds/icons/<id>.webp (ICON_SIZE), skipped when already newer than its source. Returns the ids that have one. */
async function publishIcons(projectRoot, cachedBuildsRoot, games) {
    const { default: sharp } = await import('sharp');
    const outDir = resolve(cachedBuildsRoot, 'icons');
    fs.mkdirSync(outDir, { recursive: true });
    const withIcon = new Set();
    for (const game of games) {
        const source = resolve(projectRoot, 'games', game, 'icon', 'icon.png');
        if (!fs.existsSync(source)) {
            continue;
        }
        const target = resolve(outDir, `${game}.webp`);
        if (!fs.existsSync(target) || fs.statSync(target).mtimeMs < fs.statSync(source).mtimeMs) {
            await sharp(source).resize(ICON_SIZE, ICON_SIZE, { fit: 'cover' }).webp({ quality: 88 }).toFile(target);
        }
        withIcon.add(game);
    }
    return withIcon;
}

/** games/store.json — the store's ids (in order) and optional display names. */
function readStoreList(projectRoot) {
    const path = resolve(projectRoot, 'games', 'store.json');
    if (!fs.existsSync(path)) {
        return { games: [], names: {} };
    }
    const data = JSON.parse(fs.readFileSync(path, 'utf8'));
    return { games: data.games ?? [], names: data.names ?? {} };
}

function writeAllGamesPage(cachedBuildsRoot, playable, icons, names) {
    const cards = playable
        .map((game) => {
            const hue = hueForGame(game);
            const gradient = `linear-gradient(155deg, hsl(${hue}, 70%, 58%), hsl(${(hue + 40) % 360}, 75%, 42%))`;
            const art = icons.has(game)
                ? `<img class="art" src="../icons/${game}.webp" alt="" loading="lazy" />`
                : '<span class="icon">🎮</span>';
            return `        <a class="card" href="../${game}/index.html">
            <div class="tile" style="background:${gradient}">
                ${art}
            </div>
            <div class="label">${escapeHtml(names[game] ?? displayName(game))}</div>
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
        .art {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
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
        <p class="subtitle"><a href="../" style="color:#9fd8ff">← Store</a></p>
        <p class="subtitle">${playable.length} game${playable.length === 1 ? '' : 's'} · last updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
    </header>
    <div class="grid">
${cards || '        <p class="empty">No cached builds yet.</p>'}
    </div>
</body>
</html>
`;
    fs.mkdirSync(resolve(cachedBuildsRoot, 'all'), { recursive: true });
    fs.writeFileSync(resolve(cachedBuildsRoot, 'all', 'index.html'), html);
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** The store: games/store.json's games that have a cached build, as rounded icon tiles (Poki-style grid). */
function writeStorePage(cachedBuildsRoot, store, playable, icons) {
    const shown = store.games.filter((game) => playable.includes(game));
    const missing = store.games.filter((game) => !playable.includes(game));
    if (missing.length > 0) {
        console.warn(`⚠️  Store: no cached build yet for ${missing.join(', ')} — left off the store page.`);
    }
    const tiles = shown
        .map((game) => {
            const name = escapeHtml(store.names[game] ?? displayName(game));
            const hue = hueForGame(game);
            const art = icons.has(game)
                ? `<img src="./icons/${game}.webp" alt="" loading="lazy" />`
                : `<span class="letter" style="background:linear-gradient(155deg, hsl(${hue}, 75%, 60%), hsl(${(hue + 40) % 360}, 80%, 42%))">${name.charAt(0)}</span>`;
            return `        <a class="game" href="./${game}/index.html">
            <span class="tile">${art}</span>
            <span class="name">${name}</span>
        </a>`;
        })
        .join('\n');

    const html = `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Games</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;700&display=swap" rel="stylesheet" />
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            font-family: 'Fredoka', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #fff;
            background:
                radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.12) 1.5px, transparent 0) 0 0 / 28px 28px,
                linear-gradient(160deg, #ff7a59 0%, #ff4f8b 38%, #7b4dff 100%) fixed;
            padding: 28px 16px 56px;
        }
        header {
            max-width: 1100px;
            margin: 0 auto 28px;
            display: flex;
            align-items: center;
            gap: 14px;
        }
        .logo {
            width: 52px;
            height: 52px;
            border-radius: 16px;
            background: #fff;
            color: #ff4f8b;
            display: grid;
            place-items: center;
            font-size: 28px;
            font-weight: 700;
            box-shadow: 0 6px 0 rgba(0, 0, 0, 0.12);
        }
        h1 {
            margin: 0;
            font-size: 30px;
            font-weight: 700;
            text-shadow: 0 3px 0 rgba(0, 0, 0, 0.15);
        }
        .grid {
            max-width: 1100px;
            margin: 0 auto;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 22px 18px;
        }
        .game {
            text-decoration: none;
            color: inherit;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }
        .tile {
            width: 100%;
            aspect-ratio: 1 / 1;
            border-radius: 26px;
            overflow: hidden;
            background: rgba(255, 255, 255, 0.25);
            box-shadow: 0 8px 0 rgba(0, 0, 0, 0.14), 0 14px 28px rgba(40, 0, 60, 0.28);
            border: 4px solid #fff;
            transition: transform 0.18s cubic-bezier(.3, 1.6, .5, 1), box-shadow 0.18s ease;
        }
        .tile img, .letter {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
        }
        .letter {
            display: grid;
            place-items: center;
            font-size: 64px;
            font-weight: 700;
            text-shadow: 0 4px 0 rgba(0, 0, 0, 0.18);
        }
        .game:hover .tile, .game:focus-visible .tile {
            transform: translateY(-6px) scale(1.05) rotate(-1.5deg);
            box-shadow: 0 14px 0 rgba(0, 0, 0, 0.12), 0 22px 36px rgba(40, 0, 60, 0.35);
        }
        .name {
            font-size: 18px;
            font-weight: 700;
            text-align: center;
            text-shadow: 0 2px 0 rgba(0, 0, 0, 0.2);
        }
        footer {
            max-width: 1100px;
            margin: 40px auto 0;
            text-align: center;
        }
        footer a {
            color: #fff;
            opacity: 0.8;
            font-size: 14px;
        }
        @media (max-width: 480px) {
            .grid { grid-template-columns: repeat(3, 1fr); gap: 16px 12px; }
            .tile { border-radius: 20px; border-width: 3px; }
            .name { font-size: 15px; }
            h1 { font-size: 24px; }
        }
    </style>
</head>
<body>
    <header>
        <div class="logo">▶</div>
        <h1>Games</h1>
    </header>
    <div class="grid">
${tiles || '        <p>No games yet.</p>'}
    </div>
    <footer><a href="./all/">All builds and prototypes →</a></footer>
</body>
</html>
`;
    fs.writeFileSync(resolve(cachedBuildsRoot, 'index.html'), html);
}
