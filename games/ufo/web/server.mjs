// The UFO game's editor (`npm run editor` with GAME=ufo): the shared world editor plus this game's own settings.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBody, readJson, send, startWorldEditor, writeJson } from '../../../tools/world-editor/server.mjs';

const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4711;
const SETTINGS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ui', 'ufo.json');

/** The UFO tab: only `ufo`, `camera` and `people` change (numbers, each of a key that's already there). */
async function saveSettings(req, res) {
    const edits = await readBody(req);
    const settings = await readJson(SETTINGS_FILE, null);
    if (!settings) return send(res, 500, { error: 'Could not read ui/ufo.json' });
    for (const section of ['ufo', 'camera', 'people']) {
        for (const [key, value] of Object.entries(edits[section] ?? {})) {
            if (!(key in settings[section]) || !Number.isFinite(value)) return send(res, 400, { error: `Bad setting ${section}.${key}` });
            settings[section][key] = value;
        }
    }
    await writeJson(SETTINGS_FILE, settings);
    return send(res, 200, { ok: true });
}

startWorldEditor({
    game: 'ufo',
    port: PORT,
    title: 'ufo-editor',
    settingsFile: SETTINGS_FILE,
    api: async (req, res, url) => {
        if (url.pathname !== '/api/ufo' || req.method !== 'PUT') return false;
        await saveSettings(req, res);
        return true;
    },
});
