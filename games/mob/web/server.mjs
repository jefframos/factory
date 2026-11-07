// The Mob game's editor (`npm run editor` with GAME=mob): the shared world editor's server (static files, /vendor/three,
// the library) plus Mob's own endpoints for its battle levels and zones. The page is games/mob/web/public/index.html.
//
// - GET    /api/mob/levels            every level: [{ id, level }]
// - PUT    /api/mob/level?id=<id>     write levels/<id>.json (checked first)
// - DELETE /api/mob/level?id=<id>     delete it (refused while a zone still plays it)
// - GET    /api/mob/zones             ui/zones.json
// - PUT    /api/mob/zones             write it (every level it names must exist)
// - GET    /api/mob/themes            ui/themes.json (each zone's look: colours, surroundings, props)
// - PUT    /api/mob/themes            write it (every model it names must be under public/mob/models)
// - GET    /api/mob/units             ui/units.json (the upgrades: colours, charge, hits, damage)
// - PUT    /api/mob/units             write it (checked first)

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBody, readJson, send, startWorldEditor, writeJson } from '../../../tools/world-editor/server.mjs';

const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4712;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEVELS_DIR = path.join(HERE, '..', 'levels');
const ZONES_FILE = path.join(HERE, '..', 'ui', 'zones.json');
const THEMES_FILE = path.join(HERE, '..', 'ui', 'themes.json');
const UNITS_FILE = path.join(HERE, '..', 'ui', 'units.json');
const MODELS_DIR = path.join(HERE, '..', '..', '..', 'public', 'mob', 'models');

const goodId = (id) => /^[a-z0-9][a-z0-9-]*$/.test(id ?? '');
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** What's wrong with a level, if anything (the game trusts these files). */
function levelProblem(level) {
    if (!level || typeof level !== 'object') return 'Not a level';
    if (!level.name) return 'It needs a name';
    for (const key of ['redRate', 'redRateEnd', 'redRamp', 'baseHp', 'reward']) if (!isNumber(level[key])) return `${key} must be a number`;
    if (!Array.isArray(level.gates)) return 'gates must be a list';
    for (const gate of level.gates) if (![gate.x, gate.z, gate.width, gate.value].every(isNumber)) return 'A gate needs x, z, width and value';
    for (const o of level.obstacles ?? []) {
        if (!['wall', 'water', 'breakable'].includes(o.kind)) return `Unknown obstacle kind ${o.kind}`;
        if (o.points) {
            if (!Array.isArray(o.points) || o.points.length < 3 || !o.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNumber))) return 'A polygon needs at least 3 [x, z] points';
        } else if (!(isNumber(o.radius) || (isNumber(o.width) && isNumber(o.depth)))) return 'An obstacle needs points, a radius, or a width and depth';
    }
    for (const [list, keys] of [
        ['spinners', ['x', 'z', 'length', 'arms', 'speed']],
        ['pushers', ['x', 'z', 'width', 'depth', 'range', 'seconds']],
        ['pads', ['x', 'z', 'width', 'depth']],
        ['pushBlocks', ['x', 'z', 'width', 'depth', 'far', 'near']],
        ['targets', ['x', 'hp']],
        ['helmets', ['x', 'z', 'width']],
    ]) {
        for (const item of level[list] ?? []) if (!keys.every((key) => isNumber(item[key]))) return `Each of ${list} needs ${keys.join(', ')}`;
    }
    for (const pad of level.pads ?? []) {
        if (pad.kind !== undefined && !['giant', 'truck', 'saucer', 'car'].includes(pad.kind)) return `Unknown house kind ${pad.kind}`;
        // Its own charge, or (none) its unit's.
        if (pad.need !== undefined && !(isNumber(pad.need) && pad.need >= 1)) return 'A house\'s need must be 1 or more (or empty)';
    }
    return null;
}

/** What's wrong with the units file, if anything: every unit, its colours as #rrggbb, its numbers. */
function unitsProblem(units) {
    const colour = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
    for (const kind of ['giant', 'truck', 'saucer', 'car']) {
        const unit = units?.[kind];
        if (!unit) return `${kind} is missing`;
        for (const key of ['color', 'tint', 'wall', 'roof']) if (unit[key] !== undefined && !colour(unit[key])) return `${kind}: ${key} must be a #rrggbb colour`;
        if (!(isNumber(unit.need) && unit.need >= 1)) return `${kind}: charge (need) must be 1 or more`;
        if (unit.hp !== undefined && !(isNumber(unit.hp) && unit.hp >= 0)) return `${kind}: hp must be 0 or more`;
        if (!(isNumber(unit.damage) && unit.damage >= 0)) return `${kind}: damage must be 0 or more`;
    }
    return null;
}

async function listLevels() {
    const files = (await fs.readdir(LEVELS_DIR).catch(() => [])).filter((f) => f.endsWith('.json')).sort();
    return Promise.all(files.map(async (f) => ({ id: f.replace(/\.json$/, ''), level: await readJson(path.join(LEVELS_DIR, f), null) })));
}

async function zonesProblem(data) {
    if (!Array.isArray(data?.zones) || !data.zones.length) return 'It needs at least one zone';
    const ids = new Set();
    for (const zone of data.zones) {
        if (!goodId(zone.id) || ids.has(zone.id)) return `Zone ids must be unique (lower case, digits, dashes): ${zone.id}`;
        ids.add(zone.id);
        if (!zone.name) return 'A zone has no name';
        if (!zone.theme) return `${zone.name} has no theme`;
        if (!Array.isArray(zone.levels)) return `${zone.name} has no level list`;
        for (const id of zone.levels) {
            const exists = goodId(id) && await fs.access(path.join(LEVELS_DIR, `${id}.json`)).then(() => true, () => false);
            if (!exists) return `${zone.name}: no level "${id}"`;
        }
    }
    return null;
}

/** What's wrong with the themes file, if anything. */
async function themesProblem(data) {
    if (!Array.isArray(data?.themes) || !data.themes.length) return 'It needs at least one theme';
    const ids = new Set();
    const colour = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    for (const theme of data.themes) {
        if (!goodId(theme.id) || ids.has(theme.id)) return `Theme ids must be unique (lower case, digits, dashes): ${theme.id}`;
        ids.add(theme.id);
        if (!theme.name) return 'A theme has no name';
        for (const key of ['sky', 'ground', 'field', 'stripe', 'rim', 'sea']) if (!colour(theme[key])) return `${theme.name}: ${key} must be a #rrggbb colour`;
        if (!['sea', 'valley'].includes(theme.surround)) return `${theme.name}: surround is sea or valley`;
        const models = [theme.kit?.wall, theme.kit?.pillar, ...(theme.kit?.tower ?? []), ...(theme.kit?.props ?? []).map((prop) => prop.model)].filter(Boolean);
        for (const model of models) {
            const file = path.join(MODELS_DIR, model);
            if (!file.startsWith(MODELS_DIR) || !await fs.access(file).then(() => true, () => false)) return `${theme.name}: no model ${model}`;
        }
        for (const prop of theme.kit?.props ?? []) if (!isNumber(prop.height) || !isNumber(prop.count)) return `${theme.name}: each prop needs a height and a count`;
    }
    return null;
}

async function handle(req, res, url) {
    const id = url.searchParams.get('id');
    if (url.pathname === '/api/mob/levels' && req.method === 'GET') return send(res, 200, await listLevels()), true;
    if (url.pathname === '/api/mob/themes' && req.method === 'GET') return send(res, 200, await readJson(THEMES_FILE, { themes: [] })), true;
    if (url.pathname === '/api/mob/themes' && req.method === 'PUT') {
        const data = await readBody(req);
        const problem = await themesProblem(data);
        if (problem) return send(res, 400, { error: problem }), true;
        await writeJson(THEMES_FILE, { themes: data.themes });
        return send(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/mob/units' && req.method === 'GET') return send(res, 200, await readJson(UNITS_FILE, {})), true;
    if (url.pathname === '/api/mob/units' && req.method === 'PUT') {
        const units = await readBody(req);
        const problem = unitsProblem(units);
        if (problem) return send(res, 400, { error: problem }), true;
        await writeJson(UNITS_FILE, units);
        return send(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/mob/zones' && req.method === 'GET') return send(res, 200, await readJson(ZONES_FILE, { zones: [] })), true;
    if (url.pathname === '/api/mob/zones' && req.method === 'PUT') {
        const data = await readBody(req);
        const problem = await zonesProblem(data);
        if (problem) return send(res, 400, { error: problem }), true;
        await writeJson(ZONES_FILE, { zones: data.zones });
        return send(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/mob/level' && req.method === 'PUT') {
        if (!goodId(id)) return send(res, 400, { error: 'Level ids: lower case letters, digits and dashes' }), true;
        const level = await readBody(req);
        const problem = levelProblem(level);
        if (problem) return send(res, 400, { error: problem }), true;
        await writeJson(path.join(LEVELS_DIR, `${id}.json`), level);
        return send(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/mob/level' && req.method === 'DELETE') {
        if (!goodId(id)) return send(res, 400, { error: 'Bad id' }), true;
        const zones = await readJson(ZONES_FILE, { zones: [] });
        const user = zones.zones.find((zone) => zone.levels.includes(id));
        if (user) return send(res, 409, { error: `Zone ${user.name} still plays it: take it out there first` }), true;
        await fs.rm(path.join(LEVELS_DIR, `${id}.json`), { force: true });
        return send(res, 200, { ok: true }), true;
    }
    return false;
}

startWorldEditor({ game: 'mob', port: PORT, title: 'mob-editor', settingsFile: ZONES_FILE, api: handle });
