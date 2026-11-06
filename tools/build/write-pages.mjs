// `npm run pages` — regenerates the published pages without building anything: the store
// (cachedBuilds/index.html, games/store.json) and every cached build (cachedBuilds/all/index.html),
// publishing each game's games/<id>/icon/icon.png as cachedBuilds/icons/<id>.webp.
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadRegistry, writeIndexPage } from './cache-lib.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const cachedBuildsRoot = resolve(projectRoot, 'cachedBuilds');

await writeIndexPage(cachedBuildsRoot, loadRegistry(resolve(cachedBuildsRoot, 'registry.json')));
console.log('✅ Pages: cachedBuilds/index.html (store), cachedBuilds/all/index.html (every build)');
