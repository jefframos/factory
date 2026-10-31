// shrink-textures.mjs
//
// Caps the textures of published models at `maxTextureSize` pixels (the longer side), so a model pack that embeds
// a big texture in every file (e.g. one 1024x1024 colour-gradient atlas inside each furniture GLB) doesn't make the
// game download it at full size over and over. Runs on the PUBLISHED copies (public/<game>/models) after
// build-models.mjs copies them, so the raw assets stay untouched.
//
// Runs at the end of every model build (`npm run models` / `models:compress`, `watch:models`, `all`; not
// `models:uncompress`), on models imported in the editor, and on its own with `node tools/models/shrink-textures.mjs`.
// Defaults to a 512px cap (only bigger textures change); a game sets its own in
// games/<game>/raw-assets/models-optimize.json, e.g. { "maxTextureSize": 256, "jpegQuality": 85 }, or turns it off
// with { "enabled": false }.
// - .glb: every embedded image larger than the cap is resized (keeping its aspect); an image without alpha is
//   re-encoded as JPEG (`jpegQuality`), one with alpha stays PNG (palette-quantised).
// - Loose .png / .jpg next to .gltf models: resized in place, same format and name (the .gltf points at them).
// Images already within the cap are left as they are.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const DEFAULTS = { maxTextureSize: 512, jpegQuality: 85, fbxToGlb: false, fbxDropAttributes: ['color'] };

/** The game's settings (raw-assets/models-optimize.json over DEFAULTS), or null when it turned compression off. */
export function loadShrinkOptions(gameRoot) {
    const file = path.resolve(gameRoot, 'raw-assets/models-optimize.json');
    if (!fs.existsSync(file)) return { ...DEFAULTS };
    try {
        const options = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (options.enabled === false) return null;
        return { ...DEFAULTS, ...options };
    } catch (e) {
        console.warn('⚠️  Could not read raw-assets/models-optimize.json — using the defaults:', e.message);
        return { ...DEFAULTS };
    }
}

/** Resizes one image buffer to fit `max`; returns { data, mimeType } or null when it's already small enough. */
async function shrinkImage(data, max, jpegQuality, keepFormat) {
    const image = sharp(data);
    const meta = await image.metadata();
    if (!meta.width || !meta.height || Math.max(meta.width, meta.height) <= max) return null;
    const resized = image.resize({ width: max, height: max, fit: 'inside' });
    const format = keepFormat ?? (meta.hasAlpha ? 'png' : 'jpeg');
    if (format === 'jpeg') return { data: await resized.jpeg({ quality: jpegQuality, mozjpeg: true }).toBuffer(), mimeType: 'image/jpeg' };
    if (format === 'webp') return { data: await resized.webp({ quality: jpegQuality }).toBuffer(), mimeType: 'image/webp' };
    return { data: await resized.png({ palette: true, compressionLevel: 9 }).toBuffer(), mimeType: 'image/png' };
}

/** Shrinks the embedded textures of a .glb in place; returns bytes saved. */
export async function shrinkGlb(file, options) {
    const before = fs.statSync(file).size;
    const document = await io.read(file);
    let changed = false;
    for (const texture of document.getRoot().listTextures()) {
        const image = texture.getImage();
        if (!image) continue;
        const shrunk = await shrinkImage(Buffer.from(image), options.maxTextureSize, options.jpegQuality);
        if (!shrunk) continue;
        texture.setImage(new Uint8Array(shrunk.data)).setMimeType(shrunk.mimeType);
        // A file name of the old type would mislead the loader.
        if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.[^.]+$/, shrunk.mimeType === 'image/jpeg' ? '.jpg' : '.png'));
        changed = true;
    }
    if (!changed) return 0;
    await io.write(file, document);
    return before - fs.statSync(file).size;
}

/** Shrinks a loose image file in place (same name and format); returns bytes saved. */
export async function shrinkImageFile(file, options) {
    const ext = path.extname(file).toLowerCase();
    const format = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg';
    const before = fs.statSync(file).size;
    const shrunk = await shrinkImage(fs.readFileSync(file), options.maxTextureSize, options.jpegQuality, format);
    if (!shrunk || shrunk.data.length >= before) return 0;
    fs.writeFileSync(file, shrunk.data);
    return before - shrunk.data.length;
}

/** Every .glb and loose texture under `dir` (the published models), shrunk; logs the total saved. */
export async function shrinkModelsFolder(dir, options) {
    let saved = 0;
    let files = 0;
    const walk = async (folder) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
                continue;
            }
            const ext = path.extname(entry.name).toLowerCase();
            let gain = 0;
            try {
                if (ext === '.glb') gain = await shrinkGlb(full, options);
                else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) gain = await shrinkImageFile(full, options);
            } catch (e) {
                console.warn(`⚠️  Could not shrink ${path.relative(dir, full)}:`, e.message);
            }
            if (gain > 0) {
                saved += gain;
                files++;
            }
        }
    };
    await walk(dir);
    console.log(`🗜️  Textures capped at ${options.maxTextureSize}px: ${files} file(s), ${(saved / 1048576).toFixed(2)} MB saved`);
}

// Run on its own (node tools/models/shrink-textures.mjs): the current game's published models.
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const dotenv = await import('dotenv');
    // .env picks the game, even over a GAME left set in the terminal (dotenv alone never overrides one).
    process.env.GAME = dotenv.config().parsed?.GAME ?? process.env.GAME;
    const game = process.env.GAME || process.env.GAME_NAME;
    const root = path.resolve(path.dirname(thisFile), '../..');
    const options = loadShrinkOptions(path.resolve(root, `games/${game}`));
    if (!options) console.log(`🗜️  Model compression is off for ${game} (raw-assets/models-optimize.json)`);
    else await shrinkModelsFolder(path.resolve(root, `public/${game}/models`), options);
}
