// Deletes images in the current game's tiled/models folder that no Tiled map uses — the folder
// fills up with ModelSnapshotTool exports that never made it into a tileset.
//
//   npm run clean-tmx            # current GAME from .env — deletes unused images
//   npm run clean-tmx -- --dry   # only list what would be deleted
//
// "Used" = referenced by an <image source="..."> in ANY .tmx/.tsx in games/<GAME>/tiled/ (so an
// older map like testMap1Old.tmx never loses its images). A file git doesn't track can't be
// restored after deleting, so those are called out in the summary.
import dotenv from 'dotenv';
import fs from 'fs';
import path, { dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry');
const game = process.env.GAME || process.env.GAME_NAME;
if (!game) {
    console.error('❌ Please specify GAME=<name> in your .env file');
    process.exit(1);
}

const repoRoot = resolve(__dirname, '../..');
const tiledDir = resolve(repoRoot, `games/${game}/tiled`);
const modelsDir = resolve(tiledDir, 'models');
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

if (!fs.existsSync(modelsDir)) {
    console.error(`❌ No models folder at ${modelsDir}`);
    process.exit(1);
}

const maps = fs.readdirSync(tiledDir).filter(name => /\.(tmx|tsx)$/i.test(name));
if (maps.length === 0) {
    console.error(`❌ No .tmx/.tsx files in ${tiledDir} — refusing to delete anything`);
    process.exit(1);
}

const referenced = new Set();
for (const map of maps) {
    const xml = fs.readFileSync(path.join(tiledDir, map), 'utf8');
    let count = 0;
    for (const match of xml.matchAll(/<image\b[^>]*\bsource="([^"]+)"/g)) {
        referenced.add(path.normalize(resolve(tiledDir, decodeURIComponent(match[1]))).toLowerCase());
        count++;
    }
    console.log(`🗺️  ${map}: ${count} image reference(s)`);
}

const images = fs.readdirSync(modelsDir).filter(name => IMAGE_EXT.test(name));
const unused = images.filter(name => !referenced.has(path.normalize(path.join(modelsDir, name)).toLowerCase()));

// Files git doesn't know about can't be restored once deleted — flag them.
let tracked = null;
try {
    const out = execSync(`git ls-files -- "${path.relative(repoRoot, modelsDir).split(path.sep).join('/')}"`, { cwd: repoRoot, encoding: 'utf8' });
    tracked = new Set(out.split('\n').filter(Boolean).map(file => path.basename(file).toLowerCase()));
} catch {
    // Not a git checkout — just skip the warning.
}

const kb = bytes => `${(bytes / 1024).toFixed(0)}K`;
let freed = 0;
const untracked = [];
for (const name of unused) {
    const file = path.join(modelsDir, name);
    freed += fs.statSync(file).size;
    if (tracked && !tracked.has(name.toLowerCase())) {
        untracked.push(name);
    }
    if (!dryRun) {
        fs.unlinkSync(file);
    }
    console.log(`${dryRun ? '•' : '🗑️ '} ${name}`);
}

console.log('');
console.log(`${images.length} image(s) in tiled/models, ${images.length - unused.length} used, ${unused.length} unused (${kb(freed)}).`);
if (untracked.length > 0) {
    console.log(`⚠️  ${untracked.length} of those ${dryRun ? 'are' : 'were'} not in git — ${dryRun ? 'deleting them can\'t be undone' : 'they can\'t be restored'}: ${untracked.join(', ')}`);
}
if (unused.length === 0) {
    console.log('✨ Nothing to clean.');
} else if (dryRun) {
    console.log('Dry run — nothing deleted. Run without --dry to delete.');
} else {
    console.log('✅ Deleted. Tracked files can be restored with git if needed.');
}
