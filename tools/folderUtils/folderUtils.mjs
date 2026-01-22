import { existsSync, mkdirSync } from 'fs';

function ensureFolderExists(folderPath) {
  // Check if the folder exists
  if (!existsSync(folderPath)) {
    console.log(`Creating directory tree for: "${folderPath}"`);

    // Adding { recursive: true } allows creating nested folders
    mkdirSync(folderPath, { recursive: true });

    console.log(`Folder path created successfully.`);
  }
}

export { ensureFolderExists };
