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
/** The Levels tab's: the areas, and the levels played in each. */
const AREAS_FILE = path.join(HERE, '..', 'ui', 'areas.json');
const LEVELS_DIR = path.join(HERE, '..', 'levels');
const SAUCER_TEXTURES = path.join(HERE, '..', '..', '..', 'public', 'ufo', 'images', 'non-preload', 'saucer');

/** The UFO tab: only `ufo`, `rivals`, `camera`, `home` and `people` change (numbers, each of a key that's already there). */
async function saveSettings(req, res) {
    const edits = await readBody(req);
    const settings = await readJson(SETTINGS_FILE, null);
    if (!settings) return send(res, 500, { error: 'Could not read ui/ufo.json' });
    for (const section of ['ufo', 'rivals', 'camera', 'home', 'saucerLook', 'intro', 'scarcity', 'ranking', 'people']) {
        for (const [key, value] of Object.entries(edits[section] ?? {})) {
            const toggle = typeof settings[section][key] === 'boolean' && typeof value === 'boolean';
            if (!(key in settings[section]) || (!toggle && !Number.isFinite(value))) return send(res, 400, { error: `Bad setting ${section}.${key}` });
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

const townExists = (name) => /^[\w-]+$/.test(name ?? '') && fs.access(path.join(LEVELS_DIR, `${name}.json`)).then(() => true, () => false);

async function areasProblem(data) {
    if (!Array.isArray(data?.areas) || !data.areas.some((area) => area.levels?.length)) return 'It needs at least one level';
    if (data.tutorial && !await townExists(data.tutorial.level)) return 'The tutorial\'s town is gone';
    const ids = new Set();
    for (const area of data.areas) {
        if (!area.id || ids.has(area.id)) return `Two areas share the id ${area.id}`;
        ids.add(area.id);
        if (!area.name) return 'An area has no name';
        if (!await townExists(area.miniature)) return `${area.name}: its miniature's town is gone`;
        for (const level of area.levels ?? []) {
            if (!await townExists(level.level)) return `${area.name}: a level's town (${level.level}) is gone`;
            if (!['points', 'all', 'object', 'race', 'top'].includes(level.type)) return `${area.name}: a level has no goal`;
            if (!(level.seconds > 0) || !(level.rivals >= 0)) return `${area.name}: a level needs seconds and rivals`;
        }
    }
    return null;
}

/** A new town: a copy of another, under its own file name. */
async function createTown(req, res) {
    const { name, from } = await readBody(req);
    const file = String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!file) return send(res, 400, { error: 'It needs a name' });
    if (await townExists(file)) return send(res, 400, { error: `There's already a levels/${file}.json` });
    const source = await townExists(from) ? await readJson(path.join(LEVELS_DIR, `${from}.json`), null) : null;
    if (!source) return send(res, 400, { error: `Could not read the town to copy (${from})` });
    await writeJson(path.join(LEVELS_DIR, `${file}.json`), { ...source, name });
    return send(res, 200, { id: file, name, level: file });
}

/** What a town keeps when it's erased: its name, shape and where things start. Everything else goes. */
const KEPT_WHEN_ERASED = new Set(['name', 'next', 'ground', 'island', 'start', 'grassNoise', 'round', 'soundSettings']);
/** Without these, a town has nothing to be finished by. */
const REMOVED_WHEN_ERASED = new Set(['goal']);

function erased(town) {
    const empty = {};
    for (const [key, value] of Object.entries(town)) {
        if (REMOVED_WHEN_ERASED.has(key)) continue;
        if (KEPT_WHEN_ERASED.has(key)) empty[key] = value;
        else if (Array.isArray(value)) empty[key] = [];
        else if (value && typeof value === 'object') {
            // traffic, people, roads: the same parts, each empty.
            empty[key] = Object.fromEntries(Object.entries(value).map(([part, content]) => [part, Array.isArray(content) ? [] : content && typeof content === 'object' ? {} : typeof content === 'number' ? 0 : content]));
        } else empty[key] = value;
    }
    return empty;
}

/** Empties a town, unless a level plays in it: that would leave the level with nothing to eat. */
async function eraseTown(req, res) {
    const { level } = await readBody(req);
    if (!await townExists(level)) return send(res, 400, { error: `There's no town ${level}` });
    const data = await readJson(AREAS_FILE, { areas: [] });
    const played = [data.tutorial, ...data.areas.flatMap((area) => area.levels ?? [])].filter(Boolean).some((entry) => entry.level === level);
    if (played) return send(res, 400, { error: 'Levels play in this town. Move them to another town in the Levels tab first.' });
    const file = path.join(LEVELS_DIR, `${level}.json`);
    await writeJson(file, erased(await readJson(file, {})));
    return send(res, 200, { ok: true });
}

async function handleLevels(req, res, url) {
    if (url.pathname === '/api/areas' && req.method === 'GET') {
        send(res, 200, await readJson(AREAS_FILE, { areas: [] }));
        return true;
    }
    if (url.pathname === '/api/areas' && req.method === 'PUT') {
        const data = await readBody(req);
        const problem = await areasProblem(data);
        if (problem) send(res, 400, { error: problem });
        else {
            await writeJson(AREAS_FILE, data);
            send(res, 200, { ok: true });
        }
        return true;
    }
    if (url.pathname === '/api/towns/erase' && req.method === 'POST') {
        await eraseTown(req, res);
        return true;
    }
    if (url.pathname === '/api/towns' && req.method === 'POST') {
        await createTown(req, res);
        return true;
    }
    return false;
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
        if (await handleLevels(req, res, url)) return true;
        if (url.pathname !== '/api/ufo' || req.method !== 'PUT') return false;
        await saveSettings(req, res);
        return true;
    },
});
