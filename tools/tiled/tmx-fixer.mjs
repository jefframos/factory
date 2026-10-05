// Names every typed shape object in the current game's Tiled maps after its "type"/"id" custom
// properties, so they're easy to find in Tiled's Objects panel (which lists objects by name):
//
//   type=storage   id=storage1          -> "storage: storage1"
//   type=dropper   target=stall1        -> "dropper → stall1"     (no id: its target instead)
//   type=polyWall                       -> "polyWall"
//
//   npm run tmx-fixer                    # every .tmx in games/<GAME>/tiled/ (GAME from .env)
//   npm run tmx-fixer -- testMap1.tmx    # only these maps
//   npm run tmx-fixer -- --dry           # only list what would change
//   npm run tmx-fixer -- --force         # also overwrite names you typed yourself
//
// Left alone: image objects (tile objects, i.e. with a gid), objects with no "type" property,
// and — unless --force — a name that doesn't start with the object's type (a hand-written one).
// A name this script wrote before always starts with the type, so re-running keeps names in step
// when an id/target changes.
//
// Close the map in Tiled first (or reload it after), or Tiled will overwrite the change on save.
// The game never reads object names, so there's nothing to re-export afterwards.
import dotenv from 'dotenv';
import fs from 'fs';
import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const force = args.includes('--force');
const onlyMaps = args.filter(arg => !arg.startsWith('--')).map(arg => path.basename(arg).toLowerCase());
const game = process.env.GAME || process.env.GAME_NAME;
if (!game) {
    console.error('❌ Please specify GAME=<name> in your .env file');
    process.exit(1);
}

const repoRoot = resolve(__dirname, '../..');
const tiledDir = resolve(repoRoot, `games/${game}/tiled`);
if (!fs.existsSync(tiledDir)) {
    console.error(`❌ No tiled folder at ${tiledDir}`);
    process.exit(1);
}

const maps = fs.readdirSync(tiledDir)
    .filter(name => /\.tmx$/i.test(name))
    .filter(name => onlyMaps.length === 0 || onlyMaps.includes(name.toLowerCase()));
if (maps.length === 0) {
    console.error(`❌ No matching .tmx files in ${tiledDir}`);
    process.exit(1);
}

/** Attribute value (still XML-escaped, as written in the file) of `attr` in a tag's text, or undefined. */
function attribute(tag, attr) {
    return tag.match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1];
}

/** `<property name="..." value="..."/>` values directly inside an object's body, by name. */
function readProperties(body) {
    const props = new Map();
    for (const match of body.matchAll(/<property\b[^>]*>/g)) {
        const name = attribute(match[0], 'name');
        const value = attribute(match[0], 'value');
        if (name !== undefined && value !== undefined) {
            props.set(name, value);
        }
    }
    return props;
}

function nameFor(props) {
    const type = props.get('type');
    const id = props.get('id');
    const target = props.get('target');
    if (id) {
        return `${type}: ${id}`;
    }
    if (target) {
        return `${type} → ${target}`;
    }
    return type;
}

let totalChanged = 0;
let totalKept = 0;
for (const map of maps) {
    const file = path.join(tiledDir, map);
    const xml = fs.readFileSync(file, 'utf8');
    let out = '';
    let cursor = 0;
    let changed = 0;
    const kept = [];

    for (const match of xml.matchAll(/<object\b[^>]*>/g)) {
        const tag = match[0];
        const tagStart = match.index;
        const tagEnd = tagStart + tag.length;
        // Self-closing = no properties, so no type. Image (tile) objects carry a gid.
        if (tag.endsWith('/>') || attribute(tag, 'gid') !== undefined) {
            continue;
        }
        const close = xml.indexOf('</object>', tagEnd);
        if (close === -1) {
            continue;
        }
        const props = readProperties(xml.slice(tagEnd, close));
        const type = props.get('type');
        if (!type) {
            continue;
        }

        const wanted = nameFor(props);
        const current = attribute(tag, 'name');
        if (current === wanted) {
            continue;
        }
        const objectId = attribute(tag, 'id');
        if (current && !current.startsWith(type) && !force) {
            kept.push(`#${objectId} "${current}" (would be "${wanted}")`);
            continue;
        }

        const newTag = current !== undefined
            ? tag.replace(/\sname="[^"]*"/, ` name="${wanted}"`)
            : tag.replace(/(\sid="[^"]*")/, `$1 name="${wanted}"`);
        out += xml.slice(cursor, tagStart) + newTag;
        cursor = tagEnd;
        changed++;
        console.log(`${dryRun ? '•' : '✏️ '} ${map} #${objectId}: ${current ? `"${current}" → ` : ''}"${wanted}"`);
    }
    out += xml.slice(cursor);

    if (changed > 0 && !dryRun) {
        fs.writeFileSync(file, out);
    }
    if (kept.length > 0) {
        console.log(`⚠️  ${map}: kept ${kept.length} hand-written name(s) — --force to overwrite: ${kept.join(', ')}`);
    }
    console.log(`🗺️  ${map}: ${changed} object(s) ${dryRun ? 'would be' : ''} renamed`);
    totalChanged += changed;
    totalKept += kept.length;
}

console.log('');
if (totalChanged === 0) {
    console.log(`✨ Nothing to rename${totalKept > 0 ? ` (${totalKept} hand-written name(s) kept)` : ''}.`);
} else if (dryRun) {
    console.log(`Dry run — ${totalChanged} object(s) would be renamed. Run without --dry to write.`);
} else {
    console.log(`✅ Renamed ${totalChanged} object(s). Reload the map in Tiled if it's open.`);
}
