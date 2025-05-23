
import { AssetPack } from '@assetpack/core';

import { resolve } from 'path';

import { pixiManifest } from '@assetpack/core/manifest';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import audio from './pack/audio.mjs';
import font from './pack/font.mjs';
import json from './pack/json.mjs';
import manifest from './pack/manifest.mjs';

const GAME = process.env.GAME;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawJson = resolve(__dirname, `../games/${GAME}/raw-assets/json`);
const outputJson = resolve(__dirname, `../public/${GAME}/json`);
const outputManifest = resolve(__dirname, `../games/${GAME}/manifests`);

if (!GAME) {
    console.error('❌ Please specify GAME=game1');
    process.exit(1);
}

async function buildAllAssets() {
    const pipes = [];
    pipes.push(font.pipes[0]);
    pipes.push(json.pipes[0]);
    pipes.push(audio.pipes[0]);
    pipes.push(manifest.pipes[0]);

    const fontPack = new AssetPack({
        entry: rawJson,
        output: outputJson,
        // pipes: pipes
        pipes: [
            json.pipes[0],
            pixiManifest({
                output: `${outputManifest}/json.json`,
                createShortcuts: false,
                trimExtensions: false,
                includeMetaData: false,
            }),
        ]
    })

    await fontPack.run();
}

buildAllAssets();
