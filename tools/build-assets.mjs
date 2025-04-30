
import { AssetPack } from '@assetpack/core';

import { resolve } from 'path';

import { pixiManifest } from '@assetpack/core/manifest';
import { pixiPipes } from "@assetpack/core/pixi";
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import audio from './pack/audio.mjs';
import font from './pack/font.mjs';
import image from './pack/image.mjs';
import json from './pack/json.mjs';
import manifest from './pack/manifest.mjs';

const GAME = process.env.GAME;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawImages = resolve(__dirname, `../games/${GAME}/raw-assets/images`);
const outputImages = resolve(__dirname, `../public/${GAME}/images`);

if (!GAME) {
    console.error('❌ Please specify GAME=game1');
    process.exit(1);
}

async function buildAllAssets() {
    const pipes = [];
    pipes.push(image.pipes[0]);
    pipes.push(font.pipes[0]);
    pipes.push(json.pipes[0]);
    pipes.push(audio.pipes[0]);
    pipes.push(manifest.pipes[0]);

    const assetpack = new AssetPack({
        entry: rawImages,
        output: outputImages,
        // pipes: pipes
        pipes: [
            pixiManifest({
                output: "manifest.json",
                createShortcuts: false,
                trimExtensions: true,
                includeMetaData: false,
                //nameStyle: 'short'
            }),
            pixiPipes({
                cacheBust: true,
                resolutions: { default: 1 },
                compression: { jpg: true, png: true, webp: true },
                texturePacker: { nameStyle: "relative" },
                audio: audio.pipes[0],

            }),
        ]
    });

    // To run AssetPack
    await assetpack.run();
}

buildAllAssets();
