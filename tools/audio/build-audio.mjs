import { AssetPack } from '@assetpack/core';
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import audio from '../pack/audio.mjs';

dotenv.config();

const GAME = process.env.GAME;
const WATCH = process.env.WATCH === 'true';

if (!GAME) {
    console.error('❌ Please specify GAME=game1 in your .env file');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawAudio = resolve(__dirname, `../../games/${GAME}/raw-assets/audio`);
const outputAudio = resolve(__dirname, `../../public/${GAME}/audio`);

const pack = new AssetPack({
    entry: rawAudio,
    output: outputAudio,
    pipes: [
        audio.pipes[0]
    ]
});

if (WATCH) {
    console.log(`👀 Watching audio folder for game: ${GAME}`);
    pack.watch(() => {
        console.log('✅ Rebuilt audio assets');
    });
} else {
    await pack.run();
    console.log('✅ Built audio assets');
}
