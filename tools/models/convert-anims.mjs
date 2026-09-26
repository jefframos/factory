// Converts animation-only FBX files (e.g. Mixamo "Without Skin" downloads) in the
// current game's raw-assets/models folder into small animation-only GLBs, replacing
// the FBX, then refreshes public/ and the models registry.
//
//   npm run anims            # current GAME from .env
//   npm run anims -- --keep  # keep the FBX next to its GLB
//
// FBX files that contain a mesh (a character model) are left untouched.
import dotenv from 'dotenv';
import fs from 'fs';
import path, { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { convertFbxAnimationToGlb } from './fbx-anim-to-glb.mjs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const keepSource = args.includes('--keep');
const game = process.env.GAME || process.env.GAME_NAME;
const targets = args.filter((a) => !a.startsWith('--'));
if (targets.length === 0) targets.push(resolve(__dirname, `../../games/${game}/raw-assets/models`));

function collectFbx(target) {
    if (!fs.existsSync(target)) {
        console.warn(`⚠️  Not found: ${target}`);
        return [];
    }
    if (fs.statSync(target).isFile()) {
        return target.toLowerCase().endsWith('.fbx') ? [target] : [];
    }
    return fs.readdirSync(target, { withFileTypes: true }).flatMap((item) => collectFbx(path.join(target, item.name)));
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)}K`;
let converted = 0;

console.log(`🎞️  Converting animations in: ${targets.join(', ')}`);

for (const file of targets.flatMap(collectFbx)) {
    const source = fs.readFileSync(file);
    let glb;
    try {
        glb = await convertFbxAnimationToGlb(source);
    } catch (e) {
        console.warn(`⚠️  ${path.basename(file)}: ${e.message}`);
        continue;
    }
    if (!glb) continue; // has a mesh — a character model, not an animation

    const glbPath = file.replace(/\.fbx$/i, '.glb');
    fs.writeFileSync(glbPath, glb);
    if (!keepSource) fs.unlinkSync(file);
    converted++;
    console.log(`✅ ${path.basename(file)} ${kb(source.length)} -> ${path.basename(glbPath)} ${kb(glb.length)}`);
}

if (converted === 0) console.log('Nothing to convert.');

// Only for the default (whole game) run: sync public/ + modelsRegistry.ts.
if (args.every((a) => a.startsWith('--'))) await import('./build-models.mjs');
