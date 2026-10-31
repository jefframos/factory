import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { sanitizeAssetNames } from './folderUtils/sanitizeAssetNames.mjs';

// .env picks the game, even over a GAME left set in the terminal (dotenv alone never overrides one).
process.env.GAME = dotenv.config().parsed?.GAME ?? process.env.GAME;

const GAME = process.env.GAME;
const TARGET = process.argv[2];

if (!GAME) {
    console.error('❌ Please specify GAME=... in your .env');
    process.exit(1);
}

if (!TARGET) {
    console.error('Usage: node sanitize <folder>');
    console.error('');
    console.error('Examples:');
    console.error('  node sanitize audio');
    console.error('  node sanitize images');
    console.error('  node sanitize non-preload');
    process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const folder = resolve(
    __dirname,
    `../../games/${GAME}/raw-assets/${TARGET}`
);

const renamed = sanitizeAssetNames(folder, console.log);

console.log(`\n✅ Renamed ${renamed} file(s)/folder(s).`);