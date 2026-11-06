// pixelate.mjs — turns pictures into Ant levels from the command line (the level editor does the same: web/server.mjs).
//
//   npm run ant:pixelate              every level in raw-assets/pictures/pictures.json + every picture there
//   npm run ant:pixelate -- mushroom  just that one
//
// Each level goes through pixelate-lib.mjs's buildLevel with its settings from raw-assets/pictures/pictures.json, e.g.
//
//   { "mushroom": { "name": "Mushroom", "width": 22, "height": 22, "colors": 5, "palette": "master", "saturation": 1,
//                   "offsetX": 0, "offsetY": 1, "edits": { "10,3": "." } } }
//
// (defaults: DEFAULT_SETTINGS), its picture (raw-assets/pictures/<id>.png|jpg|webp|svg — none for a level drawn by
// hand) and the master palette (raw-assets/pictures/palette.json). The level goes to games/ant/levels/<id>.json with a
// big preview (levels/previews/<id>.png). levels/index.json is the play order: a new level is added at the end.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildLevel } from './pixelate-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PICTURES = path.join(root, 'raw-assets/pictures');
const LEVELS = path.join(root, 'levels');
const PREVIEWS = path.join(LEVELS, 'previews');
const IMAGE = /\.(png|jpe?g|webp|svg)$/i;

const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
const settings = readJson(path.join(PICTURES, 'pictures.json'), {});
const master = readJson(path.join(PICTURES, 'palette.json'), { colors: [] }).colors;
const pictures = new Map(fs.readdirSync(PICTURES).filter((f) => IMAGE.test(f)).map((f) => [path.parse(f).name, f]));
const only = process.argv[2];
const ids = [...new Set([...Object.keys(settings), ...pictures.keys()])].filter((id) => !only || id === only);
if (!ids.length) {
    console.error(only ? `No level or picture named ${only} in ${PICTURES}` : `No pictures in ${PICTURES}`);
    process.exit(1);
}
fs.mkdirSync(PREVIEWS, { recursive: true });
const index = readJson(path.join(LEVELS, 'index.json'), { levels: [] });

for (const id of ids) {
    const file = pictures.has(id) ? path.join(PICTURES, pictures.get(id)) : null;
    // Its place in the play order sets its difficulty goal (a new level goes last).
    const order = index.levels.includes(id) ? index.levels.indexOf(id) : index.levels.length;
    const { level, preview, pixels } = await buildLevel(file, id, { ...settings[id], order }, master);
    fs.writeFileSync(path.join(LEVELS, `${id}.json`), `${JSON.stringify(level, null, 2)}\n`);
    fs.writeFileSync(path.join(PREVIEWS, `${id}.png`), preview);
    if (!index.levels.includes(id)) index.levels.push(id);
    console.log(`🐜 ${id}: ${level.width}x${level.height}, ${pixels} pixels, ${level.palette.length} colours ${level.palette.join(' ')}`);
}
fs.writeFileSync(path.join(LEVELS, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`📋 levels/index.json: ${index.levels.join(', ')}`);
