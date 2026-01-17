import { existsSync, mkdirSync } from 'fs';

function ensureFolderExists(folderPath) {
  // Check if the folder exists
  if (!existsSync(folderPath)) {
    // If it doesn't exist, create it
    mkdirSync(folderPath);
    console.log(`Folder "${folderPath}" created.`);
  }
}

export { ensureFolderExists };
