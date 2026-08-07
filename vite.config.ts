import dotenv from 'dotenv';
import fs from 'fs';
import { resolve } from 'path';
import { defineConfig, Plugin } from 'vite';

// Load .env file
dotenv.config();

const GAME = process.env.GAME;
// merge1 only ships on YouTube Playables, so unlike the other games it has no
// generic "local" platform entry — default it straight to 'youtube'.
const PLATFORM = process.env.VITE_PLATFORM || (GAME === 'merge1' ? 'youtube' : 'default');

if (!GAME) {
    throw new Error('Please specify the GAME environment variable in your .env file (GAME=game1)');
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

export default defineConfig({
    root: `games/${GAME}`,
    base: './',
    publicDir: resolve(__dirname, 'public'),
    plugins: [injectPlatformApiScript(resolve(__dirname, `games/${GAME}`), PLATFORM)],
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
    server: {
        host: '0.0.0.0',
        port: 9001,
        open: true,
    }
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
