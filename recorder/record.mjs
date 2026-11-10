#!/usr/bin/env node
// record.mjs
//
// `npm run record`: the project's game, served by its own Vite config on another port (9300 by default, so the normal
// dev server can run too), with the recorder around it (http://localhost:<port>/__recorder/).
//
// Run it from a project's root (it uses that project's vite and vite.config):
//   node <path to>/recorder/record.mjs [--port 9300] [--config vite.config.ts] [--out recordings] [--no-open]

import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { recorderPlugin } from './lib/plugin.mjs';
import { ffmpegPath } from './lib/ffmpeg.mjs';

const argv = process.argv.slice(2);
const option = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};
const cwd = process.cwd();
const port = Number(option('port', process.env.RECORD_PORT ?? 9300));
const outDir = path.resolve(cwd, option('out', 'recordings'));
const configFile = option('config', undefined);

try {
    console.log(`🎞  ffmpeg: ${ffmpegPath(cwd)}`);
} catch (error) {
    console.warn(`⚠️  ${error.message} Recording works; exporting needs it.`);
}

let vite;
try {
    const require = createRequire(path.join(cwd, 'package.json'));
    const module = await import(pathToFileURL(require.resolve('vite')).href);
    // Its CommonJS entry comes in as the default export.
    vite = module.createServer ? module : module.default;
} catch {
    console.error('The recorder runs a project\'s game through its own Vite: no vite found in this folder. Run it from the project\'s root.');
    process.exit(1);
}

const server = await vite.createServer({
    configFile: configFile ? path.resolve(cwd, configFile) : undefined,
    plugins: [recorderPlugin({ outDir, cwd })],
    server: { port, strictPort: false, open: argv.includes('--no-open') ? false : '/__recorder/' },
});
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
const url = `${base.replace(/\/$/, '')}/__recorder/`;
console.log(`\n🎬 Recorder: ${url}\n   Recordings: ${outDir}\n`);
if (!fs.existsSync(path.join(cwd, '.gitignore')) || !fs.readFileSync(path.join(cwd, '.gitignore'), 'utf8').includes(path.basename(outDir))) {
    console.log(`   (Add ${path.relative(cwd, outDir)}/ to .gitignore: videos are big.)\n`);
}
