import { AssetPack } from '@assetpack/core';
import { compress } from '@assetpack/core/image';
import { pixiManifest } from '@assetpack/core/manifest';
import { pixiPipes } from '@assetpack/core/pixi';
import { texturePackerCompress } from '@assetpack/core/texture-packer';
import dotenv from 'dotenv';
import fs from 'fs';
import { globSync } from 'glob';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ensureFolderExists } from '../folderUtils/folderUtils.mjs';
import { sanitizeAssetNames } from '../folderUtils/sanitizeAssetNames.mjs';

dotenv.config();

const GAME = process.env.GAME;
const WATCH = process.env.WATCH === 'true';

if (!GAME) {
    console.error('❌ Please specify GAME=game1 in your .env file');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawImages = resolve(__dirname, `../../games/${GAME}/raw-assets/images`);
const rawImagesN = resolve(__dirname, `../../games/${GAME}/raw-assets/non-preload`);

const outputImagesN = resolve(__dirname, `../../public/${GAME}/images/non-preload`);
const outputImages = resolve(__dirname, `../../public/${GAME}/images`);
const outputManifest = resolve(__dirname, `../../games/${GAME}/manifests`);

ensureFolderExists(rawImages)
ensureFolderExists(rawImagesN)
ensureFolderExists(outputManifest)
ensureFolderExists(outputImagesN)
ensureFolderExists(outputImages)

const renamedPreloadImages = sanitizeAssetNames(rawImages, (msg) => console.log(msg));
const renamedNonPreloadImages = sanitizeAssetNames(rawImagesN, (msg) => console.log(msg));
const totalRenamedImages = renamedPreloadImages + renamedNonPreloadImages;
if (totalRenamedImages > 0) {
    console.log(`🧹 Sanitized ${totalRenamedImages} image filename(s) before build`);
}

// ✅ Use 'skip' to delete originals after conversion
const compressOptions = {
    jpg: false,
    png: false,
    webp: { quality: 70, alphaQuality: 100 },
    avif: false,
    bc7: false,
    astc: false,
    basis: false,
    etc: false
};

const pack = new AssetPack({
    entry: rawImages,
    output: outputImages,
    pipes: [
        // ✅ pixiPipes FIRST - it handles the conversion
        pixiPipes({
            cacheBust: false,
            resolutions: { default: 1 },
            formats: [
                { identifier: 'webp', encoder: 'webp' }
            ],
            texturePacker: {
                texturePacker: {
                    nameStyle: "short",
                    removeFileExtension: true,
                    textureFormat: 'webp',
                },
                formats: [
                    { identifier: 'webp', encoder: 'webp' }
                ],
                // ✅ Compress options inside texturePacker
                compression: compressOptions,

            },
            // ✅ Compress options for non-packed images
            compression: compressOptions,
        }),
        // ✅ Then apply compress pipe for any remaining images
        compress(compressOptions),
        texturePackerCompress(compressOptions),
        pixiManifest({
            output: `${outputManifest}/images.json`,
            createShortcuts: false,
            trimExtensions: true,
            includeMetaData: false,
            nameStyle: 'short'
        }),
    ],
});

const packNonPreload = new AssetPack({
    entry: rawImagesN,
    output: outputImagesN,
    pipes: [
        pixiPipes({
            cacheBust: false,
            resolutions: { default: 1 },
            formats: ['webp'],
            texturePacker: {
                formats: ['webp'],
                texturePacker: {
                    nameStyle: "short",
                    removeFileExtension: true,
                },
                compress: compressOptions,
            },
            compress: compressOptions,
        }),
        compress(compressOptions),
    ],
});

if (WATCH) {
    console.log(`👀 Watching image folder for game: ${GAME}`);
    await packNonPreload.run();
    pack.watch(() => {
        console.log('✅ Rebuilt image assets');
    });
} else {
    await pack.run();
    await packNonPreload.run();
    console.log('✅ Built image assets (WebP only)');

    const pngs = globSync(`${outputImages}/**/*.png`);
    pngs.forEach(file => {
        fs.unlinkSync(file);
    });

    console.log(`🧹 Cleaned up ${pngs.length} legacy PNG files.`);
    console.log('✅ Built image assets (WebP only)');
}