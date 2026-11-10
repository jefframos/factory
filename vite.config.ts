import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import { resolve } from 'path';
import { defineConfig, Plugin } from 'vite';

// Load .env file
// .env picks the game, even over a GAME left set in the terminal (dotenv alone never overrides one).
process.env.GAME = dotenv.config().parsed?.GAME ?? process.env.GAME;

const GAME = process.env.GAME;
// merge1 only ships on YouTube Playables, so unlike the other games it has no
// generic "local" platform entry — default it straight to 'youtube'.
const PLATFORM = process.env.VITE_PLATFORM || (GAME === 'merge1' ? 'youtube' : 'default');

if (!GAME) {
    throw new Error('Please specify the GAME environment variable in your .env file (GAME=game1)');
}

// Rescans games/ into cachedBuilds/registry.json every time the dev server
// starts, so a newly added folder is picked up on the next `npm start` for
// any game, not just its own. Only the cached-build script
// (tools/build/build-cached.mjs) reads this list; `apply: 'serve'` means this
// never runs during `vite build`, so build/build-all behavior is untouched.
// A platform build (build-all: VITE_PLATFORM set) keeps only its own entry of the game's platforms.config.json,
// which every game imports whole: a Poki build otherwise ships the CrazyGames / YouTube ids, folders and API
// script. Builds without a platform (dev, the default / cached build) keep the whole file.
function trimPlatformConfig(platform: string | undefined): Plugin {
    return {
        name: 'trim-platform-config',
        apply: 'build',
        enforce: 'pre',
        transform(code, id) {
            if (!platform || !id.replace(/\\/g, '/').endsWith('/platforms.config.json')) return null;
            const all = JSON.parse(code) as Record<string, unknown>;
            return { code: JSON.stringify(platform in all ? { [platform]: all[platform] } : {}), map: null };
        },
    };
}

// A build copies the whole public/ folder, which still holds the asset folders of whatever games were built before
// (7.9 MB of Ant's in Mob's build, 12 MB of Mow's in UFO's). After the build only the game's own are kept: public/<GAME>
// and any folderPath its platforms.config.json names. Vite's own output (assets/, index.html) stays.
function keepOnlyGameAssets(gameRoot: string, outDir: string): Plugin {
    return {
        name: 'keep-only-game-assets',
        apply: 'build',
        closeBundle() {
            const keep = new Set<string>([GAME!]);
            try {
                const config = JSON.parse(fs.readFileSync(resolve(gameRoot, 'platforms.config.json'), 'utf8')) as Record<string, { folderPath?: string }>;
                for (const entry of Object.values(config)) if (entry?.folderPath) keep.add(entry.folderPath);
            } catch {
                // No platforms config: just the game's own folder.
            }
            const publicRoot = resolve(__dirname, 'public');
            if (!fs.existsSync(publicRoot) || !fs.existsSync(outDir)) return;
            for (const entry of fs.readdirSync(publicRoot, { withFileTypes: true })) {
                if (!entry.isDirectory() || keep.has(entry.name)) continue;
                const copied = resolve(outDir, entry.name);
                if (!fs.existsSync(copied)) continue;
                fs.rmSync(copied, { recursive: true, force: true });
                console.log(`🧹 Left out public/${entry.name} (another game's assets)`);
            }
        },
    };
}

function syncGameRegistry(): Plugin {
    return {
        name: 'sync-game-registry',
        apply: 'serve',
        configResolved() {
            const gamesRoot = resolve(__dirname, 'games');
            const registryPath = resolve(__dirname, 'cachedBuilds/registry.json');
            fs.mkdirSync(resolve(__dirname, 'cachedBuilds'), { recursive: true });

            const games = fs
                .readdirSync(gamesRoot, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort();

            fs.writeFileSync(registryPath, JSON.stringify(games, null, 4) + '\n');
            console.log(`📋 Synced ${games.length} game folder(s) for cached builds.`);
        },
    };
}

// Switching games without restarting anything: the dev server watches .env, and when its GAME line changes it
// restarts itself (re-reading this config, so the new game becomes the root); the open page reloads into it.
function restartOnGameChange(): Plugin {
    const envPath = resolve(__dirname, '.env');
    return {
        name: 'restart-on-game-change',
        apply: 'serve',
        configureServer(server) {
            server.watcher.add(envPath);
            server.watcher.on('change', (file) => {
                if (resolve(file) !== envPath) return;
                const next = dotenv.parse(fs.readFileSync(envPath)).GAME;
                if (!next || next === GAME) return;
                console.log(`🔁 .env now says GAME=${next} (was ${GAME}): restarting the dev server`);
                void server.restart();
            });
        },
    };
}

// Some platforms require an SDK script (e.g. YouTube Playables' game_api
// script) to load before the game bundle. platforms.config.json can declare
// this per-platform as "apiScript": "<url>"; this plugin injects it as the
// very first tag in <head> — ahead of Vite's own injected module/CSS tags,
// which always get hoisted to the top of <head> during build.
function injectPlatformApiScript(gameRoot: string, platformName: string): Plugin {
    return {
        name: 'inject-platform-api-script',
        enforce: 'post',
        transformIndexHtml(html) {
            const configPath = resolve(gameRoot, 'platforms.config.json');
            if (!fs.existsSync(configPath)) return html;

            const platforms = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            const apiScript = platforms[platformName]?.apiScript;
            if (!apiScript) return html;

            return html.replace('<head>', `<head>\n    <script src="${apiScript}"></script>`);
        },
    };
}

// A game's own models built straight into public/ by games/<GAME>/tools/build-props.mjs (mob's props, beach, hexa and
// desert, from library3d). Nothing else rebuilds them, so anything that empties public/<GAME> (npm run all switching
// games, keepOnlyGameAssets, a hand clean-up) would lose them for good. The script lists what it built in
// public/<GAME>/models/.props-built.json; when that list, or any folder on it, is missing, it's run again here before
// the dev server or the build starts.
function ensureGameProps(): Plugin {
    const script = resolve(__dirname, `games/${GAME}/tools/build-props.mjs`);
    const models = resolve(__dirname, `public/${GAME}/models`);
    const missing = () => {
        const list = resolve(models, '.props-built.json');
        if (!fs.existsSync(list)) return 'never built';
        const folders: string[] = JSON.parse(fs.readFileSync(list, 'utf-8')).folders ?? [];
        const gone = folders.filter((folder) => {
            const dir = resolve(models, folder);
            return !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
        });
        return gone.length ? `missing ${gone.join(', ')}` : null;
    };
    return {
        name: 'ensure-game-props',
        config() {
            if (!fs.existsSync(script)) return;
            const why = missing();
            if (!why) return;
            console.log(`📦 public/${GAME}/models: ${why}, running games/${GAME}/tools/build-props.mjs`);
            execSync(`node "${script}"`, { stdio: 'inherit', cwd: __dirname });
        },
    };
}

export default defineConfig({
    root: `games/${GAME}`,
    base: './',
    publicDir: resolve(__dirname, 'public'),
    plugins: [
        injectPlatformApiScript(resolve(__dirname, `games/${GAME}`), PLATFORM),
        trimPlatformConfig(process.env.VITE_PLATFORM),
        syncGameRegistry(),
        restartOnGameChange(),
        ensureGameProps(),
        keepOnlyGameAssets(resolve(__dirname, `games/${GAME}`), resolve(__dirname, `dist/_builds_${GAME}/${PLATFORM}`)),
    ],
    resolve: {
        alias: {
            'core': resolve(__dirname, 'core'),
            '@core': resolve(__dirname, 'core'),
        },
    },
    build: {
        outDir: `../../dist/_builds_${GAME}/${PLATFORM}`,
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, `games/${GAME}/index.html`),
        },
    },
    // PLAYTEST_SERVER is set by tools/playtest/run-playtest.mjs for the dev server it starts: no
    // browser tab, and no live reload — a file saved mid-run would reload the page and restart the
    // run (its URL has &fresh).
    server: process.env.PLAYTEST_SERVER
        ? { host: '127.0.0.1', open: false, hmr: false, watch: { ignored: ['**/*'] } }
        : {
            host: '0.0.0.0',
            port: 9001,
            open: true,
        },
});


// import { defineConfig } from 'vite';
// import { resolve } from 'path';

// const GAME = process.env.GAME;

// if (!GAME) {
//   throw new Error('Missing GAME env variable. Set it in your .env file.');
// }

// export default defineConfig({
//   root: `games/${GAME}`,
//   base: '/',
//   publicDir: resolve(__dirname, 'public'),
//   resolve: {
//     alias: {
//       '@core': resolve(__dirname, 'core'),
//     },
//   },
//   build: {
//     outDir: `../../dist/${GAME}`,
//     emptyOutDir: true,
//     rollupOptions: {
//       input: resolve(__dirname, `games/${GAME}/index.html`),
//     },
//   },
// });
