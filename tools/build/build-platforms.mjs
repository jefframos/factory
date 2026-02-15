import archiver from 'archiver';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const GAME = process.env.GAME;

if (!GAME) {
    console.error('❌ Please specify GAME=game1 in your .env file');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Correctly resolve the Root directory (2 levels up from your script folder)
const projectRoot = resolve(__dirname, '../../');
const gameRoot = resolve(projectRoot, `games/${GAME}`);
const configPath = resolve(gameRoot, 'platforms.config.json');
const distRoot = resolve(projectRoot, 'dist');

const platforms = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

/**
 * Zips a directory
 * @param {string} sourceDir Absolute path to source
 * @param {string} outPath Absolute path to output zip
 */
async function zipDirectory(sourceDir, outPath) {
    return new Promise((resolveZip, reject) => {
        // Ensure the directory actually exists before zipping
        if (!fs.existsSync(sourceDir)) {
            return reject(new Error(`Source directory does not exist: ${sourceDir}`));
        }

        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`   📦 Zip created: ${Math.round(archive.pointer() / 1024)} KB`);
            resolveZip();
        });

        archive.on('error', (err) => reject(err));

        archive.pipe(output);
        // "false" here prevents the zip from containing the parent folder name itself
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

async function runBuilds() {
    console.log(`\n🚀 Starting Build & Zip for Game: [${GAME}]`);

    // Ensure main dist folder exists
    if (!fs.existsSync(distRoot)) fs.mkdirSync(distRoot);

    const platformKeys = Object.keys(platforms).filter(k => k !== 'local');

    for (const platformKey of platformKeys) {
        // Create absolute paths for Vite and Archiver
        const outputSubDir = resolve(distRoot, platformKey);
        const zipPath = resolve(distRoot, `${platformKey}.zip`);

        console.log(`\n🏗️  Platform: [${platformKey.toUpperCase()}]`);

        try {
            // 1. Vite Build
            console.log(`   - Compiling...`);
            // We use the absolute path in --outDir
            execSync(`npx vite build --outDir "${outputSubDir}" --emptyOutDir`, {
                stdio: 'inherit',
                env: { ...process.env, VITE_PLATFORM: platformKey }
            });

            // 2. Zip the resulting folder
            console.log(`   - Zipping folder...`);
            await zipDirectory(outputSubDir, zipPath);

            console.log(`✅ Success: ${platformKey}`);
        } catch (error) {
            console.error(`❌ Error with ${platformKey}:`, error.message);
            process.exit(1);
        }
    }

    console.log(`\n✨ Done! Files are in: ${distRoot}`);
}

runBuilds();