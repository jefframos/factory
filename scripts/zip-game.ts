import { existsSync, createWriteStream } from 'fs';
import { resolve } from 'path';
import * as archiver from 'archiver';

const GAME = process.env.GAME;

if (!GAME) {
  console.error('Please specify the GAME environment variable');
  process.exit(1);
}

const distPath = resolve(__dirname, '../dist', GAME);
const zipDistPath = resolve(__dirname, '../dist', `${GAME}.zip`);
const zipFullPath = resolve(__dirname, '../dist', `${GAME}_full.zip`);
const gameSourcePath = resolve(__dirname, '../games', GAME);

function zipFolder(sourceFolder: string, outPath: string, folderDescription: string) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const output = createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`✅ ${folderDescription} zipped (${archive.pointer()} bytes): ${outPath}`);
      resolvePromise();
    });

    archive.on('error', (err) => {
      rejectPromise(err);
    });

    archive.pipe(output);
    archive.directory(sourceFolder, false);
    archive.finalize();
  });
}

async function zip() {
  if (!existsSync(distPath)) {
    console.error('Build folder does not exist. Run the build first.');
    process.exit(1);
  }

  await zipFolder(distPath, zipDistPath, 'Built game');
  await zipFolder(gameSourcePath, zipFullPath, 'Full game source + assets');
}

zip();
