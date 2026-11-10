// The Mob editor's page: a Levels tab (the field top-down: draw polygons, place gates, houses, PUSH blocks, spinners,
// pushers and forts, edit their numbers; the game itself on the right as a live 3D preview, rebuilt on every change)
// a Zones tab (each zone's theme and its levels, in play order), a Themes tab, and a Units tab (the upgrades: colours,
// charge, hits, damage: ui/units.json). Each level's difficulty grade (robot players: mob-grades.js) shows as a coloured
// badge in the level list and the Zones tab, with letters for what's in it; a level's panel grades it. Saves go through games/mob/web/server.mjs to
// games/mob/levels/<id>.json and games/mob/ui/zones.json, which the game bundles.
//
// The field (MobConfig.ts ARENA): x across from -width/2 to width/2, z along it from the cannon (0.35) up to the base's
// front (-length); 10 x 24 unless the level sets its `width` / `length` (it grows from the bottom centre: the cannon's
// end and the middle stay put). Blues go up (-z). Polygons are [x, z] corner lists, as the game reads them.

// ------------------------------------------------------------------ constants

import { buildWorldTab } from './mob-world.js';
import { buildSettingsTab } from './mob-settings.js';
import { createGrades } from './mob-grades.js';
import { buildCurveTab, loadCurve, targetCurve } from './mob-curve.js';
import { createGaps } from './mob-gaps.js';

/** The field sizes (MobConfig.ts FIELD): the default, the most, and the presets offered. */
const FIELD = { width: 10, length: 24, maxWidth: 20, maxLength: 60 };
const FIELD_SIZES = [
    { label: 'default 10 x 24', width: 10, length: 24 },
    { label: 'long 10 x 32', width: 10, length: 32 },
    { label: 'wide 14 x 24', width: 14, length: 24 },
    { label: 'big 14 x 32', width: 14, length: 32 },
    { label: 'huge 18 x 44', width: 18, length: 44 },
];
const fieldWidth = () => Math.min(FIELD.maxWidth, Math.max(4, level()?.width ?? FIELD.width));
const fieldLength = () => Math.min(FIELD.maxLength, Math.max(4, level()?.length ?? FIELD.length));
const halfWidth = () => fieldWidth() / 2;
const baseZ = () => -fieldLength();
const CANNON_Z = 0.35;
const DANGER_Z = -0.6;
const BASE = { width: 4.4, depth: 2.6 };
/** The part of the field drawn (z): a little past the cannon, a little behind the base; a little past each side. */
const viewBox = () => ({ near: 2.5, far: baseZ() - 3.5, side: halfWidth() + 1.5 });
const COLORS = {
    sand: '#e8a35c', stripe: '#d9914c', grass: '#4f9a3c', hedge: '#3d7d2e', wall: '#6fc94f', wallSide: '#3f8a2c',
    water: '#3fb6ff', breakable: '#c9cedd', gate: '#4fb6ff', red: '#ff3d4f', house: '#e8f1ff', roof: '#3d6dff',
    push: '#3a4466', pushPlate: '#ff4757', spinner: '#ffd23f', pusher: '#ffd23f', select: '#ffe14d', cannon: '#3b8cff',
};
/** New pieces, as placed by the tools. */
const DEFAULTS = {
    gates: (x, z) => ({ x, z, width: 3, value: 2 }),
    spinners: (x, z) => ({ x, z, length: 2.8, arms: 3, speed: 0.25 }),
    pushers: (x, z) => ({ x, z, width: 3.2, depth: 0.7, range: 3, seconds: 3.5 }),
    // No `need`: it charges as its unit does (the Units tab), unless one's set here.
    pads: (x, z) => ({ kind: state.houseKind, x, z, width: 2.4, depth: 1.8 }),
    pushBlocks: (x, z) => ({ x, z, width: 4.4, depth: 1.3, far: round(z - 8), near: round(z + 4) }),
    // A helmet (hits x2) leaves `kind` out; a viking hat (damage x2) is `attack`.
    // A grinder: a spiked roller lying across the field, standing (it spins in place).
    grinders: (x, z) => ({ x, z, length: 4, thickness: 0.9, axis: 'x' }),
    // A pipe: its first end where clicked, the other further up the field.
    // A new one's blue (only blues go through it); a pipe with no `team` is purple (both).
    pipes: (x, z) => ({ x, z, toX: x, toZ: round(z - 8), team: 'blue' }),
    helmets: (x, z) => (state.helmetKind === 'attack' ? { kind: 'attack', x, z, width: 3 } : { x, z, width: 3 }),
    targets: (x, z) => ({ x, hp: 200, width: 3.2, z: Math.abs(z - baseZ()) < 1 ? undefined : z }),
};
/** What a barrier gives, and how it's drawn here. */
const HELMET_KINDS = {
    hp: { label: 'helmet (hits x2)', text: 'HELMET x2', fill: '#9ccf5a', stroke: '#5d6e2c', ink: '#e4ffb8' },
    attack: { label: 'viking hat (damage x2)', text: 'VIKING x2', fill: '#ff8a4c', stroke: '#7a1f1c', ink: '#ffe0b0' },
};
/** What a house makes, how it's drawn here, and a new one's `need`. */
const HOUSE_KINDS = {
    giant: { label: 'GIANT', wall: '#e8f1ff', roof: '#3d6dff', need: 16 },
    truck: { label: 'TRUCK', wall: '#cfe0ff', roof: '#1f4fbf', need: 24 },
    saucer: { label: 'UFO', wall: '#ffe27a', roof: '#ffb31a', need: 40 },
    car: { label: 'RAMMER', wall: '#ffe3d6', roof: '#ff6a3d', need: 30 },
};
const LIST_NAMES = { gates: 'Gate', obstacles: 'Obstacle', spinners: 'Spinner', pushers: 'Pusher', pads: 'House', pushBlocks: 'PUSH block', helmets: 'Barrier', pipes: 'Pipe', grinders: 'Grinder', targets: 'Fort' };
/** Hit-test order: smaller things on top. */
const PICK_ORDER = ['pipes', 'grinders', 'targets', 'pushBlocks', 'pads', 'pushers', 'spinners', 'helmets', 'gates', 'obstacles'];
/** A pipe's colours and words by who can go through it (MobConfig PipeConfig.team). */
const PIPE_TEAMS = {
    blue: { label: 'blue (blues only)', word: 'BLUE', fill: '#3d6dff', edge: '#1d3a99', line: '#9fc2ff' },
    red: { label: 'red (reds only)', word: 'RED', fill: '#ff3d4f', edge: '#8a1a26', line: '#ffa3ad' },
    both: { label: 'purple (both)', word: 'BOTH', fill: '#7b5cff', edge: '#3b2a8a', line: '#a58bff' },
};
/** A pipe's opening (MobConfig PIPE.radius) and how far back its elbow goes (PIPE.body). */
const PIPE = { radius: 0.75, body: 1.6 };
/** A pipe's ends: [x, z, facing] each (the nearer the cannon opens towards it, +1; the other towards the base, -1). */
const pipeEnds = (p) => (p.z >= p.toZ ? [[p.x, p.z, 1], [p.toX, p.toZ, -1]] : [[p.x, p.z, -1], [p.toX, p.toZ, 1]]);
/** Which end of a pipe is under (x, z): 'from' (x, z), 'to' (toX, toZ), or null. */
function pipeEndAt(p, x, z) {
    const reach = Math.max(PIPE.radius + 0.2, 10 / view.scale);
    const from = Math.hypot(x - p.x, z - p.z);
    const to = Math.hypot(x - p.toX, z - p.toZ);
    if (Math.min(from, to) > reach) return null;
    return from <= to ? 'from' : 'to';
}
const LEVEL_FIELDS = [
    ['name', 'text'], ['kind', 'text'], ['redRate', 'number'], ['redRateEnd', 'number'], ['redRamp', 'number'],
    ['redGiantEvery', 'number'], ['kingAt', 'number'], ['baseHp', 'number'], ['reward', 'number'],
];
const FIELD_HINTS = {
    redRate: 'reds a second at the start', redRateEnd: 'reds a second at the end of the ramp', redRamp: 'ramp seconds',
    redGiantEvery: 'a red giant every N s (0 = none)',
    kingAt: 'boss: the Giant King comes out once, when the enemy\'s HP is down to this (empty or 0 = none)', baseHp: 'the one base\'s hits (no forts)', far: 'z: pushed here, the blues open it',
    near: 'z: pushed here, the reds open it', need: 'blues per one it makes (empty = the Units tab\'s)', hp: 'hits', value: 'multiplier', lock: 'locked: hits to unlock it (empty = open)', speed: 'turns a second',
};

// ------------------------------------------------------------------ helpers

const round = (v, step = 0.05) => Math.round(v / step) * step;
const fix = (v) => Number(v.toFixed(3));
const clone = (v) => JSON.parse(JSON.stringify(v));

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? `${response.status}`);
    return data;
}

let toastTimer = 0;
function toast(message, kind = '') {
    const box = document.getElementById('toast');
    box.textContent = message;
    box.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.className = ''; }, 2600);
}

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (key === 'class') node.className = value;
        else if (value !== undefined && value !== null && value !== false) node[key] = value;
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
}

function pointInPolygon(x, z, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, zi] = points[i];
        const [xj, zj] = points[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
}

function distanceToSegment(px, pz, [ax, az], [bx, bz]) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

// ------------------------------------------------------------------ state

const state = {
    gameUrl: 'http://localhost:9001/',
    themes: [],
    zones: { zones: [] },
    levels: new Map(),
    /** Ids changed since their last save. */
    dirty: new Set(),
    id: null,
    selection: null,
    tool: 'select',
    polygonKind: 'wall',
    houseKind: 'giant',
    helmetKind: 'hp',
    draft: [],
    snap: 0.25,
    theme: 'beach',
    undo: [],
    redo: [],
};
const level = () => state.levels.get(state.id);

// ------------------------------------------------------------------ boot

const statusLine = document.getElementById('status');
const levelsTab = document.getElementById('tab-levels');
const zonesTab = document.getElementById('tab-zones');
const themesTab = document.getElementById('tab-themes');
const unitsTab = document.getElementById('tab-units');
const worldTab = document.getElementById('tab-world');
/** The World map tab (mob-world.js), once built. */
let worldEditor = null;
const settingsTab = document.getElementById('tab-settings');
const curveTab = document.getElementById('tab-curve');
/** The Settings tab (mob-settings.js), once built. */
let settingsEditor = null;
/** The levels' difficulty grades (mob-grades.js). */
let grades = null;
/** The level panel's Check gaps, and its overlay on the field (mob-gaps.js). */
const gaps = createGaps({
    el: (...args) => el(...args),
    api: (...args) => api(...args),
    toast: (...args) => toast(...args),
    // The panel again (`panel`: its buttons changed) and the field.
    redraw: (panel) => {
        if (panel && !state.selection) renderProps();
        draw();
    },
    // The levels' ✓ ! ✗ marks changed.
    onSummary: () => {
        const button = document.getElementById('check-gaps');
        if (button) {
            button.disabled = gaps.checkingAll;
            button.textContent = gaps.checkingAll ? 'Checking gaps…' : 'Check all gaps';
        }
        if (!state.levels?.size) return;
        renderLevelList();
        if (!zonesTab.hidden) renderZones();
    },
});
/** The Curve tab (mob-curve.js). */
let curveEditor = null;

/**
 * Every side panel in every tab (the lists on the left, the properties and previews on the right) gets a handle on its
 * inner edge to drag it wider or narrower; each one's width is kept (localStorage) and a double-click on the handle puts
 * it back.
 */
const PANEL_WIDTH = { least: 140, most: 900, handle: 6 };

/** What the editor keeps across a refresh (the tab shown, the level open), in localStorage. */
function remember(key, value) {
    try {
        if (value) window.localStorage.setItem(`mob.editor.${key}`, value);
        else window.localStorage.removeItem(`mob.editor.${key}`);
    } catch {
        // No storage: it starts at the beginning.
    }
}
function remembered(key) {
    try {
        return window.localStorage.getItem(`mob.editor.${key}`);
    } catch {
        return null;
    }
}
function makePanelsResizable() {
    document.querySelectorAll('.tab-panel').forEach((tab) => {
        const panels = [...tab.querySelectorAll(':scope aside, :scope .props, :scope .preview')];
        panels.forEach((panel, i) => {
            const key = `mob.editor.width.${tab.id}.${i}`;
            // Left of the work area (a list): its handle on the right; right of it: on the left.
            const left = panel.tagName === 'ASIDE';
            panel.style.position = 'relative';
            panel.style.flex = '0 0 auto';
            try {
                const kept = Number(window.localStorage.getItem(key));
                if (kept) panel.style.width = `${kept}px`;
            } catch {
                // No storage: the default width.
            }
            const handle = el('div', {
                title: 'Drag to resize (double-click: back to its width)',
                style: { position: 'absolute', top: 0, bottom: 0, [left ? 'right' : 'left']: `-${PANEL_WIDTH.handle / 2}px`, width: `${PANEL_WIDTH.handle}px`, cursor: 'col-resize', zIndex: 20 },
            });
            handle.addEventListener('pointerenter', () => { handle.style.background = 'rgba(79,140,255,0.6)'; });
            handle.addEventListener('pointerleave', () => { handle.style.background = ''; });
            handle.addEventListener('dblclick', () => {
                panel.style.width = '';
                try { window.localStorage.removeItem(key); } catch { /* nothing kept */ }
                window.dispatchEvent(new Event('resize'));
            });
            handle.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                handle.setPointerCapture(event.pointerId);
                const startX = event.clientX;
                const startWidth = panel.getBoundingClientRect().width;
                const move = (e) => {
                    const width = Math.min(PANEL_WIDTH.most, Math.max(PANEL_WIDTH.least, startWidth + (left ? 1 : -1) * (e.clientX - startX)));
                    panel.style.width = `${width}px`;
                    window.dispatchEvent(new Event('resize'));
                };
                const up = () => {
                    handle.removeEventListener('pointermove', move);
                    handle.removeEventListener('pointerup', up);
                    try { window.localStorage.setItem(key, String(Math.round(panel.getBoundingClientRect().width))); } catch { /* not kept */ }
                };
                handle.addEventListener('pointermove', move);
                handle.addEventListener('pointerup', up);
            });
            panel.append(handle);
        });
    });
}

async function boot() {
    try {
        const [config, themes, zones, levels, units] = await Promise.all([api('/api/config'), api('/api/mob/themes'), api('/api/mob/zones'), api('/api/mob/levels'), api('/api/mob/units')]);
        state.units = units;
        state.gameUrl = config.gameUrl;
        state.themes = themes.themes;
        state.zones = zones;
        for (const { id, level: data } of levels) if (data) state.levels.set(id, data);
        state.theme = zones.zones[0]?.theme ?? themes[0]?.id ?? 'beach';
    } catch (error) {
        toast(`Could not load: ${error.message}`, 'error');
        return;
    }
    buildLevelsTab();
    buildZonesTab();
    buildThemesTab();
    buildUnitsTab();
    worldEditor = buildWorldTab(worldTab, { el, api, toast, state, statusLine });
    settingsEditor = buildSettingsTab(settingsTab, { el, api, toast, statusLine });
    makePanelsResizable();
    grades = createGrades({
        el, api, toast, state, statusLine,
        onChange: () => {
            renderLevelList();
            if (!itemOf(state.selection)) renderProps();
            if (!zonesTab.hidden) renderZones();
            if (!curveTab.hidden && !grades?.running) curveEditor?.show();
        },
    });
    grades.load();
    curveEditor = buildCurveTab(curveTab, {
        el, api, toast, state, grades,
        onLevelChanged: (id) => {
            state.dirty.add(id);
            renderLevelList();
            if (id === state.id) {
                renderProps();
                draw();
                queuePreview();
            }
        },
        openLevel: (id) => {
            document.querySelector('header [data-tab="levels"]').click();
            openLevel(id);
        },
    });
    // Where you were (kept across a refresh): the level open, the tab shown.
    const keptLevel = remembered('level');
    openLevel(keptLevel && state.levels.has(keptLevel) ? keptLevel : firstLevelId());
    document.querySelectorAll('header [data-tab]').forEach((button) => button.addEventListener('click', () => {
        remember('tab', button.dataset.tab);
        document.querySelectorAll('header [data-tab]').forEach((b) => b.classList.toggle('on', b === button));
        levelsTab.hidden = button.dataset.tab !== 'levels';
        zonesTab.hidden = button.dataset.tab !== 'zones';
        themesTab.hidden = button.dataset.tab !== 'themes';
        unitsTab.hidden = button.dataset.tab !== 'units';
        worldTab.hidden = button.dataset.tab !== 'world';
        settingsTab.hidden = button.dataset.tab !== 'settings';
        curveTab.hidden = button.dataset.tab !== 'curve';
        if (!curveTab.hidden) curveEditor?.show();
        if (!settingsTab.hidden) settingsEditor?.show();
        if (!worldTab.hidden) worldEditor?.show();
        if (!themesTab.hidden) renderThemes();
        if (!unitsTab.hidden) renderUnits();
        if (!zonesTab.hidden) renderZones();
        else resizeCanvas();
    }));
    const keptTab = remembered('tab');
    if (keptTab && keptTab !== 'levels') document.querySelector(`header [data-tab="${keptTab}"]`)?.click();
    window.addEventListener('beforeunload', (event) => {
        if (state.dirty.size || zonesDirty || themesDirty || unitsDirty || worldEditor?.dirty || settingsEditor?.dirty) event.preventDefault();
    });
}

function firstLevelId() {
    for (const zone of state.zones.zones) for (const id of zone.levels) if (state.levels.has(id)) return id;
    return state.levels.keys().next().value ?? null;
}

// ------------------------------------------------------------------ levels tab: layout

let canvas;
let ctx;
let propsPanel;
let levelList;
let preview;
let toolButtons = {};

function buildLevelsTab() {
    levelList = el('div', { class: 'list' });
    const side = el('aside', {},
        levelList,
        el('div', { class: 'tools' },
            el('button', { onclick: newLevel }, '+ New'),
            el('button', { onclick: duplicateLevel }, 'Duplicate'),
            el('button', { class: 'danger', onclick: deleteLevel }, 'Delete'),
            el('button', { title: 'Robot players grade the levels whose grade is missing or out of date (the level, those before it, the settings or the grading itself changed), each where it is in the game: the badges. Shift+click: every level, from scratch', onclick: (event) => grades?.run([], event.shiftKey) }, 'Grade all'),
            el('button', { id: 'check-gaps', title: 'Check every level for where giants, trucks and cars get stuck (a few seconds): ✓ pass, ! units stall, ✗ one stuck for good', disabled: gaps.checkingAll, onclick: () => gaps.checkAll(Object.fromEntries(state.levels)) }, gaps.checkingAll ? 'Checking gaps…' : 'Check all gaps'),
        ),
    );
    const tool = (id, label, title) => {
        const button = el('button', { title, onclick: () => setTool(id) }, label);
        toolButtons[id] = button;
        return button;
    };
    const polygonKind = el('select', { title: 'What a drawn polygon becomes', onchange: (e) => { state.polygonKind = e.target.value; } },
        el('option', { value: 'wall' }, 'wall'), el('option', { value: 'water' }, 'water'), el('option', { value: 'breakable' }, 'breakable'),
        el('option', { value: 'enemyWall', title: 'Invisible in the game; only the reds bump into it' }, 'enemy wall'));
    const snap = el('select', { title: 'Snap', onchange: (e) => { state.snap = Number(e.target.value); } },
        ...[0, 0.05, 0.1, 0.25, 0.5].map((v) => el('option', { value: v, selected: v === state.snap }, v ? `snap ${v}` : 'no snap')));
    const toolbar = el('div', { class: 'toolbar' },
        tool('select', 'Select', 'Select, drag to move, drag a corner, double-click an edge to add a corner (V)'),
        tool('polygon', 'Polygon', 'Click corners; click the first one or press Enter to close; Esc cancels (P)'),
        polygonKind,
        el('span', { class: 'sep' }),
        tool('gates', 'Gate', 'Multiplier gate'),
        tool('pads', 'House', 'A house: blues walking in make a giant, a truck or a gold UFO (pick which)'),
        el('select', { title: 'What a new house makes', onchange: (e) => { state.houseKind = e.target.value; } },
            ...Object.entries(HOUSE_KINDS).map(([kind, info]) => el('option', { value: kind }, info.label.toLowerCase()))),
        tool('pushBlocks', 'PUSH', 'PUSH block'),
        tool('helmets', 'Barrier', 'Barrier: blues going through get a helmet (double hits) or a viking hat (double damage); pick which'),
        el('select', { title: 'What a new barrier gives', onchange: (e) => { state.helmetKind = e.target.value; } },
            ...Object.entries(HELMET_KINDS).map(([kind, info]) => el('option', { value: kind }, info.label))),
        tool('pipes', 'Pipe', 'Pipe: two ends joined over the field; blues go in the one nearer the cannon and out the other, reds the other way (drag an end to move it)'),
        tool('grinders', 'Grinder', 'Grinder: a spiked roller that grinds up anything touching it; horizontal or vertical, standing (it spins) or rolling back and forth'),
        tool('spinners', 'Spinner', 'Spinner'),
        tool('pushers', 'Pusher', 'Sliding bar'),
        tool('targets', 'Fort', 'An enemy fort (several make a multi-target level)'),
        el('span', { class: 'sep' }),
        snap,
        el('button', { title: 'Undo (Ctrl+Z)', onclick: undo }, 'Undo'),
        el('button', { title: 'Redo (Ctrl+Y)', onclick: redo }, 'Redo'),
        el('span', { style: { flex: 1 } }),
        el('button', { class: 'primary', title: 'Save (Ctrl+S)', onclick: saveLevel }, 'Save'),
    );
    canvas = el('canvas', { id: 'field' });
    ctx = canvas.getContext('2d');
    propsPanel = el('div', { class: 'props' });
    const themeSelect = el('select', { onchange: (e) => { state.theme = e.target.value; reloadPreview(); } },
        ...state.themes.map((theme) => el('option', { value: theme.id, selected: theme.id === state.theme }, theme.name)));
    preview = el('iframe', { title: 'Preview' });
    const previewPanel = el('div', { class: 'preview' },
        el('div', { class: 'bar' }, el('span', { class: 'hint' }, 'Live preview'), themeSelect, el('span', { style: { flex: 1 } }),
            el('button', { title: 'Reload the game', onclick: reloadPreview }, 'Reload')),
        preview,
    );
    levelsTab.append(side, el('div', { class: 'editor' }, toolbar, el('div', { class: 'work' }, el('div', { class: 'canvas-wrap' }, canvas), propsPanel)), previewPanel);
    // The game says when it's listening (it posts 'mob-ready' once its scene is up): then it gets the level as it is now.
    window.addEventListener('message', (event) => {
        if (event.source === preview.contentWindow && event.data?.type === 'mob-ready') sendPreview();
    });
    new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onKey);
    setTool('select');
}

/** The zones folded away in the level list (kept in this browser). */
const CLOSED_ZONES_KEY = 'mob-editor.closedZones';
/** Levels that take longer than this to win (seconds, the robots' average) are flagged: long levels are bad. */
const LONG_LEVEL = 55;
function closedZones() {
    try {
        return new Set(JSON.parse(localStorage.getItem(CLOSED_ZONES_KEY) ?? '[]'));
    } catch {
        return new Set();
    }
}
function toggleZone(id) {
    const closed = closedZones();
    if (closed.has(id)) closed.delete(id);
    else closed.add(id);
    try {
        localStorage.setItem(CLOSED_ZONES_KEY, JSON.stringify([...closed]));
    } catch {
        // Not kept: it folds for now.
    }
    renderLevelList();
}

/**
 * Each level in play order against the Curve tab's curve: how far its grade is off the aim, past the curve's
 * tolerance (+ too hard, - too easy), or 0; null if it's not graded.
 */
function offTheCurve() {
    const order = state.zones.zones.flatMap((zone) => zone.levels.filter((id) => state.levels.has(id)).map((id) => ({ id, zone: zone.id })));
    const curve = loadCurve();
    const target = targetCurve(order.map(({ zone }) => ({ zone })), curve);
    const off = new Map();
    order.forEach(({ id }, i) => {
        const score = grades?.score(id) ?? null;
        if (score === null) return off.set(id, null);
        const delta = score - target[i];
        off.set(id, Math.abs(delta) > curve.tolerance ? Math.round(delta) : 0);
    });
    return off;
}

function renderLevelList() {
    levelList.replaceChildren();
    const used = new Set();
    const off = offTheCurve();
    const closed = closedZones();
    /** Too easy or too hard for where it is: by how much (the Curve tab says what to change). */
    const fit = (id) => {
        const delta = off.get(id);
        if (!delta) return null;
        return delta < 0
            ? el('span', { class: 'fit easy', title: `Easier than the curve wants here by ${-delta} (Curve tab: its suggestion)` }, `EASY ${delta}`)
            : el('span', { class: 'fit hard', title: `Harder than the curve wants here by ${delta} (Curve tab: its suggestion)` }, `HARD +${delta}`);
    };
    /** How long it takes to win (the robots' average), flagged when it's long. */
    const length = (id) => {
        const time = grades?.seconds(id) ?? null;
        if (time === null) return null;
        return time > LONG_LEVEL
            ? el('span', { class: 'fit hard', title: `Takes ${time}s to win on average: long levels are bad, make it shorter (more pressure, not more HP)` }, `LONG ${time}s`)
            : el('small', { title: 'How long it takes to win, on average (the casual and average robots)' }, `${time}s`);
    };
    const row = (id, number) => {
        const data = state.levels.get(id);
        const node = el('div', { class: `row${id === state.id ? ' sel' : ''}`, onclick: () => openLevel(id) },
            el('div', { class: 'row-main' },
                el('span', { class: state.dirty.has(id) ? 'dirty' : '' }, `${number ? `${number}. ` : ''}${data?.name ?? id}`),
                el('div', { class: 'row-sub' }, fit(id), length(id), grades?.chips(data), el('small', {}, data?.kind ?? ''))),
            gaps.mark(id, data),
            grades?.badge(id) ?? null);
        levelList.append(node);
    };
    /** A zone's heading: click to fold it away or open it; folded, it still says how many are off the curve. */
    const heading = (key, title, ids) => {
        const isClosed = closed.has(key);
        const easy = ids.filter((id) => (off.get(id) ?? 0) < 0).length;
        const hard = ids.filter((id) => (off.get(id) ?? 0) > 0).length;
        levelList.append(el('div', { class: 'zone-head', title: isClosed ? 'Show its levels' : 'Hide its levels', onclick: () => toggleZone(key) },
            el('span', { class: 'arrow' }, isClosed ? '▸' : '▾'),
            el('span', { class: 'zone-name' }, title),
            el('small', {}, `${ids.length}`),
            easy ? el('span', { class: 'fit easy', title: `${easy} too easy` }, `${easy} easy`) : null,
            hard ? el('span', { class: 'fit hard', title: `${hard} too hard` }, `${hard} hard`) : null));
        return isClosed;
    };
    let number = 0;
    for (const zone of state.zones.zones) {
        const ids = zone.levels.filter((id) => state.levels.has(id));
        const isClosed = heading(zone.id, `${zone.name} · ${zone.theme}`, ids);
        for (const id of ids) {
            used.add(id);
            // (Numbered through, folded or not: the numbers are the play order.)
            number++;
            if (!isClosed) row(id, number);
        }
    }
    const loose = [...state.levels.keys()].filter((id) => !used.has(id));
    if (loose.length && !heading('(none)', 'In no zone', loose)) loose.forEach((id) => row(id, 0));
}

function setTool(tool) {
    state.tool = tool;
    state.draft = [];
    for (const [id, button] of Object.entries(toolButtons)) button.classList.toggle('on', id === tool);
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
    draw();
}

function openLevel(id) {
    state.id = id;
    remember('level', id);
    state.selection = null;
    state.undo = [];
    state.redo = [];
    state.draft = [];
    // The zone it's in picks the preview's theme.
    const zone = state.zones.zones.find((z) => z.levels.includes(id));
    if (zone) state.theme = zone.theme;
    const select = document.querySelector('.preview select');
    if (select) select.value = state.theme;
    renderLevelList();
    renderProps();
    reloadPreview();
    draw();
}

// ------------------------------------------------------------------ levels tab: files

async function saveLevel() {
    if (!state.id) return;
    try {
        await api(`/api/mob/level?id=${state.id}`, { method: 'PUT', body: level() });
        state.dirty.delete(state.id);
        renderLevelList();
        toast(`Saved levels/${state.id}.json`, 'ok');
    } catch (error) {
        toast(error.message, 'error');
    }
}

function askId(question, suggestion) {
    const id = (prompt(question, suggestion) ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!id) return null;
    if (state.levels.has(id)) {
        toast(`There's already a level "${id}"`, 'error');
        return null;
    }
    return id;
}

async function addLevel(id, data) {
    state.levels.set(id, data);
    try {
        await api(`/api/mob/level?id=${id}`, { method: 'PUT', body: data });
    } catch (error) {
        toast(error.message, 'error');
        state.dirty.add(id);
    }
    openLevel(id);
}

function newLevel() {
    const id = askId('New level id (lower case, dashes):', 'new-level');
    if (!id) return;
    addLevel(id, {
        name: id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), kind: 'Custom',
        gates: [{ x: -2.45, z: -9, width: 3.6, value: 2 }, { x: 2.45, z: -9, width: 3.6, value: 3 }],
        redRate: 2.4, redRateEnd: 4.4, redRamp: 50, baseHp: 400, reward: 120,
    });
    toast('Created. Add it to a zone (Zones tab) to play it in order.');
}

function duplicateLevel() {
    if (!state.id) return;
    const id = askId('Copy as (new id):', `${state.id}-copy`);
    if (!id) return;
    const data = clone(level());
    data.name = `${data.name} copy`;
    addLevel(id, data);
}

async function deleteLevel() {
    if (!state.id || !confirm(`Delete levels/${state.id}.json?`)) return;
    try {
        await api(`/api/mob/level?id=${state.id}`, { method: 'DELETE' });
        state.levels.delete(state.id);
        state.dirty.delete(state.id);
        openLevel(firstLevelId());
        toast('Deleted');
    } catch (error) {
        toast(error.message, 'error');
    }
}

// ------------------------------------------------------------------ levels tab: editing

/** Call before a change: remembers the level for Undo. */
function checkpoint() {
    state.undo.push(JSON.stringify(level()));
    if (state.undo.length > 100) state.undo.shift();
    state.redo = [];
}

/** After a change: marks it unsaved, redraws, updates the preview. */
function changed({ props = true } = {}) {
    state.dirty.add(state.id);
    renderLevelList();
    if (props) renderProps();
    draw();
    queuePreview();
}

function undo() {
    if (!state.undo.length) return;
    state.redo.push(JSON.stringify(level()));
    state.levels.set(state.id, JSON.parse(state.undo.pop()));
    state.selection = null;
    changed();
}

function redo() {
    if (!state.redo.length) return;
    state.undo.push(JSON.stringify(level()));
    state.levels.set(state.id, JSON.parse(state.redo.pop()));
    state.selection = null;
    changed();
}

const itemOf = (selection) => selection && level()[selection.list]?.[selection.index];

function removeSelected() {
    const s = state.selection;
    const item = itemOf(s);
    if (!item) return;
    checkpoint();
    if (s.vertex !== undefined && item.points) {
        if (item.points.length <= 3) {
            toast('A polygon needs at least 3 corners');
            state.undo.pop();
            return;
        }
        item.points.splice(s.vertex, 1);
        state.selection = { list: s.list, index: s.index };
    } else {
        level()[s.list].splice(s.index, 1);
        if (!level()[s.list].length && s.list !== 'gates') delete level()[s.list];
        state.selection = null;
    }
    changed();
}

function duplicateSelected() {
    const s = state.selection;
    const item = itemOf(s);
    if (!item) return;
    checkpoint();
    const copy = clone(item);
    moveItem(s.list, copy, 1, -1);
    level()[s.list].push(copy);
    state.selection = { list: s.list, index: level()[s.list].length - 1 };
    changed();
}

/** Moves an item (or its copy) by (dx, dz); a pipe's one end (`end`: 'from' / 'to'), or the whole pipe without one. */
function moveItem(list, item, dx, dz, end) {
    if (list === 'pipes') {
        if (end !== 'to') { item.x = fix(item.x + dx); item.z = fix(item.z + dz); }
        if (end !== 'from') { item.toX = fix(item.toX + dx); item.toZ = fix(item.toZ + dz); }
        return;
    }
    if (item.points) {
        item.points = item.points.map(([x, z]) => [fix(x + dx), fix(z + dz)]);
        return;
    }
    item.x = fix((item.x ?? 0) + dx);
    if (list === 'targets') {
        const z = (item.z ?? baseZ()) + dz;
        item.z = Math.abs(z - baseZ()) < 0.01 ? undefined : fix(z);
        if (item.z === undefined) delete item.z;
        return;
    }
    item.z = fix((item.z ?? 0) + dz);
    if (list === 'pushBlocks') {
        item.far = fix(item.far + dz);
        item.near = fix(item.near + dz);
    }
}

function addItem(list, x, z) {
    checkpoint();
    const data = level();
    if (list === 'targets' && !data.targets?.length) {
        // The first fort replaces the one implicit base: keep it as fort 1, so the level still has it.
        data.targets = [{ x: 0, hp: data.baseHp, width: BASE.width }];
    }
    const item = DEFAULTS[list](fix(x), fix(z));
    if (item.z === undefined) delete item.z;
    (data[list] ??= []).push(item);
    state.selection = { list, index: data[list].length - 1 };
    setTool('select');
    changed();
}

function closeDraft() {
    if (state.draft.length < 3) return;
    checkpoint();
    const obstacle = { kind: state.polygonKind, points: state.draft.map(([x, z]) => [fix(x), fix(z)]) };
    if (obstacle.kind === 'breakable') obstacle.hp = 40;
    (level().obstacles ??= []).push(obstacle);
    state.selection = { list: 'obstacles', index: level().obstacles.length - 1 };
    state.draft = [];
    changed();
}

// ------------------------------------------------------------------ levels tab: drawing

let view = { scale: 20, ox: 0, oy: 0 };
let pointerWorld = null;

function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = Math.max(1, rect.height * ratio);
    const margin = 16;
    const VIEW = viewBox();
    const scale = Math.min((rect.width - margin * 2) / (VIEW.side * 2), (rect.height - margin * 2) / (VIEW.near - VIEW.far));
    view = { scale, ox: rect.width / 2, oy: margin - VIEW.far * scale, ratio, size: `${fieldWidth()}x${fieldLength()}` };
    draw();
}

const toScreen = (x, z) => [view.ox + x * view.scale, view.oy + z * view.scale];
const toWorld = (sx, sy) => [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale];
const snapValue = (v) => (state.snap ? Math.round(v / state.snap) * state.snap : v);

function rect(x, z, width, depth, fill, stroke) {
    const [sx, sy] = toScreen(x - width / 2, z - depth / 2);
    ctx.fillStyle = fill;
    ctx.fillRect(sx, sy, width * view.scale, depth * view.scale);
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.strokeRect(sx, sy, width * view.scale, depth * view.scale);
    }
}

function text(value, x, z, size = 13, color = '#fff') {
    const [sx, sy] = toScreen(x, z);
    ctx.font = `bold ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(15, 18, 45, 0.9)';
    ctx.strokeText(value, sx, sy);
    ctx.fillStyle = color;
    ctx.fillText(value, sx, sy);
}

function polygonPath(points) {
    ctx.beginPath();
    points.forEach(([x, z], i) => {
        const [sx, sy] = toScreen(x, z);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
}

function obstacleOutline(o) {
    if (o.points) return o.points;
    if (o.radius !== undefined) return Array.from({ length: 24 }, (_, i) => [o.x + Math.sin((i / 24) * Math.PI * 2) * o.radius, o.z + Math.cos((i / 24) * Math.PI * 2) * o.radius]);
    const w = (o.width ?? 1) / 2;
    const d = (o.depth ?? 1) / 2;
    return [[o.x - w, o.z - d], [o.x + w, o.z - d], [o.x + w, o.z + d], [o.x - w, o.z + d]];
}

function draw() {
    if (!ctx) return;
    const data = level();
    // Another field size (a level opened, its size changed): framed again first.
    if (data && view.size !== `${fieldWidth()}x${fieldLength()}`) {
        resizeCanvas();
        return;
    }
    const VIEW = viewBox();
    ctx.setTransform(view.ratio ?? 1, 0, 0, view.ratio ?? 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!data) return;
    // Ground, field, stripes, hedges, danger line, cannon.
    rect(0, (VIEW.near + VIEW.far) / 2, VIEW.side * 2, VIEW.near - VIEW.far, COLORS.grass);
    rect(0, (VIEW.near + VIEW.far) / 2, halfWidth() * 2, VIEW.near - VIEW.far, COLORS.sand);
    for (let z = 0.5; z > VIEW.far; z -= 4) rect(0, z, halfWidth() * 2, 2, COLORS.stripe);
    for (const side of [-1, 1]) rect(side * (halfWidth() + 0.55), (VIEW.near + VIEW.far) / 2, 1.1, VIEW.near - VIEW.far, COLORS.hedge);
    // A light grid every unit, stronger every 5.
    ctx.lineWidth = 1;
    for (let x = -halfWidth(); x <= halfWidth(); x += 1) {
        ctx.strokeStyle = x % 5 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.08)';
        ctx.beginPath();
        ctx.moveTo(...toScreen(x, VIEW.near));
        ctx.lineTo(...toScreen(x, VIEW.far));
        ctx.stroke();
    }
    for (let z = 0; z >= VIEW.far; z -= 1) {
        ctx.strokeStyle = z % 5 === 0 ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.08)';
        ctx.beginPath();
        ctx.moveTo(...toScreen(-halfWidth(), z));
        ctx.lineTo(...toScreen(halfWidth(), z));
        ctx.stroke();
        if (z % 5 === 0) text(`${z}`, -halfWidth() - 0.9, z, 10, '#d8f5c8');
    }
    rect(0, DANGER_Z, halfWidth() * 2, 0.15, COLORS.red);
    rect(0, CANNON_Z, 8.4, 0.12, '#ffffff');
    rect(0, CANNON_Z, 1.1, 1, COLORS.cannon, '#1b2a55');
    // Obstacles.
    (data.obstacles ?? []).forEach((o, i) => {
        const outline = obstacleOutline(o);
        polygonPath(outline);
        const enemy = o.kind === 'enemyWall';
        // An enemy wall (invisible in the game): see-through red, dashed.
        ctx.fillStyle = enemy ? 'rgba(255, 40, 60, 0.18)' : o.kind === 'water' ? COLORS.water : o.kind === 'breakable' ? COLORS.breakable : COLORS.wall;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = enemy ? '#ff3d4f' : o.kind === 'water' ? '#1f6fae' : o.kind === 'breakable' ? '#7d849e' : COLORS.wallSide;
        if (enemy) ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length;
        const cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
        if (o.kind === 'breakable') text(`${o.hp ?? 40}`, cx, cz, 13);
        if (isSelected('obstacles', i)) {
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = COLORS.select;
            polygonPath(outline);
            ctx.stroke();
            if (o.points) o.points.forEach(([x, z], v) => handle(x, z, state.selection.vertex === v));
        }
    });
    // Gates.
    (data.gates ?? []).forEach((g, i) => {
        // A locked one: grey, its hits on a padlock under its multiplier.
        const locked = (g.lock ?? 0) > 0;
        rect(g.x, g.z, g.width, locked ? 0.6 : 0.35, locked ? '#9aa0a8' : COLORS.gate, isSelected('gates', i) ? COLORS.select : locked ? '#5e646d' : '#1d5fae');
        if (locked) text(`🔒 ${g.lock}`, g.x, g.z + 0.6, 12, '#ffffff');
        if (g.swing) {
            ctx.strokeStyle = 'rgba(79,182,255,0.6)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(...toScreen(g.x - g.swing.range - g.width / 2, g.z));
            ctx.lineTo(...toScreen(g.x + g.swing.range + g.width / 2, g.z));
            ctx.stroke();
            ctx.setLineDash([]);
        }
        text(`x${g.value}`, g.x, g.z - 0.55, 14);
    });
    // Grinders: the roller (spiked edges), its rolling range dashed.
    (data.grinders ?? []).forEach((g, i) => {
        const across = g.axis === 'z' ? g.thickness : g.length;
        const along = g.axis === 'z' ? g.length : g.thickness;
        if (g.move) {
            ctx.strokeStyle = 'rgba(255,71,87,0.7)';
            ctx.setLineDash([5, 4]);
            const reachX = g.axis === 'z' ? g.move.range : 0;
            const reachZ = g.axis === 'x' ? g.move.range : 0;
            const [ax, ay] = toScreen(g.x - across / 2 - reachX, g.z - along / 2 - reachZ);
            const [bx, by] = toScreen(g.x + across / 2 + reachX, g.z + along / 2 + reachZ);
            ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
            ctx.setLineDash([]);
        }
        rect(g.x, g.z, across, along, '#3a3f4b', isSelected('grinders', i) ? COLORS.select : '#ff4757');
        // Spikes along its length.
        ctx.fillStyle = '#d5dae2';
        const count = Math.max(2, Math.round(g.length / 0.4));
        for (let k = 0; k < count; k++) {
            const t = -g.length / 2 + ((k + 0.5) / count) * g.length;
            const [sx, sy] = g.axis === 'z' ? toScreen(g.x, g.z + t) : toScreen(g.x + t, g.z);
            ctx.beginPath();
            ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
        text('GRINDER', g.x, g.z - along / 2 - 0.45, 11, '#ffd0d4');
    });
    // Pipes: each end (its opening a line across, its elbow behind it), joined by a dashed line; the near end "IN".
    (data.pipes ?? []).forEach((p, i) => {
        const selected = isSelected('pipes', i);
        const look = PIPE_TEAMS[p.team ?? 'both'];
        ctx.strokeStyle = selected ? COLORS.select : look.line;
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(...toScreen(p.x, p.z));
        ctx.lineTo(...toScreen(p.toX, p.toZ));
        ctx.stroke();
        ctx.setLineDash([]);
        pipeEnds(p).forEach(([x, z, facing], e) => {
            rect(x, z - facing * PIPE.body / 2, PIPE.radius * 2, PIPE.body, look.fill, selected ? COLORS.select : look.edge);
            rect(x, z, PIPE.radius * 2, 0.18, '#1a1240');
            text(`${look.word} ${facing > 0 ? 'in' : 'out'}`, x, z - facing * PIPE.body / 2, 11, '#ffffff');
            // pipeEnds keeps the order: [0] is (x, z), [1] is (toX, toZ).
            if (selected) handle(x, z, drag?.end === (e === 0 ? 'from' : 'to'));
        });
    });
    // Helmet barriers.
    (data.helmets ?? []).forEach((h, i) => {
        const look = HELMET_KINDS[h.kind === 'attack' ? 'attack' : 'hp'];
        rect(h.x, h.z, h.width, 0.35, look.fill, isSelected('helmets', i) ? COLORS.select : look.stroke);
        text(look.text, h.x, h.z - 0.55, 12, look.ink);
    });
    // Spinners.
    (data.spinners ?? []).forEach((s, i) => {
        const [cx, cy] = toScreen(s.x, s.z);
        ctx.strokeStyle = isSelected('spinners', i) ? COLORS.select : '#2b2f45';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, s.length * view.scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = COLORS.spinner;
        ctx.lineWidth = Math.max(3, 0.36 * view.scale);
        for (let a = 0; a < s.arms; a++) {
            const angle = (a / s.arms) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.sin(angle) * s.length * view.scale, cy + Math.cos(angle) * s.length * view.scale);
            ctx.stroke();
        }
    });
    // Pushers: the bar, and its swing.
    (data.pushers ?? []).forEach((p, i) => {
        ctx.strokeStyle = 'rgba(255,210,63,0.55)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(...toScreen(p.x - p.range - p.width / 2, p.z));
        ctx.lineTo(...toScreen(p.x + p.range + p.width / 2, p.z));
        ctx.stroke();
        ctx.setLineDash([]);
        rect(p.x, p.z, p.width, p.depth, COLORS.pusher, isSelected('pushers', i) ? COLORS.select : '#2b2f45');
    });
    // Giant houses.
    (data.pads ?? []).forEach((p, i) => {
        const look = HOUSE_KINDS[p.kind ?? 'giant'] ?? HOUSE_KINDS.giant;
        rect(p.x, p.z, p.width, p.depth, look.wall, isSelected('pads', i) ? COLORS.select : look.roof);
        rect(p.x, p.z - p.depth * 0.15, p.width, p.depth * 0.5, look.roof);
        rect(p.x, p.z + p.depth / 2 - 0.1, Math.min(p.width * 0.55, 1.6), 0.2, '#14183a');
        text(`${look.label} ${p.need}`, p.x, p.z, 12);
    });
    // PUSH blocks: the block, and its two stops.
    (data.pushBlocks ?? []).forEach((b, i) => {
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        for (const [z, color] of [[b.far, '#7fd0ff'], [b.near, '#ff8a96']]) {
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(...toScreen(b.x - b.width / 2, z));
            ctx.lineTo(...toScreen(b.x + b.width / 2, z));
            ctx.stroke();
        }
        ctx.setLineDash([]);
        rect(b.x, b.z, b.width, b.depth, COLORS.push, isSelected('pushBlocks', i) ? COLORS.select : '#1b2240');
        rect(b.x, b.z, b.width - 0.3, b.depth * 0.45, COLORS.pushPlate);
        text('PUSH', b.x, b.z, 12);
    });
    // Forts (or the one base).
    const targets = data.targets?.length ? data.targets : null;
    if (targets) {
        targets.forEach((t, i) => {
            const z = t.z ?? baseZ();
            const width = t.width ?? BASE.width;
            rect(t.x, z - BASE.depth / 2, width, BASE.depth, COLORS.red, isSelected('targets', i) ? COLORS.select : '#7a1220');
            text(`${t.hp}`, t.x, z - BASE.depth / 2, 13);
        });
    } else {
        rect(0, baseZ() - BASE.depth / 2, BASE.width, BASE.depth, COLORS.red, '#7a1220');
        text(`${data.baseHp}`, 0, baseZ() - BASE.depth / 2, 13);
    }
    // Check gaps' overlay (where its units get stuck).
    gaps.draw(ctx, state.id, toScreen, view.scale);
    // The polygon being drawn.
    if (state.tool === 'polygon' && state.draft.length) {
        ctx.strokeStyle = COLORS.select;
        ctx.lineWidth = 2;
        ctx.beginPath();
        state.draft.forEach(([x, z], i) => (i ? ctx.lineTo(...toScreen(x, z)) : ctx.moveTo(...toScreen(x, z))));
        if (pointerWorld) ctx.lineTo(...toScreen(...pointerWorld));
        ctx.stroke();
        state.draft.forEach(([x, z], i) => handle(x, z, i === 0));
    }
    if (pointerWorld) {
        const [x, z] = pointerWorld;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(6, 6, 118, 20);
        ctx.fillStyle = '#fff';
        ctx.font = '12px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(`x ${x.toFixed(2)}  z ${z.toFixed(2)}`, 12, 17);
    }
}

function handle(x, z, active) {
    const [sx, sy] = toScreen(x, z);
    ctx.fillStyle = active ? COLORS.select : '#ffffff';
    ctx.strokeStyle = '#14183a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
}

const isSelected = (list, index) => state.selection?.list === list && state.selection.index === index;

// ------------------------------------------------------------------ levels tab: picking

function pick(x, z) {
    const data = level();
    for (const list of PICK_ORDER) {
        const items = data[list] ?? [];
        for (let i = items.length - 1; i >= 0; i--) if (hits(list, items[i], x, z)) return { list, index: i };
    }
    return null;
}

function hits(list, item, x, z) {
    const inRect = (cx, cz, w, d) => Math.abs(x - cx) <= w / 2 && Math.abs(z - cz) <= d / 2;
    switch (list) {
        case 'gates': case 'helmets': return inRect(item.x, item.z, item.width, 0.8);
        case 'spinners': return Math.hypot(x - item.x, z - item.z) <= item.length;
        case 'pushers': return inRect(item.x, item.z, item.width, Math.max(0.6, item.depth));
        case 'pads': case 'pushBlocks': return inRect(item.x, item.z, item.width, item.depth);
        case 'pipes': return pipeEndAt(item, x, z) !== null;
        case 'grinders': return item.axis === 'z' ? inRect(item.x, item.z, Math.max(0.6, item.thickness), item.length) : inRect(item.x, item.z, item.length, Math.max(0.6, item.thickness));
        case 'targets': return inRect(item.x, (item.z ?? baseZ()) - BASE.depth / 2, item.width ?? BASE.width, BASE.depth);
        case 'obstacles': return pointInPolygon(x, z, obstacleOutline(item));
        default: return false;
    }
}

/** A corner of the selected polygon under the pointer, if any. */
function pickVertex(x, z) {
    const item = itemOf(state.selection);
    if (!item?.points) return -1;
    const reach = 8 / view.scale;
    return item.points.findIndex(([px, pz]) => Math.hypot(px - x, pz - z) <= reach);
}

// ------------------------------------------------------------------ levels tab: pointer

let drag = null;

function eventWorld(event) {
    const box = canvas.getBoundingClientRect();
    return toWorld(event.clientX - box.left, event.clientY - box.top);
}

function onPointerDown(event) {
    if (!level()) return;
    const [rx, rz] = eventWorld(event);
    const x = snapValue(rx);
    const z = snapValue(rz);
    if (state.tool === 'polygon') {
        if (state.draft.length >= 3) {
            const [fx, fz] = state.draft[0];
            if (Math.hypot(fx - rx, fz - rz) <= 10 / view.scale) {
                closeDraft();
                return;
            }
        }
        state.draft.push([x, z]);
        draw();
        return;
    }
    if (state.tool !== 'select') {
        addItem(state.tool, x, z);
        return;
    }
    const vertex = pickVertex(rx, rz);
    if (vertex >= 0) {
        state.selection = { ...state.selection, vertex };
        drag = { kind: 'vertex', before: JSON.stringify(level()), moved: false };
        renderProps();
        draw();
        canvas.setPointerCapture(event.pointerId);
        return;
    }
    state.selection = pick(rx, rz);
    renderProps();
    draw();
    if (state.selection) {
        // A pipe's end under the pointer moves alone.
        const end = state.selection.list === 'pipes' ? pipeEndAt(itemOf(state.selection), rx, rz) : undefined;
        drag = { kind: 'item', before: JSON.stringify(level()), start: [x, z], original: clone(itemOf(state.selection)), moved: false, end };
        canvas.setPointerCapture(event.pointerId);
    }
}

function onPointerMove(event) {
    const [rx, rz] = eventWorld(event);
    pointerWorld = [snapValue(rx), snapValue(rz)];
    if (!drag) {
        draw();
        return;
    }
    const item = itemOf(state.selection);
    if (!item) return;
    if (drag.kind === 'vertex') {
        item.points[state.selection.vertex] = [fix(pointerWorld[0]), fix(pointerWorld[1])];
    } else {
        const dx = pointerWorld[0] - drag.start[0];
        const dz = pointerWorld[1] - drag.start[1];
        const fresh = clone(drag.original);
        moveItem(state.selection.list, fresh, dx, dz, drag.end);
        level()[state.selection.list][state.selection.index] = fresh;
    }
    drag.moved = true;
    draw();
    queuePreview();
}

function onPointerUp() {
    if (!drag) return;
    if (drag.moved) {
        state.undo.push(drag.before);
        state.redo = [];
        changed();
    }
    drag = null;
}

function onDoubleClick(event) {
    const item = itemOf(state.selection);
    if (state.tool !== 'select' || !item?.points) return;
    const [rx, rz] = eventWorld(event);
    // Add a corner on the nearest edge.
    let best = -1;
    let bestDistance = 12 / view.scale;
    item.points.forEach((point, i) => {
        const distance = distanceToSegment(rx, rz, point, item.points[(i + 1) % item.points.length]);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
        }
    });
    if (best < 0) return;
    checkpoint();
    item.points.splice(best + 1, 0, [fix(snapValue(rx)), fix(snapValue(rz))]);
    state.selection = { ...state.selection, vertex: best + 1 };
    changed();
}

function onKey(event) {
    if (levelsTab.hidden) return;
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveLevel();
        return;
    }
    if (typing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
    }
    if (event.key === 'Escape') {
        if (state.draft.length) state.draft = [];
        else if (state.tool !== 'select') setTool('select');
        else state.selection = null;
        renderProps();
        draw();
    } else if (event.key === 'Enter' && state.tool === 'polygon') closeDraft();
    else if (event.key === 'Backspace' && state.tool === 'polygon' && state.draft.length) {
        state.draft.pop();
        draw();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeSelected();
    } else if (event.key.toLowerCase() === 'v') setTool('select');
    else if (event.key.toLowerCase() === 'p') setTool('polygon');
    else if (event.key.startsWith('Arrow') && state.selection) {
        event.preventDefault();
        const step = event.shiftKey ? 1 : state.snap || 0.05;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dz = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        checkpoint();
        const item = itemOf(state.selection);
        if (state.selection.vertex !== undefined && item.points) {
            const p = item.points[state.selection.vertex];
            item.points[state.selection.vertex] = [fix(p[0] + dx), fix(p[1] + dz)];
        } else moveItem(state.selection.list, item, dx, dz);
        changed();
    }
}

// ------------------------------------------------------------------ levels tab: properties

function numberField(object, key, onChange, { step = 0.05, hint } = {}) {
    const input = el('input', { type: 'number', step, value: object[key] ?? '', title: hint ?? FIELD_HINTS[key] ?? '' });
    input.addEventListener('change', () => {
        checkpoint();
        if (input.value === '') delete object[key];
        else object[key] = Number(input.value);
        onChange?.();
        changed();
    });
    return el('div', { class: 'field' }, el('label', { title: hint ?? FIELD_HINTS[key] ?? '' }, key), input);
}

/**
 * The field's size: a preset, or its own width / length. Unset = the default (10 x 24). It grows from the bottom centre,
 * so nothing placed moves; pieces left outside a smaller field are flagged.
 */
function fieldSizeFields(data) {
    const set = (width, length) => {
        checkpoint();
        if (width === FIELD.width) delete data.width; else data.width = width;
        if (length === FIELD.length) delete data.length; else data.length = length;
        changed();
    };
    const current = FIELD_SIZES.findIndex((size) => size.width === fieldWidth() && size.length === fieldLength());
    const preset = el('select', { onchange: (e) => { if (e.target.value !== '') { const size = FIELD_SIZES[Number(e.target.value)]; set(size.width, size.length); } } },
        ...FIELD_SIZES.map((size, i) => el('option', { value: i, selected: i === current }, size.label)),
        ...(current < 0 ? [el('option', { value: '', selected: true }, `custom ${fieldWidth()} x ${fieldLength()}`)] : []));
    const number = (key, value, most) => {
        const input = el('input', { type: 'number', step: 1, min: 4, max: most, value, title: key === 'width' ? 'across (x), centred' : 'cannon to base (z): the base moves back' });
        input.addEventListener('change', () => {
            const v = Math.min(most, Math.max(4, Math.round(Number(input.value) || 0)));
            if (key === 'width') set(v, fieldLength()); else set(fieldWidth(), v);
        });
        return el('div', { class: 'field' }, el('label', {}, key), input);
    };
    const box = el('div', {},
        el('div', { class: 'field' }, el('label', { title: "The field's size: it grows from the bottom centre (the cannon's end)" }, 'size'), preset),
        number('width', fieldWidth(), FIELD.maxWidth),
        number('length', fieldLength(), FIELD.maxLength));
    const outside = outsideField(data);
    if (outside) box.append(el('p', { class: 'hint', style: { color: '#ff8a8a' } }, `${outside} piece(s) are outside the field.`));
    return box;
}

/** How many of the level's pieces are past the field's sides or behind its base (after it was made smaller). */
function outsideField(data) {
    const hw = halfWidth() + 0.01;
    const far = baseZ() - 0.01;
    const out = (x, z) => Math.abs(x) > hw || (z !== undefined && z < far);
    let count = 0;
    for (const list of ['gates', 'spinners', 'pushers', 'pads', 'pushBlocks', 'helmets', 'targets']) {
        for (const item of data[list] ?? []) if (out(item.x, item.z)) count++;
    }
    for (const o of data.obstacles ?? []) {
        if (o.points ? o.points.some(([x, z]) => out(x, z)) : out(o.x, o.z)) count++;
    }
    return count;
}

function textField(object, key) {
    const input = el('input', { type: 'text', value: object[key] ?? '' });
    input.addEventListener('change', () => {
        checkpoint();
        object[key] = input.value;
        changed();
    });
    return el('div', { class: 'field' }, el('label', {}, key), input);
}

function renderProps() {
    if (!propsPanel) return;
    propsPanel.replaceChildren();
    const data = level();
    if (!data) {
        propsPanel.append(el('p', { class: 'hint' }, 'No level open.'));
        return;
    }
    const s = state.selection;
    const item = itemOf(s);
    if (!item) {
        propsPanel.append(el('h3', {}, `Level · ${state.id}`));
        // Its zone (the play order and its look): moving it here edits the Zones tab's list (save it there, or here).
        const current = state.zones.zones.find((zone) => zone.levels.includes(state.id));
        const zone = el('select', {
            title: 'Which zone plays this level (its look comes from the zone\'s theme)',
            onchange: (e) => {
                for (const z of state.zones.zones) z.levels = z.levels.filter((id) => id !== state.id);
                const target = state.zones.zones.find((z) => z.id === e.target.value);
                if (target) target.levels.push(state.id);
                zonesDirty = true;
                saveZones();
                openLevel(state.id);
            },
        }, el('option', { value: '' }, '(no zone)'), ...state.zones.zones.map((z) => el('option', { value: z.id, selected: z === current }, `${z.name} · ${z.theme}`)));
        propsPanel.append(el('div', { class: 'field' }, el('label', {}, 'zone'), zone));
        propsPanel.append(fieldSizeFields(data));
        for (const [key, type] of LEVEL_FIELDS) propsPanel.append(type === 'text' ? textField(data, key) : numberField(data, key, null, { step: 0.1 }));
        propsPanel.append(el('p', { class: 'hint' }, data.targets?.length
            ? `${data.targets.length} forts (baseHp is not used).`
            : 'One base, baseHp hits. Place forts (Fort) for a multi-target level.'));
        propsPanel.append(gaps.panel(state.id, data));
        if (grades) propsPanel.append(grades.panel(state.id));
        propsPanel.append(el('p', { class: 'hint' }, 'Zones (the order levels play in, and each one\'s look) are in the Zones tab at the top: + Zone adds one (pick its theme), "+ add a level…" puts levels in it, ↑ ↓ reorder, Save zones.'));
        propsPanel.append(el('p', { class: 'hint' }, 'Click a piece to edit it. Polygon: click corners, Enter closes. Double-click an edge to add a corner, Delete removes the selection, arrows nudge (Shift: 1 unit), Ctrl+D duplicates, Ctrl+Z undoes, Ctrl+S saves.'));
        return;
    }
    propsPanel.append(el('h3', {}, `${LIST_NAMES[s.list]} ${s.index + 1}`));
    if (s.list === 'obstacles') {
        const kind = el('select', {
            onchange: (e) => {
                checkpoint();
                item.kind = e.target.value;
                if (item.kind === 'breakable') item.hp ??= 40;
                else delete item.hp;
                changed();
            },
        }, ...['wall', 'water', 'breakable', 'enemyWall'].map((k) => el('option', { value: k, selected: item.kind === k }, k === 'enemyWall' ? 'enemy wall' : k)));
        propsPanel.append(el('div', { class: 'field' }, el('label', {}, 'kind'), kind));
        if (item.kind === 'enemyWall') propsPanel.append(el('p', { class: 'hint' }, 'Enemy wall: not seen in the game. Reds steer round it as round a wall; blues walk straight through.'));
        if (item.kind === 'breakable') propsPanel.append(numberField(item, 'hp', null, { step: 1 }));
        if (item.points) {
            propsPanel.append(el('p', { class: 'hint' }, `${item.points.length} corners. Drag a corner to move it; double-click an edge to add one.`));
            if (s.vertex !== undefined && item.points[s.vertex]) {
                const corner = { x: item.points[s.vertex][0], z: item.points[s.vertex][1] };
                const apply = () => { item.points[s.vertex] = [corner.x, corner.z]; };
                propsPanel.append(el('h3', {}, `Corner ${s.vertex + 1}`), numberField(corner, 'x', apply), numberField(corner, 'z', apply));
            }
        } else {
            for (const key of ['x', 'z', 'width', 'depth', 'radius']) if (item[key] !== undefined) propsPanel.append(numberField(item, key));
            propsPanel.append(el('button', {
                onclick: () => {
                    checkpoint();
                    const points = obstacleOutline(item).map(([x, z]) => [fix(x), fix(z)]);
                    for (const key of ['x', 'z', 'width', 'depth', 'radius']) delete item[key];
                    item.points = points;
                    changed();
                },
            }, 'Turn into a polygon'));
        }
    } else {
        const keys = { gates: ['x', 'z', 'width', 'value', 'lock'], spinners: ['x', 'z', 'length', 'arms', 'speed'], pushers: ['x', 'z', 'width', 'depth', 'range', 'seconds', 'phase'], pads: ['x', 'z', 'width', 'depth', 'need'], pushBlocks: ['x', 'z', 'width', 'depth', 'far', 'near'], helmets: ['x', 'z', 'width'], pipes: ['x', 'z', 'toX', 'toZ'], grinders: ['x', 'z', 'length', 'thickness'], targets: ['x', 'z', 'width', 'hp'] }[s.list];
        if (s.list === 'pads') {
            const kind = el('select', {
                onchange: (e) => {
                    checkpoint();
                    item.kind = e.target.value;
                    changed();
                },
            }, ...Object.entries(HOUSE_KINDS).map(([k, info]) => el('option', { value: k, selected: (item.kind ?? 'giant') === k }, info.label.toLowerCase())));
            propsPanel.append(el('div', { class: 'field' }, el('label', { title: 'What it makes' }, 'makes'), kind));
        }
        if (s.list === 'helmets') {
            const kind = el('select', {
                onchange: (e) => {
                    checkpoint();
                    if (e.target.value === 'attack') item.kind = 'attack';
                    else delete item.kind;
                    changed();
                },
            }, ...Object.entries(HELMET_KINDS).map(([k, info]) => el('option', { value: k, selected: (item.kind ?? 'hp') === k }, info.label)));
            propsPanel.append(el('div', { class: 'field' }, el('label', { title: 'What blues going through get' }, 'gives'), kind));
        }
        for (const key of keys) propsPanel.append(numberField(item, key, null, { step: ['value', 'arms', 'need', 'hp', 'lock'].includes(key) ? 1 : 0.05 }));
        if (s.list === 'gates') {
            const swing = el('input', { type: 'checkbox', checked: !!item.swing });
            swing.addEventListener('change', () => {
                checkpoint();
                if (swing.checked) item.swing = { range: 2.5, seconds: 5 };
                else delete item.swing;
                changed();
            });
            propsPanel.append(el('div', { class: 'field' }, el('label', {}, 'swings'), swing));
            if (item.swing) propsPanel.append(numberField(item.swing, 'range'), numberField(item.swing, 'seconds'));
        }
        if (s.list === 'pipes') {
            const team = el('select', {
                onchange: (e) => {
                    checkpoint();
                    item.team = e.target.value;
                    changed();
                },
            }, ...Object.entries(PIPE_TEAMS).map(([key, info]) => el('option', { value: key, selected: (item.team ?? 'both') === key }, info.label)));
            propsPanel.append(el('div', { class: 'field' }, el('label', { title: 'Who can go through it: the others steer round its ends' }, 'who'), team));
        }
        if (s.list === 'grinders') {
            const axis = el('select', {
                onchange: (e) => {
                    checkpoint();
                    item.axis = e.target.value;
                    changed();
                },
            }, el('option', { value: 'x', selected: item.axis !== 'z' }, 'horizontal (across)'), el('option', { value: 'z', selected: item.axis === 'z' }, 'vertical (along)'));
            propsPanel.append(el('div', { class: 'field' }, el('label', { title: 'Which way it lies' }, 'lies'), axis));
            const moves = el('input', { type: 'checkbox', checked: !!item.move });
            moves.addEventListener('change', () => {
                checkpoint();
                if (moves.checked) item.move = { range: 3, seconds: 4 };
                else delete item.move;
                changed();
            });
            propsPanel.append(el('div', { class: 'field' }, el('label', { title: 'Rolls back and forth (a horizontal one up and down the field, a vertical one across it); unticked it stands and spins' }, 'rolls'), moves));
            if (item.move) propsPanel.append(numberField(item.move, 'range', null, { hint: 'how far either way' }), numberField(item.move, 'seconds', null, { hint: 'a full trip there and back' }));
        }
        if (s.list === 'targets') propsPanel.append(el('p', { class: 'hint' }, `z empty = the base line (${baseZ()}).`));
        if (s.list === 'pushBlocks') propsPanel.append(el('p', { class: 'hint' }, 'Blue dashes: the far stop (blues open the lane there). Red dashes: the near stop (the reds open it).'));
    }
    propsPanel.append(el('div', { class: 'field', style: { marginTop: '12px' } },
        el('button', { onclick: duplicateSelected }, 'Duplicate'),
        el('button', { class: 'danger', onclick: removeSelected }, s.vertex !== undefined ? 'Delete corner' : 'Delete')));
}

// ------------------------------------------------------------------ levels tab: preview

let previewTimer = 0;

function previewUrl() {
    const url = new URL(state.gameUrl);
    url.searchParams.set('preview', '1');
    if (state.id) url.searchParams.set('level', state.id);
    url.searchParams.set('theme', state.theme);
    return url.toString();
}

function reloadPreview() {
    if (!preview || !state.id) return;
    preview.src = previewUrl();
}

function queuePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 250);
}

function sendPreview() {
    if (!preview?.contentWindow || !level()) return;
    preview.contentWindow.postMessage({ type: 'mob-level', level: level(), theme: state.theme }, '*');
}

// ------------------------------------------------------------------ zones tab

let zonesDirty = false;
let zonesBody;

function buildZonesTab() {
    zonesBody = el('div', { class: 'zones' });
    zonesTab.append(el('div', { class: 'editor' },
        el('div', { class: 'toolbar' },
            el('button', { onclick: addZone }, '+ Zone'),
            el('span', { class: 'hint' }, 'A zone is looks only: its theme draws its levels. Levels play zone by zone, in order; any level works in any theme.'),
            el('span', { style: { flex: 1 } }),
            el('button', { class: 'primary', onclick: saveZones }, 'Save zones')),
        zonesBody));
}

function zonesChanged() {
    zonesDirty = true;
    renderZones();
    renderLevelList();
}

function addZone() {
    const id = (prompt('Zone id (lower case, dashes):', 'castle') ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!id) return;
    if (state.zones.zones.some((zone) => zone.id === id)) {
        toast('That id is taken', 'error');
        return;
    }
    state.zones.zones.push({ id, name: id.replace(/\b\w/g, (c) => c.toUpperCase()), theme: state.themes.find((t) => t.id === id)?.id ?? state.themes[0]?.id ?? 'beach', levels: [] });
    zonesChanged();
}

async function saveZones() {
    try {
        await api('/api/mob/zones', { method: 'PUT', body: state.zones });
        zonesDirty = false;
        renderZones();
        toast('Saved ui/zones.json', 'ok');
    } catch (error) {
        toast(error.message, 'error');
    }
}

function renderZones() {
    if (!zonesBody) return;
    zonesBody.replaceChildren();
    const zones = state.zones.zones;
    zones.forEach((zone, z) => {
        const name = el('input', { type: 'text', value: zone.name, onchange: (e) => { zone.name = e.target.value; zonesChanged(); } });
        const theme = el('select', { onchange: (e) => { zone.theme = e.target.value; zonesChanged(); } },
            ...state.themes.map((t) => el('option', { value: t.id, selected: t.id === zone.theme }, t.name)));
        const list = el('div', {});
        zone.levels.forEach((id, i) => {
            const move = (to) => {
                const [taken] = zone.levels.splice(i, 1);
                zone.levels.splice(to, 0, taken);
                zonesChanged();
            };
            list.append(el('div', { class: 'lv' },
                el('span', { title: id }, `${i + 1}. ${state.levels.get(id)?.name ?? `${id} (missing)`}`),
                grades?.chips(state.levels.get(id)) ?? null,
                gaps.mark(id, state.levels.get(id)),
                grades?.badge(id) ?? null,
                el('button', { title: 'Up', disabled: i === 0, onclick: () => move(i - 1) }, '↑'),
                el('button', { title: 'Down', disabled: i === zone.levels.length - 1, onclick: () => move(i + 1) }, '↓'),
                el('button', { title: 'Edit', onclick: () => { document.querySelector('header [data-tab="levels"]').click(); openLevel(id); } }, '✎'),
                el('button', { title: 'Take out of the zone', onclick: () => { zone.levels.splice(i, 1); zonesChanged(); } }, '✕')));
        });
        const add = el('select', {
            onchange: (e) => {
                if (!e.target.value) return;
                zone.levels.push(e.target.value);
                zonesChanged();
            },
        }, el('option', { value: '' }, '+ add a level…'),
            ...[...state.levels.keys()].sort().map((id) => el('option', { value: id }, `${state.levels.get(id).name} (${id})`)));
        zonesBody.append(el('div', { class: 'zone' },
            el('div', { class: 'field' }, el('label', {}, 'name'), name),
            el('div', { class: 'field' }, el('label', {}, 'id'), el('span', { class: 'hint' }, zone.id)),
            el('div', { class: 'field' }, el('label', {}, 'theme'), theme),
            plainFortsField(zone),
            el('h3', { class: 'hint' }, `Levels (${zone.levels.length})`),
            list,
            add,
            el('div', { class: 'field', style: { marginTop: '10px' } },
                el('button', { disabled: z === 0, onclick: () => { zones.splice(z - 1, 0, zones.splice(z, 1)[0]); zonesChanged(); } }, '← Earlier'),
                el('button', { disabled: z === zones.length - 1, onclick: () => { zones.splice(z + 1, 0, zones.splice(z, 1)[0]); zonesChanged(); } }, 'Later →'),
                el('button', { class: 'danger', onclick: () => { if (confirm(`Remove zone ${zone.name}? (Its levels stay.)`)) { zones.splice(z, 1); zonesChanged(); } } }, 'Remove'))));
    });
    statusLine.textContent = zonesDirty ? 'Zones not saved' : '';
}

/** A zone's "plain forts": the enemy's forts made in the game, not the barracks and tower models. */
function plainFortsField(zone) {
    const box = el('input', { type: 'checkbox', checked: !!zone.plainForts });
    box.addEventListener('change', () => {
        if (box.checked) zone.plainForts = true;
        else delete zone.plainForts;
        zonesChanged();
    });
    return el('div', { class: 'field' }, el('label', { title: 'The red barracks and tower models off: the plain forts made in the game' }, 'plain forts'), box);
}

// ------------------------------------------------------------------ themes tab
//
// Each theme (ui/themes.json) is a zone's look: colours, what's round the field (the sea, or a valley of cliffs), wall
// pieces and corner towers from a kit, and props scattered outside the field (any model in public/mob/models — pick one,
// or import one from library3d). The game on the right draws a level in the theme as it's edited.

let themesDirty = false;
let themeId = null;
let themeList;
let themeForm;
let themePreview;
let themeLevel = null;

const COLOUR_FIELDS = [
    ['sky', 'Sky'], ['ground', 'Ground'], ['field', 'Field'], ['stripe', 'Field stripes'], ['sea', 'Water (sea, holes)'],
    ['rim', 'Water hole rim'],
];
const PAIR_FIELDS = [['block', 'Walls (top / side)'], ['breakable', 'Breakables (top / side)']];

const currentTheme = () => state.themes.find((theme) => theme.id === themeId);

function buildThemesTab() {
    themeList = el('div', { class: 'list' });
    themeForm = el('div', { class: 'theme-form' });
    themePreview = el('iframe', { title: 'Theme preview' });
    themePreview.addEventListener('load', () => {});
    window.addEventListener('message', (event) => {
        if (event.source === themePreview.contentWindow && event.data?.type === 'mob-ready') sendThemePreview();
    });
    const levelPick = el('select', { onchange: (e) => { themeLevel = e.target.value; reloadThemePreview(); } },
        ...[...state.levels.keys()].sort().map((id) => el('option', { value: id }, state.levels.get(id).name)));
    themeLevel = levelPick.value;
    themesTab.append(
        el('aside', {}, themeList, el('div', { class: 'tools' },
            el('button', { onclick: newTheme }, '+ New theme'),
            el('button', { class: 'danger', onclick: deleteTheme }, 'Delete'))),
        el('div', { class: 'editor' },
            el('div', { class: 'toolbar' },
                el('span', { class: 'hint' }, 'A zone\'s look. Pick it per zone in the Zones tab.'),
                el('span', { style: { flex: 1 } }),
                el('button', { class: 'primary', onclick: saveThemes }, 'Save themes')),
            themeForm),
        el('div', { class: 'preview' },
            el('div', { class: 'bar' }, el('span', { class: 'hint' }, 'Preview on'), levelPick, el('span', { style: { flex: 1 } }),
                el('button', { onclick: reloadThemePreview }, 'Reload')),
            themePreview),
    );
    themeId = state.themes[0]?.id ?? null;
}

function renderThemes() {
    themeList.replaceChildren(...state.themes.map((theme) => el('div', {
        class: `row${theme.id === themeId ? ' sel' : ''}`,
        onclick: () => { themeId = theme.id; renderThemes(); reloadThemePreview(); },
    }, el('span', {}, theme.name), el('small', {}, theme.surround))));
    renderThemeForm();
    if (!themePreview.src) reloadThemePreview();
    statusLine.textContent = themesDirty ? 'Themes not saved' : '';
}

function themeChanged({ form = false } = {}) {
    themesDirty = true;
    statusLine.textContent = 'Themes not saved';
    if (form) renderThemeForm();
    clearTimeout(themeTimer);
    themeTimer = setTimeout(sendThemePreview, 250);
}
let themeTimer = 0;

function colourInput(object, key, label) {
    const input = el('input', { type: 'color', value: object[key] ?? '#888888' });
    input.addEventListener('input', () => { object[key] = input.value; themeChanged(); });
    return el('div', { class: 'field' }, el('label', {}, label), input);
}

function numberInput(object, key, label, step = 0.1) {
    const input = el('input', { type: 'number', step, value: object[key] ?? '' });
    input.addEventListener('change', () => { object[key] = Number(input.value); themeChanged(); });
    return el('div', { class: 'field' }, el('label', {}, label), input);
}

async function pickModel(current, onPick) {
    const { setModelCatalog, openModelPicker } = await import('./modelPicker.js');
    setModelCatalog(await api('/api/models'));
    openModelPicker({ current, title: 'Choose a model (public/mob/models)', confirmLabel: 'Use it', onPick: (path) => onPick(path) });
}

async function importModel(onPick) {
    const { openLibraryPicker } = await import('./library.js');
    openLibraryPicker({ onImported: (path) => onPick(path) });
}

/** A model slot: its path, Pick (game models) and Library (import from library3d). */
function modelSlot(current, onPick) {
    return [
        el('code', { title: current ?? '' }, current ?? '—'),
        el('button', { title: 'Pick from the game\'s models', onclick: () => pickModel(current, onPick) }, 'Pick'),
        el('button', { title: 'Import from library3d', onclick: () => importModel(onPick) }, 'Library'),
    ];
}

function renderThemeForm() {
    const theme = currentTheme();
    themeForm.replaceChildren();
    if (!theme) {
        themeForm.append(el('p', { class: 'hint' }, 'No theme. + New theme.'));
        return;
    }
    const name = el('input', { type: 'text', value: theme.name, onchange: (e) => { theme.name = e.target.value; themeChanged(); renderThemes(); } });
    themeForm.append(el('h3', {}, `Theme · ${theme.id}`), el('div', { class: 'field' }, el('label', {}, 'name'), name));
    // Surroundings.
    const surround = el('select', {
        onchange: (e) => {
            theme.surround = e.target.value;
            if (theme.surround === 'valley') theme.cliff ??= { height: 3, top: theme.ground, side: '#a8774a' };
            themeChanged({ form: true });
        },
    }, el('option', { value: 'sea', selected: theme.surround === 'sea' }, 'island in the sea'), el('option', { value: 'valley', selected: theme.surround === 'valley' }, 'valley (cliffs)'));
    themeForm.append(el('h3', {}, 'Around the field'), el('div', { class: 'field' }, el('label', {}, 'surround'), surround));
    if (theme.surround === 'valley' && theme.cliff) {
        themeForm.append(numberInput(theme.cliff, 'height', 'cliff height'), colourInput(theme.cliff, 'top', 'cliff top'), colourInput(theme.cliff, 'side', 'cliff face'));
    }
    // Colours.
    themeForm.append(el('h3', {}, 'Colours'));
    for (const [key, label] of COLOUR_FIELDS) themeForm.append(colourInput(theme, key, label));
    for (const [key, label] of PAIR_FIELDS) {
        const top = el('input', { type: 'color', value: theme[key].top });
        const side = el('input', { type: 'color', value: theme[key].side });
        top.addEventListener('input', () => { theme[key].top = top.value; themeChanged(); });
        side.addEventListener('input', () => { theme[key].side = side.value; themeChanged(); });
        themeForm.append(el('div', { class: 'field' }, el('label', {}, label), el('span', {}, top, ' ', side)));
    }
    const hedgeA = el('input', { type: 'color', value: theme.hedge[0] });
    const hedgeB = el('input', { type: 'color', value: theme.hedge[1] });
    hedgeA.addEventListener('input', () => { theme.hedge[0] = hedgeA.value; themeChanged(); });
    hedgeB.addEventListener('input', () => { theme.hedge[1] = hedgeB.value; themeChanged(); });
    themeForm.append(el('div', { class: 'field' }, el('label', { title: 'Down the field\'s sides on an island with no kit walls' }, 'Hedges'), el('span', {}, hedgeA, ' ', hedgeB)));
    // The kit: walls, towers.
    theme.kit ??= { scale: 1.25, props: [] };
    const kit = theme.kit;
    kit.props ??= [];
    themeForm.append(el('h3', {}, 'Walls and towers (optional)'), numberInput(kit, 'scale', 'piece scale'));
    const slotRow = (label, current, onPick, onClear) => el('div', { class: 'prop-row', style: { gridTemplateColumns: '90px 1fr auto auto auto' } },
        el('label', { class: 'hint' }, label), ...modelSlot(current, onPick), el('button', { title: 'None', onclick: onClear }, '✕'));
    themeForm.append(
        slotRow('side wall', kit.wall, (path) => { kit.wall = path; themeChanged({ form: true }); }, () => { delete kit.wall; themeChanged({ form: true }); }),
        slotRow('wall pillar', kit.pillar, (path) => { kit.pillar = path; kit.pillarEvery ??= 4; themeChanged({ form: true }); }, () => { delete kit.pillar; themeChanged({ form: true }); }),
    );
    (kit.tower ?? []).forEach((piece, i) => themeForm.append(slotRow(`tower piece ${i + 1}`, piece,
        (path) => { kit.tower[i] = path; themeChanged({ form: true }); },
        () => { kit.tower.splice(i, 1); themeChanged({ form: true }); })));
    themeForm.append(el('button', { onclick: () => pickModel(null, (path) => { (kit.tower ??= []).push(path); themeChanged({ form: true }); }) }, '+ tower piece (stacked)'));
    // Props.
    themeForm.append(el('h3', {}, 'Props outside the field'), el('p', { class: 'hint' }, 'Trees, rocks, anything: each scaled to its height (world units; a mob is 1.6) and scattered count times on both sides (on the cliffs in a valley).'));
    kit.props.forEach((prop, i) => {
        const height = el('input', { type: 'number', step: 0.1, value: prop.height, title: 'height' });
        height.addEventListener('change', () => { prop.height = Number(height.value); themeChanged(); });
        const count = el('input', { type: 'number', step: 1, value: prop.count, title: 'how many' });
        count.addEventListener('change', () => { prop.count = Number(count.value); themeChanged(); });
        themeForm.append(el('div', { class: 'prop-row' },
            el('code', { title: prop.model }, prop.model), height, count,
            el('button', { onclick: () => pickModel(prop.model, (path) => { prop.model = path; themeChanged({ form: true }); }) }, 'Pick'),
            el('button', { onclick: () => importModel((path) => { prop.model = path; themeChanged({ form: true }); }) }, 'Library'),
            el('button', { class: 'danger', onclick: () => { kit.props.splice(i, 1); themeChanged({ form: true }); } }, '✕')));
    });
    themeForm.append(el('div', { class: 'field', style: { justifyContent: 'flex-start' } },
        el('button', { onclick: () => pickModel(null, (path) => { kit.props.push({ model: path, height: 2, count: 6 }); themeChanged({ form: true }); }) }, '+ prop from the game\'s models'),
        el('button', { onclick: () => importModel((path) => { kit.props.push({ model: path, height: 2, count: 6 }); themeChanged({ form: true }); }) }, '+ prop from library3d')));
}

function newTheme() {
    const base = currentTheme() ?? state.themes[0];
    const id = (prompt('New theme id (lower case, dashes):', 'desert-2') ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!id) return;
    if (state.themes.some((theme) => theme.id === id)) {
        toast('That id is taken', 'error');
        return;
    }
    const theme = base ? clone(base) : { surround: 'sea', hedge: ['#4ea83a', '#3f9130'], block: { top: '#6fc94f', side: '#9a6a3c' }, breakable: { top: '#d4d8e6', side: '#7d849e' } };
    theme.id = id;
    theme.name = id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    state.themes.push(theme);
    themeId = id;
    themeChanged();
    renderThemes();
    toast('Copied from ' + (base?.name ?? 'defaults') + '. Save themes, then use it on a zone (Zones tab).');
}

function deleteTheme() {
    const theme = currentTheme();
    if (!theme) return;
    const user = state.zones.zones.find((zone) => zone.theme === theme.id);
    if (user) {
        toast(`Zone ${user.name} uses it: give that zone another theme first`, 'error');
        return;
    }
    if (!confirm(`Delete theme ${theme.name}?`)) return;
    state.themes = state.themes.filter((other) => other !== theme);
    themeId = state.themes[0]?.id ?? null;
    themeChanged();
    renderThemes();
}

async function saveThemes() {
    try {
        await api('/api/mob/themes', { method: 'PUT', body: { themes: state.themes } });
        themesDirty = false;
        statusLine.textContent = '';
        toast('Saved ui/themes.json', 'ok');
        renderZones();
    } catch (error) {
        toast(error.message, 'error');
    }
}

function reloadThemePreview() {
    if (!themePreview || !themeLevel) return;
    const url = new URL(state.gameUrl);
    url.searchParams.set('preview', '1');
    url.searchParams.set('level', themeLevel);
    themePreview.src = url.toString();
}

function sendThemePreview() {
    const theme = currentTheme();
    const data = state.levels.get(themeLevel);
    if (!themePreview?.contentWindow || !theme || !data) return;
    themePreview.contentWindow.postMessage({ type: 'mob-level', level: data, theme: theme.id, themeData: theme }, '*');
}

boot();

// ------------------------------------------------------------------ units tab

/** The upgrades, in the order shown: what each house makes. */
const UNIT_ORDER = [['giant', 'GIANT'], ['truck', 'TRUCK'], ['saucer', 'UFO'], ['car', 'RAMMER']];
let unitsDirty = false;
let unitId = 'giant';
let unitList;
let unitForm;
let unitPreview;
let unitLevel = null;

function buildUnitsTab() {
    unitList = el('div', { class: 'list' });
    unitForm = el('div', { class: 'theme-form' });
    unitPreview = el('iframe', { title: 'Unit preview' });
    // The preview game asks for its level when it's ready: this tab's (saved) level.
    window.addEventListener('message', (event) => {
        if (event.source !== unitPreview.contentWindow || event.data?.type !== 'mob-ready') return;
        const data = unitLevel ? state.levels.get(unitLevel) : null;
        if (data) unitPreview.contentWindow.postMessage({ type: 'mob-level', level: data }, '*');
    });
    unitsTab.append(
        el('aside', {}, unitList),
        el('div', { class: 'editor' },
            el('div', { class: 'toolbar' },
                el('span', { class: 'hint' }, 'What each house makes, in every level. A level\'s house can set its own charge.'),
                el('span', { style: { flex: 1 } }),
                el('button', { class: 'primary', onclick: saveUnits }, 'Save units')),
            unitForm),
        el('div', { class: 'preview' },
            el('div', { class: 'bar' }, el('span', { class: 'hint' }, 'A level with it (saved values)'), el('span', { style: { flex: 1 } }),
                el('button', { onclick: reloadUnitPreview }, 'Reload')),
            unitPreview),
    );
}

/** A level whose house makes `kind` (the preview), if there is one. */
function levelWithUnit(kind) {
    for (const [id, data] of state.levels) if ((data.pads ?? []).some((pad) => (pad.kind ?? 'giant') === kind)) return id;
    return null;
}

function renderUnits() {
    unitList.replaceChildren(...UNIT_ORDER.map(([kind, label]) => el('div', {
        class: `row${kind === unitId ? ' sel' : ''}`,
        onclick: () => { unitId = kind; renderUnits(); },
    }, el('span', {}, label), el('small', {}, `charge ${state.units[kind]?.need ?? '?'}`))));
    renderUnitForm();
    const level = levelWithUnit(unitId);
    if (level !== unitLevel) {
        unitLevel = level;
        reloadUnitPreview();
    }
    statusLine.textContent = unitsDirty ? 'Units not saved' : '';
}

function unitsChanged() {
    unitsDirty = true;
    statusLine.textContent = 'Units not saved';
}

function unitColour(unit, key, label) {
    const input = el('input', { type: 'color', value: unit[key] ?? '#ffffff' });
    input.addEventListener('input', () => { unit[key] = input.value; unitsChanged(); });
    return el('div', { class: 'field' }, el('label', {}, label), input);
}

function unitNumber(unit, key, label, hint) {
    const input = el('input', { type: 'number', step: 1, min: 0, value: unit[key] ?? '', title: hint });
    input.addEventListener('change', () => {
        unit[key] = Math.max(0, Math.round(Number(input.value) || 0));
        input.value = unit[key];
        unitsChanged();
        if (key === 'need') renderUnits();
    });
    return el('div', { class: 'field' }, el('label', { title: hint }, label), input);
}

function renderUnitForm() {
    const unit = state.units[unitId];
    unitForm.replaceChildren();
    if (!unit) return;
    const label = UNIT_ORDER.find(([kind]) => kind === unitId)[1];
    // Its house: the building (a model; the car has none), the plain house made in the game, or a pad on the floor.
    const styles = unitId === 'car' ? [['house', 'plain house'], ['pad', 'pad on the floor']] : [['model', 'building (model)'], ['house', 'plain house'], ['pad', 'pad on the floor']];
    const current = unit.style ?? (unitId === 'giant' ? 'model' : 'house');
    const style = el('select', { onchange: (e) => { unit.style = e.target.value; unitsChanged(); renderUnitForm(); } },
        ...styles.map(([value, text]) => el('option', { value, selected: value === current }, text)));
    unitForm.append(el('h3', {}, `${label} · house`), el('div', { class: 'field' }, el('label', {}, 'style'), style));
    // (The giant's building can be tinted; the others' `tint` is their vehicle's, below.)
    if (current === 'model' && unitId === 'giant') unitForm.append(unitColour(unit, 'tint', 'building tint (white = as it is)'));
    if (current === 'house') unitForm.append(unitColour(unit, 'wall', 'wall'), unitColour(unit, 'roof', 'roof'));
    if (current === 'pad') unitForm.append(unitColour(unit, 'pad', 'pad colour'));
    unitForm.append(el('h3', {}, `${label} · colours`));
    if (unitId === 'giant') unitForm.append(unitColour(unit, 'color', 'body'));
    else unitForm.append(unitColour(unit, 'tint', `${label.toLowerCase()} (tint over its model; white = as it is)`));
    unitForm.append(el('h3', {}, 'Numbers'), unitNumber(unit, 'need', 'charge', 'Blues walking into its house to make one'));
    if (unitId !== 'saucer') {
        unitForm.append(unitNumber(unit, 'hp', 'hp', unitId === 'car' ? 'Hits it takes (0: nothing stops it)' : 'Hits it takes'));
    }
    unitForm.append(unitNumber(unit, 'damage', unitId === 'saucer' ? 'damage (crashing in)' : 'base damage (most)',
        unitId === 'saucer' ? 'What it takes off the enemy\'s building when it crashes in' : 'The most it takes off the enemy\'s building when it reaches it (less if it\'s been hurt)'));
    if (unitId === 'car') unitForm.append(el('p', { class: 'hint' }, 'hp 0: the car can\'t be stopped.'));
    if (unitId !== 'saucer') {
        // Its body against the world (walls, holes, blocks, houses, the field's sides): a share of its size.
        const hint = 'Its body against walls, holes, blocks, houses and the field sides, as a share of its size (0.3 to 1; empty: 0.65). Smaller: it slips through gaps instead of wedging; it still fights and walks into houses at its full size. Check gaps (in a level panel) shows where it still gets stuck.';
        const input = el('input', { type: 'number', step: 0.05, min: 0.3, max: 1, value: unit.body ?? '', placeholder: '0.65', title: hint });
        input.addEventListener('change', () => {
            if (input.value === '') delete unit.body;
            else unit.body = Math.max(0.3, Math.min(1, Math.round(Number(input.value) * 100) / 100 || 0.65));
            input.value = unit.body ?? '';
            unitsChanged();
        });
        unitForm.append(el('div', { class: 'field' }, el('label', { title: hint }, 'body (walls)'), input));
    }
}

async function saveUnits() {
    try {
        await api('/api/mob/units', { method: 'PUT', body: state.units });
        unitsDirty = false;
        statusLine.textContent = '';
        toast('Saved ui/units.json', 'ok');
        renderUnits();
        // The game picks the file up and reloads itself; the preview with it, a moment later.
        setTimeout(reloadUnitPreview, 800);
    } catch (error) {
        toast(error.message, 'error');
    }
}

function reloadUnitPreview() {
    if (!unitPreview) return;
    if (!unitLevel) {
        unitPreview.removeAttribute('src');
        return;
    }
    const url = new URL(state.gameUrl);
    url.searchParams.set('preview', '1');
    url.searchParams.set('level', unitLevel);
    unitPreview.src = url.toString();
}
