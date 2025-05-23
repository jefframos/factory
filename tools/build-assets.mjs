
import { AssetPack } from '@assetpack/core';

import { resolve } from 'path';

import { pixiManifest } from '@assetpack/core/manifest';
import { pixiPipes } from "@assetpack/core/pixi";
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import audio from './pack/audio.mjs';
import font from './pack/font.mjs';
import json from './pack/json.mjs';
import manifest from './pack/manifest.mjs';

const GAME = process.env.GAME;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rawImages = resolve(__dirname, `../games/${GAME}/raw-assets/images`);
const outputImages = resolve(__dirname, `../public/${GAME}/images`);

const rawFonts = resolve(__dirname, `../games/${GAME}/raw-assets/fonts`);
const outputFonts = resolve(__dirname, `../public/${GAME}/fonts`);

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

    const assetpack = new AssetPack({
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
                texturePacker: { nameStyle: "short", texturePacker: { removeFileExtension: true } },
                audio: audio.pipes[0],
            }),
        ]
    });

    const fontPack = new AssetPack({
        entry: rawFonts,
        output: outputFonts,
        // pipes: pipes
        pipes: [
            font.pipes[0],
            pixiManifest({
                output: `${outputManifest}/fonts.json`,
                createShortcuts: false,
                trimExtensions: true,
                includeMetaData: false,
            }),
        ]
    })

    await assetpack.run();
    await fontPack.run();
}

buildAllAssets();
