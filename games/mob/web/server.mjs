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
// - GET    /api/mob/grades            ui/grades.json: each level's difficulty grade (tools/grade-levels.ts, robot players)
// - POST   /api/mob/grade             grade levels in the background: { ids?: [...] (none: all), zones?, levels? } — the
//                                     editor's order and unsaved levels, graded as they are there
// - GET    /api/mob/grade-status      how that's going: { running, done, total, finished: [{ id, score }], error }
// - POST   /api/mob/grade-cancel      stop it (the levels already graded stay saved)
// - POST   /api/mob/gaps              { level, id? }: where its giants, trucks and cars can get stuck (tools/gap-check.ts);
//                                     with its id, its summary's kept in ui/gaps.json (the level list's ✓ ! ✗)
// - GET    /api/mob/gaps-summary      ui/gaps.json: { levels: { id: { hash, at, result, stuck, stalls, runs } } }
// - POST   /api/mob/gaps-all          { levels: { id: level } }: every one checked (a few at a time), kept; the summaries
// - GET    /api/mob/reports           the grading reports in reports/ (newest first): [{ name, at, full }]
// - GET    /api/mob/report?name=<f>   one of them

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { readBody, readJson, readRawBody, send, startWorldEditor, writeJson } from '../../../tools/world-editor/server.mjs';
import { startGrading } from '../tools/grade-run.mjs';
import { checkGaps } from '../tools/gap-run.mjs';
import { levelHash } from './public/mob-grade-key.js';

const PORT = process.env.EDITOR_PORT ? Number(process.env.EDITOR_PORT) : 4712;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEVELS_DIR = path.join(HERE, '..', 'levels');
const ZONES_FILE = path.join(HERE, '..', 'ui', 'zones.json');
const THEMES_FILE = path.join(HERE, '..', 'ui', 'themes.json');
const UNITS_FILE = path.join(HERE, '..', 'ui', 'units.json');
const WORLD_FILE = path.join(HERE, '..', 'ui', 'worldmap.json');
const SETTINGS_FILE = path.join(HERE, '..', 'ui', 'settings.json');
const GRADES_FILE = path.join(HERE, '..', 'ui', 'grades.json');
const GAPS_FILE = path.join(HERE, '..', 'ui', 'gaps.json');

/** A gap check in short: fail (a test unit stuck for good), stall (one stood still a while), else pass. */
function gapSummary(level, data) {
    const stuck = data.runs.filter((run) => run.end === 'stuck').length;
    const stalls = data.runs.reduce((n, run) => n + run.stalls.length, 0);
    return { hash: levelHash(level), at: new Date().toISOString(), result: stuck ? 'fail' : stalls ? 'stall' : 'pass', stuck, stalls, runs: data.runs.length };
}

async function keepGapSummaries(summaries) {
    const file = await readJson(GAPS_FILE, { levels: {} });
    file.levels = { ...(file.levels ?? {}), ...summaries };
    await writeJson(GAPS_FILE, file);
    return file;
}
const REPORTS_DIR = path.join(HERE, '..', 'reports');
/** The level grader running in the background (one at a time), and how it's going. */
const grading = { running: false, done: 0, total: 0, levels: [], finished: [], error: null, child: null };
/** The cards' pictures, to edit by hand: npm run image packs them into the game's `entities` atlas. */
const CARD_PICTURES_DIR = path.join(HERE, '..', 'raw-assets', 'images', 'entities{tps}');

/** What's wrong with the settings, if anything (the game trusts the file: Settings.ts). */
function settingsProblem(s) {
    if (!s || typeof s !== 'object') return 'Settings must be an object';
    if (!(isNumber(s.retry?.step) && s.retry.step >= 0 && isNumber(s.retry?.most) && s.retry.most >= 0 && s.retry.most < 1)) return 'retry: step 0 or more, most from 0 up to (not) 1';
    if (!(isNumber(s.loopHarder) && s.loopHarder >= 0)) return 'loopHarder must be 0 or more';
    if (!(isNumber(s.startCoins) && s.startCoins >= 0)) return 'startCoins must be 0 or more';
    if (typeof s.housesBlockReds !== 'boolean') return 'housesBlockReds must be true or false';
    if (!(isNumber(s.loseCoins) && s.loseCoins >= 0)) return 'loseCoins must be 0 or more';
    if (!(isNumber(s.replayReward) && s.replayReward >= 0)) return 'replayReward must be 0 or more';
    const range = (r) => Array.isArray(r) && r.length === 2 && r.every((v) => isNumber(v) && v >= 0);
    for (const kind of ['giant', 'truck', 'saucer', 'car']) {
        const c = s.cards?.[kind];
        if (!c) return `cards.${kind} is missing`;
        if (!(Number.isInteger(c.maxLevel) && c.maxLevel >= 1 && c.maxLevel <= 50)) return `cards.${kind}: levels 1 to 50`;
        if (!Array.isArray(c.cost) || !c.cost.every((v) => isNumber(v) && v > 0)) return `cards.${kind}: prices, each more than 0`;
        if (!range(c.damage) || !range(c.seconds) || (c.hp !== undefined && !range(c.hp))) return `cards.${kind}: each stat a [level 1, top] pair, 0 or more`;
        if (!(c.seconds[0] > 0 && c.seconds[1] > 0)) return `cards.${kind}: charge seconds more than 0`;
        if (!(isNumber(c.icon?.x) && isNumber(c.icon?.y) && isNumber(c.icon?.zoom) && c.icon.zoom > 0)) return `cards.${kind}: icon x, y and zoom`;
        if (!/^#[0-9a-f]{6}$/i.test(c.colour ?? '')) return `cards.${kind}: its main colour as #rrggbb`;
    }
    for (const kind of ['fire', 'capacity', 'recharge']) {
        const u = s.upgrades?.[kind];
        if (!u || typeof u.name !== 'string') return `upgrades.${kind}: a name`;
        if (!(Number.isInteger(u.max) && u.max >= 1 && u.max <= 50)) return `upgrades.${kind}: levels 1 to 50`;
        if (!isNumber(u.perLevel)) return `upgrades.${kind}: what a level adds`;
        if (!Array.isArray(u.cost) || !u.cost.every((c) => isNumber(c) && c > 0)) return `upgrades.${kind}: prices, each more than 0`;
    }
    return null;
}
const MODELS_DIR = path.join(HERE, '..', '..', '..', 'public', 'mob', 'models');

const goodId = (id) => /^[a-z0-9][a-z0-9-]*$/.test(id ?? '');
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** What's wrong with a level, if anything (the game trusts these files). */
function levelProblem(level) {
    if (!level || typeof level !== 'object') return 'Not a level';
    if (!level.name) return 'It needs a name';
    for (const key of ['redRate', 'redRateEnd', 'redRamp', 'baseHp', 'reward']) if (!isNumber(level[key])) return `${key} must be a number`;
    if (!Array.isArray(level.gates)) return 'gates must be a list';
    for (const gate of level.gates) {
        if (![gate.x, gate.z, gate.width, gate.value].every(isNumber)) return 'A gate needs x, z, width and value';
        if (gate.lock !== undefined && !(isNumber(gate.lock) && gate.lock >= 1)) return "A gate's lock must be 1 or more hits (or empty)";
    }
    for (const o of level.obstacles ?? []) {
        if (!['wall', 'water', 'breakable', 'enemyWall'].includes(o.kind)) return `Unknown obstacle kind ${o.kind}`;
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
        ['pipes', ['x', 'z', 'toX', 'toZ']],
        ['grinders', ['x', 'z', 'length', 'thickness']],
    ]) {
        for (const item of level[list] ?? []) if (!keys.every((key) => isNumber(item[key]))) return `Each of ${list} needs ${keys.join(', ')}`;
    }
    // The field's size (MobConfig.ts FIELD): unset is the default 10 x 24.
    if (level.width !== undefined && !(isNumber(level.width) && level.width >= 4 && level.width <= 20)) return 'width must be 4 to 20 (or unset)';
    if (level.length !== undefined && !(isNumber(level.length) && level.length >= 4 && level.length <= 60)) return 'length must be 4 to 60 (or unset)';
    for (const pipe of level.pipes ?? []) {
        if (pipe.team !== undefined && !['blue', 'red', 'both'].includes(pipe.team)) return 'A pipe is blue, red or both';
    }
    for (const grinder of level.grinders ?? []) {
        if (!['x', 'z'].includes(grinder.axis)) return 'A grinder lies along x (horizontal) or z (vertical)';
        if (!(grinder.length > 0 && grinder.thickness > 0)) return "A grinder's length and thickness must be more than 0";
        if (grinder.move && !(isNumber(grinder.move.range) && isNumber(grinder.move.seconds) && grinder.move.seconds > 0)) return "A rolling grinder needs a range and seconds";
    }
    for (const helmet of level.helmets ?? []) {
        if (helmet.kind !== undefined && !['hp', 'attack'].includes(helmet.kind)) return `Unknown barrier kind ${helmet.kind}`;
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
        for (const key of ['color', 'tint', 'wall', 'roof', 'pad']) if (unit[key] !== undefined && !colour(unit[key])) return `${kind}: ${key} must be a #rrggbb colour`;
        if (unit.style !== undefined && !['model', 'house', 'pad'].includes(unit.style)) return `${kind}: style is model, house or pad`;
        if (!(isNumber(unit.need) && unit.need >= 1)) return `${kind}: charge (need) must be 1 or more`;
        if (unit.hp !== undefined && !(isNumber(unit.hp) && unit.hp >= 0)) return `${kind}: hp must be 0 or more`;
        if (!(isNumber(unit.damage) && unit.damage >= 0)) return `${kind}: damage must be 0 or more`;
        if (unit.body !== undefined && !(isNumber(unit.body) && unit.body >= 0.3 && unit.body <= 1)) return `${kind}: body must be 0.3 to 1`;
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

/** Starts grading `ids` (none: every level) with the editor's `zones` and unsaved `levels` over what's on disk. */
async function startGradingJob({ ids, zones, levels }) {
    const stateFile = path.join(os.tmpdir(), 'mob-grader', `state-${Date.now()}.json`);
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify({ zones, levels }));
    Object.assign(grading, { running: true, done: 0, total: 0, levels: [], finished: [], error: null });
    grading.child = await startGrading([...(ids ?? []), '--state', stateFile, '--careers', '3'], {
        onMessage: (message) => {
            if (message.type === 'start') Object.assign(grading, { total: message.total, levels: message.levels });
            if (message.type === 'progress') grading.done = message.done;
            if (message.type === 'level') grading.finished.push({ id: message.id, score: message.score });
            if (message.type === 'skipped') grading.error = `${message.id}: ${message.reason}`;
        },
        onExit: (code, errors) => {
            grading.running = false;
            grading.child = null;
            if (code !== 0 && code !== null) grading.error = errors.trim().split(/\r?\n/).slice(-3).join(' ') || `The grader stopped (${code})`;
            fs.rm(stateFile, { force: true }).catch(() => {});
        },
    });
}

async function handle(req, res, url) {
    const id = url.searchParams.get('id');
    if (url.pathname === '/api/mob/grades' && req.method === 'GET') return send(res, 200, await readJson(GRADES_FILE, { levels: {} })), true;
    if (url.pathname === '/api/mob/reports' && req.method === 'GET') {
        const files = (await fs.readdir(REPORTS_DIR).catch(() => [])).filter((f) => /^(latest|grades-[\d-]+)\.json$/.test(f));
        const list = await Promise.all(files.map(async (name) => {
            const report = await readJson(path.join(REPORTS_DIR, name), null);
            return report && { name, at: report.at, full: !!report.full };
        }));
        return send(res, 200, list.filter(Boolean).sort((a, b) => (a.name === 'latest.json' ? -1 : b.name === 'latest.json' ? 1 : b.at.localeCompare(a.at)))), true;
    }
    if (url.pathname === '/api/mob/report' && req.method === 'GET') {
        const name = url.searchParams.get('name') ?? '';
        if (!/^(latest|grades-[\d-]+)\.json$/.test(name)) return send(res, 400, { error: 'Bad report name' }), true;
        const report = await readJson(path.join(REPORTS_DIR, name), null);
        return report ? send(res, 200, report) : send(res, 404, { error: 'No such report' }), true;
    }
    if (url.pathname === '/api/mob/gaps' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body?.level || typeof body.level !== 'object') return send(res, 400, { error: 'No level' }), true;
        try {
            const data = await checkGaps(body.level);
            if (goodId(body.id)) await keepGapSummaries({ [body.id]: gapSummary(body.level, data) });
            return send(res, 200, data), true;
        } catch (error) {
            return send(res, 500, { error: `The gap check failed: ${error.message}` }), true;
        }
    }
    if (url.pathname === '/api/mob/gaps-summary' && req.method === 'GET') return send(res, 200, await readJson(GAPS_FILE, { levels: {} })), true;
    if (url.pathname === '/api/mob/gaps-all' && req.method === 'POST') {
        const body = await readBody(req);
        const entries = Object.entries(body?.levels ?? {}).filter(([id, level]) => goodId(id) && level && typeof level === 'object');
        const summaries = {};
        const failed = [];
        let next = 0;
        const worker = async () => {
            while (next < entries.length) {
                const [id, level] = entries[next++];
                try {
                    summaries[id] = gapSummary(level, await checkGaps(level));
                } catch (error) {
                    failed.push(`${id}: ${error.message}`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(8, os.cpus().length - 2)) }, worker));
        const file = await keepGapSummaries(summaries);
        return send(res, 200, { ...file, failed }), true;
    }
    if (url.pathname === '/api/mob/grade-status' && req.method === 'GET') {
        const { child: _child, ...status } = grading;
        return send(res, 200, status), true;
    }
    if (url.pathname === '/api/mob/grade' && req.method === 'POST') {
        if (grading.running) return send(res, 409, { error: 'Already grading: wait for it, or stop it' }), true;
        const body = await readBody(req);
        const ids = Array.isArray(body.ids) ? body.ids.filter(goodId) : [];
        try {
            await startGradingJob({ ids, zones: body.zones, levels: body.levels ?? {} });
        } catch (error) {
            grading.running = false;
            return send(res, 500, { error: `Could not start the grader: ${error.message}` }), true;
        }
        return send(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/mob/grade-cancel' && req.method === 'POST') {
        grading.child?.kill();
        return send(res, 200, { ok: true }), true;
    }
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
    // The world map (the main screen's): its tiles, and the hexagon pack's pieces to make them from (models/hexa/: its
    // index.json, written by tools/build-props.mjs: the ground tiles, and what stands on them).
    if (url.pathname === '/api/mob/hex-tiles' && req.method === 'GET') {
        return send(res, 200, await readJson(path.join(MODELS_DIR, 'hexa', 'index.json'), { tiles: [], decor: [] })), true;
    }
    if (url.pathname === '/api/mob/worldmap' && req.method === 'GET') return send(res, 200, await readJson(WORLD_FILE, { tiles: [] })), true;
    if (url.pathname === '/api/mob/worldmap' && req.method === 'PUT') {
        const data = await readBody(req);
        const tiles = Array.isArray(data?.tiles) ? data.tiles : null;
        if (!tiles) return send(res, 400, { error: 'tiles must be a list' }), true;
        const seen = new Set();
        for (const tile of tiles) {
            if (!Number.isInteger(tile.q) || !Number.isInteger(tile.r) || typeof tile.model !== 'string') return send(res, 400, { error: 'Each tile needs whole q, r and a model' }), true;
            const key = `${tile.q},${tile.r}`;
            if (seen.has(key)) return send(res, 400, { error: `Two tiles at ${key}` }), true;
            seen.add(key);
        }
        const lift = Number(data.lift) || 0;
        // A colour change kept only when it changes something (hue 0, saturation and brightness 1: as it is).
        const colour = (o) => ({
            ...(Number(o.hue) ? { hue: Number(o.hue) } : {}),
            ...(isNumber(o.saturation) && o.saturation !== 1 ? { saturation: o.saturation } : {}),
            ...(isNumber(o.brightness) && o.brightness !== 1 ? { brightness: o.brightness } : {}),
        });
        await writeJson(WORLD_FILE, {
            ...(lift ? { lift } : {}),
            ...colour(data),
            tiles: tiles.map(({ q, r, model, decor, rot, zone, y, decorY, hue, saturation, brightness }) => ({
                q, r, model, ...(decor ? { decor } : {}), ...(rot ? { rot } : {}), ...(zone ? { zone } : {}),
                ...(Number(y) ? { y: Number(y) } : {}), ...(Number(decorY) ? { decorY: Number(decorY) } : {}),
                ...colour({ hue, saturation, brightness }),
            })),
        });
        return send(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/mob/card-pictures' && req.method === 'GET') {
        const files = await fs.readdir(CARD_PICTURES_DIR).catch(() => []);
        return send(res, 200, files.filter((file) => /^card-[a-z]+\.png$/.test(file))), true;
    }
    if (url.pathname === '/api/mob/card-picture' && req.method === 'GET') {
        const kind = url.searchParams.get('kind') ?? '';
        if (!['giant', 'truck', 'saucer', 'car'].includes(kind)) return send(res, 400, { error: 'Unknown card' }), true;
        const file = await fs.readFile(path.join(CARD_PICTURES_DIR, `card-${kind}.png`)).catch(() => null);
        if (!file) return send(res, 404, { error: 'No picture saved' }), true;
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).end(file);
        return true;
    }
    if (url.pathname === '/api/mob/card-picture' && req.method === 'POST') {
        const kind = url.searchParams.get('kind') ?? '';
        if (!['giant', 'truck', 'saucer', 'car'].includes(kind)) return send(res, 400, { error: 'Unknown card' }), true;
        await fs.mkdir(CARD_PICTURES_DIR, { recursive: true });
        await fs.writeFile(path.join(CARD_PICTURES_DIR, `card-${kind}.png`), await readRawBody(req));
        return send(res, 200, { ok: true }), true;
    }
    if (url.pathname === '/api/mob/settings' && req.method === 'GET') return send(res, 200, await readJson(SETTINGS_FILE, {})), true;
    if (url.pathname === '/api/mob/settings' && req.method === 'PUT') {
        const data = await readBody(req);
        const problem = settingsProblem(data);
        if (problem) return send(res, 400, { error: problem }), true;
        await writeJson(SETTINGS_FILE, data);
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
