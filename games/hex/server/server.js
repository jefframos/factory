import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3031);
const CONFIG_FILE = path.join(__dirname, "config.json");

// --- Helper Functions ---

const readJson = (filePath) => {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const writeJson = (filePath, data) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
};
const loadConfig = () => {
    // 1. Set internal defaults
    let cfg = {
        dataDir: path.join(__dirname, "data"),
        backupsDir: path.join(__dirname, "backups"),
        manifestName: "game-manifest.json"
    };

    // 2. Try to read the config.json file
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const disk = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));

            // Use path.resolve to turn "../raw-assets/json" into an absolute path
            // relative to the server's directory
            if (disk.LEVEL_DATA_PATH) {
                cfg.dataDir = path.resolve(__dirname, disk.LEVEL_DATA_PATH);
            }
            if (disk.backupsDir) {
                cfg.backupsDir = path.resolve(__dirname, disk.backupsDir);
            }
        } catch (e) {
            console.error("Error reading config.json, using defaults.");
        }
    }

    // 3. Ensure the directories actually exist on disk
    if (!fs.existsSync(cfg.dataDir)) fs.mkdirSync(cfg.dataDir, { recursive: true });
    if (!fs.existsSync(cfg.backupsDir)) fs.mkdirSync(cfg.backupsDir, { recursive: true });

    return cfg;
};
const loadConfig2 = () => {
    const cfg = {
        levelDataPath: process.env.LEVEL_DATA_PATH || "",
        backupsDir: path.join(__dirname, "backups")
    };

    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const disk = readJson(CONFIG_FILE);
            if (disk && typeof disk === "object") {
                if (typeof disk.levelDataPath === "string") cfg.levelDataPath = disk.levelDataPath;
                if (typeof disk.backupsDir === "string") cfg.backupsDir = disk.backupsDir;
            }
        } catch {
            // ignore
        }
    }
    return cfg;
};

const saveConfig = (cfg) => writeJson(CONFIG_FILE, cfg);

const ensureConfigured = (cfg) => {
    if (!cfg.levelDataPath) {
        return {
            ok: false,
            error: "levelDataPath is not set. POST /api/config with { levelDataPath } or set env LEVEL_DATA_PATH."
        };
    }
    return { ok: true };
};

const makeBackup = (cfg, reason) => {
    fs.mkdirSync(cfg.backupsDir, { recursive: true });

    const ext = path.extname(cfg.levelDataPath) || ".json";
    const base = path.basename(cfg.levelDataPath, ext);
    const name = `${base}_${Date.now()}${reason ? "_" + reason : ""}.backup${ext}`;
    const outPath = path.join(cfg.backupsDir, name);

    if (fs.existsSync(cfg.levelDataPath)) {
        fs.copyFileSync(cfg.levelDataPath, outPath);
    } else {
        fs.writeFileSync(outPath, "{}", "utf8");
    }

    return { name, path: outPath };
};

// --- Server Setup ---

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// --- Routes ---

app.get("/api/config", (req, res) => {
    res.json(loadConfig());
});

app.post("/api/config", (req, res) => {
    const cfg = loadConfig();
    const { levelDataPath, backupsDir } = req.body || {};

    if (typeof levelDataPath === "string") cfg.levelDataPath = levelDataPath;
    if (typeof backupsDir === "string") cfg.backupsDir = backupsDir;

    saveConfig(cfg);
    res.json(cfg);
});

// app.get("/api/load", (req, res) => {
//     const cfg = loadConfig();
//     const check = ensureConfigured(cfg);
//     if (!check.ok) return res.status(400).json(check);

//     try {
//         const data = readJson(cfg.levelDataPath);
//         res.json({ ok: true, data });
//     } catch (err) {
//         res.status(500).json({ ok: false, error: String(err) });
//     }
// });

// app.post("/api/save", (req, res) => {
//     const cfg = loadConfig();
//     const check = ensureConfigured(cfg);
//     if (!check.ok) return res.status(400).json(check);

//     const { data } = req.body || {};
//     if (data === undefined) {
//         return res.status(400).json({ ok: false, error: "Missing body.data" });
//     }

//     try {
//         const backup = makeBackup(cfg, "autosave");
//         writeJson(cfg.levelDataPath, data);
//         res.json({ ok: true, backup: backup.name, savedTo: cfg.levelDataPath });
//     } catch (err) {
//         res.status(500).json({ ok: false, error: String(err) });
//     }
// });
app.get("/api/load", (req, res) => {
    const cfg = loadConfig();
    try {
        const manifestPath = path.join(cfg.dataDir, cfg.manifestName);

        // Ensure manifest exists, if not create a default one
        if (!fs.existsSync(manifestPath)) {
            writeJson(manifestPath, { worlds: [] });
        }

        const manifest = readJson(manifestPath);
        const worldFiles = {};

        manifest.worlds.forEach(w => {
            const worldPath = path.join(cfg.dataDir, w.levelFile);

            if (fs.existsSync(worldPath)) {
                worldFiles[w.levelFile] = readJson(worldPath);
            } else {
                // AUTO-CREATE: The file is in manifest but missing on disk
                const defaultWorldData = { id: w.id, levels: [] };
                writeJson(worldPath, defaultWorldData);
                worldFiles[w.levelFile] = defaultWorldData;
                console.log(`[Server] Created missing world file: ${w.levelFile}`);
            }
        });

        res.json({ ok: true, manifest, worldFiles });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});

// POST /api/save - Receives the full state and splits it back into files
app.post("/api/save", (req, res) => {
    const cfg = loadConfig();
    console.log(cfg)
    const { manifest, worldsData } = req.body || {};

    if (!manifest || !worldsData) {
        return res.status(400).json({ ok: false, error: "Missing manifest or worldsData" });
    }

    try {
        // 1. Save the manifest
        const manifestPath = path.join(cfg.dataDir, cfg.manifestName);
        writeJson(manifestPath, manifest);

        // 2. Save each world file mentioned in the worldsData object
        for (const [fileName, content] of Object.entries(worldsData)) {
            const worldPath = path.join(cfg.dataDir, fileName);
            writeJson(worldPath, content);
        }

        res.json({ ok: true, message: "Manifest and World files updated." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, error: String(err) });
    }
});
app.get("/api/backups", (req, res) => {
    const cfg = loadConfig();

    try {
        fs.mkdirSync(cfg.backupsDir, { recursive: true });
        const backups = fs.readdirSync(cfg.backupsDir)
            .filter(f => f.toLowerCase().includes(".backup"))
            .sort()
            .reverse();

        res.json({ ok: true, backups });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.post("/api/restore", (req, res) => {
    const cfg = loadConfig();
    const check = ensureConfigured(cfg);
    if (!check.ok) return res.status(400).json(check);

    const { name } = req.body || {};
    if (typeof name !== "string" || !name.length) {
        return res.status(400).json({ ok: false, error: "Missing body.name (backup filename)" });
    }

    const backupPath = path.join(cfg.backupsDir, name);
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ ok: false, error: "Backup not found" });
    }

    try {
        const before = makeBackup(cfg, "before_restore");
        fs.copyFileSync(backupPath, cfg.levelDataPath);
        res.json({ ok: true, restored: name, previous: before.name });
    } catch (err) {
        res.status(500).json({ ok: false, error: String(err) });
    }
});

app.listen(PORT, () => {
    console.log(`[level-editor-server] http://localhost:${PORT}`);
    console.log(`[level-editor-server] config: ${CONFIG_FILE}`);
});