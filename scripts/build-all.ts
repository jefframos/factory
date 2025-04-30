import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { resolve } from 'path';

function getGamesFolders(): string[] {
  const gamesPath = resolve(__dirname, '../games');
  return readdirSync(gamesPath).filter((file) => {
    const path = resolve(gamesPath, file);
    return statSync(path).isDirectory();
  });
}

function buildGame(gameName: string) {
  console.log(`\n📦 Building ${gameName}...`);
  execSync(`cross-env GAME=${gameName} vite build`, { stdio: 'inherit' });
}

function zipGame(gameName: string) {
  console.log(`\n📦 Zipping ${gameName}...`);
  execSync(`cross-env GAME=${gameName} ts-node scripts/zip-game.ts`, { stdio: 'inherit' });
}

async function buildAll() {
  const games = getGamesFolders();
  for (const game of games) {
    buildGame(game);
    zipGame(game);
  }
  console.log('\n✅ All games built and zipped!');
  execSync(`ts-node scripts/generate-index.ts`, { stdio: 'inherit' });
}

buildAll();
