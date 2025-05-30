import { AssetPack } from '@assetpack/core';
import { pixiManifest } from '@assetpack/core/manifest';
import { pixiPipes } from '@assetpack/core/pixi';
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

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
const outputImages = resolve(__dirname, `../../public/${GAME}/images`);
const outputManifest = resolve(__dirname, `../../games/${GAME}/manifests`);

const pack = new AssetPack({
    entry: rawImages,
    output: outputImages,
    pipes: [
        pixiManifest({
            output: `${outputManifest}/images.json`,
            createShortcuts: false,
            trimExtensions: true,
            includeMetaData: false,
            nameStyle: 'short'
        }),
        pixiPipes({
            manifest: { trimExtensions: true },
            cacheBust: true,
            resolutions: { default: 1 },
            compression: { jpg: true, png: true, webp: true },
            texturePacker: {
                nameStyle: "short",
                texturePacker: { removeFileExtension: true }
            }
        }),
    ]
});

if (WATCH) {
    console.log(`👀 Watching image folder for game: ${GAME}`);
    pack.watch(() => {
        console.log('✅ Rebuilt image assets');
    });
} else {
    await pack.run();
    console.log('✅ Built image assets');
}
