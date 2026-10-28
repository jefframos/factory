// dig-import-models.mjs
//
// Imports Dig & Discover's mine models from the shared 3D library (KayKit Block Bits for the voxel
// blocks, KayKit Resource Bits for nuggets/gems, artifacts and hub stations from other packs) as self-contained .glb files into
// games/dig/raw-assets/models/mine{m}/<slug>.glb. Run `GAME=dig npm run models` afterwards to publish.
// Idempotent: existing files are skipped unless --force.
//
//   node scripts/dig-import-models.mjs [--force]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY = 'D:/projects/PIXI3d/library3d';
const OUT = path.join(ROOT, 'games', 'dig', 'raw-assets', 'models', 'mine{m}');
const FORCE = process.argv.includes('--force');

/** [collectionId, asset name] in KayKit Bits Bundle 2, or [packId, collectionId, asset name] for other packs. */
const PICKS = [
    ['block', 'Dirt'], ['block', 'Gravel'], ['block', 'Stone'], ['block', 'Stone Dark'],
    ['block', 'Stone With Copper'], ['block', 'Stone With Silver'], ['block', 'Stone With Gold'],
    ['block', 'Metal'], ['block', 'Sand A'], ['block', 'Bricks A'], ['block', 'Lava'], ['block', 'Chest'],
    ['resource', 'Copper Nugget Small'], ['resource', 'Silver Nugget Small'], ['resource', 'Gold Nugget Small'],
    ['resource', 'Gem Small'], ['resource', 'Gem Medium'], ['resource', 'Gem Large'], ['resource', 'Stone Chunks Small'],
    ['resource', 'Gems Pile Large'], ['resource', 'Gold Nuggets'], ['resource', 'Copper Nuggets'],
    ['resource', 'Gems Chest'], ['resource', 'Stone Brick'], ['resource', 'Gold Bars'],
    ['kaykit-bits-1', 'halloween', 'Bone A'], ['kaykit-bits-1', 'halloween', 'Skull'], ['kaykit-bits-1', 'halloween', 'Skull Candle'],
    ['block', 'Dynamite'], ['block', 'Vault'], ['rpg-tools', 'Lantern'], ['rpg-tools', 'Map Rolled'], ['rpg-tools', 'Journal Closed'], ['rpg-tools', 'Anvil'],
    ['mixed-bag-1', 'mixed-bag-1', 'Idol A'], ['mixed-bag-1', 'mixed-bag-1', 'Idol B'], ['mixed-bag-1', 'mixed-bag-1', 'Comicbook A'],
    // Hub stations
    ['casino-glb', 'casino-assets-glb', 'ATM 01'], ['cute-furniture-glb', 'cute-furniture-glb', 'Closet 01'],
];

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const index = JSON.parse(fs.readFileSync(path.join(LIBRARY, 'library', 'index.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(OUT, { recursive: true });

let imported = 0;
for (const pick of PICKS) {
    const [pack, collection, name] = pick.length === 3 ? pick : ['kaykit-bits-2', ...pick];
    const asset = index.assets.find((entry) => entry.packId === pack && entry.collectionId === collection && entry.name === name);
    const source = asset?.formats.glb ?? asset?.formats.gltf;
    if (!source) {
        console.warn(`⚠️  ${collection} "${name}" not found`);
        continue;
    }
    const target = path.join(OUT, `${slug(name)}.glb`);
    if (fs.existsSync(target) && !FORCE) continue;
    const document = await io.read(path.join(LIBRARY, 'files', source));
    fs.writeFileSync(target, await io.writeBinary(document));
    console.log(`mine{m}/${slug(name)}.glb`);
    imported++;
}
console.log(`✅ ${imported} model(s) imported into ${path.relative(ROOT, OUT)}`);
