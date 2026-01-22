import fs from 'fs';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const inputFolder = resolve(__dirname, '../../images');
const outputFolder = resolve(__dirname, '../images');

/**
 * Remove tags like `{...}` from names
 */
function removeTags(name) {
    return name.replace(/\{.*?\}/g, '');
}

/**
 * Recursively build a set of expected output paths from the input structure
 */
function buildExpectedPaths(src, currentOut = '') {
    const expected = new Set();

    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        const cleanName = removeTags(path.basename(src));
        const nextOut = path.join(currentOut, cleanName);
        expected.add(nextOut);

        const entries = fs.readdirSync(src);
        for (const entry of entries) {
            const child = buildExpectedPaths(path.join(src, entry), nextOut);
            for (const e of child) expected.add(e);
        }
    } else {
        expected.add(currentOut + '/' + path.basename(src));
    }

    return expected;
}

/**
 * Delete any files/folders in dest that are not in expected
 */
function cleanOutput(dir, expected, base = '') {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relPath = path.join(base, entry);

        const stat = fs.statSync(fullPath);
        if (!expected.has(relPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`Deleted: ${relPath}`);
        } else if (stat.isDirectory()) {
            cleanOutput(fullPath, expected, relPath);
        }
    }
}

/**
 * Copy from input to output, cleaning folder names
 */
function copyRecursive(src, destRoot) {
    const stat = fs.statSync(src);

    if (stat.isDirectory()) {
        const cleanName = removeTags(path.basename(src));
        const dest = path.join(destRoot, cleanName);

        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const entries = fs.readdirSync(src);
        for (const entry of entries) {
            copyRecursive(path.join(src, entry), dest);
        }
    } else if (stat.isFile()) {
        fs.copyFileSync(src, path.join(destRoot, path.basename(src)));
    }
}

/**
 * Entry
 */
function main() {
    if (!fs.existsSync(inputFolder)) {
        console.error(`Input folder not found: ${inputFolder}`);
        return;
    }

    if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder, { recursive: true });
    }

    const expectedPaths = new Set();
    const rootEntries = fs.readdirSync(inputFolder);
    for (const entry of rootEntries) {
        const paths = buildExpectedPaths(path.join(inputFolder, entry));
        for (const p of paths) expectedPaths.add(p);
    }

    cleanOutput(outputFolder, expectedPaths);

    for (const entry of rootEntries) {
        copyRecursive(path.join(inputFolder, entry), outputFolder);
    }

    console.log('Sync complete.');
}

main();