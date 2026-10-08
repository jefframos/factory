// Writes Tiled custom ENUM property types into games/<GAME>/tiled/world.tiled-project from the
// web editor's Store View data, so a floor/wall/door's "style" (and a wall's "setup") is a
// dropdown in Tiled instead of free text:
//
//   floorStyle  <- web/data/storeFloors.json      (FLOOR_CHECKER_BY_ID ids)
//   wallStyle   <- web/data/storeWalls.json       (WALL_STYLE_BY_ID ids)
//   doorStyle   <- web/data/storeDoors.json       (DOOR_STYLE_BY_ID ids, e.g. "glass")
//   wallSetup   <- web/data/storeWallSetups.json  (WALL_SETUP_BY_ID ids)
//   fenceStyle  <- web/data/storeFences.json      (FENCE_STYLE_BY_ID ids)
//
//   npm run tiled-types
//
// In Tiled: select the object, Add Property, name it "style" (or "setup" on a wall) and pick the
// matching type from the list. Leave it off to use the default. Re-run after adding a style in
// the editor, then reopen the project in Tiled. Other property types in the project are kept.
import dotenv from 'dotenv';
import fs from 'fs';
import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const game = process.env.GAME || process.env.GAME_NAME;
if (!game) {
    console.error('❌ Please specify GAME=<name> in your .env file');
    process.exit(1);
}

const gameDir = resolve(__dirname, `../../games/${game}`);
const projectFile = path.join(gameDir, 'tiled', 'world.tiled-project');
const dataDir = path.join(gameDir, 'web', 'data');

const SOURCES = [
    { name: 'floorStyle', file: 'storeFloors.json' },
    { name: 'wallStyle', file: 'storeWalls.json' },
    { name: 'doorStyle', file: 'storeDoors.json' },
    { name: 'wallSetup', file: 'storeWallSetups.json' },
    { name: 'fenceStyle', file: 'storeFences.json' },
];

if (!fs.existsSync(projectFile)) {
    console.error(`❌ No Tiled project at ${projectFile}`);
    process.exit(1);
}

const raw = fs.readFileSync(projectFile, 'utf8');
const project = JSON.parse(raw);
const types = Array.isArray(project.propertyTypes) ? project.propertyTypes : [];
let nextId = types.reduce((max, type) => Math.max(max, type.id ?? 0), 0) + 1;

for (const source of SOURCES) {
    const file = path.join(dataDir, source.file);
    if (!fs.existsSync(file)) {
        console.warn(`⚠️  ${source.file} not found — skipping ${source.name}`);
        continue;
    }
    // Only the named (byId) entries — no property at all means the default.
    const ids = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).byId ?? {}).sort();
    const existing = types.find(type => type.name === source.name);
    const entry = {
        id: existing?.id ?? nextId++,
        name: source.name,
        type: 'enum',
        storageType: 'string',
        values: ids,
        valuesAsFlags: false,
    };
    if (existing) {
        Object.assign(existing, entry);
    } else {
        types.push(entry);
    }
    console.log(`🎨 ${source.name}: ${ids.length ? ids.join(', ') : '(no named styles yet — only the default)'}`);
}

project.propertyTypes = types;
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = JSON.stringify(project, null, 4) + '\n';
if (eol === '\r\n') {
    text = text.replace(/\r?\n/g, '\r\n');
}
fs.writeFileSync(projectFile, text);
console.log(`✅ Wrote ${types.length} property type(s) to ${path.relative(process.cwd(), projectFile)} — reopen the project in Tiled to see them.`);
