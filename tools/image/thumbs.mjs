#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SUPPORTED_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.tiff'
]);

function parseResolution(res) {
    const match = res.match(/^(\d+)x(\d+)$/);
    if (!match) {
        throw new Error('Resolution must be in the format WIDTHxHEIGHT (e.g. 250x250)');
    }

    return {
        width: parseInt(match[1], 10),
        height: parseInt(match[2], 10)
    };
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

async function processImage(srcPath, dstPath, width, height) {
    await sharp(srcPath)
        .resize({
            width,
            height,
            fit: 'inside',
            withoutEnlargement: true
        })
        .toFile(dstPath);
}

async function processFolder(inputDir, outputDir, width, height) {
    ensureDir(outputDir);

    const entries = fs.readdirSync(inputDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(inputDir, entry.name);
        const dstPath = path.join(outputDir, entry.name);

        if (entry.isDirectory()) {
            await processFolder(srcPath, dstPath, width, height);
            continue;
        }

        const ext = path.extname(entry.name).toLowerCase();

        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            // Copy non-images as-is
            fs.copyFileSync(srcPath, dstPath);
            continue;
        }

        await processImage(srcPath, dstPath, width, height);
    }
}

async function main() {
    const [, , inputDir, outputDir, resolution] = process.argv;

    if (!inputDir || !outputDir || !resolution) {
        console.error(
            'Usage:\n  node resize-images.js <inputDir> <outputDir> <WIDTHxHEIGHT>'
        );
        process.exit(1);
    }

    const { width, height } = parseResolution(resolution);

    const absInput = path.resolve(inputDir);
    const absOutput = path.resolve(outputDir);

    if (!fs.existsSync(absInput)) {
        throw new Error(`Input folder does not exist: ${absInput}`);
    }

    await processFolder(absInput, absOutput, width, height);

    console.log(`✔ Images processed to ${width}x${height}`);
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
