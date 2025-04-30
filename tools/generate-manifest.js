import { readdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const GAME = process.env.GAME;

console.log('GAME')
console.log('GAME', GAME)
if (!GAME) {
    console.error('❌ Please specify GAME=game1');
    process.exit(1);
}

const publicPath = resolve(__dirname, `../public/${GAME}`);
const publicImages = resolve(publicPath, 'images');
const publicAudio = resolve(publicPath, 'audio');
const publicFonts = resolve(publicPath, 'fonts');

function createBundle(folderPath, folderName) {
    if (!readdirSync(folderPath).length) return null;

    const files = readdirSync(folderPath);
    const assets = [];

    files.forEach(file => {
        const name = file.split('.')[0];
        assets.push({
            name,
            srcs: `${folderName}/${file}`
        });
    });

    return {
        name: folderName,
        assets
    };
}

function generateManifest() {
    const bundles = [
        createBundle(publicImages, 'images'),
        createBundle(publicAudio, 'audio'),
        createBundle(publicFonts, 'fonts'),
    ].filter(Boolean); // remove nulls if no assets

    const manifest = {
        bundles
    };

    const manifestPath = resolve(publicPath, 'manifest.json');
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✅ Manifest generated at public/${GAME}/manifest.json`);
}

generateManifest();
