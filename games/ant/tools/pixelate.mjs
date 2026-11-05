// pixelate.mjs — turns pictures into Ant levels from the command line (the level editor does the same: web/server.mjs).
//
//   npm run ant:pixelate              every picture in games/ant/raw-assets/pictures
//   npm run ant:pixelate -- mushroom  just that one (file name without extension)
//
// Each picture (.png / .jpg / .webp / .svg) goes through pixelate-lib.mjs with its settings from
// raw-assets/pictures/pictures.json, e.g.
//
//   { "mushroom": { "name": "Mushroom", "width": 22, "height": 22, "colors": 5, "palette": "cozy", "background": "auto" } }
//
// (defaults: pixelate-lib's DEFAULT_SETTINGS). The level goes to games/ant/levels/<name>.json with a big preview
// (levels/previews/<name>.png). levels/index.json is the play order: a new picture is added at the end.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pixelate } from './pixelate-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PICTURES = path.join(root, 'raw-assets/pictures');
const LEVELS = path.join(root, 'levels');
const PREVIEWS = path.join(LEVELS, 'previews');

const settings = fs.existsSync(path.join(PICTURES, 'pictures.json')) ? JSON.parse(fs.readFileSync(path.join(PICTURES, 'pictures.json'), 'utf8')) : {};
const only = process.argv[2];
const files = fs.readdirSync(PICTURES).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f) && (!only || path.parse(f).name === only));
if (!files.length) {
    console.error(only ? `No picture named ${only} in ${PICTURES}` : `No pictures in ${PICTURES}`);
    process.exit(1);
}
fs.mkdirSync(PREVIEWS, { recursive: true });
const index = fs.existsSync(path.join(LEVELS, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(LEVELS, 'index.json'), 'utf8')) : { levels: [] };

for (const file of files) {
    const id = path.parse(file).name;
    const { level, preview, pixels } = await pixelate(path.join(PICTURES, file), id, settings[id] ?? {});
    fs.writeFileSync(path.join(LEVELS, `${id}.json`), `${JSON.stringify(level, null, 2)}\n`);
    fs.writeFileSync(path.join(PREVIEWS, `${id}.png`), preview);
    if (!index.levels.includes(id)) index.levels.push(id);
    console.log(`🐜 ${id}: ${level.width}x${level.height}, ${pixels} pixels, ${level.palette.length} colours ${level.palette.join(' ')}`);
}
fs.writeFileSync(path.join(LEVELS, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`📋 levels/index.json: ${index.levels.join(', ')}`);
