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

async function processImage(srcPath, dstPath, width, height, quality) {
    // Map 0-1 input to 1-100 for sharp's quality setting
    const qualityValue = Math.round(quality * 100);

    await sharp(srcPath)
        .resize({
            width,
            height,
            fit: 'inside',
            withoutEnlargement: true
        })
        .png({
            quality: qualityValue,
            palette: qualityValue < 100 // Use palette-based compression if quality < 1
        })
        .toFile(dstPath);
}

async function processFolder(inputDir, outputDir, width, height, quality) {
    ensureDir(outputDir);

    const entries = fs.readdirSync(inputDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(inputDir, entry.name);
        const ext = path.extname(entry.name).toLowerCase();

        if (entry.isDirectory()) {
            const dstPath = path.join(outputDir, entry.name);
            await processFolder(srcPath, dstPath, width, height, quality);
            continue;
        }

        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            const dstPath = path.join(outputDir, entry.name);
            fs.copyFileSync(srcPath, dstPath);
            continue;
        }

        const baseName = path.basename(entry.name, ext);
        const dstPath = path.join(outputDir, `${baseName}.png`);

        await processImage(srcPath, dstPath, width, height, quality);
    }
}

async function main() {
    const [, , inputDir, outputDir, resolution, compressionArg] = process.argv;

    if (!inputDir || !outputDir || !resolution) {
        console.error(
            'Usage:\n  node resize-images.js <inputDir> <outputDir> <WIDTHxHEIGHT> [compression (0-1)]'
        );
        process.exit(1);
    }

    // Default compression to 1 (no compression) if not provided
    const quality = compressionArg !== undefined ? parseFloat(compressionArg) : 1;

    if (isNaN(quality) || quality < 0 || quality > 1) {
        throw new Error('Compression must be a number between 0 and 1');
    }

    const { width, height } = parseResolution(resolution);

    const absInput = path.resolve(inputDir);
    const absOutput = path.resolve(outputDir);

    if (!fs.existsSync(absInput)) {
        throw new Error(`Input folder does not exist: ${absInput}`);
    }

    await processFolder(absInput, absOutput, width, height, quality);

    console.log(`✔ All images converted to .png (Quality: ${quality}) and resized to max ${width}x${height}`);
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});