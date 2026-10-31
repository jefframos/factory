import { AssetPack } from '@assetpack/core';
import { pixiManifest } from '@assetpack/core/manifest';
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ensureFolderExists } from '../folderUtils/folderUtils.mjs';
import font from '../pack/font.mjs';

// .env picks the game, even over a GAME left set in the terminal (dotenv alone never overrides one).
process.env.GAME = dotenv.config().parsed?.GAME ?? process.env.GAME;

const GAME = process.env.GAME;
const WATCH = process.env.WATCH === 'true';

if (!GAME) {
    console.error('❌ Please specify GAME=game1 in your .env file');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawFonts = resolve(__dirname, `../../games/${GAME}/raw-assets/fonts`);
const outputFonts = resolve(__dirname, `../../public/${GAME}/fonts`);
const outputManifest = resolve(__dirname, `../../games/${GAME}/manifests`);

ensureFolderExists(rawFonts);

const pack = new AssetPack({
    entry: rawFonts,
    output: outputFonts,
    pipes: [
        font.pipes[0],
        pixiManifest({
            output: `${outputManifest}/fonts.json`,
            createShortcuts: false,
            trimExtensions: true,
            includeMetaData: false,
        }),
    ]
});

if (WATCH) {
    console.log(`👀 Watching font folder for game: ${GAME}`);
    pack.watch(() => {
        console.log('✅ Rebuilt font assets');
    });
} else {
    await pack.run();
    console.log('✅ Built font assets');
}
