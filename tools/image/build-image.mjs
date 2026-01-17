import { AssetPack } from '@assetpack/core';
import { cacheBuster } from '@assetpack/core/cache-buster';
import { pixiManifest } from '@assetpack/core/manifest';
import { pixiPipes } from '@assetpack/core/pixi';
import { texturePackerCacheBuster } from '@assetpack/core/texture-packer';
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ensureFolderExists } from '../folderUtils/folderUtils.mjs';

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
ensureFolderExists(outputImagesN)
ensureFolderExists(outputImages)
ensureFolderExists(outputManifest)
const options = {
    jpg: {},
    png: false,
    webp: { quality: 100, alphaQuality: 100, },
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
        pixiPipes({
            cacheBust: false,
            resolutions: { default: 1 },
            texturePacker: {
                texturePacker: {
                    nameStyle: "short",
                    removeFileExtension: true,
                    textureFormat: 'webp'
                },
            },
        }),

        texturePackerCacheBuster(),
        cacheBuster(),
        // compress(options),
        // texturePackerCompress(options),
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
            texturePacker: {
                texturePacker: {
                    nameStyle: "short",
                    removeFileExtension: true,
                    textureFormat: 'webp'
                },
            },
        }),

        texturePackerCacheBuster(),
        cacheBuster(),
        // compress(options),
        // texturePackerCompress(options),

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
    console.log('✅ Built image assets');
}
