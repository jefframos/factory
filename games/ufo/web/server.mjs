// The UFO game's editor (`npm run editor` with GAME=ufo): the shared world editor plus this game's own settings.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBody, readJson, send, startWorldEditor, writeJson } from '../../../tools/world-editor/server.mjs';

const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4711;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.join(HERE, '..', 'ui', 'ufo.json');
/** The Hangar tab's: the saucer's looks. */
const LOOKS_FILE = path.join(HERE, '..', 'ui', 'saucers.json');
const SAUCER_TEXTURES = path.join(HERE, '..', '..', '..', 'public', 'ufo', 'images', 'non-preload', 'saucer');

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

function looksProblem(looks) {
    if (!Array.isArray(looks?.ufos) || !looks.ufos.length || !Array.isArray(looks.aliens) || !looks.aliens.length) return 'It needs at least one UFO style and one alien';
    for (const list of [looks.ufos, looks.aliens]) {
        const ids = new Set();
        for (const style of list) {
            if (!style?.id || ids.has(style.id)) return `Two styles share the id ${style?.id}`;
            ids.add(style.id);
            if (!Array.isArray(style.pieces)) return `${style.id} has no pieces list`;
        }
    }
    if (!looks.ufos.some((style) => style.id === looks.ufo)) return 'The UFO style in the game is gone';
    if (!looks.aliens.some((style) => style.id === looks.alien)) return 'The alien in the game is gone';
    return null;
}

async function handleHangar(req, res, url) {
    if (url.pathname === '/api/saucers' && req.method === 'GET') {
        send(res, 200, await readJson(LOOKS_FILE, { ufos: [], aliens: [] }));
        return true;
    }
    if (url.pathname === '/api/saucers' && req.method === 'PUT') {
        const looks = await readBody(req);
        const problem = looksProblem(looks);
        if (problem) send(res, 400, { error: problem });
        else {
            await writeJson(LOOKS_FILE, looks);
            send(res, 200, { ok: true });
        }
        return true;
    }
    if (url.pathname === '/api/saucer-texture' && req.method === 'GET') {
        const name = url.searchParams.get('name') ?? '';
        const content = /^[\w-]+$/.test(name) ? await fs.readFile(path.join(SAUCER_TEXTURES, `${name}.webp`)).catch(() => null) : null;
        if (!content) res.writeHead(404).end('Not found');
        else {
            res.writeHead(200, { 'Content-Type': 'image/webp' });
            res.end(content);
        }
        return true;
    }
    return false;
}

startWorldEditor({
    game: 'ufo',
    port: PORT,
    title: 'ufo-editor',
    settingsFile: SETTINGS_FILE,
    api: async (req, res, url) => {
        if (await handleHangar(req, res, url)) return true;
        if (url.pathname !== '/api/ufo' || req.method !== 'PUT') return false;
        await saveSettings(req, res);
        return true;
    },
});
