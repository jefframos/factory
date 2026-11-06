// `npm run store` — the published site, locally: regenerates the pages (`npm run pages`), then serves
// cachedBuilds/ the way GitHub Pages does (folder URLs -> their index.html) and opens the store.
// `npm run store -- --port 9100` picks the port, `--no-open` skips the browser.
import { exec } from 'child_process';
import fs from 'fs';
import http from 'http';
import { dirname, extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { loadRegistry, writeIndexPage } from './cache-lib.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const root = resolve(projectRoot, 'cachedBuilds');
const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg >= 0 ? Number(args[portArg + 1]) : 9002;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.fbx': 'application/octet-stream',
    '.wasm': 'application/wasm',
    '.txt': 'text/plain; charset=utf-8',
};

await writeIndexPage(root, loadRegistry(resolve(root, 'registry.json')));

const server = http.createServer((request, response) => {
    let path;
    try {
        path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
        response.writeHead(400).end('Bad request');
        return;
    }
    let file = resolve(root, '.' + path);
    // Nothing outside cachedBuilds/.
    if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        // Like Pages: /all -> /all/ (so relative links resolve), then its index.html.
        if (!path.endsWith('/')) {
            response.writeHead(301, { Location: path + '/' }).end();
            return;
        }
        file = resolve(file, 'index.html');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain' }).end(`Not found: ${path}`);
        return;
    }
    response.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(response);
});

server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `❌ Port ${port} is busy — try \`npm run store -- --port ${port + 1}\`` : error);
    process.exit(1);
});

server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    console.log(`🏪 Store: ${url}   (every build: ${url}all/)   Ctrl+C to stop`);
    if (!args.includes('--no-open')) {
        const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
        exec(open);
    }
});
