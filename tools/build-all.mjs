import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const arg = process.argv.slice(2).find((a) => a.startsWith('--'));
const requestedGame = arg ? arg.slice(2) : null;

const envPath = path.resolve(root, '.env');
let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';

let currentGame;
if (requestedGame) {
    const gameDir = path.resolve(root, 'games', requestedGame);
    if (!fs.existsSync(gameDir)) {
        console.error(`❌ games/${requestedGame} does not exist`);
        process.exit(1);
    }

    if (/^GAME=.*/m.test(envContent)) {
        envContent = envContent.replace(/^GAME=.*/m, `GAME=${requestedGame}`);
    } else {
        envContent = `GAME=${requestedGame}\n${envContent}`;
    }
    fs.writeFileSync(envPath, envContent);
    currentGame = requestedGame;
    console.log(`🎮 Switched GAME to ${requestedGame} in .env`);
} else {
    const match = envContent.match(/^GAME=(.*)$/m);
    currentGame = match ? match[1].trim() : process.env.GAME;
}

if (!currentGame) {
    console.error('❌ No GAME set in .env');
    process.exit(1);
}

const publicDir = path.resolve(root, 'public');
if (fs.existsSync(publicDir)) {
    for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name !== currentGame) {
            fs.rmSync(path.join(publicDir, entry.name), { recursive: true, force: true });
            console.log(`🧹 Removed stale public/${entry.name}`);
        }
    }
}

const cacheDir = path.resolve(root, '.assetpack');
if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log('🧹 Removed .assetpack cache');
}

console.log(`📦 Building assets for GAME=${currentGame}`);
execSync('npm run image && npm run font && npm run audio && npm run models && npm run json', {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, GAME: currentGame },
});
