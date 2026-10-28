// bandit-import-decor.mjs
//
// Imports level-dressing models for Bandit Controller from the shared 3D library (see
// scripts/bandit-decor-picks.json). Every pick is re-written as one self-contained .glb with its
// textures downscaled to MAX_TEXTURE px (some library models ship 2048px textures and weigh 9 MB),
// into raw-assets/models/heist{m}/decor/<pack>/<slug>.glb. Run `npm run models` afterwards to
// publish them. Idempotent: existing outputs are skipped unless --force.
//
//   node scripts/bandit-import-decor.mjs [--force] [--dry]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PICKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'bandit-decor-picks.json'), 'utf8'));
const OUT = path.join(ROOT, 'games', 'bandit-controller', 'raw-assets', 'models', 'heist{m}', 'decor');
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');
const MAX_TEXTURE = 512;

/** Short folder per pack so prop paths stay readable in level files. */
const PACK_FOLDER = {
    'casino-glb': 'casino',
    'cute-furniture-glb': 'cute',
    'kaykit-bits-1': 'kaykit',
    'kaykit-bits-2': 'kaykit',
    'kenney-castle-kit': 'castle',
    'mixed-bag-1': 'mixed',
};

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const library = PICKS.library;
const index = JSON.parse(fs.readFileSync(path.join(library, 'library', 'index.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function shrinkTextures(document) {
    for (const texture of document.getRoot().listTextures()) {
        const image = texture.getImage();
        if (!image) {
            continue;
        }
        const meta = await sharp(image).metadata();
        if ((meta.width ?? 0) <= MAX_TEXTURE && (meta.height ?? 0) <= MAX_TEXTURE) {
            continue;
        }
        const resized = await sharp(image)
            .resize(MAX_TEXTURE, MAX_TEXTURE, { fit: 'inside' })
            .png({ compressionLevel: 9, palette: true })
            .toBuffer();
        texture.setImage(new Uint8Array(resized)).setMimeType('image/png');
    }
}

const seen = new Set();
let imported = 0;
for (const [theme, picks] of Object.entries(PICKS.themes)) {
    for (const [packId, name, collectionId] of picks) {
        const asset = index.assets.find((entry) => entry.packId === packId
            && entry.name === name
            && (!collectionId || entry.collectionId === collectionId)
            && (!entry.kind || entry.kind === 'model')
            && !/demo|characters/.test(entry.collectionId ?? ''));
        const source = asset?.formats.glb ?? asset?.formats.gltf;
        if (!source) {
            console.warn(`⚠️  ${theme}: ${packId} "${name}" not found in the library`);
            continue;
        }
        const folder = PACK_FOLDER[packId] ?? slug(packId);
        const target = path.join(OUT, folder, `${slug(name)}.glb`);
        if (seen.has(target)) {
            continue;
        }
        seen.add(target);
        if (fs.existsSync(target) && !FORCE) {
            continue;
        }
        const document = await io.read(path.join(library, 'files', source));
        await shrinkTextures(document);
        const glb = await io.writeBinary(document);
        console.log(`${theme.padEnd(9)} ${path.relative(OUT, target).padEnd(46)} ${(glb.length / 1024).toFixed(0)} KB`);
        if (!DRY) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, glb);
        }
        imported++;
    }
}
console.log(`✅ ${imported} model(s) ${DRY ? 'would be ' : ''}imported into ${path.relative(ROOT, OUT)}`);
