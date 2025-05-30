import { AssetPack } from '@assetpack/core';
import { pixiManifest } from '@assetpack/core/manifest';
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import json from '../pack/json.mjs';

dotenv.config();

const GAME = process.env.GAME;

if (!GAME) {
    console.error('❌ Please specify GAME=game1 in your .env file');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawJson = resolve(__dirname, `../../games/${GAME}/raw-assets/json`);
const outputJson = resolve(__dirname, `../../public/${GAME}/json`);
const outputManifest = resolve(__dirname, `../../games/${GAME}/manifests`);

const pack = new AssetPack({
    entry: rawJson,
    output: outputJson,
    pipes: [
        json.pipes[0],
        pixiManifest({
            output: `${outputManifest}/json.json`,
            createShortcuts: false,
            trimExtensions: false,
            includeMetaData: false,
        }),
    ]
});

console.log(`👀 Watching ${rawJson} for changes...`);

pack.watch(() => {
    console.log('✅ Rebuilt JSON assets');
});
