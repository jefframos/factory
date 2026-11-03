// Town tab: builds Mow Town (levels/town.json) in a perspective view the way the game draws it — the ground and the
// pavements, the props (library models fitted to their height), the ATMs (each sells the bag and opens the shop) and
// the wardrobes (each opens the wardrobe) — one tied to a section appears when that section opens — the sections (the districts to restore, in unlock order: their
// rect is where grass grows, their separator is the fence that keeps them closed until the previous one is restored,
// and what happens when they open), the grass patches (painted over the sections: a grass type, `auto`, or `none` to
// carve) and the grass noise (rings around a centre: the further out, the tougher the `auto` grass).
//
// The traffic (`traffic`: waypoints on the roads, the links between them, the cars) is drawn over it: orange posts,
// cyan roads; selecting a waypoint lights up its links (yellow) and everything it connects to (its network: where a
// car there can drive). Alt+click (or 🔗 Link) another waypoint links / unlinks them.
//
// The road builder (🛣 Roads, B): click or drag on the ground to lay road tiles on the kit's grid (ui/mow.json
// roadKit), Shift to take them up, a click on a laid one for its next variant (a crossing, a stop line …). Each tile's
// piece and turn come from its neighbours (core/roads/RoadGrid.ts, the game's own code), and so do the traffic's
// waypoints and links: the cars drive what's built.
//
// Shift+click (or Ctrl+click), in the view or the lists, adds to the selection (or takes back out): the gizmo sits on
// the last one picked, and moving it moves them all together; Del removes them all; Esc lets go.
//
// The grass preview shows every cell as the game generates it (same noise, same rings, nothing under a collider or a
// pavement). Orbit with the mouse, click to select, drag the gizmo to move (W), turn (E) or scale (R). Models come from
// the game (public/mow/models) or are imported from the 3D asset library (library.js). Saves with PUT /api/town.
//
// The Map shots tab loads a second copy of this module (its own state: `town3d.js?diorama`) to edit a zone's custom
// diorama instead (options.townUrl: /api/mapshots/custom?zone=…), a level shaped like town.json. A diorama is only a
// picture, so its editor keeps only what makes the view (props, pavements, grass patches, the shore, the lawn): no
// stations, start, noise rings, sounds, secrets, traffic or unlocking (`town-only` controls are hidden).

import * as THREE from 'three';
import { createGLTFLoader } from './gltf.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { api, el, toast, isModalOpen } from './shared.js';
import { openModelPicker, setModelCatalog } from './modelPicker.js';
import { openLibraryPicker } from './library.js';
import { roadCellAt, roadCellKey, roadNetwork, solveRoads } from '/core/roads/RoadGrid.ts';

// Mirrors games/mow/game/world/Town.ts and GrassField.ts, so the editor shows what the game builds.
const PAD_RADIUS = 1.4;
/** Grass never grows this close to a pavement or a collider (Town.isBlocked). */
const BLOCK_PAD = 0.25;
/** Pieces lower than this lose their collider on save (road tiles are walked over). */
const FLAT_HEIGHT = 0.3;
const SNAP = 0.25;
const ROTATE_SNAP = THREE.MathUtils.degToRad(15);
const UNDO_LIMIT = 60;
const SECTION_COLORS = [0x8fe3a1, 0x4fc3f7, 0xffd23f, 0xffa94d, 0xe2a6ff, 0xff8a8a];

let host;
let town;
let mow = { grass: [], cell: 0.5, seed: 1 };
/** The game's sounds (raw-assets/audio), for the sound zones. */
let soundFiles = ['ocean-ambient'];
const DEFAULT_SOUND_SETTINGS = { cars: { volume: 0.35, near: 3, far: 14 } };
let dirty = false;
let selection = null; // { type, index }
/** Also selected (Shift+click): they move with `selection` and go with it on Del. */
let also = [];
/** Where each selected holder was when a move began (keyOf -> position). */
const moveStarts = new Map();
let snap = true;
let showGrass = true;
let showTraffic = true;
/** 🔗 Link: the next waypoint clicked is linked to (or unlinked from) the selected one. */
let linking = false;
let gameUrl = 'http://localhost:9001/';
/** What this editor loads and saves (the town, or a Map shots diorama), and whether it's a diorama (no Play). */
let townUrl = '/api/town';
let diorama = false;
const undoStack = [];
/** Changes made (touch()): a click again on the same spot cycles only if nothing changed since the last pick. */
let edits = 0;
/** The last click's pick (where, the edit count then): clicking there again picks the next thing under it (pickAt()). */
let lastPick = null;

let renderer;
let scene;
let camera;
let orbit;
let gizmo;
const groundGroup = new THREE.Group();
const entityGroup = new THREE.Group();
const grassGroup = new THREE.Group();
/** The traffic's roads (links), redrawn as the selection changes; the waypoints themselves are entities. */
const trafficGroup = new THREE.Group();
/** A yellow box round each selected thing (the selection outlined). */
const highlightGroup = new THREE.Group();
/** The road builder's pieces (not entities: clicks go through them), and the cell under the pointer while building. */
const roadGroup = new THREE.Group();
const roadHover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false }));
let roadMode = false;
/** A stroke being painted: taking up (Shift) or laying, the cell it's on, whether it started on road, whether it moved. */
let roadStroke = null;
const holders = new Map(); // "type:index" -> THREE.Group
const loader = createGLTFLoader();
const modelCache = new Map();
const raycaster = new THREE.Raycaster();
let grassTimer = 0;

export const hasUnsavedTown = () => dirty;

export async function initTownTab(container, options = {}) {
    host = container;
    gameUrl = options.gameUrl ?? gameUrl;
    townUrl = options.townUrl ?? townUrl;
    playCity = options.city ?? playCity;
    diorama = Boolean(options.diorama);
    host.classList.toggle('diorama', diorama);
    if (diorama) showTraffic = false;
    mow = await api('/api/mow');
    soundFiles = await api('/api/sounds').catch(() => soundFiles);
    buildLayout();
    setupViewport(host.querySelector('#townViewport'));
    await reload();
}

/** Loads another document into this editor (another city's level; the Map shots tab: a zone's diorama). */
export async function loadTown(url, city) {
    townUrl = url;
    if (city) playCity = city;
    await reload();
}

/** The city ▶ Play opens the game in (the level being edited). */
let playCity = '';

/** Saves now (the Map shots tab, before taking a shot); false if it failed. */
export async function saveTown() {
    return save();
}

/** The view's angles (degrees): yaw round the target (0 = from the south), pitch above the ground, field of view. */
export function viewAngles() {
    const offset = camera.position.clone().sub(orbit.target);
    return {
        yaw: Math.round(THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z))),
        pitch: Math.round(THREE.MathUtils.radToDeg(Math.asin(offset.y / Math.max(offset.length(), 1e-6)))),
        fov: Math.round(camera.fov),
    };
}

async function reload() {
    town = await api(townUrl);
    town.props ??= [];
    town.atms ??= [];
    town.wardrobes ??= [];
    // The wardrobes' look (Dig's closet), for a level from before them.
    town.wardrobe ??= { model: 'town/station/closet-02.glb', height: 2.2, back: 1.5, label: 3.2, color: '#e266c8', icon: 'ItemIcon_Heart_Red', collider: { halfX: 0.7, halfZ: 0.45 } };
    town.pavements ??= [];
    town.sections ??= [];
    town.grassPatches ??= [];
    town.sounds ??= [];
    town.secrets ??= [];
    town.traffic ??= { waypoints: [], links: [], cars: [] };
    if (town.roads) syncRoadTraffic();
    town.soundSettings ??= structuredClone(DEFAULT_SOUND_SETTINGS);
    town.grassNoise ??= { centre: { x: 0, z: 0 }, scale: 0.2, rings: [{ upTo: 999, mix: { grass: 1 } }] };
    // An island without an outline is the ground's rect: start the shore from its corners.
    if (town.island && !(town.island.outline?.length >= 3)) {
        const g = town.ground;
        town.island.outline = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: g.x + (sx * g.width) / 2, z: g.z + (sz * g.depth) / 2 }));
    }
    selection = null;
    also = [];
    undoStack.length = 0;
    setDirty(false);
    rebuildAll();
}

function rebuildAll() {
    rebuildGround();
    rebuildRoads();
    rebuildEntities();
    renderLists();
    renderInspector();
    renderNoise();
    queueGrass();
}

// ---------------------------------------------------------------- layout

function buildLayout() {
    host.replaceChildren(
        el('aside', { class: 'sidebar left' },
            el('section', { class: 'card-section' },
                el('h2', {}, 'Add'),
                el('div', { class: 'stack' },
                    el('button', { class: 'block', onclick: () => pickModel() }, '🪴 Prop (game model)…'),
                    el('button', { class: 'block primary', onclick: () => importFromLibrary() }, '📚 Import from 3D library…'),
                    el('button', { class: 'block town-only', onclick: () => addAtm() }, '🏧 ATM'),
                    el('button', { class: 'block town-only', onclick: () => addWardrobe() }, '👗 Wardrobe'),
                    el('button', { class: 'block', onclick: () => addPatch('auto') }, '🌿 Grass patch (noise)'),
                    el('button', { class: 'block', onclick: () => addPatch('tallgrass') }, '🌾 Dense patch (tall grass)'),
                    el('button', { class: 'block', onclick: () => addPatch('none') }, '✂ Bare patch (no grass)'),
                    el('button', { class: 'block', onclick: () => addPavement() }, '⬜ Pavement'),
                    el('button', { class: 'block town-only', onclick: () => addSound() }, '🔊 Sound zone'),
                    el('button', { class: 'block town-only', onclick: () => addSecret() }, '🤫 Secret patch (chest)'),
                    el('button', { class: 'block town-only', onclick: () => addWaypoint() }, '🚦 Traffic waypoint'),
                    el('button', { class: 'block town-only', onclick: () => addSection() }, '🗺 Section (next to unlock)'))),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Sections'),
                el('p', { class: 'muted small' }, 'In unlock order: each opens when the one before is restored. Grass grows inside their rect.'),
                el('ul', { id: 'townSectionList', class: 'list' })),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Grass noise'),
                el('p', { class: 'muted small' }, 'Which grass "auto" cells get: rings around the centre, tougher further out. Shares per grass type.'),
                el('div', { id: 'townNoise' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Island shore'),
                el('p', { class: 'muted small' }, 'The island\'s outline (orange posts): drag them to reshape it, D on one adds a point after it. The deck, fence and sea follow.'),
                el('ul', { id: 'townShoreList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Grass patches'),
                el('ul', { id: 'townPatchList', class: 'list' })),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'ATMs'),
                el('ul', { id: 'townAtmList', class: 'list' })),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Wardrobes'),
                el('ul', { id: 'townWardrobeList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Pavements'),
                el('ul', { id: 'townPavementList', class: 'list' })),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Sounds'),
                el('p', { class: 'muted small' }, 'Sound zones (violet boxes): their sound at full volume inside, fading out to the dashed line. Zones with the same sound share one loop (the loudest wins). Volumes are 0-1 (0.15 is a soft bed).'),
                el('ul', { id: 'townSoundList', class: 'list' }),
                el('div', { id: 'townSoundSettings' })),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Roads'),
                el('p', { class: 'muted small' }, '🛣 Roads (B) in the toolbar: click or drag on the ground to lay road tiles, Shift to take them up, click a laid tile for its next variant. The pieces fit themselves to their neighbours, and the cars drive them (the waypoints follow).'),
                el('div', { id: 'townRoadSummary', class: 'muted small' }),
                el('button', { class: 'block', onclick: () => clearRoads() }, '🧹 Clear roads')),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Traffic'),
                el('p', { class: 'muted small' }, 'Cars drive the cyan roads between waypoints (two-way, on the right), each starting at a waypoint and roaming what it links to. Select a waypoint to see its network; Alt+click another to link / unlink it. A new waypoint links to the selected one.'),
                el('div', { id: 'townTrafficSummary', class: 'muted small' }),
                el('ul', { id: 'townCarList', class: 'list' }),
                el('button', { class: 'block', onclick: () => waypointsFromRoads() }, '🛣 Waypoints from road tiles')),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Secrets'),
                el('p', { class: 'muted small' }, 'Secret patches (gold boxes): a clump of lush grass anywhere in town; mowing it through gives up a chest worth its reward. A twinkle shows over it when the player is near.'),
                el('ul', { id: 'townSecretList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Props'),
                el('ul', { id: 'townPropList', class: 'list' }))),
        el('div', { class: 'stage-area' },
            el('div', { class: 'toolbar' },
                el('div', { class: 'segmented', id: 'townMode' },
                    el('button', { dataset: { mode: 'translate' }, class: 'active', onclick: () => setMode('translate') }, 'Move (W)'),
                    el('button', { dataset: { mode: 'rotate' }, onclick: () => setMode('rotate') }, 'Turn (E)'),
                    el('button', { dataset: { mode: 'scale' }, onclick: () => setMode('scale') }, 'Scale (R)')),
                el('button', { id: 'townRoadMode', class: 'town-only', onclick: () => setRoadMode(!roadMode) }, '🛣 Roads (B)'),
                el('label', {}, el('input', { type: 'checkbox', checked: snap, onchange: (event) => { snap = event.target.checked; applySnap(); } }), ' Snap'),
                el('label', {}, el('input', { type: 'checkbox', checked: showGrass, onchange: (event) => { showGrass = event.target.checked; grassGroup.visible = showGrass; } }), ' Grass preview'),
                el('label', { class: 'town-only' }, el('input', { type: 'checkbox', checked: showTraffic, onchange: (event) => { showTraffic = event.target.checked; rebuildEntities(); } }), ' Traffic'),
                el('span', { class: 'spacer' }),
                el('span', { id: 'townStatus' }),
                el('button', { class: 'primary', onclick: () => void save() }, '💾 Save'),
                diorama ? '' : el('button', { onclick: () => window.open(playCity ? `${gameUrl}${gameUrl.includes('?') ? '&' : '?'}city=${playCity}` : gameUrl, 'mow-game') }, '▶ Play')),
            el('div', { id: 'townViewport', style: { position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden' } }),
            el('div', { class: 'hint-bar' }, 'Left-drag: orbit · Right-drag: pan · Wheel: zoom · Click: select · Shift+click: add to selection · Ctrl+A: all of a kind · W/E/R: move/turn/scale · D: duplicate · Del: remove · F: focus · Ctrl+Z: undo · Ctrl+S: save')),
        el('aside', { class: 'sidebar right' },
            el('section', { class: 'card-section' }, el('h2', {}, 'Selection'), el('div', { id: 'townInspector' }))),
    );
}

function setDirty(value) {
    dirty = value;
    const status = host.querySelector('#townStatus');
    status.textContent = dirty ? 'Unsaved changes' : 'Saved';
    status.className = dirty ? 'dirty' : '';
}

/** Snapshot for undo, then mark unsaved. Call before changing `town`. */
function touch() {
    edits++;
    undoStack.push(JSON.stringify(town));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    setDirty(true);
}

function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    town = { ...JSON.parse(previous), _version: town._version };
    if (selection && !entityData(selection)) selection = null;
    also = selection ? also.filter((sel) => entityData(sel)) : [];
    setDirty(true);
    rebuildAll();
}

// ---------------------------------------------------------------- viewport

function setupViewport(viewport) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    viewport.append(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fd4f2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(6, 14, 8);
    roadHover.rotation.x = -Math.PI / 2;
    roadHover.visible = false;
    roadHover.raycast = () => {};
    scene.add(sun, groundGroup, roadGroup, grassGroup, trafficGroup, entityGroup, highlightGroup, roadHover);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
    camera.position.set(0, 34, 30);
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, -6);
    orbit.maxPolarAngle = Math.PI / 2 - 0.05;
    orbit.update();

    gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', (event) => {
        orbit.enabled = !event.value;
        if (event.value) {
            touch();
            // Where everything selected starts, so the others follow the gizmo's move.
            moveStarts.clear();
            for (const sel of selected()) {
                const holder = holders.get(keyOf(sel));
                if (holder) moveStarts.set(keyOf(sel), holder.position.clone());
            }
        }
        else if (gizmo.getMode() === 'scale') commitScale();
        else afterMove();
    });
    gizmo.addEventListener('objectChange', () => syncFromGizmo());
    scene.add(gizmo.getHelper());
    setMode('translate');

    let down = null;
    renderer.domElement.addEventListener('pointerdown', (event) => {
        down = { x: event.clientX, y: event.clientY };
        if (roadMode && event.button === 0) startRoadStroke(event);
    });
    renderer.domElement.addEventListener('pointermove', (event) => {
        if (roadMode) moveRoadStroke(event);
    });
    renderer.domElement.addEventListener('pointerleave', () => { roadHover.visible = false; });
    renderer.domElement.addEventListener('pointerup', (event) => {
        if (roadMode) return endRoadStroke();
        // A click (not an orbit/pan drag, not a gizmo drag) selects what's under the pointer.
        if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || gizmo.dragging || event.button !== 0) return;
        pickAt(event);
    });
    window.addEventListener('keydown', onKey);
    new ResizeObserver(resize).observe(viewport);
    resize();
    const loop = () => {
        requestAnimationFrame(loop);
        if (host.hidden || host.closest('[hidden]')) return;
        orbit.update();
        renderer.render(scene, camera);
    };
    loop();
}

function resize() {
    const viewport = host?.querySelector('#townViewport');
    if (!viewport || !renderer) return;
    const width = viewport.clientWidth || 800;
    const height = viewport.clientHeight || 600;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

function setMode(mode) {
    gizmo.setMode(mode);
    gizmo.showX = mode !== 'rotate';
    gizmo.showZ = mode !== 'rotate';
    gizmo.showY = mode !== 'translate';
    host.querySelectorAll('#townMode button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    applySnap();
}

function applySnap() {
    gizmo.setTranslationSnap(snap ? SNAP : null);
    gizmo.setRotationSnap(snap ? ROTATE_SNAP : null);
    gizmo.setScaleSnap(snap ? 0.05 : null);
}

function onKey(event) {
    if (host.closest('[hidden]') || isModalOpen()) return;
    if (event.target.closest?.('input, select, textarea')) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        void save();
    } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        undo();
    } else if (key === 'b' && !diorama) setRoadMode(!roadMode);
    else if (key === 'w') setMode('translate');
    else if (key === 'e') setMode('rotate');
    else if (key === 'r') setMode('scale');
    else if (key === 'd' && selection) duplicateSelection();
    else if ((key === 'delete' || key === 'backspace') && selection) removeSelection();
    else if (key === 'escape') select(null);
    else if ((event.ctrlKey || event.metaKey) && key === 'a') {
        // Ctrl+A: everything of the selected kind.
        event.preventDefault();
        const list = selection && listOf(selection.type);
        if (list) {
            also = list.map((_, index) => ({ type: selection.type, index })).filter((sel) => sel.index !== selection.index);
            select(selection, false, true);
        }
    }
    else if (key === 'f' && selection) focusSelection();
}

/** Flat things (sections, pavements, patches) lose to anything standing on them. */
const FLAT_TYPES = new Set(['section', 'pavement', 'patch', 'sound', 'pen']);

function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const entities = raycaster.intersectObjects(entityGroup.children, true).filter((entry) => entry.object.visible).map((entry) => {
        let node = entry.object;
        while (node && !node.userData.entity) node = node.parent;
        return node?.userData.entity;
    }).filter(Boolean);
    // In order: anything standing, then patches, then the rest (a patch over a section wins over the section), each once.
    const rank = (e) => (!FLAT_TYPES.has(e.type) ? 0 : e.type === 'patch' ? 1 : 2);
    const candidates = entities.filter((e, i) => entities.findIndex((other) => sameSel(other, e)) === i)
        .map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map(({ e }) => e);
    // Clicking the same spot again, the selection untouched since: the next thing under it (round to the first), so
    // something hidden under another can be reached.
    const again = lastPick && Math.hypot(event.clientX - lastPick.x, event.clientY - lastPick.y) <= 4 && lastPick.edits === edits;
    const current = again && selection ? candidates.findIndex((e) => sameSel(e, selection)) : -1;
    const picked = (current >= 0 ? candidates[(current + 1) % candidates.length] : candidates[0]) ?? null;
    lastPick = { x: event.clientX, y: event.clientY, edits };
    // Linking: a waypoint clicked with one selected (Alt, or 🔗 Link) links / unlinks the two.
    if (picked?.type === 'waypoint' && selection?.type === 'waypoint' && picked.index !== selection.index && (linking || event.altKey)) {
        toggleLink(selection.index, picked.index);
        linking = false;
        return select(picked);
    }
    linking = false;
    // Shift / Ctrl: add to the selection (a click on nothing keeps it).
    const add = event.shiftKey || event.ctrlKey || event.metaKey;
    if (add && !picked) return;
    select(picked, add);
}

// ---------------------------------------------------------------- ground

function plane(width, depth, color, y, opacity = 1) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
        color, roughness: 0.9, transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
    }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(width, depth, 1);
    mesh.position.y = y;
    return mesh;
}

// The island's outline maths (mirrors games/mow/game/world/Shore.ts).
function inwardNormals(points) {
    let area = 0;
    points.forEach((p, i) => { const q = points[(i + 1) % points.length]; area += p.x * q.z - q.x * p.z; });
    const sign = area >= 0 ? 1 : -1;
    return points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        const length = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        return { x: (-(q.z - p.z) / length) * sign, z: ((q.x - p.x) / length) * sign };
    });
}

function insetPolygon(points, distance) {
    const normals = inwardNormals(points);
    return points.map((p, i) => {
        const a = normals[(i - 1 + points.length) % points.length];
        const b = normals[i];
        const scale = distance / Math.max(0.25, 1 + a.x * b.x + a.z * b.z);
        return { x: p.x + (a.x + b.x) * scale, z: p.z + (a.z + b.z) * scale };
    });
}

/** The shore as the game reads it: the island's outline, or the ground's rect. */
/** The island's outline as the game draws it: its points (or the ground's rect), corners rounded (Shore.ts). */
function shorePoints() {
    const radius = town.island?.cornerRadius ?? 3.5;
    if (town.island?.outline?.length >= 3) return roundCorners(town.island.outline, radius);
    const g = town.ground;
    return roundCorners([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({ x: g.x + (sx * g.width) / 2, z: g.z + (sz * g.depth) / 2 })), radius);
}

/** Shore.ts roundCorners(): each corner an arc tangent to its edges (at most 45% of either edge), a point every 15°. */
function roundCorners(points, radius) {
    if (radius <= 0 || points.length < 3) return points.map((p) => ({ ...p }));
    const out = [];
    points.forEach((p, i) => {
        const prev = points[(i - 1 + points.length) % points.length];
        const next = points[(i + 1) % points.length];
        const inLength = Math.hypot(p.x - prev.x, p.z - prev.z);
        const outLength = Math.hypot(next.x - p.x, next.z - p.z);
        if (inLength < 1e-6 || outLength < 1e-6) return;
        const toPrev = { x: (prev.x - p.x) / inLength, z: (prev.z - p.z) / inLength };
        const toNext = { x: (next.x - p.x) / outLength, z: (next.z - p.z) / outLength };
        const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, toPrev.x * toNext.x + toPrev.z * toNext.z)));
        if (turn < 0.02) return void out.push({ ...p });
        const half = (Math.PI - turn) / 2;
        const reach = Math.min(radius / Math.tan(half), inLength * 0.45, outLength * 0.45);
        const r = reach * Math.tan(half);
        const start = { x: p.x + toPrev.x * reach, z: p.z + toPrev.z * reach };
        const end = { x: p.x + toNext.x * reach, z: p.z + toNext.z * reach };
        const length = Math.hypot(toPrev.x + toNext.x, toPrev.z + toNext.z) || 1;
        const centre = { x: p.x + ((toPrev.x + toNext.x) / length) * (r / Math.sin(half)), z: p.z + ((toPrev.z + toNext.z) / length) * (r / Math.sin(half)) };
        const from = Math.atan2(start.z - centre.z, start.x - centre.x);
        let sweep = Math.atan2(end.z - centre.z, end.x - centre.x) - from;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        while (sweep < -Math.PI) sweep += Math.PI * 2;
        const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
        for (let s = 0; s <= steps; s++) {
            const angle = from + (sweep * s) / steps;
            out.push({ x: centre.x + Math.cos(angle) * r, z: centre.z + Math.sin(angle) * r });
        }
    });
    return out;
}

/** A flat polygon (a hole optional) at height y. */
function polygonMesh(points, color, y, hole) {
    const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
    if (hole) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.z))));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }));
    mesh.position.y = y;
    return mesh;
}

function rebuildGround() {
    groundGroup.clear();
    const ground = town.ground;
    if (!ground) return;
    const shore = shorePoints();
    const island = town.island;
    groundGroup.add(polygonMesh(shore, ground.color, -0.05));
    if (!island) return;
    // The deck band, the sea round the shore's bounds (the game draws pizza's water) and the fence line.
    if (island.deck) groundGroup.add(polygonMesh(shore, island.deck.color, -0.02, insetPolygon(shore, island.deck.width)));
    const xs = shore.map((p) => p.x);
    const zs = shore.map((p) => p.z);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const sea = plane(maxX - minX + island.margin * 2, maxZ - minZ + island.margin * 2, island.water, -island.waterLevel);
    sea.position.x = (minX + maxX) / 2;
    sea.position.z = (minZ + maxZ) / 2;
    groundGroup.add(sea);
    if (island.fence) {
        const line = insetPolygon(shore, island.fence.inset).map((p) => new THREE.Vector3(p.x, island.fence.height, p.z));
        groundGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(line), new THREE.LineBasicMaterial({ color: island.fence.color })));
    }
}

// ---------------------------------------------------------------- grass preview (mirrors GrassField.generate)

function valueNoise(seed) {
    const hash = (x, z) => {
        let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2147483647);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const smooth = (t) => t * t * (3 - 2 * t);
    return (x, z) => {
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const fx = smooth(x - x0);
        const fz = smooth(z - z0);
        const a = hash(x0, z0) + (hash(x0 + 1, z0) - hash(x0, z0)) * fx;
        const b = hash(x0, z0 + 1) + (hash(x0 + 1, z0 + 1) - hash(x0, z0 + 1)) * fx;
        return a + (b - a) * fz;
    };
}

function inPatch(patch, x, z) {
    const turn = -(patch.rotationY ?? 0);
    const dx = x - patch.x;
    const dz = z - patch.z;
    const lx = dx * Math.cos(turn) + dz * Math.sin(turn);
    const lz = -dx * Math.sin(turn) + dz * Math.cos(turn);
    const hx = patch.width / 2;
    const hz = patch.depth / 2;
    if (patch.shape === 'round') return (lx / hx) ** 2 + (lz / hz) ** 2 <= 1;
    return Math.abs(lx) <= hx && Math.abs(lz) <= hz;
}

function autoType(x, z, noise) {
    const field = town.grassNoise;
    const distance = Math.hypot(x - field.centre.x, z - field.centre.z);
    const ring = field.rings.find((r) => distance <= r.upTo) ?? field.rings[field.rings.length - 1];
    const total = mow.grass.reduce((sum, g) => sum + (ring.mix[g.id] ?? 0), 0) || 1;
    const n = noise(x * field.scale, z * field.scale);
    let cumulative = 0;
    for (let t = 0; t < mow.grass.length; t++) {
        cumulative += (ring.mix[mow.grass[t].id] ?? 0) / total;
        if (n < cumulative) return t;
    }
    return mow.grass.length - 1;
}

/** What blocks grass (Town.isBlocked): pavements, prop colliders, ATM and wardrobe boxes, all padded. */
function blockers() {
    const boxes = town.pavements.map((p) => ({ x: p.x, z: p.z, halfX: p.width / 2, halfZ: p.depth / 2 }));
    for (const prop of town.props) if (prop.collider) boxes.push({ x: prop.x, z: prop.z, halfX: prop.collider.halfX, halfZ: prop.collider.halfZ });
    for (const atm of town.atms) boxes.push(stationBox(atm, town.atm));
    for (const wardrobe of town.wardrobes) boxes.push(stationBox(wardrobe, town.wardrobe));
    return boxes;
}

/** The box a station (an ATM, a wardrobe: `look` is its kind's) blocks: its model, `back` behind the pad. */
function stationBox(atm, look) {
    const turn = atm.rotationY ?? 0;
    const sideways = Math.abs(Math.sin(turn)) > 0.5;
    return {
        x: atm.x - Math.sin(turn) * look.back,
        z: atm.z - Math.cos(turn) * look.back,
        halfX: sideways ? look.collider.halfZ : look.collider.halfX,
        halfZ: sideways ? look.collider.halfX : look.collider.halfZ,
    };
}

function queueGrass() {
    clearTimeout(grassTimer);
    grassTimer = setTimeout(rebuildGrass, 120);
}

/** Every grass cell, as the game generates it, drawn as one texture over the grid (one texel per cell). */
function rebuildGrass() {
    grassGroup.clear();
    if (!town.sections.length) return;
    refreshColliders();
    const cell = mow.cell;
    const minX = Math.min(...town.sections.map((s) => s.x - s.width / 2));
    const maxX = Math.max(...town.sections.map((s) => s.x + s.width / 2));
    const minZ = Math.min(...town.sections.map((s) => s.z - s.depth / 2));
    const maxZ = Math.max(...town.sections.map((s) => s.z + s.depth / 2));
    const width = Math.ceil((maxX - minX) / cell);
    const depth = Math.ceil((maxZ - minZ) / cell);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = depth;
    const g = canvas.getContext('2d');
    const noise = valueNoise(mow.seed + 17);
    const boxes = blockers();
    const taken = new Uint8Array(width * depth);
    const counts = mow.grass.map(() => 0);
    town.sections.forEach((section) => {
        const cap = section.maxGrass ? mow.grass.findIndex((gr) => gr.id === section.maxGrass) : -1;
        const maxType = cap >= 0 ? cap : mow.grass.length - 1;
        for (let iz = 0; iz < depth; iz++) {
            for (let ix = 0; ix < width; ix++) {
                const x = minX + (ix + 0.5) * cell;
                const z = minZ + (iz + 0.5) * cell;
                if (Math.abs(x - section.x) > section.width / 2 || Math.abs(z - section.z) > section.depth / 2) continue;
                if (taken[ix + iz * width]) continue;
                if (boxes.some((b) => Math.abs(x - b.x) <= b.halfX + BLOCK_PAD && Math.abs(z - b.z) <= b.halfZ + BLOCK_PAD)) continue;
                const patch = town.grassPatches.reduce((found, p) => (inPatch(p, x, z) ? p : found), undefined);
                const kind = patch ? patch.grass : (section.fill ?? 'auto');
                if (kind === 'none') continue;
                const type = Math.min(maxType, kind === 'auto' ? autoType(x, z, noise) : Math.max(0, mow.grass.findIndex((gr) => gr.id === kind)));
                taken[ix + iz * width] = 1;
                counts[type]++;
                g.fillStyle = mow.grass[type].color;
                g.fillRect(ix, iz, 1, 1);
            }
        }
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.flipY = false;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * cell, depth * cell), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    // PlaneGeometry's v runs +Y; laid flat that's -Z, and flipY false puts row 0 (minZ) at v = 0.
    mesh.scale.y = -1;
    mesh.position.set(minX + (width * cell) / 2, 0.02, minZ + (depth * cell) / 2);
    grassGroup.add(mesh);
    grassGroup.visible = showGrass;
    const summary = host.querySelector('#townGrassCount');
    if (summary) summary.textContent = mow.grass.map((gr, t) => `${gr.name}: ${counts[t]}`).join(' · ');
}

// ---------------------------------------------------------------- entities

const keyOf = (sel) => `${sel.type}:${sel.index}`;
const LISTS = { prop: 'props', atm: 'atms', wardrobe: 'wardrobes', pavement: 'pavements', section: 'sections', patch: 'grassPatches', sound: 'sounds', secret: 'secrets' };
const listOf = (type) => (type === 'waypoint' ? town.traffic.waypoints : LISTS[type] ? town[LISTS[type]] : null);
const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;
const grassColor = (id) => (id === 'none' ? '#c9b48a' : id === 'auto' ? '#9be37a' : (mow.grass.find((g) => g.id === id)?.color ?? '#5cbf4a'));
const grassName = (id) => (id === 'none' ? 'no grass' : id === 'auto' ? 'noise' : (mow.grass.find((g) => g.id === id)?.name ?? id));

function entityData(sel) {
    if (!sel) return null;
    if (sel.type === 'start') return town.start;
    if (sel.type === 'centre') return town.grassNoise.centre;
    if (sel.type === 'separator') return town.sections[sel.index]?.separator ?? null;
    if (sel.type === 'pen') return town.sections[sel.index]?.pen ?? null;
    if (sel.type === 'shore') return town.island?.outline?.[sel.index] ?? null;
    return listOf(sel.type)?.[sel.index] ?? null;
}

function loadModel(path) {
    if (!modelCache.has(path)) {
        modelCache.set(path, loader.loadAsync(`/models/${path}`).then((gltf) => gltf.scene, (error) => {
            console.warn(`[town] could not load ${path}`, error);
            return null;
        }));
    }
    return modelCache.get(path);
}

/** A model scaled to `height`, standing on `elevation`, in a holder (the holder carries x/z and the turn). */
async function fillModel(holder, path, height, elevation, stretch) {
    const source = await loadModel(path);
    if (!source || !holder.parent) return null;
    const model = source.clone(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (size.y > 1e-4) model.scale.multiplyScalar(height / size.y);
    if (stretch) model.scale.multiply(new THREE.Vector3(stretch.x, 1, stretch.z));
    model.updateMatrixWorld(true);
    model.position.y = elevation - new THREE.Box3().setFromObject(model).min.y;
    holder.add(model);
    holder.userData.model = model;
    queueGrass();
    return model;
}

function labelSprite(text, color = '#ffffff', background = 'rgba(20,24,32,0.85)') {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const g = canvas.getContext('2d');
    g.fillStyle = background;
    g.beginPath();
    g.roundRect(4, 4, 248, 88, 20);
    g.fill();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = text.split('\n');
    lines.forEach((line, i) => {
        g.font = i === 0 ? 'bold 40px Arial' : 'bold 22px Arial';
        g.fillText(line, 128, lines.length === 1 ? 48 : 34 + i * 34, 236);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
    sprite.scale.set(2.4, 0.9, 1);
    return sprite;
}

/** An outlined rectangle (or ellipse) on the ground, 1 x 1, scaled to its size by the caller. */
function outline(color, round = false) {
    const geometry = round ? new THREE.CircleGeometry(0.5, 48) : new THREE.PlaneGeometry(1, 1);
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color }));
    line.rotation.x = -Math.PI / 2;
    return line;
}

function rebuildEntities() {
    gizmo.detach();
    entityGroup.clear();
    holders.clear();
    town.pavements.forEach((pavement, index) => addHolder({ type: 'pavement', index }, buildPavement(pavement, index)));
    town.sections.forEach((section, index) => {
        addHolder({ type: 'section', index }, buildSection(section, index));
        if (diorama) return;
        if (section.separator) addHolder({ type: 'separator', index }, buildSeparator(section.separator, index));
        if (section.pen) addHolder({ type: 'pen', index }, buildPen(section.pen, index));
    });
    town.grassPatches.forEach((patch, index) => addHolder({ type: 'patch', index }, buildPatch(patch)));
    town.props.forEach((prop, index) => addHolder({ type: 'prop', index }, buildProp(prop)));
    town.atms.forEach((atm, index) => addHolder({ type: 'atm', index }, buildStation(atm, town.atm, 'ATM', '#3fd16b')));
    town.wardrobes.forEach((wardrobe, index) => addHolder({ type: 'wardrobe', index }, buildStation(wardrobe, town.wardrobe, 'WARDROBE', '#e266c8')));
    town.island?.outline?.forEach((point, index) => addHolder({ type: 'shore', index }, buildShorePoint(point, index)));
    renderTraffic();
    // A diorama is only a picture: no stations' markers, start, noise centre, sounds, secrets or traffic.
    if (!diorama) {
        town.sounds.forEach((zone, index) => addHolder({ type: 'sound', index }, buildSound(zone)));
        town.secrets.forEach((secret, index) => addHolder({ type: 'secret', index }, buildSecret(secret)));
        if (showTraffic) town.traffic.waypoints.forEach((point, index) => addHolder({ type: 'waypoint', index }, buildWaypoint(point)));
        addHolder({ type: 'start', index: 0 }, buildStart());
        addHolder({ type: 'centre', index: 0 }, buildCentre());
    }
    attachGizmo();
    renderHighlights();
}

function addHolder(sel, holder) {
    holder.userData.entity = sel;
    holders.set(keyOf(sel), holder);
    entityGroup.add(holder);
}

function buildPavement(pavement, index) {
    const holder = new THREE.Group();
    holder.position.set(pavement.x, 0, pavement.z);
    const mesh = plane(pavement.width, pavement.depth, pavement.color, 0.03 + index * 0.004);
    holder.add(mesh);
    return holder;
}

/** A sound zone: a translucent violet box (full volume), a dashed line where it has faded out, its label. */
function buildSound(zone) {
    const holder = new THREE.Group();
    holder.position.set(zone.x, 0, zone.z);
    const fill = plane(zone.width, zone.depth, '#a15cff', 0.25, 0.35);
    const edge = outline(0xc89bff);
    edge.scale.set(zone.width, zone.depth, 1);
    edge.position.y = 0.26;
    const fade = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
        new THREE.LineDashedMaterial({ color: 0xe6d4ff, dashSize: 0.6, gapSize: 0.4 }));
    fade.rotation.x = -Math.PI / 2;
    fade.scale.set(zone.width + zone.fade * 2, zone.depth + zone.fade * 2, 1);
    fade.position.y = 0.26;
    fade.computeLineDistances();
    // The fade line is only a guide: clicks pick the box.
    fade.raycast = () => {};
    const label = labelSprite(`🔊 ${zone.id}\n${zone.sound} · vol ${zone.volume} · fade ${zone.fade}`, '#d9bfff');
    label.position.y = 3;
    holder.add(fill, edge, fade, label);
    return holder;
}

/** A section's pen: a dashed white line round its rect (the fence the game draws) and its label. */
function buildPen(pen, index) {
    const holder = new THREE.Group();
    holder.position.set(pen.x, 0, pen.z);
    const area = plane(pen.width, pen.depth, '#ffffff', 0.12, 0.06);
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
        new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.5, gapSize: 0.3 }));
    line.rotation.x = -Math.PI / 2;
    line.scale.set(pen.width, pen.depth, 1);
    line.position.y = 0.14;
    line.computeLineDistances();
    const label = labelSprite(`🚧 Pen: stay inside
until ${town.sections[index].name} is restored`, '#ffffff');
    label.position.set(0, 2.4, pen.depth / 2);
    holder.add(area, line, label);
    return holder;
}

/** A secret patch: a translucent gold-green box (the lush grass), its outline and its label. */
function buildSecret(secret) {
    const holder = new THREE.Group();
    holder.position.set(secret.x, 0, secret.z);
    const fill = plane(secret.width, secret.depth, '#8ff05a', 0.2, 0.55);
    const edge = outline(0xffd23f);
    edge.scale.set(secret.width, secret.depth, 1);
    edge.position.y = 0.21;
    const label = labelSprite(`🤫 ${secret.id}
chest $${secret.reward}`, '#ffe27a');
    label.position.y = 2;
    holder.add(fill, edge, label);
    return holder;
}

function buildSection(section, index) {
    const holder = new THREE.Group();
    holder.position.set(section.x, 0, section.z);
    const color = SECTION_COLORS[index % SECTION_COLORS.length];
    const fill = plane(section.width, section.depth, section.ground ?? '#4f7d35', 0.01);
    const edge = outline(color);
    edge.scale.set(section.width, section.depth, 1);
    edge.position.y = 0.08;
    const label = diorama ? labelSprite(section.name, hex(color)) : labelSprite(`${index + 1}. ${section.name}\n$${section.bonus} bonus · grass: ${grassName(section.fill ?? 'auto')}${(section.grassScale ?? 1) !== 1 ? ` ×${section.grassScale}` : ''}${section.maxGrass ? ` · max ${grassName(section.maxGrass)}` : ''}`, hex(color));
    label.position.y = 4;
    label.scale.multiplyScalar(1.6);
    holder.add(fill, edge, label);
    return holder;
}

/** A separator: the fence line (as the game draws it) with its section's lock label. */
function buildSeparator(line, index) {
    const holder = new THREE.Group();
    holder.position.set(line.x, 0, line.z);
    holder.rotation.y = line.rotationY ?? 0;
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(line.width, 0.12, 0.08), white);
    rail.position.y = 0.95;
    const rail2 = rail.clone();
    rail2.position.y = 0.45;
    holder.add(rail, rail2);
    for (let x = -line.width / 2; x <= line.width / 2 + 0.01; x += 1.5) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), white);
        post.position.set(x, 0.6, 0);
        holder.add(post);
    }
    const label = labelSprite(`🔒 ${town.sections[index].name}\nopens when ${town.sections[index - 1]?.name ?? '—'} is restored`, '#ffe27a');
    label.position.y = 2.2;
    holder.add(label);
    return holder;
}

function buildPatch(patch) {
    const holder = new THREE.Group();
    holder.position.set(patch.x, 0, patch.z);
    holder.rotation.y = patch.rotationY ?? 0;
    const color = new THREE.Color(grassColor(patch.grass));
    const geometry = patch.shape === 'round' ? new THREE.CircleGeometry(0.5, 48) : new THREE.PlaneGeometry(1, 1);
    const area = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide }));
    area.rotation.x = -Math.PI / 2;
    area.scale.set(patch.width, patch.depth, 1);
    area.position.y = 0.06;
    const edge = outline(color.getHex(), patch.shape === 'round');
    edge.scale.set(patch.width, patch.depth, 1);
    edge.position.y = 0.07;
    holder.add(area, edge);
    return holder;
}

function buildProp(prop) {
    const holder = new THREE.Group();
    holder.position.set(prop.x, 0, prop.z);
    holder.rotation.y = prop.rotationY ?? 0;
    void fillModel(holder, prop.model, prop.height, prop.elevation ?? 0, prop.stretch);
    return holder;
}

/** A station's "appears" in a few words, for the lists. */
function appearsLabel(spot) {
    if (spot.appearsWhenFull) return 'when the bag first fills';
    if (spot.appearsAfterSales) return `after sale ${spot.appearsAfterSales}`;
    return town.sections.find((s) => s.id === spot.section)?.name ?? 'always';
}

/**
 * When a station appears: from the start, when the bag first fills (`appearsWhenFull`), after the bag's nth sale
 * (`appearsAfterSales`) or with a section.
 */
function appearsField(data) {
    const value = data.appearsWhenFull ? 'full' : data.appearsAfterSales ? `sales:${data.appearsAfterSales}` : data.section ?? '';
    const options = [['', 'From the start'], ['full', 'When the bag first fills'], ['sales:1', 'After the 1st sale'], ['sales:2', 'After the 2nd sale'], ['sales:3', 'After the 3rd sale'],
        ...town.sections.map((s) => [s.id, `When ${s.name} opens`])];
    return selectField('Appears', value, options, (v) => edit((d) => {
        delete d.section;
        delete d.appearsAfterSales;
        delete d.appearsWhenFull;
        if (v === 'full') d.appearsWhenFull = true;
        else if (v.startsWith('sales:')) d.appearsAfterSales = Number(v.slice(6));
        else if (v) d.section = v;
    }));
}

/** A station (an ATM, a wardrobe) as the game draws it: its pad, the model `back` behind it, its name over it. */
function buildStation(atm, look, name, labelColor) {
    const holder = new THREE.Group();
    holder.position.set(atm.x, 0, atm.z);
    holder.rotation.y = atm.rotationY ?? 0;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS, 0.06, 40),
        new THREE.MeshStandardMaterial({ color: look.color, emissive: look.color, emissiveIntensity: 0.3, transparent: true, opacity: 0.7 }));
    pad.position.y = 0.05;
    holder.add(pad);
    const stand = new THREE.Group();
    stand.position.z = -look.back;
    holder.add(stand);
    void fillModel(stand, look.model, look.height, 0);
    const section = town.sections.find((s) => s.id === atm.section);
    const when = atm.appearsWhenFull ? 'when the bag first fills' : atm.appearsAfterSales ? `after sale ${atm.appearsAfterSales}` : section ? `with ${section.name}` : '';
    const label = labelSprite(when ? `${name}\nappears ${when}` : name, labelColor);
    label.position.set(0, look.label, -look.back);
    holder.add(label);
    return holder;
}

/** One of the island outline's points: an orange post with its number. */
function buildShorePoint(point, index) {
    const holder = new THREE.Group();
    holder.position.set(point.x, 0, point.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 12), new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff8a2a, emissiveIntensity: 0.35 }));
    post.position.y = 0.8;
    const label = labelSprite(`${index + 1}`, '#ffb36b');
    label.scale.multiplyScalar(0.45);
    label.position.y = 2.1;
    holder.add(post, label);
    return holder;
}

function buildStart() {
    const holder = new THREE.Group();
    holder.position.set(town.start.x, 0, town.start.z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0x4fd2ff }));
    disc.position.y = 0.05;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 12), new THREE.MeshStandardMaterial({ color: 0x42a5f5 }));
    body.position.y = 0.75;
    const label = labelSprite('START', '#4fd2ff');
    label.position.y = 2;
    label.scale.multiplyScalar(0.7);
    holder.add(disc, body, label);
    return holder;
}

/** The grass noise's centre, with its rings (each ring's outer edge). */
function buildCentre() {
    const holder = new THREE.Group();
    const centre = town.grassNoise.centre;
    holder.position.set(centre.x, 0, centre.z);
    const marker = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 16), new THREE.MeshBasicMaterial({ color: 0xff6bd5 }));
    marker.position.y = 0.5;
    marker.rotation.x = Math.PI;
    holder.add(marker);
    town.grassNoise.rings.forEach((ring, i) => {
        if (ring.upTo > 200) return;
        const points = [];
        for (let a = 0; a <= 64; a++) points.push(new THREE.Vector3(Math.cos((a / 64) * Math.PI * 2) * ring.upTo, 0.12, Math.sin((a / 64) * Math.PI * 2) * ring.upTo));
        const circle = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0xff6bd5, dashSize: 0.6, gapSize: 0.4 }));
        circle.computeLineDistances();
        circle.raycast = () => {};
        holder.add(circle);
        const tag = labelSprite(`ring ${i + 1}`, '#ff6bd5');
        tag.scale.multiplyScalar(0.6);
        tag.position.set(ring.upTo, 0.8, 0);
        tag.raycast = () => {};
        holder.add(tag);
    });
    const label = labelSprite('GRASS NOISE\ncentre', '#ff6bd5');
    label.position.y = 2;
    label.scale.multiplyScalar(0.7);
    holder.add(label);
    return holder;
}

// ---------------------------------------------------------------- selection + gizmo

/** Everything selected: the one the gizmo is on, and the rest. */
const selected = () => (selection ? [selection, ...also] : []);
const sameSel = (a, b) => a.type === b.type && a.index === b.index;

/**
 * Selects `sel` (null: nothing). With `add` (Shift / Ctrl), it joins the selection (the gizmo moves to it) or, already
 * in it, leaves. `keep`: the others stay as they are (Ctrl+A).
 */
function select(sel, add = false, keep = false) {
    if (add && sel && selection) {
        if (sameSel(sel, selection)) {
            selection = also.pop() ?? null;
        } else if (also.some((other) => sameSel(other, sel))) {
            also = also.filter((other) => !sameSel(other, sel));
        } else {
            also.push(selection);
            selection = sel;
        }
    } else {
        selection = sel;
        if (!keep) also = [];
    }
    renderTraffic();
    attachGizmo();
    renderHighlights();
    renderLists();
    renderInspector();
}

/** A yellow box round everything selected (the gizmo's one brighter). */
function renderHighlights() {
    highlightGroup.clear();
    for (const sel of selected()) {
        const holder = holders.get(keyOf(sel));
        if (!holder) continue;
        const box = new THREE.BoxHelper(holder, sameSel(sel, selection) ? 0xffe066 : 0xffb020);
        box.userData.holder = holder;
        // Only a picture: clicks go through it.
        box.raycast = () => {};
        highlightGroup.add(box);
    }
}

/** The boxes follow their things (after a move; a model that just loaded). */
function updateHighlights() {
    for (const box of highlightGroup.children) box.update();
}

function attachGizmo() {
    const holder = selection ? holders.get(keyOf(selection)) : null;
    if (holder) gizmo.attach(holder);
    else gizmo.detach();
}

// toFixed drops float noise (0.69 * 1 → 0.6900000000000001) so town.json stays readable.
const round = (value, step = 0.001) => Number((Math.round(value / step) * step).toFixed(4));
/** Things that turn (the rest only move / resize). */
const TURNS = new Set(['prop', 'atm', 'wardrobe', 'patch', 'separator']);
/** Things whose size is width x depth (scaling changes those, not a height). */
const SIZED = new Set(['pavement', 'section', 'patch', 'sound', 'pen', 'secret']);

/** The gizmo moved/turned the holder: write it back into the data. */
function syncFromGizmo() {
    const data = entityData(selection);
    const holder = gizmo.object;
    if (!data || !holder) return;
    if (gizmo.getMode() === 'scale') {
        holder.scale.set(Math.max(0.05, holder.scale.x), Math.max(0.05, holder.scale.y), Math.max(0.05, holder.scale.z));
        setDirty(true);
        return;
    }
    data.x = round(holder.position.x);
    data.z = round(holder.position.z);
    if (TURNS.has(selection.type)) data.rotationY = round(holder.rotation.y, 0.0001);
    // The rest of the selection moves by as much (a turn is the gizmo's one only).
    const start = moveStarts.get(keyOf(selection));
    if (start && also.length && gizmo.getMode() === 'translate') {
        const dx = holder.position.x - start.x;
        const dz = holder.position.z - start.z;
        for (const sel of also) {
            const other = holders.get(keyOf(sel));
            const from = moveStarts.get(keyOf(sel));
            const otherData = entityData(sel);
            if (!other || !from || !otherData) continue;
            other.position.set(from.x + dx, other.position.y, from.z + dz);
            otherData.x = round(other.position.x);
            otherData.z = round(other.position.z);
        }
    }
    const types = new Set(selected().map((sel) => sel.type));
    if (types.has('shore')) rebuildGround();
    if (types.has('waypoint')) renderTraffic();
    updateHighlights();
    setDirty(true);
}

/** A move/turn ended: things that depend on it (labels, rings, the grass) catch up. */
function afterMove() {
    if (selection?.type === 'centre') rebuildEntities();
    renderInspector();
    queueGrass();
}

/** A scale drag ended: fold the holder's scale into the data and redraw. */
function commitScale() {
    const data = entityData(selection);
    const scale = gizmo.object?.scale ?? new THREE.Vector3(1, 1, 1);
    if (data && SIZED.has(selection.type)) {
        data.width = round(Math.max(0.5, data.width * scale.x), 0.25);
        data.depth = round(Math.max(0.5, data.depth * scale.z), 0.25);
    } else if (data && selection.type === 'separator') {
        data.width = round(Math.max(1, data.width * scale.x), 0.25);
    } else if (data && selection.type === 'prop') {
        if (Math.abs(scale.x - scale.y) > 1e-3 || Math.abs(scale.z - scale.y) > 1e-3) {
            // Height takes the Y scale (and with it the whole model grows); width/depth keep the rest as a stretch.
            stretch(data, scale.x / scale.y, scale.z / scale.y);
            data.height = round(Math.max(0.05, data.height * scale.y), 0.01);
        } else {
            data.height = round(Math.max(0.05, data.height * scale.x), 0.01);
        }
    }
    rebuildAll();
}

/** Multiplies a prop's width/depth stretch (dropped again when it's back to 1 x 1). */
function stretch(data, x, z) {
    const next = { x: round((data.stretch?.x ?? 1) * x, 0.01), z: round((data.stretch?.z ?? 1) * z, 0.01) };
    if (Math.abs(next.x - 1) < 1e-3 && Math.abs(next.z - 1) < 1e-3) delete data.stretch;
    else data.stretch = next;
}

function focusSelection() {
    const holder = holders.get(keyOf(selection));
    if (!holder) return;
    const offset = camera.position.clone().sub(orbit.target);
    orbit.target.copy(holder.position);
    camera.position.copy(holder.position).add(offset);
}

/** Where new things go: the orbit target (the middle of the view), on the floor. */
function dropPoint() {
    return { x: round(orbit.target.x, SNAP), z: round(orbit.target.z, SNAP) };
}

const fileName = (path) => path.split('/').pop().replace(/\.(glb|gltf)$/i, '');
const titleCase = (text) => text.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function added(type) {
    rebuildAll();
    select({ type, index: listOf(type).length - 1 });
}

function addModel(path) {
    touch();
    town.props.push({ model: path, ...dropPoint(), rotationY: 0, height: 1.5, collider: { halfX: 0.5, halfZ: 0.5 } });
    added('prop');
}

function pickModel() {
    openModelPicker({ title: 'Prop model', confirmLabel: 'Place in town', onPick: (path) => addModel(path) });
}

async function importFromLibrary() {
    await openLibraryPicker({
        onImported: async (path) => {
            setModelCatalog(await api('/api/models'));
            addModel(path);
            toast('Imported. Run "GAME=mow npm run models" before a build.');
        },
    });
}

function addAtm() {
    touch();
    town.atms.push({ ...dropPoint(), rotationY: 0 });
    added('atm');
}

function addWardrobe() {
    touch();
    town.wardrobes.push({ ...dropPoint(), rotationY: 0 });
    added('wardrobe');
}

function addPatch(grass) {
    touch();
    town.grassPatches.push({ ...dropPoint(), width: 4, depth: 3, rotationY: 0, shape: 'round', grass });
    added('patch');
}

function addPavement() {
    touch();
    let n = town.pavements.length + 1;
    while (town.pavements.some((p) => p.id === `pavement-${n}`)) n++;
    town.pavements.push({ id: `pavement-${n}`, ...dropPoint(), width: 6, depth: 2, color: '#d8ccb0' });
    added('pavement');
}

function addSound() {
    touch();
    let n = town.sounds.length + 1;
    while (town.sounds.some((s) => s.id === `sound-${n}`)) n++;
    town.sounds.push({ id: `sound-${n}`, sound: soundFiles.includes('ocean-ambient') ? 'ocean-ambient' : soundFiles[0], ...dropPoint(), width: 10, depth: 10, fade: 10, volume: 0.15 });
    added('sound');
}

function addSecret() {
    touch();
    let n = town.secrets.length + 1;
    while (town.secrets.some((s) => s.id === `secret-${n}`)) n++;
    town.secrets.push({ id: `secret-${n}`, ...dropPoint(), width: 2, depth: 2, reward: 50 });
    added('secret');
}

/** A new section, the last to unlock: next to the last one (further out), with a separator on its near side. */
function addSection() {
    touch();
    const last = town.sections[town.sections.length - 1];
    let n = town.sections.length + 1;
    while (town.sections.some((s) => s.id === `section-${n}`)) n++;
    const width = last?.width ?? 20;
    const depth = last?.depth ?? 14;
    const z = last ? last.z - last.depth / 2 - depth / 2 - 8 : 0;
    const x = last?.x ?? 0;
    town.sections.push({
        id: `section-${n}`, name: `Section ${n}`, x, z, width, depth, fill: 'auto',
        completeAt: 0.97, bonus: Math.round((last?.bonus ?? 100) * 2.5), ground: last?.ground ?? '#4d7633', restoredGround: last?.restoredGround ?? '#6aa845',
        separator: { x, z: z + depth / 2, width, rotationY: 0 }, onUnlock: { pan: false },
    });
    added('section');
    focusSelection();
}

/** Adds a shore point half way to the next one (and selects it). */
function insertShorePoint(index) {
    const outline = town.island.outline;
    const a = outline[index];
    const b = outline[(index + 1) % outline.length];
    touch();
    outline.splice(index + 1, 0, { x: round((a.x + b.x) / 2, SNAP), z: round((a.z + b.z) / 2, SNAP) });
    rebuildAll();
    select({ type: 'shore', index: index + 1 });
}

function duplicateSelection() {
    if (selection?.type === 'shore') return insertShorePoint(selection.index);
    if (selection?.type === 'waypoint') return addWaypoint();
    if (!selection || !LISTS[selection.type] || selection.type === 'section') return;
    const data = entityData(selection);
    touch();
    const copy = { ...structuredClone(data), x: data.x + 1, z: data.z + 1 };
    if (selection.type === 'pavement' || selection.type === 'sound' || selection.type === 'secret') copy.id = `${data.id}-copy`;
    listOf(selection.type).push(copy);
    added(selection.type);
}

/** Removes everything selected (the start and the noise centre stay; the shore keeps 3 points). */
function removeSelection() {
    const doomed = selected().filter((sel) => sel.type !== 'start' && sel.type !== 'centre');
    if (!doomed.length) return;
    const shore = doomed.filter((sel) => sel.type === 'shore').length;
    if (shore && town.island.outline.length - shore < 3) return toast('The shore needs at least 3 points.', 'bad');
    touch();
    // Highest index first, so the ones still to go keep theirs.
    doomed.sort((a, b) => b.index - a.index);
    for (const sel of doomed) {
        if (sel.type === 'separator') delete town.sections[sel.index].separator;
        else if (sel.type === 'pen') delete town.sections[sel.index].pen;
        else if (sel.type === 'waypoint') removeWaypoint(sel.index);
        else if (sel.type === 'shore') town.island.outline.splice(sel.index, 1);
        else listOf(sel.type).splice(sel.index, 1);
    }
    selection = null;
    also = [];
    rebuildAll();
}

function moveSection(index, by) {
    const to = index + by;
    if (to < 0 || to >= town.sections.length) return;
    touch();
    const [section] = town.sections.splice(index, 1);
    town.sections.splice(to, 0, section);
    rebuildAll();
    select({ type: 'section', index: to });
}

/** How high above its base a model's footprint is measured: a tree blocks with its trunk, not its crown. */
const FOOTPRINT_HEIGHT = 1;

/** The world-space box of a model's vertices up to FOOTPRINT_HEIGHT above its base (axis-aligned, turned with it). */
function footprint(model) {
    model.updateMatrixWorld(true);
    const base = new THREE.Box3().setFromObject(model).min.y;
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    model.traverse((node) => {
        const position = node.isMesh ? node.geometry.getAttribute('position') : null;
        if (!position) return;
        for (let i = 0; i < position.count; i++) {
            point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
            if (point.y <= base + FOOTPRINT_HEIGHT) box.expandByPoint(point);
        }
    });
    return box;
}

/** Re-derives each blocking prop's collider from its model's footprint (axis-aligned, as the game uses it). */
function refreshColliders() {
    town.props.forEach((data, index) => {
        if (!data.collider) return;
        const model = holders.get(keyOf({ type: 'prop', index }))?.userData.model;
        if (!model) return;
        model.updateMatrixWorld(true);
        const height = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
        const size = footprint(model).getSize(new THREE.Vector3());
        // Flat pieces (road tiles) are walked over, never blocking.
        data.collider = height < FLAT_HEIGHT || size.x <= 0 ? null : { halfX: round(Math.max(0.15, size.x / 2), 0.05), halfZ: round(Math.max(0.15, size.z / 2), 0.05) };
    });
}

async function save() {
    if (!town) return false;
    refreshColliders();
    // The ground's rect follows the shore (its bounds).
    if (town.island?.outline?.length >= 3) {
        const xs = town.island.outline.map((p) => p.x);
        const zs = town.island.outline.map((p) => p.z);
        Object.assign(town.ground, {
            x: round((Math.min(...xs) + Math.max(...xs)) / 2), z: round((Math.min(...zs) + Math.max(...zs)) / 2),
            width: round(Math.max(...xs) - Math.min(...xs)), depth: round(Math.max(...zs) - Math.min(...zs)),
        });
    }
    try {
        const saved = await api(townUrl, { method: 'PUT', body: JSON.stringify(town) });
        town._version = saved.version;
        setDirty(false);
        toast(diorama ? 'Diorama saved.' : 'Town saved — reload the game to see it.');
        return true;
    } catch (error) {
        toast(`Save failed: ${error.message}`, 'bad');
        return false;
    }
}

// ---------------------------------------------------------------- traffic

const TRAFFIC = { road: 0x4fd8ff, network: 0x9be7ff, link: 0xffd23f, waypoint: '#ff9f43', y: 0.32 };
const waypointIndex = (id) => town.traffic.waypoints.findIndex((w) => w.id === id);
const linksOf = (id) => town.traffic.links.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
const carsAt = (id) => town.traffic.cars.filter((car) => car.at === id);
const carName = (model) => titleCase(fileName(model ?? '').replace(/^car_/, '')) || 'Car';

/** A waypoint: an orange post on the road, its id, and a 🚗 per car starting there. */
function buildWaypoint(point) {
    const holder = new THREE.Group();
    holder.position.set(point.x, 0, point.z);
    const material = new THREE.MeshStandardMaterial({ color: TRAFFIC.waypoint, emissive: TRAFFIC.waypoint, emissiveIntensity: 0.3 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20), material);
    disc.position.y = TRAFFIC.y;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), material);
    post.position.y = 0.9;
    const cars = carsAt(point.id).length;
    const label = labelSprite(`${point.id}${cars ? `\n${'🚗'.repeat(Math.min(cars, 4))}` : ''}`, '#ffd2a8');
    label.position.y = 2;
    label.scale.multiplyScalar(0.7);
    holder.add(disc, post, label);
    return holder;
}

// ---------------------------------------------------------------- road builder

/** The kit the roads are built from (ui/mow.json roadKit). */
const roadKit = () => mow.roadKit;

/** Lays the roads' pieces again (each fitted to its neighbours: the game's solveRoads()). */
function rebuildRoads() {
    roadGroup.clear();
    const kit = roadKit();
    const count = town.roads?.cells.length ?? 0;
    const summary = host.querySelector('#townRoadSummary');
    if (summary) summary.textContent = kit ? `${count} road tiles (${kit.tile}×${kit.tile})` : 'No roadKit in ui/mow.json.';
    if (!kit || !count) return;
    for (const piece of solveRoads(town.roads, kit)) {
        const holder = new THREE.Group();
        holder.position.set(piece.x, 0, piece.z);
        holder.rotation.y = piece.rotationY;
        roadGroup.add(holder);
        void fillModel(holder, piece.model, 0.2, kit.elevation).then((model) => model?.traverse((child) => { child.raycast = () => {}; }));
    }
}

/** The waypoints and links from the roads (the cars drive what's built); cars on a tile taken up go. */
function syncRoadTraffic() {
    const kit = roadKit();
    if (!kit || !town.roads) return;
    const { waypoints, links } = roadNetwork(town.roads, kit.tile);
    const ids = new Set(waypoints.map((point) => point.id));
    town.traffic = { waypoints, links, cars: town.traffic.cars.filter((car) => ids.has(car.at)) };
}

function setRoadMode(on) {
    if (on && !roadKit()) return toast('No roadKit in ui/mow.json.');
    roadMode = on;
    roadStroke = null;
    roadHover.visible = false;
    // Left-drag paints: the view still pans (right) and zooms (wheel).
    orbit.mouseButtons.LEFT = on ? null : THREE.MOUSE.ROTATE;
    if (on) {
        select(null);
        gizmo.detach();
    }
    host.querySelector('#townRoadMode')?.classList.toggle('active', on);
}

/** The road cell under the pointer (on the ground). */
function roadCellUnder(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return point ? roadCellAt(point.x, point.z, roadKit().tile) : null;
}

function roadIndex(i, j) {
    return town.roads?.cells.findIndex(([ci, cj]) => ci === i && cj === j) ?? -1;
}

/** Lays (or, taking up, removes) the road at a cell; whether anything changed. */
function paintRoad([i, j], erase) {
    const at = roadIndex(i, j);
    if (erase) {
        if (at < 0) return false;
        town.roads.cells.splice(at, 1);
    } else {
        if (at >= 0) return false;
        town.roads ??= { cells: [] };
        town.roads.cells.push([i, j]);
    }
    return true;
}

function startRoadStroke(event) {
    const cell = roadCellUnder(event);
    if (!cell) return;
    touch();
    const erase = event.shiftKey;
    roadStroke = { erase, cell, key: roadCellKey(...cell), wasRoad: roadIndex(...cell) >= 0, moved: false };
    if (paintRoad(cell, erase)) rebuildRoads();
}

function moveRoadStroke(event) {
    const cell = roadCellUnder(event);
    const tile = roadKit().tile;
    roadHover.visible = Boolean(cell);
    if (cell) {
        roadHover.position.set(cell[0] * tile, 0.25, cell[1] * tile);
        roadHover.scale.set(tile, tile, 1);
        roadHover.material.color.set(event.shiftKey ? 0xff6b6b : 0xffd23f);
    }
    if (!roadStroke || !cell || roadCellKey(...cell) === roadStroke.key) return;
    roadStroke.key = roadCellKey(...cell);
    roadStroke.moved = true;
    if (paintRoad(cell, roadStroke.erase)) rebuildRoads();
}

function endRoadStroke() {
    if (!roadStroke) return;
    const { erase, cell, wasRoad, moved } = roadStroke;
    roadStroke = null;
    // A click on a laid tile: its next variant (back to the first after the last).
    if (!erase && wasRoad && !moved) {
        const road = town.roads.cells[roadIndex(...cell)];
        const piece = solveRoads(town.roads, roadKit()).find((p) => p.i === road[0] && p.j === road[1]);
        const next = (road[2] ?? 0) + 1;
        if (piece && next < piece.variants) road[2] = next;
        else road.length = 2;
        rebuildRoads();
    }
    syncRoadTraffic();
    rebuildEntities();
    renderLists();
}

function clearRoads() {
    if (!town.roads?.cells.length || !window.confirm('Take up every road tile (and the cars on them)?')) return;
    touch();
    town.roads = { cells: [] };
    syncRoadTraffic();
    rebuildAll();
}

/**
 * The roads between waypoints, as flat ribbons: cyan; with a waypoint selected, its links yellow and wider, and the
 * rest of its network (where a car there can get to) pale, everything else faded.
 */
function renderTraffic() {
    trafficGroup.clear();
    if (!showTraffic || !town?.traffic) return;
    const selected = selection?.type === 'waypoint' ? town.traffic.waypoints[selection.index]?.id : null;
    const network = selected ? reachable(selected) : null;
    for (const [a, b] of town.traffic.links) {
        const from = town.traffic.waypoints[waypointIndex(a)];
        const to = town.traffic.waypoints[waypointIndex(b)];
        if (!from || !to) continue;
        const direct = selected && (a === selected || b === selected);
        const inNetwork = network?.has(a) && network?.has(b);
        const color = direct ? TRAFFIC.link : inNetwork ? TRAFFIC.network : TRAFFIC.road;
        const opacity = direct ? 1 : inNetwork ? 0.85 : selected ? 0.25 : 0.7;
        const length = Math.hypot(to.x - from.x, to.z - from.z);
        const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(direct ? 0.6 : 0.3, length),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
        ribbon.rotation.x = -Math.PI / 2;
        ribbon.rotation.z = -Math.atan2(to.x - from.x, to.z - from.z);
        ribbon.position.set((from.x + to.x) / 2, TRAFFIC.y + (direct ? 0.02 : 0), (from.z + to.z) / 2);
        // Ribbons are only a picture: clicks go to the waypoints.
        ribbon.raycast = () => {};
        trafficGroup.add(ribbon);
    }
}

/** Every waypoint linked to `id`, through any number of links (its network). */
function reachable(id) {
    const seen = new Set([id]);
    const queue = [id];
    while (queue.length) {
        for (const next of linksOf(queue.shift())) {
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push(next);
        }
    }
    return seen;
}

function toggleLink(fromIndex, toIndex) {
    const a = town.traffic.waypoints[fromIndex]?.id;
    const b = town.traffic.waypoints[toIndex]?.id;
    if (!a || !b || a === b) return;
    touch();
    const links = town.traffic.links;
    const at = links.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
    if (at >= 0) links.splice(at, 1);
    else links.push([a, b]);
    rebuildEntities();
    renderLists();
    toast(at >= 0 ? `Unlinked ${a} – ${b}` : `Linked ${a} – ${b}`);
}

/** A new waypoint in the middle of the view (next to the selected one, linked to it, when one is selected). */
function addWaypoint() {
    touch();
    const points = town.traffic.waypoints;
    let n = points.length + 1;
    while (points.some((w) => w.id === `w${n}`)) n++;
    const from = selection?.type === 'waypoint' ? points[selection.index] : null;
    const at = from ? { x: from.x + (mow.traffic?.tile ?? 7), z: from.z } : dropPoint();
    points.push({ id: `w${n}`, ...at });
    if (from) town.traffic.links.push([from.id, `w${n}`]);
    added('waypoint');
}

/** Removes a waypoint, its links and the cars starting there. */
function removeWaypoint(index) {
    const id = town.traffic.waypoints[index]?.id;
    town.traffic.waypoints.splice(index, 1);
    town.traffic.links = town.traffic.links.filter(([a, b]) => a !== id && b !== id);
    town.traffic.cars = town.traffic.cars.filter((car) => car.at !== id);
}

/**
 * Replaces the waypoints with one per road tile (props whose model has `road_`), linked to the tiles next to it
 * (`tile` apart, in ui/mow.json): the roads as built. Cars whose waypoint is gone go too.
 */
function waypointsFromRoads() {
    if (town.traffic.waypoints.length && !window.confirm('Replace every waypoint and link with ones made from the road tiles?')) return;
    touch();
    const tile = mow.traffic?.tile ?? 7;
    const key = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
    const tiles = new Map();
    for (const prop of town.props) if (prop.model.includes('road_') && !tiles.has(key(prop.x, prop.z))) tiles.set(key(prop.x, prop.z), { x: prop.x, z: prop.z });
    const points = [...tiles.values()].sort((a, b) => a.z - b.z || a.x - b.x).map((p, i) => ({ id: `w${i + 1}`, x: p.x, z: p.z }));
    const byKey = new Map(points.map((p) => [key(p.x, p.z), p]));
    const links = [];
    for (const p of points) {
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
            const next = byKey.get(key(p.x + dx * tile, p.z + dz * tile));
            if (next) links.push([p.id, next.id]);
        }
    }
    const ids = new Set(points.map((p) => p.id));
    town.traffic = { waypoints: points, links, cars: town.traffic.cars.filter((car) => ids.has(car.at)) };
    selection = null;
    also = [];
    rebuildAll();
    toast(`${points.length} waypoints, ${links.length} links from the road tiles.`);
}

function renderTrafficList() {
    const { waypoints, links, cars } = town.traffic;
    host.querySelector('#townTrafficSummary').textContent = `${waypoints.length} waypoints · ${links.length} roads · ${cars.length} cars`;
    host.querySelector('#townCarList').replaceChildren(...cars.map((car) => {
        const index = waypointIndex(car.at);
        return listItem('waypoint', index, `🚗 ${carName(car.model)}`, `at ${car.at}`);
    }));
}

/** A waypoint's links (click to go there, ✕ to unlink) and its cars (model, ✕), with link / add-car buttons. */
function waypointInspector(point, index) {
    const models = mow.traffic?.models ?? [];
    const links = linksOf(point.id);
    const cars = carsAt(point.id);
    return [
        textField('Id', point.id, (v) => {
            const id = v.trim();
            if (!id || id === point.id || town.traffic.waypoints.some((w) => w.id === id)) return;
            edit(() => {
                town.traffic.links.forEach((link) => link.forEach((end, i) => { if (end === point.id) link[i] = id; }));
                town.traffic.cars.forEach((car) => { if (car.at === point.id) car.at = id; });
                point.id = id;
            });
        }),
        el('div', { class: 'inspector-title' }, `Links (${links.length})`),
        el('ul', { class: 'list' }, ...links.map((other) => el('li', {},
            el('span', { onclick: () => { select({ type: 'waypoint', index: waypointIndex(other) }); focusSelection(); } }, `↔ ${other}`),
            el('button', { class: 'danger', onclick: (event) => { event.stopPropagation(); toggleLink(index, waypointIndex(other)); renderInspector(); } }, '✕')))),
        el('button', { class: `block${linking ? ' primary' : ''}`, onclick: () => { linking = !linking; renderInspector(); } },
            linking ? '🔗 Click a waypoint to link / unlink…' : '🔗 Link / unlink another waypoint (or Alt+click it)'),
        el('div', { class: 'inspector-title' }, `Cars starting here (${cars.length})`),
        ...cars.map((car) => el('div', { class: 'row' },
            selectField('Car', car.model ?? '', [['', 'Next in turn'], ...models.map((m) => [m, carName(m)])], (v) => edit(() => {
                if (v) car.model = v;
                else delete car.model;
            })),
            el('button', { class: 'danger', onclick: () => edit(() => { town.traffic.cars.splice(town.traffic.cars.indexOf(car), 1); }) }, '✕'))),
        el('button', { class: 'block', onclick: () => edit(() => { town.traffic.cars.push({ at: point.id, model: models[town.traffic.cars.length % Math.max(1, models.length)] }); }) }, '🚗 Add a car here'),
        el('p', { class: 'muted small' }, links.length ? `Its network: ${reachable(point.id).size} waypoints a car here can reach.` : 'Not linked to anything: a car here would not drive.'),
    ];
}

// ---------------------------------------------------------------- lists + inspector

function listItem(type, index, label, small) {
    const sel = { type, index };
    return el('li', {
        class: selected().some((other) => sameSel(other, sel)) ? 'active' : '',
        onclick: (event) => {
            // Shift / Ctrl: add to the selection (or take back out); a plain click selects it alone and goes there.
            const add = event.shiftKey || event.ctrlKey || event.metaKey;
            select(sel, add);
            if (!add) focusSelection();
        },
    }, label, small ? el('small', {}, small) : '');
}

function renderLists() {
    host.querySelector('#townSectionList').replaceChildren(...town.sections.map((s, i) => listItem('section', i, `${i + 1}. ${s.name}`, `$${s.bonus}`)));
    host.querySelector('#townShoreList').replaceChildren(...(town.island?.outline ?? []).map((p, i) => listItem('shore', i, `Point ${i + 1}`, `${p.x}, ${p.z}`)));
    host.querySelector('#townPatchList').replaceChildren(...town.grassPatches.map((p, i) => listItem('patch', i, `${p.shape === 'round' ? '⬭' : '▭'} ${grassName(p.grass)}`, `${p.width}×${p.depth}`)));
    host.querySelector('#townAtmList').replaceChildren(...town.atms.map((a, i) => listItem('atm', i, `ATM ${i + 1}`, appearsLabel(a))));
    host.querySelector('#townWardrobeList').replaceChildren(...town.wardrobes.map((w, i) => listItem('wardrobe', i, `Wardrobe ${i + 1}`, appearsLabel(w))));
    host.querySelector('#townPavementList').replaceChildren(...town.pavements.map((p, i) => listItem('pavement', i, p.id, `${p.width}×${p.depth}`)));
    renderTrafficList();
    host.querySelector('#townSecretList').replaceChildren(...town.secrets.map((s, i) => listItem('secret', i, `🤫 ${s.id}`, `$${s.reward} · ${s.width}×${s.depth}`)));
    host.querySelector('#townSoundList').replaceChildren(...town.sounds.map((s, i) => listItem('sound', i, `🔊 ${s.id}`, `${s.sound} · ${s.volume}`)));
    renderSoundSettings();
    host.querySelector('#townPropList').replaceChildren(...town.props.map((p, i) => listItem('prop', i, titleCase(fileName(p.model)), p.model.split('/').slice(0, -1).join('/'))));
}

/** The traffic's sound: each car's engine volume, full within `near`, gone from `far`. */
function renderSoundSettings() {
    const cars = town.soundSettings.cars;
    const editCars = (change) => {
        touch();
        change();
        renderSoundSettings();
    };
    host.querySelector('#townSoundSettings').replaceChildren(
        el('div', { class: 'inspector-title' }, 'Cars'),
        numberField('Volume (0-1)', cars.volume, 0.05, (v) => editCars(() => { cars.volume = round(Math.min(1, Math.max(0, v)), 0.01); })),
        numberField('Full within', cars.near, 0.5, (v) => editCars(() => { cars.near = Math.max(0, v); })),
        numberField('Silent from', cars.far, 0.5, (v) => editCars(() => { cars.far = Math.max(cars.near + 0.5, v); })));
}

/** The grass noise panel: its scale and each ring's reach and mix. */
function renderNoise() {
    const box = host.querySelector('#townNoise');
    const noise = town.grassNoise;
    const rows = [
        numberField('Clump scale', noise.scale, 0.01, (v) => editNoise(() => { noise.scale = Math.max(0.01, v); })),
        el('button', { class: 'block', onclick: () => { select({ type: 'centre', index: 0 }); focusSelection(); } }, '📍 Select the centre'),
    ];
    noise.rings.forEach((ring, i) => {
        rows.push(el('div', { class: 'inspector-title' }, `Ring ${i + 1}`, el('span', { class: 'tag' }, i === noise.rings.length - 1 ? 'and beyond' : `up to ${ring.upTo}`)));
        if (i < noise.rings.length - 1) rows.push(numberField('Up to (units)', ring.upTo, 1, (v) => editNoise(() => { ring.upTo = Math.max(1, v); })));
        for (const grass of mow.grass) {
            rows.push(numberField(`${grass.name} share`, ring.mix[grass.id] ?? 0, 0.05, (v) => editNoise(() => {
                if (v > 0) ring.mix[grass.id] = round(v, 0.01);
                else delete ring.mix[grass.id];
            })));
        }
    });
    rows.push(el('div', { class: 'row' },
        el('button', { onclick: () => editNoise(() => {
            const last = noise.rings[noise.rings.length - 1];
            const before = noise.rings[noise.rings.length - 2];
            noise.rings.splice(noise.rings.length - 1, 0, { upTo: (before?.upTo ?? 0) + 10, mix: { ...last.mix } });
        }) }, '＋ Ring'),
        el('button', { class: 'danger', onclick: () => editNoise(() => { if (noise.rings.length > 1) noise.rings.splice(noise.rings.length - 2, 1); }) }, '－ Ring')),
        el('p', { id: 'townGrassCount', class: 'muted small' }));
    box.replaceChildren(...rows);
}

function editNoise(change) {
    touch();
    change();
    town.grassNoise.rings.forEach((ring, i, rings) => { if (i === rings.length - 1) ring.upTo = 999; });
    rebuildEntities();
    renderNoise();
    queueGrass();
}

function numberField(label, value, step, onChange) {
    const input = el('input', { type: 'number', step, value: round(value, step < 1 ? 0.001 : 1) });
    input.addEventListener('change', () => {
        const parsed = Number(input.value);
        if (Number.isFinite(parsed)) onChange(parsed);
    });
    return el('label', { class: 'field' }, el('span', {}, label), input);
}

function textField(label, value, onChange, type = 'text') {
    const input = el('input', { value, type });
    input.addEventListener('change', () => onChange(input.value.trim()));
    return el('label', { class: 'field' }, el('span', {}, label), input);
}

function selectField(label, value, options, onChange) {
    return el('label', { class: 'field' }, el('span', {}, label), el('select', { onchange: (event) => onChange(event.target.value) },
        ...options.map(([v, text]) => el('option', { value: v, selected: v === value }, text))));
}

function checkField(label, checked, onChange) {
    return el('label', { class: 'field check' }, el('input', { type: 'checkbox', checked, onchange: (event) => onChange(event.target.checked) }), el('span', {}, label));
}

/** Applies an inspector edit: snapshot, change, rebuild. */
function edit(change) {
    touch();
    change(entityData(selection));
    rebuildAll();
}

/** A section's grass cap: no cap, or each grass type with the first mower (shop order) that can cut it (as in the game: at most chewSec's length of powers short). */
const maxGrassOptions = () => [['', 'No cap'], ...mow.grass.map((g) => {
    const index = (mow.tools ?? []).findIndex((tool) => g.resistance - tool.power <= (mow.chewSec?.length ?? 1));
    return [g.id, index >= 0 ? `${g.name} — cut from mower ${index + 1} (${mow.tools[index].name})` : g.name];
})];

const grassOptions = (withAuto) => [...(withAuto ? [['auto', 'Noise (auto)']] : []), ...mow.grass.map((g) => [g.id, g.name]), ['none', 'No grass']];

function renderInspector() {
    const box = host.querySelector('#townInspector');
    const data = entityData(selection);
    if (!data) {
        box.replaceChildren(el('p', { class: 'muted' }, 'Nothing selected. Click something in the town, or add one on the left.'));
        return;
    }
    const type = selection.type;
    const titles = {
        prop: () => titleCase(fileName(data.model)), atm: () => `ATM ${selection.index + 1}`, wardrobe: () => `Wardrobe ${selection.index + 1}`, pavement: () => data.id,
        section: () => data.name, patch: () => `Grass patch: ${grassName(data.grass)}`, start: () => 'Player start',
        sound: () => `Sound zone: ${data.id}`, waypoint: () => `Waypoint ${data.id}`, secret: () => `Secret patch: ${data.id}`, pen: () => `${town.sections[selection.index].name} pen`, centre: () => 'Grass noise centre', shore: () => `Shore point ${selection.index + 1}`, separator: () => `${town.sections[selection.index].name} separator`,
    };
    const rows = [
        el('div', { class: 'inspector-title' }, titles[type](), el('span', { class: 'tag' }, type)),
        numberField('X', data.x, 0.25, (v) => edit((d) => { d.x = v; })),
        numberField('Z', data.z, 0.25, (v) => edit((d) => { d.z = v; })),
    ];
    if (also.length) {
        rows.push(el('p', { class: 'muted small' }, `+${also.length} more selected (outlined): moving this moves them all, Del removes them all, Esc lets go. The fields below are this one's.`));
    }
    if (TURNS.has(type)) {
        rows.push(numberField('Turn (°)', THREE.MathUtils.radToDeg(data.rotationY ?? 0), 15, (v) => edit((d) => { d.rotationY = round(THREE.MathUtils.degToRad(v), 0.0001); })));
    }
    if (SIZED.has(type) || type === 'separator') {
        rows.push(numberField(type === 'separator' ? 'Length' : 'Width', data.width, 0.5, (v) => edit((d) => { d.width = Math.max(0.5, v); })));
        if (type !== 'separator') rows.push(numberField('Depth', data.depth, 0.5, (v) => edit((d) => { d.depth = Math.max(0.5, v); })));
    }
    if (type === 'prop') {
        rows.push(
            numberField('Height', data.height, 0.1, (v) => edit((d) => { d.height = Math.max(0.05, v); })),
            numberField('Width (×)', data.stretch?.x ?? 1, 0.05, (v) => { if (v > 0) edit((d) => stretch(d, v / (d.stretch?.x ?? 1), 1)); }),
            numberField('Depth (×)', data.stretch?.z ?? 1, 0.05, (v) => { if (v > 0) edit((d) => stretch(d, 1, v / (d.stretch?.z ?? 1))); }),
            numberField('Elevation', data.elevation ?? 0, 0.05, (v) => edit((d) => { d.elevation = v || undefined; })),
            checkField('Blocks the player (and no grass under it) — from the model bounds', Boolean(data.collider), (on) => edit((d) => { d.collider = on ? { halfX: 0.5, halfZ: 0.5 } : null; })),
            checkField('Fades when it hides the player (trees, buildings)', Boolean(data.fade), (on) => edit((d) => { if (on) d.fade = true; else delete d.fade; })),
            el('div', { class: 'muted small' }, data.model),
            el('button', { onclick: () => openModelPicker({ current: data.model, title: 'Swap model', confirmLabel: 'Use model', onPick: (path) => edit((d) => { d.model = path; }) }) }, 'Swap model…'),
        );
    }
    if (type === 'atm') {
        rows.push(
            appearsField(data),
            el('p', { class: 'muted small' }, 'Standing on the pad sells the bag and opens the shop. The machine stands behind the pad.'));
    }
    if (type === 'wardrobe') {
        rows.push(
            appearsField(data),
            el('p', { class: 'muted small' }, 'Standing on the pad opens the wardrobe (colours, faces, hats). The closet stands behind the pad. The first one is the tutorial\'s: it appears after the 2nd sale and its first hat is a must.'));
    }
    if (type === 'patch') {
        rows.push(
            selectField('Grass', data.grass, grassOptions(true), (v) => edit((d) => { d.grass = v; })),
            selectField('Shape', data.shape, [['round', 'Round'], ['rect', 'Rectangle']], (v) => edit((d) => { d.shape = v; })),
            el('p', { class: 'muted small' }, 'Paints over the sections (only inside one). The last patch over a spot wins.'));
    }
    if (type === 'pavement') {
        rows.push(textField('Id', data.id, (v) => edit((d) => { d.id = v || d.id; })), textField('Colour', data.color, (v) => edit((d) => { d.color = v; }), 'color'),
            el('p', { class: 'muted small' }, 'Walkable, no grass on it. Later pavements draw over earlier ones.'));
    }
    if (type === 'sound') {
        const options = [...new Set([...soundFiles, data.sound])].map((s) => [s, s]);
        rows.push(
            textField('Id', data.id, (v) => edit((d) => { d.id = v || d.id; })),
            selectField('Sound', data.sound, options, (v) => edit((d) => { d.sound = v; })),
            numberField('Volume (0-1)', data.volume, 0.01, (v) => edit((d) => { d.volume = round(Math.min(1, Math.max(0, v)), 0.01); })),
            numberField('Fade distance', data.fade, 0.5, (v) => edit((d) => { d.fade = Math.max(0.5, v); })),
            el('p', { class: 'muted small' }, 'Full volume inside the box, fading to nothing at the dashed line (Fade distance out from its edges); heard from the box\'s side the player is nearest. A new sound file needs `npm run audio` to reach the game.'));
    }
    if (type === 'waypoint') rows.push(...waypointInspector(data, selection.index));
    if (type === 'secret') {
        rows.push(
            textField('Id', data.id, (v) => edit((d) => { d.id = v || d.id; })),
            numberField('Chest ($)', data.reward, 10, (v) => edit((d) => { d.reward = Math.max(0, Math.round(v)); })),
            el('p', { class: 'muted small' }, 'Lush grass any mower cuts (even with the bag full; no clippings). Mowed through, its chest pops out with a claim card. Found once per save (by id: renaming it makes it new again).'));
    }
    if (type === 'pen') {
        rows.push(el('p', { class: 'muted small' }, 'A fence all round this rect keeps the player inside until the section is restored, then sinks away. Keep the start, an ATM and the section\'s grass inside it.'));
    }
    if (type === 'section' && diorama) {
        // A diorama's lawn: only how it looks.
        rows.push(
            selectField('Grass', data.fill ?? 'auto', grassOptions(true), (v) => edit((d) => { d.fill = v; })),
            numberField('Grass size ×', data.grassScale ?? 1, 0.05, (v) => edit((d) => {
                const scale = Math.round(Math.min(3, Math.max(0.2, v || 1)) * 100) / 100;
                if (scale === 1) delete d.grassScale;
                else d.grassScale = scale;
            })),
            textField('Restored ground', data.restoredGround, (v) => edit((d) => { d.restoredGround = v; }), 'color'),
            el('p', { class: 'muted small' }, 'The lawn, mowed and in bloom in the picture (its restored ground colour).'));
    } else if (type === 'section') {
        const index = selection.index;
        rows.push(
            textField('Name', data.name, (v) => edit((d) => { d.name = v || d.name; })),
            textField('Id', data.id, (v) => edit((d) => {
                const old = d.id;
                d.id = v || d.id;
                [...town.atms, ...town.wardrobes].forEach((a) => { if (a.section === old) a.section = d.id; });
            })),
            selectField('Grass', data.fill ?? 'auto', grassOptions(true), (v) => edit((d) => { d.fill = v; })),
            numberField('Grass size ×', data.grassScale ?? 1, 0.05, (v) => edit((d) => {
                const scale = Math.round(Math.min(3, Math.max(0.2, v || 1)) * 100) / 100;
                if (scale === 1) delete d.grassScale;
                else d.grassScale = scale;
            })),
            selectField('Max growth', data.maxGrass ?? '', maxGrassOptions(), (v) => edit((d) => {
                if (v) d.maxGrass = v;
                else delete d.maxGrass;
            })),
            el('p', { class: 'muted small' }, 'Max growth: nothing tougher grows in this section (tougher spots grow this instead), so it can be finished with that mower.'),
            el('p', { class: 'muted small' }, 'Grass size: under 1 an easier section (shorter grass, chewed through faster), over 1 a harder one. Clippings stay the same.'),
            numberField('Camera zoom ×', data.zoom ?? 1, 0.05, (v) => edit((d) => {
                const zoom = Math.round(Math.min(2, Math.max(0.4, v || 1)) * 100) / 100;
                if (zoom === 1) delete d.zoom;
                else d.zoom = zoom;
            })),
            el('p', { class: 'muted small' }, 'Camera zoom: the camera distance while this is the section being worked on (under 1 = closer, like the Front Yard).'),
            numberField('Bonus ($)', data.bonus, 50, (v) => edit((d) => { d.bonus = Math.max(0, Math.round(v)); })),
            numberField('Restored at (0-1)', data.completeAt, 0.01, (v) => edit((d) => { d.completeAt = Math.min(1, Math.max(0.5, v)); })),
            textField('Ground', data.ground, (v) => edit((d) => { d.ground = v; }), 'color'),
            textField('Restored ground', data.restoredGround, (v) => edit((d) => { d.restoredGround = v; }), 'color'),
            index > 0 ? checkField('When it opens, the camera glides over to show it', Boolean(data.onUnlock?.pan), (on) => edit((d) => { d.onUnlock = { ...(d.onUnlock ?? {}), pan: on }; })) : el('p', { class: 'muted small' }, 'Open from the start.'),
            index > 0 ? (data.separator
                ? el('button', { class: 'block', onclick: () => select({ type: 'separator', index }) }, '🚧 Select its separator')
                : el('button', { class: 'block', onclick: () => edit((d) => { d.separator = { x: d.x, z: d.z + d.depth / 2, width: d.width, rotationY: 0 }; }) }, '🚧 Add a separator')) : '',
            data.pen
                ? el('button', { class: 'block', onclick: () => select({ type: 'pen', index }) }, '🚧 Select its pen')
                : el('button', { class: 'block', onclick: () => edit((d) => { d.pen = { x: d.x, z: d.z, width: d.width + 4, depth: d.depth + 4 }; }) }, '🚧 Add a pen (keeps the player in until restored)'),
            el('div', { class: 'row' },
                el('button', { onclick: () => moveSection(index, -1) }, '▲ Earlier'),
                el('button', { onclick: () => moveSection(index, 1) }, '▼ Later')),
            el('p', { class: 'muted small' }, 'Opens when the section before it is restored: its separator sinks, its ATMs pop in.'));
    }
    if (type === 'separator') {
        rows.push(el('p', { class: 'muted small' }, 'The fence (with its sign) that keeps the section closed. Scale X / Length sets how long it is.'));
    }
    if (type === 'shore') {
        const island = town.island;
        const deck = island.deck;
        rows.push(
            el('button', { class: 'block', onclick: () => insertShorePoint(selection.index) }, '＋ Add a point after this one (D)'),
            el('p', { class: 'muted small' }, 'The island\'s outline, point by point (keep it from crossing itself). Keep sections and roads a deck width in from it: the deck, fence and walkable area follow the shore.'),
            el('div', { class: 'inspector-title' }, 'Wooden deck'),
            deck ? numberField('Deck width', deck.width, 0.1, (v) => edit(() => { deck.width = Math.max(0.5, v); })) : '',
            deck ? textField('Deck colour', deck.color, (v) => edit(() => { deck.color = v; }), 'color') : '',
            deck ? textField('Pilings colour', deck.pilingColor, (v) => edit(() => { deck.pilingColor = v; }), 'color') : '',
            deck ? numberField('Pilings every', deck.pilingSpacing, 0.1, (v) => edit(() => { deck.pilingSpacing = Math.max(0.8, v); })) : '',
            checkField('A wooden deck round the shore', Boolean(deck), (on) => edit(() => {
                if (on) island.deck = { width: 2.4, color: '#b98352', pilingColor: '#6b4a30', pilingSpacing: 2.6 };
                else delete island.deck;
            })),
            textField('Sides colour', island.sideColor, (v) => edit(() => { island.sideColor = v; }), 'color'));
    }
    if (type === 'centre') {
        rows.push(el('p', { class: 'muted small' }, 'Rings are measured from here: the rings and their mixes are in "Grass noise" on the left.'));
    }
    const actions = el('div', { class: 'row' }, el('button', { onclick: () => focusSelection() }, 'Focus (F)'));
    if (LISTS[type] && type !== 'section') actions.append(el('button', { onclick: () => duplicateSelection() }, 'Duplicate (D)'));
    if (type !== 'start' && type !== 'centre') actions.append(el('button', { class: 'danger', onclick: () => removeSelection() }, 'Delete'));
    box.replaceChildren(...rows, actions);
}
