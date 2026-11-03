// Map shots tab: the town map's pictures (the HUD's miniature, images/non-preload/map/<zone>.webp), one per zone
// (`town`, the whole island, or a section). Each zone is shot one of two ways (levels/mapshots.json):
//   - Original: the town as it is (a section cut out of it onto a slab of earth);
//   - Custom: its own diorama, a little level shaped like town.json, edited right here with the Town tab's editor
//     (a second copy of town3d.js) — started from the town (↺ Copy from the town), then anything goes: move things
//     closer, drop what clutters, add what tells the story.
// Its camera (yaw round, pitch above; isometric or perspective with its field of view; "🎯 Use this view" takes the
// diorama view's) sets the angle, and "HUD outline" a black stroke round the small picture (its width in pixels). 📸 Take snapshot opens the
// game in snapshot mode for that zone (TownSnapshotScene: the game's own look), which posts two pictures back here
// (POST /api/map-snapshot): `<zone>` (512 across, the HUD's reveal) and `<zone>-small` (the HUD's corner).

import { api, el, toast } from './shared.js';

const DEFAULT_CAMERA = { yaw: 0, pitch: 40, ortho: true, fov: 35 };
/** A section's diorama: its island reaches this far past the section (the deck round the lawn). */
const DIORAMA_MARGIN = 0.5;

let host;
let gameUrl = 'http://localhost:9001/';
let town;
let shots = { zones: {} };
/** The city whose shots these are (the editor's level picker): its level, and its whole-island zone (`map`). */
let city = { id: 'city1', name: 'Mow Town', level: 'town', map: 'town' };
let zone = city.map;
/** The diorama editor (a second town3d.js, its own state), once loaded. */
let editor = null;
/** The editor's own element (kept across re-renders: its 3D view lives in it), and the slot it goes in. */
let editorView = null;
let editorHost;
let preview;

const zoneSettings = (id) => {
    const saved = shots.zones[id] ?? {};
    return { mode: 'original', stroke: false, strokeWidth: 3, ...saved, camera: { ...DEFAULT_CAMERA, ...saved.camera } };
};
const zoneName = (id) => (id === city.map ? `Whole ${city.name}` : town.sections.find((s) => s.id === id)?.name ?? id);
const levelUrl = () => `/api/town?level=${encodeURIComponent(city.level)}`;
const imageUrl = (id, small = false) => `/map-images/${id}${small ? '-small' : ''}.webp?t=${Date.now()}`;

export const hasUnsavedMapShots = () => Boolean(editor?.hasUnsavedTown());

export async function initMapShotsTab(container, options = {}) {
    host = container;
    gameUrl = options.gameUrl ?? gameUrl;
    if (options.city) city = options.city;
    zone = city.map;
    town = await api(levelUrl());
    shots = await api('/api/mapshots');
    render();
}

/** Back on the tab (or another city picked): the town may have changed (new sections). */
export async function refreshMapShotsTab(next) {
    if (next && next.id !== city.id) {
        city = next;
        zone = city.map;
    }
    town = await api(levelUrl());
    shots = await api('/api/mapshots');
    render();
}

function render() {
    const settings = zoneSettings(zone);
    const zones = [city.map, ...town.sections.map((s) => s.id)];
    preview = el('img', { class: 'mapshot-preview', src: imageUrl(zone, true), alt: '', title: 'The HUD corner\'s picture', onerror: (event) => { event.target.style.visibility = 'hidden'; } });
    const camera = () => ({ yaw: Number(yaw.value) || 0, pitch: Number(pitch.value) || 40, ortho: ortho.checked, fov: Number(fov.value) || 35 });
    const yaw = el('input', { type: 'number', step: 5, value: settings.camera.yaw, onchange: () => saveSettings({ camera: camera() }) });
    const pitch = el('input', { type: 'number', step: 5, min: 5, max: 90, value: settings.camera.pitch, onchange: () => saveSettings({ camera: camera() }) });
    const fov = el('input', { type: 'number', step: 5, min: 5, max: 100, value: settings.camera.fov, onchange: () => saveSettings({ camera: camera() }) });
    const fovLabel = el('label', { hidden: settings.camera.ortho }, 'FOV° ', fov);
    const ortho = el('input', { type: 'checkbox', checked: settings.camera.ortho, onchange: () => {
        fovLabel.hidden = ortho.checked;
        void saveSettings({ camera: camera() });
    } });
    const strokeWidth = el('input', { type: 'number', min: 1, max: 12, step: 1, value: settings.strokeWidth, title: 'The outline\'s width (pixels, on the 192-wide picture)',
        onchange: () => saveSettings({ strokeWidth: Math.min(12, Math.max(1, Math.round(Number(strokeWidth.value) || 3))) }) });
    const strokeWidthLabel = el('label', { hidden: !settings.stroke }, strokeWidth, ' px');
    const stroke = el('input', { type: 'checkbox', checked: settings.stroke, onchange: () => {
        strokeWidthLabel.hidden = !stroke.checked;
        void saveSettings({ stroke: stroke.checked });
    } });
    const custom = settings.mode === 'custom';
    const bar = el('div', { class: 'toolbar mapshots-bar' },
        el('label', {}, 'Zone ', el('select', { onchange: (event) => switchZone(event.target.value) },
            ...zones.map((id) => el('option', { value: id, selected: id === zone }, `${zoneName(id)}${shots.zones[id]?.mode === 'custom' ? ' (custom)' : ''}`)))),
        el('div', { class: 'segmented' },
            el('button', { class: custom ? '' : 'active', onclick: () => setMode('original') }, 'Original'),
            el('button', { class: custom ? 'active' : '', onclick: () => setMode('custom') }, 'Custom')),
        el('label', {}, 'Yaw° ', yaw),
        el('label', {}, 'Pitch° ', pitch),
        el('label', { title: 'Isometric: no perspective (an orthographic camera). Off: a perspective camera with its field of view.' }, ortho, ' Isometric'),
        fovLabel,
        el('label', { title: 'A black outline round the HUD corner\'s (small) picture, like the rest of the HUD' }, stroke, ' HUD outline'),
        strokeWidthLabel,
        custom ? el('button', { title: 'The diorama view\'s angle (orbit it first)', onclick: () => useView() }, '🎯 Use this view') : '',
        custom ? el('button', { title: 'Start the diorama again from the town as it is', onclick: () => copyFromTown(true) }, '↺ Copy from the town') : '',
        el('span', { class: 'spacer' }),
        el('button', { class: 'primary', onclick: () => void takeShot() }, '📸 Take snapshot'),
        preview);
    editorHost = el('section', { class: 'workspace mapshots-editor', hidden: !custom });
    const original = el('div', { class: 'mapshots-original', hidden: custom },
        el('div', { class: 'mapshots-pair' },
            el('img', { class: 'mapshot-large', src: imageUrl(zone), alt: 'Not taken yet', onerror: (event) => { event.target.replaceWith(el('p', { class: 'muted' }, 'No picture for this zone yet: take one.')); } }),
            el('img', { class: 'mapshot-small', src: imageUrl(zone, true), alt: '', title: 'The HUD corner\'s picture', onerror: (event) => { event.target.style.visibility = 'hidden'; } })),
        el('p', { class: 'muted small' }, custom ? '' : `Original: ${zone === city.map ? 'the whole island as it is' : `${zoneName(zone)} cut out of the town as it is, on a slab of earth`}, from yaw ${settings.camera.yaw}° / pitch ${settings.camera.pitch}°${settings.camera.ortho ? ', isometric' : `, perspective ${settings.camera.fov}°`}. Left: the big picture (the reveal); right: the HUD corner's. Switch to Custom to build a diorama of it instead.`));
    host.replaceChildren(bar, original, editorHost);
    if (custom) void openEditor();
}

async function saveSettings(change) {
    const settings = { ...zoneSettings(zone), ...change };
    try {
        await api(`/api/mapshots?zone=${encodeURIComponent(zone)}`, { method: 'PUT', body: JSON.stringify({ mode: settings.mode, camera: settings.camera, stroke: settings.stroke, strokeWidth: settings.strokeWidth }) });
        shots.zones[zone] = { ...shots.zones[zone], mode: settings.mode, camera: settings.camera, stroke: settings.stroke, strokeWidth: settings.strokeWidth };
    } catch (error) {
        toast(`Could not save: ${error.message}`, 'bad');
    }
}

async function switchZone(id) {
    if (editor?.hasUnsavedTown() && !window.confirm('The diorama has unsaved changes. Leave it anyway?')) return render();
    zone = id;
    render();
}

async function setMode(mode) {
    if (mode === 'custom' && !shots.zones[zone]?.custom) await copyFromTown(false);
    await saveSettings({ mode });
    render();
}

async function useView() {
    if (!editor) return;
    // The view's angle (and, for a perspective shot, its field of view); isometric or not stays as set.
    const view = editor.viewAngles();
    const current = zoneSettings(zone).camera;
    const camera = { ...current, yaw: view.yaw, pitch: view.pitch, fov: current.ortho ? current.fov : view.fov };
    await saveSettings({ camera });
    toast(`Camera: yaw ${camera.yaw}°, pitch ${camera.pitch}°${camera.ortho ? '' : `, FOV ${camera.fov}°`}`);
    render();
}

/**
 * The zone's diorama, made from the town as it is, with only what makes the picture (no stations, traffic, sounds or
 * secrets): the whole town, or a section on its own little island (the town's deck and sides round it) with what
 * stands in it: its props, patches and the pavements cut to it.
 */
async function copyFromTown(ask) {
    if (ask && !window.confirm(`Replace ${zoneName(zone)}'s diorama with a fresh copy from the town?`)) return;
    town = await api(levelUrl());
    const { _version, traffic, sounds, soundSettings, secrets, ...level } = structuredClone(town);
    level.atms = [];
    level.wardrobes = [];
    level.sections = level.sections.map(({ separator, pen, onUnlock, ...lawn }) => lawn);
    let custom = level;
    if (zone !== city.map) {
        const section = town.sections.find((s) => s.id === zone);
        const pad = (town.island?.deck?.width ?? 0) + DIORAMA_MARGIN;
        const rect = { minX: section.x - section.width / 2 - pad, maxX: section.x + section.width / 2 + pad, minZ: section.z - section.depth / 2 - pad, maxZ: section.z + section.depth / 2 + pad };
        const inside = (p) => p.x >= rect.minX && p.x <= rect.maxX && p.z >= rect.minZ && p.z <= rect.maxZ;
        // Pavements are cut to inside the deck (they'd stick out square over its rounded corners).
        const deck = town.island?.deck?.width ?? 0;
        const clip = (p) => {
            const minX = Math.max(rect.minX + deck, p.x - p.width / 2);
            const maxX = Math.min(rect.maxX - deck, p.x + p.width / 2);
            const minZ = Math.max(rect.minZ + deck, p.z - p.depth / 2);
            const maxZ = Math.min(rect.maxZ - deck, p.z + p.depth / 2);
            return maxX > minX && maxZ > minZ ? { ...p, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ } : null;
        };
        const { separator, pen, onUnlock, ...lawn } = section;
        custom = {
            ...level,
            ground: { ...level.ground, x: section.x, z: section.z, width: rect.maxX - rect.minX, depth: rect.maxZ - rect.minZ },
            island: level.island ? { ...level.island, outline: [
                { x: rect.minX, z: rect.minZ }, { x: rect.maxX, z: rect.minZ }, { x: rect.maxX, z: rect.maxZ }, { x: rect.minX, z: rect.maxZ },
            ] } : undefined,
            start: { x: section.x, z: section.z },
            sections: [lawn],
            props: level.props.filter(inside),
            grassPatches: level.grassPatches.filter(inside),
            pavements: level.pavements.map(clip).filter(Boolean),
        };
        if (!custom.island) delete custom.island;
    }
    try {
        await api(`/api/mapshots/custom?zone=${encodeURIComponent(zone)}`, { method: 'PUT', body: JSON.stringify(custom) });
        shots = await api('/api/mapshots');
        if (editor) await editor.loadTown(customUrl());
        toast(`${zoneName(zone)}: diorama copied from the town.`);
    } catch (error) {
        toast(`Could not copy: ${error.message}`, 'bad');
    }
}

const customUrl = () => `/api/mapshots/custom?zone=${encodeURIComponent(zone)}`;

/** The diorama editor in this tab: the Town tab's, a second copy (its own state), on this zone's diorama. */
async function openEditor() {
    if (!editor) {
        editor = await import('./town3d.js?diorama');
        await editor.initTownTab(editorHost, { gameUrl, townUrl: customUrl(), diorama: true });
        editorView = editorHost;
        return;
    }
    // A rebuilt tab: put the editor's own element back in the new slot, then load this zone.
    editorHost.replaceWith(editorView);
    editorHost = editorView;
    editorHost.hidden = false;
    await editor.loadTown(customUrl());
}

/** Saves what's pending, then the game takes the zone's picture in a new tab; the previews refresh as it lands. */
async function takeShot() {
    if (editor?.hasUnsavedTown() && zoneSettings(zone).mode === 'custom' && !(await editor.saveTown())) return;
    await saveSettings({});
    const url = new URL(gameUrl);
    url.searchParams.set('mapshots', window.location.origin);
    url.searchParams.set('city', city.id);
    url.searchParams.set('zone', zone);
    window.open(url.toString(), 'mow-mapshots');
    toast(`Taking ${zoneName(zone)}'s snapshot in the game…`);
    // The picture lands a few seconds later (the game has to load): refresh the previews meanwhile.
    for (let i = 1; i <= 10; i++) {
        window.setTimeout(() => {
            host.querySelectorAll('.mapshot-preview, .mapshot-large, .mapshot-small').forEach((img) => {
                img.style.visibility = '';
                img.src = imageUrl(zone, !img.classList.contains('mapshot-large'));
            });
        }, i * 3000);
    }
}
