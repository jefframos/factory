import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3031;

// --- Load Config ---
const CONFIG_PATH = path.join(__dirname, 'config.json');

const loadServerConfig = () => {
    const defaults = { LEVEL_DATA_PATH: "../raw-assets/json/game", WORLDS_FOLDER: "/game" };
    if (fs.existsSync(CONFIG_PATH)) {
        try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
        catch (e) { console.error("Config error, using defaults."); }
    }
    return defaults;
};

const serverConfig = loadServerConfig();
const ABSOLUTE_DATA_DIR = path.resolve(__dirname, serverConfig.LEVEL_DATA_PATH);
const MANIFEST_NAME = 'worlds.json';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

/**
 * Normalizes a path to prevent /game/game/ level stacking.
 * Returns the "Clean" filename for disk and the "Prefixed" path for manifest.
 */
const getSanitizedPaths = (inputPath) => {
    // 1. Get just the filename (e.g., "01_world.json") regardless of how many slashes were sent
    const fileName = path.basename(inputPath);

    // 2. Clean the prefix from config (remove leading/trailing slashes for consistency)
    const cleanPrefix = serverConfig.WORLDS_FOLDER.replace(/^\/|\/$/g, '');

    return {
        diskPath: path.join(ABSOLUTE_DATA_DIR, fileName),
        manifestPath: `${cleanPrefix}/${fileName}`
    };
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, d) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
};

app.get('/api/load', (req, res) => {
    try {
        const manifestPath = path.join(ABSOLUTE_DATA_DIR, MANIFEST_NAME);
        if (!fs.existsSync(manifestPath)) writeJson(manifestPath, { worlds: [] });

        const manifest = readJson(manifestPath);
        const worldFiles = {};

        manifest.worlds.forEach(w => {
            const { diskPath } = getSanitizedPaths(w.levelFile);
            if (fs.existsSync(diskPath)) {
                worldFiles[w.levelFile] = readJson(diskPath);
            } else {
                const defaultData = { id: w.id, levels: [] };
                writeJson(diskPath, defaultData);
                worldFiles[w.levelFile] = defaultData;
            }
        });

        res.json({ ok: true, manifest, worldFiles });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.post('/api/save', (req, res) => {
    const { manifest, worldsData } = req.body;
    try {
        const activeFilesOnDisk = new Set([MANIFEST_NAME]);

        // 1. Process Worlds and Patch Manifest
        manifest.worlds.forEach(w => {
            const { diskPath, manifestPath } = getSanitizedPaths(w.levelFile);
            const oldKey = w.levelFile;

            // Patch the manifest entry to ensure it has the correct SINGLE prefix
            w.levelFile = manifestPath;

            // Save the actual world content
            if (worldsData[oldKey]) {
                writeJson(diskPath, worldsData[oldKey]);
                activeFilesOnDisk.add(path.basename(diskPath));
            }
        });

        // 2. Save the patched Manifest
        writeJson(path.join(ABSOLUTE_DATA_DIR, MANIFEST_NAME), manifest);

        // 3. Cleanup: Delete orphaned .json files not in manifest
        const filesOnDisk = fs.readdirSync(ABSOLUTE_DATA_DIR);
        filesOnDisk.forEach(file => {
            if (file.endsWith('.json') && !activeFilesOnDisk.has(file)) {
                fs.unlinkSync(path.join(ABSOLUTE_DATA_DIR, file));
                console.log(`[Cleanup] Deleted orphaned file: ${file}`);
            }
        });

        res.json({ ok: true, message: "Saved and Patched" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: err.message });
    }
});

app.listen(PORT, () => console.log(`Editor Server active on port ${PORT}`));