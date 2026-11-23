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
// Collider cubes (`colliders`, 🧊): boxes placed by hand for a model its own bounds fit badly (a stadium). Solid ones
// (blue) block walking; any can name a prop it fades (amber edge): the player in or touching it makes that prop
// see-through, and only such cubes do.
//
// The road builder (🛣 Roads, B): click or drag on the ground to lay road tiles on the kit's grid (ui/mow.json
// roadKit), Shift+drag to take them up. A click on a laid tile selects it (in or out of Roads mode): Del takes it up, V
// gives it its next look (a crossing, a stop line …), and the inspector shows the same. Each tile's
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
//
// People (options.people: only a game that asks for it, so far UFO): the level's `people`. Wander areas are rects cast
// down on what's under them: green dots on the ground, pink ones on a roof, and a game's people stand on those. Street
// paths are waypoints and links like the traffic's, in violet: D adds the next point, linked to the selected one.

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
/** How tall a collider cube is drawn (only a picture: it blocks at any height). */
const COLLIDER_HEIGHT = 4;
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
/** Whether this game has people (options.people). */
let peopleOn = false;
/** 🔗 Link: the next waypoint clicked is linked to (or unlinked from) the selected one. */
let linking = false;
let gameUrl = 'http://localhost:8000/';
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
/** The bottom bar's shortcuts: normally, and while building roads. */
const TOWN_HINT = 'Left-drag: orbit · Right-drag: pan · Wheel: zoom · Click: select · Shift+click: add to selection · Ctrl+A: all of a kind · W/E/R: move/turn/scale · D or Ctrl+D: duplicate · Del: remove · F: focus · Ctrl+Z: undo · Ctrl+S: save';
const ROAD_HINT = 'ROADS — Click or drag: lay road · Shift+drag: remove road · Click a laid tile: select it · Del: remove it · V: next look · Right-drag: pan · Wheel: zoom · B: done';
/** The road builder's pieces (not entities: clicks go through them), and the cell under the pointer while building. */
const roadGroup = new THREE.Group();
const roadHover = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false }));
let roadMode = false;
/** A stroke being painted: taking up (Shift) or laying, the cell it started on, the one it's on, whether it moved or changed anything. */
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
    peopleOn = Boolean(options.people);
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
    town.spawns ??= [];
    town.colliders ??= [];
    town.traffic ??= { waypoints: [], links: [], cars: [] };
    if (peopleOn) {
        town.people ??= {};
        town.people.areas ??= [];
        town.people.waypoints ??= [];
        town.people.links ??= [];
        town.people.walkers ??= 0;
    }
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

/**
 * Empties a group, freeing what its children hold on the graphics card (labels' canvas textures, geometries, materials:
 * dropped without this they stay allocated, and rebuilding a big level again and again loses the WebGL context).
 * Models are left alone: they share the cached source's (fillModel()).
 */
function emptyGroup(group) {
    const free = (node) => {
        if (node.userData.shared) return;
        node.children.forEach(free);
        // A sprite's geometry is three's own, shared by every sprite.
        if (!node.isSprite) node.geometry?.dispose();
        for (const material of [node.material].flat()) {
            material?.map?.dispose();
            material?.dispose();
        }
    };
    group.children.forEach(free);
    group.clear();
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
                    el('button', { class: 'block town-only', onclick: () => addFarmPad('tool') }, '⬆ Mower upgrade station'),
                    el('button', { class: 'block town-only', onclick: () => addFarmPad('capacity') }, '🎒 Bag upgrade station'),
                    el('button', { class: 'block town-only', onclick: () => addFarmPad('blades') }, '🔪 Blades upgrade station'),
                    el('button', { class: 'block town-only', onclick: () => addTruckPoint() }, '🚚 Truck path point'),
                    el('button', { class: 'block town-only', onclick: () => addPeopleWayPoint('peopleIn') }, '🧍 Customers in point'),
                    el('button', { class: 'block town-only', onclick: () => addPeopleWayPoint('peopleOut') }, '🧍 Customers out point'),
                    el('button', { class: 'block town-only', onclick: () => addSpawn('people') }, '🧍 People spawn area'),
                    el('button', { class: 'block town-only', onclick: () => addSpawn('trucks') }, '🚚 Truck spawn area'),
                    el('button', { class: 'block town-only', onclick: () => addFootArea() }, '🚶 No-mower area'),
                    el('button', { class: 'block town-only', onclick: () => addShape() }, '⬛ Shape cube'),
                    el('button', { class: 'block town-only', onclick: () => addCollider() }, '🧊 Collider cube'),
                    el('button', { class: 'block town-only', onclick: () => addWaypoint() }, '🚦 Traffic waypoint'),
                    el('button', { class: 'block town-only', onclick: () => addSection() }, '🗺 Section (next to unlock)'))),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Sections'),
                el('p', { class: 'muted small' }, 'In unlock order: each opens when the one before is restored. Grass grows inside their rect.'),
                el('div', { id: 'townOpenAll' }),
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
                el('p', { class: 'muted small' }, '🛣 Roads (B) in the toolbar: click or drag on the ground to lay road tiles, Shift+drag to take them up. Click a laid tile to select it: Del removes it, V changes its look. The pieces fit themselves to their neighbours, and the cars drive them (the waypoints follow).'),
                el('div', { id: 'townRoadSummary', class: 'muted small' }),
                el('div', { id: 'townCarCount' }),
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
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Farm'),
                el('p', { class: 'muted small' }, 'The farm test\'s pieces: upgrade stations (stand on the square, the grass pours in; the stand is behind it, turned with it), the dens (brown yards, gate south) and the truck dock (inside the den, by the road).'),
                el('ul', { id: 'townFarmList', class: 'list' })),
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Spawn areas'),
                el('p', { class: 'muted small' }, 'Where people (the den\'s customers) and trucks pop in, as if arriving from somewhere, and pop out when they leave. Trucks drive the roads: pavements whose id starts with "road" (asphalt, no grass), joining their spawn area to the den\'s truck dock.'),
                el('ul', { id: 'townSpawnList', class: 'list' })),
            peopleOn ? el('section', { class: 'card-section' },
                el('h2', {}, 'People'),
                el('p', { class: 'muted small' }, 'Wander areas: people hang around in them, on the ground or on a roof (the dots show where they can stand). Street paths: walkers follow them, and wait for cars where one crosses a road. Alt+click another point links or unlinks it.'),
                el('div', { class: 'stack' },
                    el('button', { class: 'block', onclick: () => addPeopleArea() }, '🌳 Wander area'),
                    el('button', { class: 'block', onclick: () => addPeoplePoint() }, '🚶 Street path point')),
                el('div', { id: 'townPeopleWalkers' }),
                el('ul', { id: 'townPeopleAreaList', class: 'list' }),
                el('div', { id: 'townPeopleSummary', class: 'muted small' })) : '',
            el('section', { class: 'card-section town-only' },
                el('h2', {}, 'Collider cubes'),
                el('p', { class: 'muted small' }, 'Boxes for a model its own bounds fit badly (a stadium): solid ones (blue) block walking, and any can fade a prop (amber edge) while the player is in or touching it. Only in the editor: the game doesn\'t draw them.'),
                el('ul', { id: 'townColliderList', class: 'list' })),
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
            el('div', { id: 'townHint', class: 'hint-bar' }, roadMode ? ROAD_HINT : TOWN_HINT)),
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
    if (peopleOn) scene.add(peopleGroup);

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
    else if (key === 'v' && selection?.type === 'road') cycleRoadLook(1);
    else if (key === 'w') setMode('translate');
    else if (key === 'e') setMode('rotate');
    else if (key === 'r') setMode('scale');
    else if (key === 'd') {
        // Ctrl+D too (the browser's bookmark otherwise).
        event.preventDefault();
        if (selection) duplicateSelection();
    }
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
const FLAT_TYPES = new Set(['section', 'pavement', 'patch', 'sound', 'pen', 'road', 'peopleArea']);

function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const entities = raycaster.intersectObjects(entityGroup.children, true).filter((entry) => entry.object.visible).map((entry) => {
        let node = entry.object;
        while (node && !node.userData.entity) node = node.parent;
        return node?.userData.entity;
    }).filter(Boolean);
    // A road tile under the pointer (they aren't entities in the view: found by their grid cell).
    const roadCell = roadKit() && town.roads?.cells.length ? roadCellUnder(event) : null;
    const roadAt = roadCell ? roadIndex(...roadCell) : -1;
    if (roadAt >= 0) entities.push({ type: 'road', index: roadAt });
    // In order: anything standing, then patches, road tiles, then the rest (a patch over a section wins over the section), each once.
    const rank = (e) => (!FLAT_TYPES.has(e.type) ? 0 : e.type === 'patch' ? 1 : e.type === 'road' ? 1.5 : 2);
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
    if (picked?.type === 'peoplePoint' && selection?.type === 'peoplePoint' && picked.index !== selection.index && (linking || event.altKey)) {
        togglePeopleLink(selection.index, picked.index);
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
    const boxes = town.grassOverPavement ? [] : town.pavements.map((p) => ({ x: p.x, z: p.z, halfX: p.width / 2, halfZ: p.depth / 2 }));
    for (const prop of town.props) if (prop.collider) boxes.push({ x: prop.x, z: prop.z, halfX: prop.collider.halfX, halfZ: prop.collider.halfZ });
    for (const cube of town.colliders) if (cube.solid) boxes.push({ x: cube.x, z: cube.z, halfX: cube.width / 2, halfZ: cube.depth / 2 });
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
/** Past a section's rounded corner (the game's pastCorner()). */
function pastSectionCorner(section, x, z) {
    const radius = section.cornerRadius ?? 0;
    if (radius <= 0) return false;
    const dx = Math.abs(x - section.x) - (section.width / 2 - radius);
    const dz = Math.abs(z - section.z) - (section.depth / 2 - radius);
    return dx > 0 && dz > 0 && dx * dx + dz * dz > radius * radius;
}

/** How far the level's lawns are drawn lifted: over every pavement (TownLevel.grassOverPavement). */
const lawnLift = () => (town.grassOverPavement ? 0.1 : 0);

function rebuildGrass() {
    emptyGroup(grassGroup);
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
    // A section's spots (clumps of another grass over its fill): as the game's GrassField.
    const spotNoise = valueNoise(mow.seed + 29);
    const boxes = blockers();
    const taken = new Uint8Array(width * depth);
    const counts = mow.grass.map(() => 0);
    town.sections.forEach((section) => {
        const cap = section.maxGrass ? mow.grass.findIndex((gr) => gr.id === section.maxGrass) : -1;
        const maxType = cap >= 0 ? cap : mow.grass.length - 1;
        const spotType = section.spots ? mow.grass.findIndex((gr) => gr.id === section.spots.grass) : -1;
        const spotOver = 1 - (section.spots?.share ?? 0);
        for (let iz = 0; iz < depth; iz++) {
            for (let ix = 0; ix < width; ix++) {
                const x = minX + (ix + 0.5) * cell;
                const z = minZ + (iz + 0.5) * cell;
                if (Math.abs(x - section.x) > section.width / 2 || Math.abs(z - section.z) > section.depth / 2) continue;
                if (pastSectionCorner(section, x, z)) continue;
                if (taken[ix + iz * width]) continue;
                if (boxes.some((b) => Math.abs(x - b.x) <= b.halfX + BLOCK_PAD && Math.abs(z - b.z) <= b.halfZ + BLOCK_PAD)) continue;
                // A no-mower area is bare ground (as the game's GrassField).
                if ((town.footAreas ?? []).some((a) => Math.abs(x - a.x) <= a.width / 2 && Math.abs(z - a.z) <= a.depth / 2)) continue;
                const patch = town.grassPatches.reduce((found, p) => (inPatch(p, x, z) ? p : found), undefined);
                const kind = patch ? patch.grass : (section.fill ?? 'auto');
                if (kind === 'none') continue;
                // A patch is its own grass all over (not capped, no spots), as the game's GrassField.
                let type = patch ? Math.max(0, mow.grass.findIndex((gr) => gr.id === patch.grass)) : Math.min(maxType, kind === 'auto' ? autoType(x, z, noise) : Math.max(0, mow.grass.findIndex((gr) => gr.id === kind)));
                if (!patch && spotType >= 0 && spotNoise(x * town.grassNoise.scale, z * town.grassNoise.scale) >= spotOver) type = spotType;
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
    // A cut-out (alphaTest), not transparent: drawn with the solid things, first, so the see-through markers (den floors,
    // squares, pads) land on top of it instead of the sorting putting this big plane over them.
    const material = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width * cell, depth * cell), material);
    mesh.rotation.x = -Math.PI / 2;
    // PlaneGeometry's v runs +Y; laid flat that's -Z, and flipY false puts row 0 (minZ) at v = 0.
    mesh.scale.y = -1;
    mesh.position.set(minX + (width * cell) / 2, 0.02 + lawnLift(), minZ + (depth * cell) / 2);
    grassGroup.add(mesh);
    grassGroup.visible = showGrass;
    const summary = host.querySelector('#townGrassCount');
    if (summary) summary.textContent = mow.grass.map((gr, t) => `${gr.name}: ${counts[t]}`).join(' · ');
}

// ---------------------------------------------------------------- entities

const keyOf = (sel) => `${sel.type}:${sel.index}`;
const LISTS = { shape: 'shapes', footArea: 'footAreas', collider: 'colliders', prop: 'props', atm: 'atms', wardrobe: 'wardrobes', pavement: 'pavements', section: 'sections', patch: 'grassPatches', sound: 'sounds', secret: 'secrets', spawn: 'spawns' };
const FARM_LISTS = { pad: 'pads', den: 'dens' };
const listOf = (type) => (type === 'peopleArea' ? town.people?.areas ?? null : type === 'peoplePoint' ? town.people?.waypoints ?? null : type === 'waypoint' ? town.traffic.waypoints : type === 'road' ? town.roads?.cells ?? null
    : FARM_LISTS[type] ? town.farm?.[FARM_LISTS[type]] ?? null : type === 'dock' ? (town.farm?.trucks ? [town.farm.trucks] : null)
    : type === 'truckPoint' ? town.farm?.truckPath ?? null
    : type === 'cowDen' ? (town.farm?.cowDen ? [town.farm.cowDen] : null)
    : type === 'cowDock' ? (town.farm?.cowDen?.trucks ? [town.farm.cowDen.trucks] : null)
    : type === 'cowTruckPoint' ? town.farm?.cowDen?.truckPath ?? null
    : type === 'cropFarm' ? town.farm?.cropFarms ?? null
    : type === 'cropDock' ? (town.farm?.cropFarms ?? []).map((farm) => farm.harbour ?? null)
    : type === 'peopleInPoint' ? town.farm?.peopleIn ?? null
    : type === 'peopleOutPoint' ? town.farm?.peopleOut ?? null
    : type === 'truckCash' ? (town.farm?.trucks ? [(town.farm.trucks.cash ??= { x: town.farm.trucks.x, z: town.farm.trucks.z - 1.8 })] : null)
    : LISTS[type] ? town[LISTS[type]] : null);
const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;
const grassColor = (id) => (id === 'none' ? '#c9b48a' : id === 'auto' ? '#9be37a' : (mow.grass.find((g) => g.id === id)?.color ?? '#5cbf4a'));
const grassName = (id) => (id === 'none' ? 'no grass' : id === 'auto' ? 'noise' : (mow.grass.find((g) => g.id === id)?.name ?? id));

function entityData(sel) {
    if (!sel) return null;
    if (sel.type === 'denPart') return denPartData(sel.index);
    if (FARM_PART_SETS[sel.type]) return farmPartData(sel.type, sel.index);
    if (sel.type === 'cowBeltPoint') return cowBeltData(sel.index);
    if (BOAT_WAYS[sel.type]) return boatPointData(sel.type, sel.index);
    if (sel.type === 'areaUnlock') return town.sections[sel.index]?.unlock ?? null;
    if (sel.type === 'beltPoint' || sel.type === 'goldBeltPoint') return beltPointData(sel.index, BELT_KEYS[sel.type]);
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
    // Its geometry and materials are the cached source's: never freed with the holder (emptyGroup()).
    model.userData.shared = true;
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
    emptyGroup(entityGroup);
    holders.clear();
    for (const holder of roadGroup.children) holders.set(keyOf(holder.userData.entity), holder);
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
    if (peopleOn) {
        town.people.areas.forEach((area, index) => addHolder({ type: 'peopleArea', index }, buildPeopleArea(area, index)));
        town.people.waypoints.forEach((point, index) => addHolder({ type: 'peoplePoint', index }, buildPeoplePoint(point)));
        renderPeoplePaths();
        queuePeopleCast();
    }
    // A diorama is only a picture: no stations' markers, start, noise centre, sounds, secrets or traffic.
    if (!diorama) {
        town.sounds.forEach((zone, index) => addHolder({ type: 'sound', index }, buildSound(zone)));
        town.secrets.forEach((secret, index) => addHolder({ type: 'secret', index }, buildSecret(secret)));
        town.spawns.forEach((spawn, index) => addHolder({ type: 'spawn', index }, buildSpawn(spawn)));
        (town.footAreas ?? []).forEach((area, index) => addHolder({ type: 'footArea', index }, buildFootArea(area)));
        (town.shapes ?? []).forEach((shape, index) => addHolder({ type: 'shape', index }, buildShape(shape)));
        // Areas bought to open: their unlock squares.
        town.sections.forEach((section, index) => section.unlock && addHolder({ type: 'areaUnlock', index }, buildAreaUnlock(section)));
        // The farm test's pieces (levels with a `farm` block): its upgrade pads, dens and truck dock.
        (town.farm?.pads ?? []).forEach((pad, index) => addHolder({ type: 'pad', index }, buildFarmPad(pad)));
        (town.farm?.dens ?? []).forEach((den, index) => {
            addHolder({ type: 'den', index }, buildDen(den));
            // Its parts, each its own marker to drag (den.parts: den-local).
            denPartSlots(den).forEach((slot) => addHolder({ type: 'denPart', index: index * DEN_SLOTS + slot }, buildDenPart(den, slot)));
            // Its conveyor belt's path: a post per point (the default path until one's drawn), a line through them.
            beltPoints(den).forEach((_, i, all) => addHolder({ type: 'beltPoint', index: index * DEN_SLOTS + i }, buildBeltPoint(den, i, all.length)));
            if (town.farm?.eggs?.goldBelt) beltPoints(den, 'goldBelt').forEach((_, i, all) => addHolder({ type: 'goldBeltPoint', index: index * DEN_SLOTS + i }, buildBeltPoint(den, i, all.length, 'goldBelt')));
        });
        refreshBeltLines();
        if (town.farm?.trucks) {
            addHolder({ type: 'dock', index: 0 }, buildDock(town.farm.trucks));
            addHolder({ type: 'truckCash', index: 0 }, buildTruckCash(listOf('truckCash')[0]));
        }
        (town.farm?.truckPath ?? []).forEach((point, index) => addHolder({ type: 'truckPoint', index }, buildTruckPoint(point, index)));
        refreshTruckLine();
        // The cow barn (the game's CowDen): its yard, its truck dock, its trucks' path.
        const cowDen = town.farm?.cowDen;
        if (cowDen) {
            addHolder({ type: 'cowDen', index: 0 }, buildDen(cowDen, '🐄'));
            if (cowDen.trucks) addHolder({ type: 'cowDock', index: 0 }, buildDock(cowDen.trucks, '🐄 Truck dock'));
            (cowDen.truckPath ?? []).forEach((point, index, all) => addHolder({ type: 'cowTruckPoint', index }, buildCowTruckPoint(point, index, all.length)));
        }
        // The barn's parts and belt; the crop farms (their yard, parts, harbour drop point, boat paths).
        if (cowDen) {
            FARM_PART_SETS.cowPart.parts.forEach((_, i) => addHolder({ type: 'cowPart', index: i }, buildFarmPart('cowPart', cowDen, i)));
            cowBeltPoints(cowDen).forEach((_, i, all) => addHolder({ type: 'cowBeltPoint', index: i }, buildCowBeltPoint(cowDen, i, all.length)));
        }
        (town.farm?.cropFarms ?? []).forEach((farm, index) => {
            addHolder({ type: 'cropFarm', index }, buildDen(farm, '🍓'));
            FARM_PART_SETS.cropPart.parts.forEach((_, i) => addHolder({ type: 'cropPart', index: index * DEN_SLOTS + i }, buildFarmPart('cropPart', farm, i)));
            if (farm.harbour) {
                addHolder({ type: 'cropDock', index }, buildDock(farm.harbour, '⚓ Harbour drop point'));
                for (const type of ['boatPoint', 'boatOutPoint']) {
                    (farm.harbour[BOAT_WAYS[type]] ?? []).forEach((point, i, all) => addHolder({ type, index: index * DEN_SLOTS + i }, buildBoatPoint(type, point, i, all.length)));
                }
            }
        });
        refreshFarmLines();
        for (const way of PEOPLE_WAYS) (town.farm?.[way.key] ?? []).forEach((point, index, all) => addHolder({ type: way.type, index }, buildPeopleWayPoint(way, point, index, all.length)));
        refreshPeopleLines();
        town.colliders.forEach((cube, index) => addHolder({ type: 'collider', index }, buildCollider(cube)));
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
/** A collider cube: a see-through box, blue if solid; an amber edge if it fades a prop. */
function buildCollider(cube) {
    const holder = new THREE.Group();
    holder.position.set(cube.x, 0, cube.z);
    const box = new THREE.Mesh(new THREE.BoxGeometry(cube.width, COLLIDER_HEIGHT, cube.depth),
        new THREE.MeshBasicMaterial({ color: cube.solid ? 0x4fa8ff : 0x7fe08a, transparent: true, opacity: 0.3, depthWrite: false }));
    box.position.y = COLLIDER_HEIGHT / 2;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: cube.fades ? 0xffb020 : 0xffffff }));
    edge.position.y = COLLIDER_HEIGHT / 2;
    edge.raycast = () => {};
    holder.add(box, edge);
    return holder;
}

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

/** A spawn area: a translucent rect (cyan for people, orange for trucks), its outline and its label. */
/** A shape cube (the game's TownLevel.shapes): a plain box in its colour, as the game draws it (unlit). */
function buildShape(shape) {
    const holder = new THREE.Group();
    holder.position.set(shape.x, 0, shape.z);
    holder.rotation.y = shape.rotationY ?? 0;
    const box = new THREE.Mesh(new THREE.BoxGeometry(shape.width, shape.height, shape.depth), new THREE.MeshBasicMaterial({ color: shape.color }));
    box.position.y = (shape.y ?? 0) + shape.height / 2;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }));
    edge.position.copy(box.position);
    edge.raycast = () => {};
    holder.add(box, edge);
    return holder;
}

function addShape() {
    touch();
    town.shapes ??= [];
    town.shapes.push({ ...dropPoint(), width: 2, depth: 2, height: 2.4, color: '#0b0b10' });
    added('shape');
}

/** A no-mower area (the game's TownLevel.footAreas): the player walks there, the mower parked (as in a den). */
function buildFootArea(area) {
    const holder = new THREE.Group();
    holder.position.set(area.x, 0, area.z);
    const fill = plane(area.width, area.depth, '#c48bff', 0.18, 0.3);
    const edge = outline(0xc48bff);
    edge.scale.set(area.width, area.depth, 1);
    edge.position.y = 0.19;
    const label = labelSprite('🚶 no mower here', '#ead6ff');
    label.position.y = 1.6;
    holder.add(fill, edge, label);
    return holder;
}

function addFootArea() {
    touch();
    town.footAreas ??= [];
    town.footAreas.push({ ...dropPoint(), width: 4, depth: 4 });
    added('footArea');
}

/** An area's unlock square (DistrictDef.unlock): where its money's poured in once the part before it is restored. */
function buildAreaUnlock(section) {
    const holder = new THREE.Group();
    holder.position.set(section.unlock.x, 0, section.unlock.z);
    const fill = plane(3.2, 3.2, '#ffd34d', 0.12, 0.4);
    const edge = outline(0xffe27a);
    edge.scale.set(3.2, 3.2, 1);
    edge.position.y = 0.13;
    const label = labelSprite(`🔓 Unlock ${section.name}\n$${section.unlock.price} · level ${section.unlock.level}`, '#ffe9a8');
    label.position.y = 2;
    holder.add(fill, edge, label);
    return holder;
}

function buildSpawn(spawn) {
    const holder = new THREE.Group();
    holder.position.set(spawn.x, 0, spawn.z);
    const trucks = spawn.kind === 'trucks';
    const fill = plane(spawn.width, spawn.depth, trucks ? '#ffb74d' : '#4fe3ff', 0.2, 0.45);
    const edge = outline(trucks ? 0xffb74d : 0x4fe3ff);
    edge.scale.set(spawn.width, spawn.depth, 1);
    edge.position.y = 0.21;
    const label = labelSprite(`${trucks ? '🚚 trucks' : '🧍 people'}
${spawn.id}`, trucks ? '#ffd9a8' : '#bff4ff');
    label.position.y = 2;
    holder.add(fill, edge, label);
    return holder;
}

/**
 * A farm upgrade pad (the game's UpgradePads): its square (2.6 across, white edge), its stand (STAND_BACK behind it,
 * turned with it), and what it upgrades.
 */
function buildFarmPad(pad) {
    const holder = new THREE.Group();
    holder.position.set(pad.x, 0, pad.z);
    holder.rotation.y = pad.rotationY ?? 0;
    const tool = pad.kind === 'tool';
    const fill = plane(2.6, 2.6, tool ? '#3f8cff' : '#f2a33a', 0.08, 0.35);
    const edge = outline(0xffffff);
    edge.scale.set(2.6, 2.6, 1);
    edge.position.y = 0.09;
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.7, 16), new THREE.MeshStandardMaterial({ color: tool ? 0x3f8cff : 0xf2a33a }));
    stand.position.set(0, 0.35, -2.1);
    const section = town.sections.find((s) => s.id === pad.section);
    const label = labelSprite(`${tool ? '⬆ MOWER' : '🎒 BAG'} station${section ? `\nwith ${section.name}` : ''}`, tool ? '#9ec8ff' : '#ffd59a');
    label.position.set(0, 2.2, -2.1);
    holder.add(fill, edge, stand, label);
    return holder;
}

/** A den (the game's ChickenDen): its yard (width x depth), its gate on the south side, its name. */
/** A point of the cow barn's trucks' path: an orange post with its number (the park point marked). */
function buildCowTruckPoint(point, index, count) {
    const holder = new THREE.Group();
    holder.position.set(point.x, 0, point.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xffb74d, emissive: 0xffb74d, emissiveIntensity: 0.35 }));
    post.position.y = 0.6;
    const label = labelSprite(`🐄🚚 ${index + 1}${point.park ? ' · park' : index === 0 ? ' · in' : index === count - 1 ? ' · out' : ''}`, '#ffd59a');
    label.position.y = 2;
    holder.add(post, label);
    return holder;
}

function buildDen(den, icon = '🐔') {
    const holder = new THREE.Group();
    holder.position.set(den.x, 0, den.z);
    const fill = plane(den.width, den.depth, '#7a5b44', 0.06, 0.6);
    const edge = outline(0xc98a4b);
    edge.scale.set(den.width, den.depth, 1);
    edge.position.y = 0.07;
    const gate = new THREE.Mesh(new THREE.BoxGeometry(den.gate ?? 2.4, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: 0x9cff6a }));
    gate.position.set(0, 0.15, den.depth / 2);
    gate.raycast = () => {};
    const label = labelSprite(`${icon} ${den.name}\ngate on the south side${den.level ? ` · level ${den.level}` : ''}`, '#ffd59a');
    label.position.y = 3;
    holder.add(fill, edge, gate, label);
    return holder;
}

// ---------------------------------------------------------------- a den's parts (den.parts, den-local; the game's ChickenDen layout())

/** Slots per den in a denPart selection's index (den index x DEN_SLOTS + slot): egg spots first (one per hen), then the named parts. */
const DEN_SLOTS = 100;
const EGG_SLOTS = 50;
/** The named parts: their key in den.parts, label, colour, size (a square, or a box for the machines and the counter), planned (editor only). */
const DEN_PARTS = [
    { key: 'input', label: 'EGGS drop (packing)', color: 0xffffff, square: [1.5, 1.5], sized: true },
    { key: 'machine', label: 'Packing machine', color: 0x3f7fe0, box: [1.4, 0.95, 1.1] },
    { key: 'grid', label: 'PACKS out (2 x 2)', color: 0x4fe3ff, square: [1.9, 1.9] },
    { key: 'counter', label: 'Sell counter', color: 0x8a5a32, box: [0.8, 0.85, 2.2] },
    { key: 'sell', label: 'SELL square', color: 0x4fe3ff, square: [1.5, 2], sized: true },
    { key: 'cash', label: 'Cash square', color: 0x5fc85a, square: [1.5, 1.5], sized: true },
    { key: 'beltBuy', label: 'Conveyor buy square', color: 0xffffff, square: [1.6, 1.6], sized: true },
    { key: 'helperHire', label: 'Hire helper square', color: 0x2f6fd8, square: [1.6, 1.6], sized: true },
    { key: 'truckHelperHire', label: 'Hire truck helper square', color: 0x2f6fd8, square: [1.6, 1.6], sized: true },
    { key: 'goldBuy', label: 'Gold machine buy square', color: 0xffd34d, square: [1.6, 1.6], sized: true },
    { key: 'goldBeltBuy', label: 'Gold belt buy square', color: 0xffd34d, square: [1.6, 1.6], sized: true },
    { key: 'goldInput', label: 'Gold: PACKS drop', color: 0xf2c94c, square: [1.5, 1.5], sized: true },
    { key: 'goldMachine', label: 'Gold machine', color: 0xf2c94c, box: [1.4, 0.95, 1.1] },
    { key: 'goldGrid', label: 'Gold: packs out (2 x 2)', color: 0xf2c94c, square: [1.9, 1.9] },
];

/** A den's parts where its own layout puts them (as ChickenDen layout(): keep the two in step). */
function denPartDefaults(den) {
    const hw = den.width / 2;
    const hd = den.depth / 2;
    const hens = town.farm?.eggs?.hens?.length ?? 1;
    const spacing = (den.width - 3) / hens;
    return {
        eggs: Array.from({ length: hens }, (_, i) => ({ x: -hw + 1.5 + spacing * (i + 0.5), z: -hd + 3.05 })),
        input: { x: 0.45, z: 0.9 }, machine: { x: 2.4, z: 0.9 }, grid: { x: 4.6, z: 0.9 },
        counter: { x: -hw + 0.55, z: 0.6 }, sell: { x: -hw + 1.85, z: 0.6 }, cash: { x: -hw + 1.85, z: hd - 1.35 },
        // Planned: a second line just south of the packing one (packs out of it -> in here).
        goldInput: { x: 4.6, z: 3 }, goldMachine: { x: 2.4, z: 3 }, goldGrid: { x: 0.45, z: 3 },
        helperHire: { x: 4.6, z: 2.4 }, goldBuy: { x: 2.4, z: 4.4 },
        // The trucks' helper: by the truck dock (it's in the world; the den's parts are den-local).
        truckHelperHire: town.farm?.trucks ? { x: town.farm.trucks.x - den.x, z: town.farm.trucks.z - den.z - 2 } : { x: 0, z: 0 },
    };
}

/** The slots a den has: an egg spot per hen, then each named part. */
function denPartSlots(den) {
    const hens = town.farm?.eggs?.hens?.length ?? 1;
    return [...Array.from({ length: hens }, (_, i) => i), ...DEN_PARTS.map((_, i) => EGG_SLOTS + i)];
}

/** What a slot is: an egg spot (`egg`: its hen) or a named part. */
const denSlotInfo = (slot) => (slot < EGG_SLOTS ? { egg: slot } : { part: DEN_PARTS[slot - EGG_SLOTS] });

/** A slot's point in den.parts (made from the den's layout the first time it's touched: then it's the den's own). */
function denPartData(index) {
    const den = town.farm?.dens?.[Math.floor(index / DEN_SLOTS)];
    if (!den) return null;
    const slot = index % DEN_SLOTS;
    const defaults = denPartDefaults(den);
    den.parts ??= {};
    const { egg, part } = denSlotInfo(slot);
    if (part?.key === 'beltBuy') return (den.parts.beltBuy ??= { ...beltPoints(den)[0] });
    if (part?.key === 'goldBeltBuy') return (den.parts.goldBeltBuy ??= { ...beltPoints(den, 'goldBelt')[0] });
    if (part) return (den.parts[part.key] ??= { ...defaults[part.key] });
    den.parts.eggs ??= [];
    while (den.parts.eggs.length <= egg) den.parts.eggs.push(null);
    return (den.parts.eggs[egg] ??= { ...defaults.eggs[egg] });
}

/** Where a slot is now (den-local): placed, else the layout's (without touching den.parts). */
function denPartAt(den, slot) {
    const defaults = denPartDefaults(den);
    const { egg, part } = denSlotInfo(slot);
    // The conveyor's buy square: where placed, else the belt's start.
    if (part?.key === 'beltBuy') return den.parts?.beltBuy ?? beltPoints(den)[0];
    if (part?.key === 'goldBeltBuy') return den.parts?.goldBeltBuy ?? beltPoints(den, 'goldBelt')[0];
    if (part) return den.parts?.[part.key] ?? defaults[part.key];
    return den.parts?.eggs?.[egg] ?? defaults.eggs[egg];
}

/** A den part's marker: an egg spot (a straw disc and its hen's number), a square (dashed for planned ones) or a box. */
function buildDenPart(den, slot) {
    const holder = new THREE.Group();
    const at = denPartAt(den, slot);
    holder.position.set(den.x + at.x, 0, den.z + at.z);
    const { egg, part } = denSlotInfo(slot);
    if (part === undefined) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0xe8c25a }));
        disc.position.y = 0.08;
        const label = labelSprite(`🥚 Hen ${egg + 1} eggs`, '#fff3d6');
        label.position.y = 1.3;
        label.scale.multiplyScalar(0.7);
        holder.add(disc, label);
        return holder;
    }
    if (part.box) {
        const [w, h, d] = part.box;
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: part.color, transparent: part.planned, opacity: part.planned ? 0.55 : 1 }));
        box.position.y = h / 2;
        holder.add(box);
    } else {
        const w = part.sized && at.w ? at.w : part.square[0];
        const d = part.sized && at.d ? at.d : part.square[1];
        const fill = plane(w, d, `#${part.color.toString(16).padStart(6, '0')}`, 0.09, part.planned ? 0.3 : 0.45);
        const edge = outline(part.color);
        edge.scale.set(w, d, 1);
        edge.position.y = 0.1;
        holder.add(fill, edge);
    }
    const label = labelSprite(part.label, part.planned ? '#ffe27a' : '#cfeaff');
    label.position.y = part.box ? part.box[1] + 0.8 : 1.3;
    label.scale.multiplyScalar(0.7);
    holder.add(label);
    return holder;
}

// ---------------------------------------------------------------- the barn's and the crop farms' parts (game: CowDen / CropFarm layout())

/** A part's marker, as a den part's: a box (machines, counters) or a square (sized ones take their own size). */
function drawPartMarker(holder, part, at) {
    if (part.box) {
        const [w, h, d] = part.box;
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: part.color }));
        box.position.y = h / 2;
        holder.add(box);
    } else {
        const w = part.sized && at.w ? at.w : part.square[0];
        const d = part.sized && at.d ? at.d : part.square[1];
        const fill = plane(w, d, `#${part.color.toString(16).padStart(6, '0')}`, 0.09, 0.45);
        const edge = outline(part.color);
        edge.scale.set(w, d, 1);
        edge.position.y = 0.1;
        holder.add(fill, edge);
    }
    const label = labelSprite(part.label, '#cfeaff');
    label.position.y = part.box ? part.box[1] + 0.8 : 1.3;
    label.scale.multiplyScalar(0.7);
    holder.add(label);
}

/** The cow barn's parts where its own layout puts them (as CowDen layout(): keep the two in step). */
function cowPartDefaults(den) {
    const hw = den.width / 2;
    const hd = den.depth / 2;
    return {
        butterMachine: { x: -2.6, z: 0.9 }, butterInput: { x: -2.6, z: 3.0 }, butterGrid: { x: -4.6, z: 0.9 },
        cheeseMachine: { x: 2.6, z: 0.9 }, cheeseInput: { x: 2.6, z: 3.0 }, cheeseGrid: { x: 4.6, z: 0.9 },
        counter: { x: hw - 0.55, z: 0.6 }, sell: { x: hw - 1.85, z: 0.6 }, cash: { x: hw - 1.85, z: hd - 1.35 },
        beltBuy: { x: 0, z: -hd + 4.4 + 1.6 }, helperHire: { x: hw - 1.85, z: 3.4 }, truckHelperHire: { x: -hw + 3.4, z: 4.6 },
    };
}

/** A crop farm's parts where its own layout puts them (as CropFarm layout(): keep the two in step). */
function cropPartDefaults(farm) {
    const hw = farm.width / 2;
    const hd = farm.depth / 2;
    const cols = Math.max(1, farm.cols ?? 4);
    const rows = Math.ceil((farm.plots?.length ?? 1) / cols);
    const middle = -hd + 1.2 + rows * 3 + 1.2;
    const dock = farm.harbour ? { x: farm.harbour.x - farm.x - 2.2, z: farm.harbour.z - farm.z } : { x: 0, z: 0 };
    return {
        plots: { x: -(cols * 2.4 + (cols - 1) * 0.6) / 2 + 1.2, z: -hd + 2.4 },
        machine: { x: 2.6, z: middle }, input: { x: 2.6, z: middle + 2 }, grid: { x: 5.3, z: middle }, fresh: { x: -2.6, z: middle },
        counter: { x: hw - 0.55, z: middle }, sell: { x: hw - 1.85, z: middle }, cash: { x: hw - 1.85, z: hd - 1.35 },
        pickerHire: { x: -hw + 1.8, z: hd - 1.4 }, helperHire: { x: hw - 1.85, z: Math.min(hd - 3.2, middle + 2.6) }, boatHelperHire: dock,
    };
}

/** The farms whose parts are placed like a den's: what they are, their parts, and where those go by default. */
const FARM_PART_SETS = {
    cowPart: {
        name: 'cow barn',
        dens: () => (town.farm?.cowDen ? [town.farm.cowDen] : []),
        defaults: cowPartDefaults,
        parts: [
            { key: 'butterMachine', label: '🧈 Butter churn', color: 0xb07a45, box: [1.2, 1.2, 1.2] },
            { key: 'butterInput', label: 'MILK drop (butter)', color: 0xffffff, square: [1.6, 1.5], sized: true },
            { key: 'butterGrid', label: 'BUTTER out (2 x 2)', color: 0xffe066, square: [1.9, 1.9] },
            { key: 'cheeseMachine', label: '🧀 Cheese press', color: 0xe08a2c, box: [1.3, 1.1, 1.0] },
            { key: 'cheeseInput', label: 'MILK drop (cheese)', color: 0xffffff, square: [1.6, 1.5], sized: true },
            { key: 'cheeseGrid', label: 'CHEESE out (2 x 2)', color: 0xffb347, square: [1.9, 1.9] },
            { key: 'counter', label: 'Sell counter', color: 0x8a5a32, box: [0.8, 0.85, 2.2] },
            { key: 'sell', label: 'SELL square', color: 0x4fe3ff, square: [1.5, 2], sized: true },
            { key: 'cash', label: 'Cash square', color: 0x5fc85a, square: [1.5, 1.5], sized: true },
            { key: 'beltBuy', label: 'Conveyor buy square', color: 0xffffff, square: [1.8, 1.4], sized: true },
            { key: 'helperHire', label: 'Hire helper square', color: 0x2f6fd8, square: [1.6, 1.6], sized: true },
            { key: 'truckHelperHire', label: 'Hire truck helper square', color: 0x2f6fd8, square: [1.6, 1.6], sized: true },
        ],
    },
    cropPart: {
        name: 'farm',
        dens: () => town.farm?.cropFarms ?? [],
        defaults: cropPartDefaults,
        parts: [
            { key: 'plots', label: '🌱 First plot (the rest follow in rows)', color: 0x6b4a2e, square: [2.4, 2.4] },
            { key: 'machine', label: '🍯 Machine', color: 0x9aa3ad, box: [1.3, 1.4, 1.0] },
            { key: 'input', label: 'FRUIT drop (machine)', color: 0xffffff, square: [1.6, 1.5], sized: true },
            { key: 'grid', label: 'PRODUCT out (2 x 2)', color: 0xc0182e, square: [1.9, 1.9] },
            { key: 'fresh', label: 'FRESH crate (2 x 2)', color: 0xe8323f, square: [1.9, 1.9] },
            { key: 'counter', label: 'Sell counter', color: 0x8a5a32, box: [0.8, 0.85, 2.2] },
            { key: 'sell', label: 'SELL square', color: 0x4fe3ff, square: [1.5, 2], sized: true },
            { key: 'cash', label: 'Cash square', color: 0x5fc85a, square: [1.5, 1.5], sized: true },
            { key: 'pickerHire', label: 'Hire picker square', color: 0x2f6fd8, square: [1.6, 1.6], sized: true },
            { key: 'helperHire', label: 'Hire helper square', color: 0x2f6fd8, square: [1.6, 1.6], sized: true },
            { key: 'boatHelperHire', label: 'Hire boat helper square', color: 0x2f6fd8, square: [1.6, 1.6], sized: true },
        ],
    },
};

const farmPartOf = (type, index) => {
    const set = FARM_PART_SETS[type];
    const den = set?.dens()[Math.floor(index / DEN_SLOTS)];
    const part = set?.parts[index % DEN_SLOTS];
    return den && part ? { set, den, part } : null;
};

/** A part's point in den.parts (made from the layout the first time it's touched: then it's the farm's own). */
function farmPartData(type, index) {
    const found = farmPartOf(type, index);
    if (!found) return null;
    const { set, den, part } = found;
    den.parts ??= {};
    return (den.parts[part.key] ??= { ...set.defaults(den)[part.key] });
}

function buildFarmPart(type, den, i) {
    const set = FARM_PART_SETS[type];
    const part = set.parts[i];
    const at = den.parts?.[part.key] ?? set.defaults(den)[part.key];
    const holder = new THREE.Group();
    holder.position.set(den.x + at.x, 0, den.z + at.z);
    drawPartMarker(holder, part, at);
    return holder;
}

/** The barn's belt as the game takes it: the drawn one (2+ points), else along the milk spots and round behind the machines. */
function cowBeltPoints(den) {
    if ((den.parts?.belt?.length ?? 0) >= 2) return den.parts.belt;
    const hw = den.width / 2;
    const hd = den.depth / 2;
    const rowZ = -hd + 4.4 + 0.95;
    const backZ = (den.parts?.butterMachine?.z ?? 0.9) - 1.2;
    return [{ x: -hw + 1.2, z: rowZ }, { x: hw - 1.5, z: rowZ }, { x: hw - 1.5, z: backZ }, { x: 0, z: backZ }];
}

function cowBeltData(index) {
    const den = town.farm?.cowDen;
    if (!den) return null;
    den.parts ??= {};
    if ((den.parts.belt?.length ?? 0) < 2) den.parts.belt = cowBeltPoints(den).map((p) => ({ ...p }));
    return den.parts.belt[index] ?? null;
}

function buildCowBeltPoint(den, i, count) {
    const point = cowBeltPoints(den)[i];
    const holder = new THREE.Group();
    holder.position.set(den.x + point.x, 0, den.z + point.z);
    const color = i === 0 ? 0x5fd35a : i === count - 1 ? 0xff7043 : 0xb0b8c4;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 }));
    post.position.y = 0.25;
    const drawn = (den.parts?.belt?.length ?? 0) >= 2;
    const label = labelSprite(i === 0 ? `🐄 Belt 1 · start${drawn ? '' : ' (default)'}` : i === count - 1 ? `🐄 Belt ${i + 1} · split to the machines` : `🐄 Belt ${i + 1}`, '#e6ecf5');
    label.position.y = 1.1;
    label.scale.multiplyScalar(0.6);
    holder.add(post, label);
    return holder;
}

function addCowBeltPoint(after) {
    const den = town.farm.cowDen;
    touch();
    den.parts ??= {};
    if ((den.parts.belt?.length ?? 0) < 2) den.parts.belt = cowBeltPoints(den).map((p) => ({ ...p }));
    const path = den.parts.belt;
    const a = path[after];
    const b = path[after + 1];
    path.splice(after + 1, 0, b ? { x: round((a.x + b.x) / 2), z: round((a.z + b.z) / 2) } : { x: round(a.x + 1), z: a.z });
    selection = { type: 'cowBeltPoint', index: after + 1 };
    rebuildAll();
}

/** A harbour's boat path point (in: `path`, to the drop point; out: `out`, away): a blue post with its number. */
const BOAT_WAYS = { boatPoint: 'path', boatOutPoint: 'out' };
function boatPointData(type, index) {
    const farm = town.farm?.cropFarms?.[Math.floor(index / DEN_SLOTS)];
    return farm?.harbour?.[BOAT_WAYS[type]]?.[index % DEN_SLOTS] ?? null;
}

function buildBoatPoint(type, point, i, count) {
    const holder = new THREE.Group();
    holder.position.set(point.x, 0, point.z);
    const color = type === 'boatPoint' ? 0x4fa3ff : 0x9fd2ff;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
    post.position.y = 0.6;
    const text = type === 'boatPoint'
        ? (i === 0 ? '⛵ 1 · boats come in' : i === count - 1 ? `⛵ ${i + 1} · they dock` : `⛵ ${i + 1}`)
        : (i === 0 ? '⛵ out 1 · from the dock' : i === count - 1 ? `⛵ out ${i + 1} · gone` : `⛵ out ${i + 1}`);
    const label = labelSprite(text, '#cfe6ff');
    label.position.y = 2;
    holder.add(post, label);
    return holder;
}

function addBoatPoint(type, index) {
    const farm = town.farm.cropFarms[Math.floor(index / DEN_SLOTS)];
    const key = BOAT_WAYS[type];
    touch();
    farm.harbour[key] ??= [];
    const path = farm.harbour[key];
    const after = index % DEN_SLOTS;
    const a = path[after];
    const b = path[after + 1];
    path.splice(after + 1, 0, b ? { x: round((a.x + b.x) / 2), z: round((a.z + b.z) / 2) } : { x: round(a.x + 3), z: a.z });
    selection = { type, index: index + 1 };
    rebuildAll();
}

/** The barn's belt and the harbours' boat paths, drawn point to point (not selectable: their points are). */
const farmLines = [];
function refreshFarmLines() {
    farmLines.forEach((line) => line.removeFromParent());
    farmLines.length = 0;
    const draw = (points, color, y) => {
        if (points.length < 2) return;
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, y, p.z))), new THREE.LineBasicMaterial({ color }));
        line.raycast = () => {};
        line.renderOrder = 5;
        scene.add(line);
        farmLines.push(line);
    };
    const cow = town.farm?.cowDen;
    if (cow) draw(cowBeltPoints(cow).map((p) => ({ x: cow.x + p.x, z: cow.z + p.z })), 0xd0d6de, 0.35);
    for (const farm of town.farm?.cropFarms ?? []) {
        draw(farm.harbour?.path ?? [], 0x4fa3ff, 0.4);
        draw(farm.harbour?.out ?? [], 0x9fd2ff, 0.4);
    }
}

// ---------------------------------------------------------------- a den's conveyor belt (den.parts.belt, den-local; ChickenDen beltPath())

/** A belt point selection's belt: the egg belt (beltPoint) or the gold belt (goldBeltPoint), its key in den.parts. */
const BELT_KEYS = { beltPoint: 'belt', goldBeltPoint: 'goldBelt' };
const slotOf = (key) => EGG_SLOTS + DEN_PARTS.findIndex((p) => p.key === key);

/**
 * A belt's path as the game takes it: the drawn one (2+ points), else (the egg belt) from the egg row's far end along
 * its front to over the EGGS drop and down into it, or (the gold belt) straight from the packs grid to the gold drop.
 */
function beltPoints(den, key = 'belt') {
    if ((den.parts?.[key]?.length ?? 0) >= 2) return den.parts[key];
    if (key === 'goldBelt') {
        const grid = denPartAt(den, slotOf('grid'));
        const input = denPartAt(den, slotOf('goldInput'));
        return [{ x: grid.x, z: grid.z }, { x: input.x, z: input.z }];
    }
    const hens = town.farm?.eggs?.hens?.length ?? 1;
    const eggs = Array.from({ length: hens }, (_, i) => denPartAt(den, i));
    const input = denPartAt(den, slotOf('input'));
    const z = Math.max(...eggs.map((e) => e.z)) + 0.95;
    const left = Math.min(...eggs.map((e) => e.x)) - 0.4;
    const right = Math.max(...eggs.map((e) => e.x)) + 0.4;
    const r = (v) => Math.round(v * 100) / 100;
    const far = Math.abs(left - input.x) > Math.abs(right - input.x) ? left : right;
    return [{ x: r(far), z: r(z) }, { x: input.x, z: r(z) }, { x: input.x, z: input.z }];
}

/** A belt point to edit: the drawn path's (the default one copied in first, so it becomes the den's own). */
function beltPointData(index, key = 'belt') {
    const den = town.farm?.dens?.[Math.floor(index / DEN_SLOTS)];
    if (!den) return null;
    den.parts ??= {};
    if ((den.parts[key]?.length ?? 0) < 2) den.parts[key] = beltPoints(den, key).map((p) => ({ ...p }));
    return den.parts[key][index % DEN_SLOTS] ?? null;
}

/** A belt point: a post (green: the start, where it's bought; red: the end, into its machine) and its number. */
function buildBeltPoint(den, i, count, key = 'belt') {
    const point = beltPoints(den, key)[i];
    const holder = new THREE.Group();
    holder.position.set(den.x + point.x, 0, den.z + point.z);
    const gold = key === 'goldBelt';
    const color = i === 0 ? 0x5fd35a : i === count - 1 ? 0xff7043 : gold ? 0xffd34d : 0xb0b8c4;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25 }));
    post.position.y = 0.25;
    const drawn = (den.parts?.[key]?.length ?? 0) >= 2;
    const name = gold ? 'Gold belt' : 'Belt';
    const label = labelSprite(i === 0 ? `${name} 1 · start${drawn ? '' : ' (default)'}` : i === count - 1 ? `${name} ${i + 1} · into the ${gold ? 'gold ' : ''}machine` : `${name} ${i + 1}`, gold ? '#ffe9a8' : '#e6ecf5');
    label.position.y = 1.1;
    label.scale.multiplyScalar(0.6);
    holder.add(post, label);
    return holder;
}

/** Each den's belts drawn point to point (not selectable: their points are). */
const beltLines = [];
function refreshBeltLines() {
    beltLines.forEach((line) => line.removeFromParent());
    beltLines.length = 0;
    for (const den of town.farm?.dens ?? []) {
        for (const key of town.farm?.eggs?.goldBelt ? ['belt', 'goldBelt'] : ['belt']) {
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(beltPoints(den, key).map((p) => new THREE.Vector3(den.x + p.x, 0.35, den.z + p.z))),
                new THREE.LineBasicMaterial({ color: key === 'goldBelt' ? 0xffd34d : 0xd0d6de }));
            line.raycast = () => {};
            line.renderOrder = 5;
            scene.add(line);
            beltLines.push(line);
        }
    }
}

/** A belt point after the selected one (between it and the next, or past the end), selected. */
function addBeltPoint(denIndex, after, key = 'belt') {
    const den = town.farm.dens[denIndex];
    touch();
    den.parts ??= {};
    if ((den.parts[key]?.length ?? 0) < 2) den.parts[key] = beltPoints(den, key).map((p) => ({ ...p }));
    const path = den.parts[key];
    const a = path[after];
    const b = path[after + 1];
    const point = b ? { x: round((a.x + b.x) / 2), z: round((a.z + b.z) / 2) } : { x: round(a.x + 1), z: a.z };
    path.splice(after + 1, 0, point);
    selection = { type: key === 'goldBelt' ? 'goldBeltPoint' : 'beltPoint', index: denIndex * DEN_SLOTS + after + 1 };
    rebuildAll();
}

/** A point of the trucks' path: an orange post with its number (the first: where they pop in; the last: where they park). */
function buildTruckPoint(point, index) {
    const holder = new THREE.Group();
    holder.position.set(point.x, 0, point.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0xffb74d, emissive: 0xffb74d, emissiveIntensity: 0.35 }));
    post.position.y = 0.6;
    const path = town.farm.truckPath;
    const count = path.length;
    // Where they park: the marked point, else the last (and they drive back).
    const marked = path.findIndex((p) => p.park);
    const park = marked > 0 ? marked : count - 1;
    const label = labelSprite(index === 0 ? '🚚 1 · trucks come in' : index === park ? `🚚 ${index + 1} · they park, load` : index === count - 1 ? `🚚 ${index + 1} · they leave` : `🚚 ${index + 1}`, index === park ? '#9cff6a' : '#ffd59a');
    label.position.y = 2;
    holder.add(post, label);
    return holder;
}

/** The trucks' path drawn point to point (not selectable: its points are). */
let truckLine = null;
function refreshTruckLine() {
    const points = town.farm?.truckPath ?? [];
    if (!truckLine) {
        truckLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb74d }));
        truckLine.raycast = () => {};
        truckLine.renderOrder = 5;
    }
    // (Back in the scene if it was made again.)
    if (truckLine.parent !== scene) scene.add(truckLine);
    truckLine.geometry.setFromPoints(points.map((p) => new THREE.Vector3(p.x, 0.35, p.z)));
    truckLine.visible = points.length > 1;
}

/** A point on the trucks' path: after the selected one, else at the end (a new path starts at the view's middle). */
function addTruckPoint() {
    if (!town.farm) return toast('This level has no farm (its `farm` block).', 'bad');
    touch();
    town.farm.truckPath ??= [];
    const path = town.farm.truckPath;
    const at = selection?.type === 'truckPoint' ? selection.index + 1 : path.length;
    path.splice(at, 0, dropPoint());
    rebuildAll();
    select({ type: 'truckPoint', index: at });
}

/** The customers' ways: in (to the den's counter queue) and out (from the counter, popping out at the end). */
const PEOPLE_WAYS = [
    { key: 'peopleIn', type: 'peopleInPoint', color: 0x6ad1ff, first: 'they come in', last: 'then to the queue' },
    { key: 'peopleOut', type: 'peopleOutPoint', color: 0xd58cff, first: 'from the counter', last: 'they leave' },
];
const peopleWay = (type) => PEOPLE_WAYS.find((way) => way.type === type);

/** A point of a customers' way: a thin post with its number. */
function buildPeopleWayPoint(way, point, index, count) {
    const holder = new THREE.Group();
    holder.position.set(point.x, 0, point.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.6, 10), new THREE.MeshStandardMaterial({ color: way.color, emissive: way.color, emissiveIntensity: 0.35 }));
    post.position.y = 0.8;
    const tag = way.key === 'peopleIn' ? '🧍 in' : '🧍 out';
    const label = labelSprite(index === 0 ? `${tag} 1 · ${way.first}` : index === count - 1 ? `${tag} ${index + 1} · ${way.last}` : `${tag} ${index + 1}`, hex(way.color));
    label.position.y = 2.2;
    holder.add(post, label);
    return holder;
}

/** The customers' ways drawn point to point (not selectable: their points are). */
const peopleLines = {};
function refreshPeopleLines() {
    for (const way of PEOPLE_WAYS) {
        const points = town.farm?.[way.key] ?? [];
        let line = peopleLines[way.key];
        if (!line) {
            line = peopleLines[way.key] = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: way.color }));
            line.raycast = () => {};
            line.renderOrder = 5;
        }
        if (line.parent !== scene) scene.add(line);
        line.geometry.setFromPoints(points.map((p) => new THREE.Vector3(p.x, 0.3, p.z)));
        line.visible = points.length > 1;
    }
}

/** A point on a customers' way: after the selected one of it, else at the end. */
function addPeopleWayPoint(key) {
    if (!town.farm) return toast('This level has no farm (its `farm` block).', 'bad');
    const way = PEOPLE_WAYS.find((w) => w.key === key);
    touch();
    town.farm[key] ??= [];
    const path = town.farm[key];
    const at = selection?.type === way.type ? selection.index + 1 : path.length;
    path.splice(at, 0, dropPoint());
    rebuildAll();
    select({ type: way.type, index: at });
}

/** Where the truck's money lands (its own cash square and pile). */
function buildTruckCash(cash) {
    const holder = new THREE.Group();
    holder.position.set(cash.x, 0, cash.z);
    const fill = plane(1.5, 1.5, '#5fc85a', 0.09, 0.5);
    const edge = outline(0x4fe3ff);
    edge.scale.set(1.5, 1.5, 1);
    edge.position.y = 0.1;
    const label = labelSprite('💵 Truck cash', '#c8ffb0');
    label.position.y = 1.8;
    holder.add(fill, edge, label);
    return holder;
}

/** The den's truck dock: its square (inside the den, by the road) and its price. */
function buildDock(dock, name = '🚚 Truck dock') {
    const holder = new THREE.Group();
    holder.position.set(dock.x, 0, dock.z);
    const fill = plane(1.6, 1.6, '#4fe3ff', 0.09, 0.45);
    const edge = outline(0x4fe3ff);
    edge.scale.set(1.6, 1.6, 1);
    edge.position.y = 0.1;
    const label = labelSprite(`${name}\n$${dock.price} · level ${dock.level}`, '#bff4ff');
    label.position.y = 2.4;
    holder.add(fill, edge, label);
    return holder;
}

function buildSection(section, index) {
    const holder = new THREE.Group();
    holder.position.set(section.x, 0, section.z);
    const color = SECTION_COLORS[index % SECTION_COLORS.length];
    const fill = plane(section.width, section.depth, section.ground ?? '#4f7d35', 0.01 + lawnLift());
    const edge = outline(color);
    edge.scale.set(section.width, section.depth, 1);
    edge.position.y = 0.08 + lawnLift();
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
    area.position.y = 0.06 + lawnLift();
    const edge = outline(color.getHex(), patch.shape === 'round');
    edge.scale.set(patch.width, patch.depth, 1);
    edge.position.y = 0.07 + lawnLift();
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
    // Road tiles stay on their grid: never selected along with things the gizmo moves.
    if (add && sel && selection && (sel.type === 'road') !== (selection.type === 'road')) add = false;
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
    emptyGroup(highlightGroup);
    for (const sel of selected()) {
        if (sel.type === 'road') {
            highlightRoad(sel);
            continue;
        }
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
    for (const box of highlightGroup.children) box.update?.();
}

function attachGizmo() {
    const holder = selection && selection.type !== 'road' ? holders.get(keyOf(selection)) : null;
    if (holder) gizmo.attach(holder);
    else gizmo.detach();
}

// toFixed drops float noise (0.69 * 1 → 0.6900000000000001) so town.json stays readable.
const round = (value, step = 0.001) => Number((Math.round(value / step) * step).toFixed(4));
/** Things that turn (the rest only move / resize). */
const TURNS = new Set(['shape', 'prop', 'atm', 'wardrobe', 'patch', 'separator', 'pad']);
/** Things whose size is width x depth (scaling changes those, not a height). */
const SIZED = new Set(['shape', 'footArea', 'pavement', 'section', 'patch', 'sound', 'pen', 'secret', 'collider', 'peopleArea', 'spawn', 'den', 'cowDen', 'cropFarm']);

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
    if (FARM_PART_SETS[selection.type] || selection.type === 'cowBeltPoint') {
        // Farm-local: from the barn's (or the crop farm's) middle.
        const den = selection.type === 'cowBeltPoint' ? town.farm.cowDen : farmPartOf(selection.type, selection.index)?.den;
        if (!den) return;
        data.x = round(holder.position.x - den.x);
        data.z = round(holder.position.z - den.z);
        refreshFarmLines();
        setDirty(true);
        return;
    }
    if (BOAT_WAYS[selection.type]) {
        data.x = round(holder.position.x);
        data.z = round(holder.position.z);
        refreshFarmLines();
        setDirty(true);
        return;
    }
    if (selection.type === 'denPart' || selection.type === 'beltPoint' || selection.type === 'goldBeltPoint') {
        // Den-local: from the den's middle.
        const den = town.farm.dens[Math.floor(selection.index / DEN_SLOTS)];
        data.x = round(holder.position.x - den.x);
        data.z = round(holder.position.z - den.z);
        if (selection.type === 'beltPoint' || selection.type === 'goldBeltPoint') refreshBeltLines();
        setDirty(true);
        return;
    }
    data.x = round(holder.position.x);
    data.z = round(holder.position.z);
    if (selection.type === 'truckPoint') refreshTruckLine();
    if (peopleWay(selection.type)) refreshPeopleLines();
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
    if (types.has('peoplePoint')) renderPeoplePaths();
    if (types.has('peopleArea')) queuePeopleCast();
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
/** Where something new goes: the ground at the middle of the view (looking above the horizon: the point orbited round). */
function dropPoint() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3()) ?? orbit.target;
    return { x: round(point.x, SNAP), z: round(point.z, SNAP) };
}

const fileName = (path) => path.split('/').pop().replace(/\.(glb|gltf)$/i, '');
const titleCase = (text) => text.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function added(type) {
    rebuildAll();
    select({ type, index: listOf(type).length - 1 });
}

/**
 * A goal section's mesh: the one already placed swaps to it (same place, at its own size), else it's placed on the
 * section. Its snapshot (Map shots) is of the old one until a new one's taken.
 */
async function setGoalModel(section, path) {
    const source = await loadModel(path);
    const size = source ? new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3()) : null;
    const height = size && size.y > 1e-4 ? round(size.y, 0.01) : 10;
    touch();
    const placed = section.goalModel ? town.props.filter((prop) => prop.model === section.goalModel) : [];
    placed.forEach((prop) => {
        prop.model = path;
        prop.height = height;
        delete prop.stretch;
    });
    if (!placed.length && !town.props.some((prop) => prop.model === path)) {
        town.props.push({ model: path, x: section.x, z: section.z, rotationY: 0, height, collider: null, fade: true });
    }
    section.goalModel = path;
    rebuildAll();
    toast(`Goal model: ${titleCase(fileName(path))}. Take a new snapshot in Map shots for the HUD.`);
}

function chooseGoalModel(section) {
    openModelPicker({ current: section.goalModel, title: 'Goal model', confirmLabel: 'Use as the goal', onPick: (path) => void setGoalModel(section, path) });
}

async function importGoalModel(section) {
    await openLibraryPicker({
        onImported: async (path) => {
            setModelCatalog(await api('/api/models'));
            await setGoalModel(section, path);
        },
    });
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

function addCollider() {
    touch();
    town.colliders.push({ ...dropPoint(), width: 4, depth: 4, solid: true });
    added('collider');
}

/** A new farm upgrade pad of `kind` ('tool': the next mower, 'capacity': a bigger bag); the level needs a `farm` block. */
function addFarmPad(kind) {
    if (!town.farm) return toast('This level has no farm (its `farm` block): upgrade stations are the farm test\'s.', 'bad');
    touch();
    town.farm.pads ??= [];
    town.farm.pads.push({ kind, ...dropPoint() });
    added('pad');
}

/** A new spawn area of `kind` ('people' or 'trucks'). */
function addSpawn(kind) {
    touch();
    let n = town.spawns.length + 1;
    while (town.spawns.some((s) => s.id === `${kind}-${n}`)) n++;
    town.spawns.push({ id: `${kind}-${n}`, kind, ...dropPoint(), width: kind === 'trucks' ? 4 : 3, depth: kind === 'trucks' ? 6 : 3 });
    added('spawn');
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
    const { x, z } = dropPoint();
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
    if (selection?.type === 'peoplePoint') return addPeoplePoint();
    if (selection?.type === 'peopleArea') {
        const area = entityData(selection);
        touch();
        town.people.areas.push({ ...area, x: area.x + 1, z: area.z + 1 });
        return added('peopleArea');
    }
    if (!selection || !LISTS[selection.type] || selection.type === 'section') return;
    const data = entityData(selection);
    touch();
    const copy = { ...structuredClone(data), x: data.x + 1, z: data.z + 1 };
    if (selection.type === 'pavement' || selection.type === 'sound' || selection.type === 'secret' || selection.type === 'spawn') copy.id = `${data.id}-copy`;
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
        else if (sel.type === 'peoplePoint') removePeoplePoint(sel.index);
        else if (sel.type === 'shore') town.island.outline.splice(sel.index, 1);
        else listOf(sel.type).splice(sel.index, 1);
    }
    if (doomed.some((sel) => sel.type === 'road')) syncRoadTraffic();
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

// ---------------------------------------------------------------- people

/** Paths and cast dots: a picture, so clicks go through. */
const peopleGroup = new THREE.Group();
const PEOPLE = { path: 0xb48cff, point: '#b48cff', area: 0x7fe08a, ground: 0x7fe08a, roof: 0xff6bd5, y: 0.36 };
/** The same rules as the game's cast (game/world/People.ts): every this many units, on props at least this wide each way. */
const PEOPLE_CELL = 1;
const ROOF_MIN_HALF = 1.5;
const FLAT_NORMAL = 0.75;
let peopleCastTimer = 0;

function buildPeopleArea(area, index) {
    const holder = new THREE.Group();
    holder.position.set(area.x, 0, area.z);
    const fill = plane(area.width, area.depth, hex(PEOPLE.area), 0.26, 0.18);
    const edge = outline(PEOPLE.area);
    edge.scale.set(area.width, area.depth, 1);
    edge.position.y = 0.27;
    const label = labelSprite(`🌳 Area ${index + 1}\n${area.count} people`, '#c8f5cf');
    label.position.y = 2;
    label.scale.multiplyScalar(0.7);
    holder.add(fill, edge, label);
    return holder;
}

function buildPeoplePoint(point) {
    const holder = new THREE.Group();
    holder.position.set(point.x, 0, point.z);
    const material = new THREE.MeshStandardMaterial({ color: PEOPLE.point, emissive: PEOPLE.point, emissiveIntensity: 0.3 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.1, 16), material);
    disc.position.y = PEOPLE.y;
    holder.add(disc);
    return holder;
}

function renderPeoplePaths() {
    for (const child of [...peopleGroup.children]) {
        if (child.userData.cast) continue;
        peopleGroup.remove(child);
        child.geometry.dispose();
        child.material.dispose();
    }
    const point = (id) => town.people.waypoints.find((p) => p.id === id);
    for (const [a, b] of town.people.links) {
        const from = point(a);
        const to = point(b);
        if (!from || !to) continue;
        const length = Math.hypot(to.x - from.x, to.z - from.z);
        const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(0.22, length), new THREE.MeshBasicMaterial({ color: PEOPLE.path, transparent: true, opacity: 0.85, depthWrite: false }));
        ribbon.rotation.x = -Math.PI / 2;
        ribbon.rotation.z = -Math.atan2(to.x - from.x, to.z - from.z);
        ribbon.position.set((from.x + to.x) / 2, PEOPLE.y, (from.z + to.z) / 2);
        ribbon.raycast = () => {};
        peopleGroup.add(ribbon);
    }
}

/** Models load in the background: the dots are worked out a moment after a change, and again once more have come in. */
function queuePeopleCast() {
    clearTimeout(peopleCastTimer);
    castPeopleAreas();
    peopleCastTimer = setTimeout(castPeopleAreas, 1500);
}

/** Where each area's people could stand: a dot per spot, green on the ground, pink on a roof. */
function castPeopleAreas() {
    if (!town?.people) return;
    for (const child of [...peopleGroup.children]) {
        if (!child.userData.cast) continue;
        peopleGroup.remove(child);
        child.geometry.dispose();
        child.material.dispose();
    }
    const roofs = town.props.map((prop, index) => ({ prop, holder: holders.get(`prop:${index}`) }))
        .filter(({ prop, holder }) => holder && prop.collider && Math.min(prop.collider.halfX, prop.collider.halfZ) >= ROOF_MIN_HALF)
        .map(({ holder }) => holder);
    const caster = new THREE.Raycaster();
    caster.camera = camera;
    const down = new THREE.Vector3(0, -1, 0);
    const normal = new THREE.Vector3();
    const dots = { ground: [], roof: [] };
    for (const area of town.people.areas) {
        for (let x = area.x - area.width / 2 + PEOPLE_CELL / 2; x < area.x + area.width / 2; x += PEOPLE_CELL) {
            for (let z = area.z - area.depth / 2 + PEOPLE_CELL / 2; z < area.z + area.depth / 2; z += PEOPLE_CELL) {
                caster.set(new THREE.Vector3(x, 200, z), down);
                const hit = caster.intersectObjects(roofs, true).find((entry) => entry.object.isMesh);
                if (!hit) dots.ground.push(x, PEOPLE.y, z);
                else {
                    normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
                    if (normal.y >= FLAT_NORMAL) dots.roof.push(x, hit.point.y + 0.15, z);
                }
            }
        }
    }
    for (const [kind, positions] of Object.entries(dots)) {
        if (!positions.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const cloud = new THREE.Points(geometry, new THREE.PointsMaterial({ color: PEOPLE[kind], size: 0.28 }));
        cloud.userData.cast = true;
        cloud.raycast = () => {};
        peopleGroup.add(cloud);
    }
}

function addPeopleArea() {
    touch();
    town.people.areas.push({ ...dropPoint(), width: 12, depth: 12, count: 5 });
    added('peopleArea');
}

/** A new point mid view (next to the selected one and linked to it, when one is selected: drawing a path). */
function addPeoplePoint() {
    touch();
    const { waypoints, links } = town.people;
    let n = waypoints.length + 1;
    while (waypoints.some((p) => p.id === `p${n}`)) n++;
    const from = selection?.type === 'peoplePoint' ? waypoints[selection.index] : null;
    waypoints.push({ id: `p${n}`, ...(from ? { x: from.x + 6, z: from.z } : dropPoint()) });
    if (from) links.push([from.id, `p${n}`]);
    added('peoplePoint');
}

function removePeoplePoint(index) {
    const id = town.people.waypoints[index]?.id;
    town.people.waypoints.splice(index, 1);
    town.people.links = town.people.links.filter(([a, b]) => a !== id && b !== id);
}

function togglePeopleLink(fromIndex, toIndex) {
    const a = town.people.waypoints[fromIndex]?.id;
    const b = town.people.waypoints[toIndex]?.id;
    if (!a || !b || a === b) return;
    touch();
    const { links } = town.people;
    const at = links.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
    if (at >= 0) links.splice(at, 1);
    else links.push([a, b]);
    rebuildEntities();
    renderLists();
    toast(at >= 0 ? `Unlinked ${a} – ${b}` : `Linked ${a} – ${b}`);
}

function renderPeopleLists() {
    const { areas, waypoints, links, walkers } = town.people;
    host.querySelector('#townPeopleWalkers').replaceChildren(numberField('Walkers on the paths', walkers, 1, (v) => {
        touch();
        town.people.walkers = Math.max(0, Math.round(v));
        renderPeopleLists();
    }));
    host.querySelector('#townPeopleAreaList').replaceChildren(...areas.map((area, i) => listItem('peopleArea', i, `🌳 Area ${i + 1}`, `${area.count} people · ${area.width}×${area.depth}`)));
    host.querySelector('#townPeopleSummary').textContent = `${waypoints.length} path points · ${links.length} links`;
}

// ---------------------------------------------------------------- road builder

/** The kit the roads are built from (ui/mow.json roadKit). */
const roadKit = () => mow.roadKit;

/** Lays the roads' pieces again (each fitted to its neighbours: the game's solveRoads()). */
function rebuildRoads() {
    emptyGroup(roadGroup);
    for (const key of [...holders.keys()]) if (key.startsWith('road:')) holders.delete(key);
    const kit = roadKit();
    const count = town.roads?.cells.length ?? 0;
    const summary = host.querySelector('#townRoadSummary');
    if (summary) summary.textContent = kit ? `${count} road tiles (${kit.tile}×${kit.tile})` : 'No roadKit in ui/mow.json.';
    if (!kit || !count) return;
    for (const piece of solveRoads(town.roads, kit)) {
        const holder = new THREE.Group();
        holder.position.set(piece.x, 0, piece.z);
        holder.rotation.y = piece.rotationY;
        holder.userData.entity = { type: 'road', index: roadIndex(piece.i, piece.j) };
        holders.set(keyOf(holder.userData.entity), holder);
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
    if (on && selection?.type !== 'road') select(null);
    host.querySelector('#townRoadMode')?.classList.toggle('primary', on);
    host.querySelector('#townHint').textContent = on ? ROAD_HINT : TOWN_HINT;
    renderInspector();
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

/** Lays or takes up the road at a cell: an undo step for the stroke's first change, and the pieces fitted again. */
function strokeRoad(cell) {
    const there = roadIndex(...cell) >= 0;
    if (there !== roadStroke.erase) return;
    if (!roadStroke.changed) touch();
    roadStroke.changed = true;
    paintRoad(cell, roadStroke.erase);
    rebuildRoads();
}

function startRoadStroke(event) {
    const cell = roadCellUnder(event);
    if (!cell) return;
    roadStroke = { erase: event.shiftKey, cell, key: roadCellKey(...cell), moved: false, changed: false };
    // Indices shift as tiles come and go: whatever was selected lets go.
    if (selection?.type === 'road') select(null);
    strokeRoad(cell);
}

function moveRoadStroke(event) {
    // Let go outside the view.
    if (roadStroke && !(event.buttons & 1)) endRoadStroke();
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
    strokeRoad(cell);
}

function endRoadStroke() {
    if (!roadStroke) return;
    const { erase, cell, moved, changed } = roadStroke;
    roadStroke = null;
    if (changed) {
        syncRoadTraffic();
        rebuildEntities();
        renderLists();
    }
    // A click (not a drag) leaves that tile selected: its look, Del.
    const at = !erase && !moved ? roadIndex(...cell) : -1;
    select(at >= 0 ? { type: 'road', index: at } : null);
}

/** The selected tile's piece as the kit fits it (its model, how many looks it has). */
function roadPiece(road) {
    return solveRoads(town.roads, roadKit()).find((piece) => piece.i === road[0] && piece.j === road[1]);
}

/** The selected tile's next (or previous) look, round to the first. */
function cycleRoadLook(step) {
    const road = entityData(selection);
    const piece = road && roadPiece(road);
    if (!piece || piece.variants < 2) return toast('This piece has only one look.');
    touch();
    const look = ((road[2] ?? 0) + step + piece.variants) % piece.variants;
    if (look) road[2] = look;
    else road.length = 2;
    rebuildRoads();
    renderInspector();
}

/** A selected tile's square, lit up. */
function highlightRoad(sel) {
    const road = entityData(sel);
    if (!road) return;
    const tile = roadKit().tile;
    const lit = plane(tile, tile, sameSel(sel, selection) ? 0xffe066 : 0xffb020, 0.3, 0.3);
    const edge = outline(0xffe066);
    edge.scale.set(tile, tile, 1);
    edge.position.y = 0.32;
    for (const part of [lit, edge]) {
        part.position.x = road[0] * tile;
        part.position.z = road[1] * tile;
        highlightGroup.add(part);
    }
}

/** A row of the inspector's shortcuts. */
const shortcut = (keys, what) => el('div', { class: 'muted small' }, el('span', { class: 'tag' }, keys), ` ${what}`);

/** The inspector for a selected road tile: what it is, its look, removing it, and the keys. */
function roadInspector(road) {
    const piece = roadPiece(road);
    const count = also.length + 1;
    return [
        el('div', { class: 'inspector-title' }, `Road tile ${road[0]}, ${road[1]}`, el('span', { class: 'tag' }, 'road')),
        also.length ? el('p', { class: 'muted small' }, `${count} tiles selected (lit up): Del removes them all.`) : '',
        el('div', { class: 'muted small' }, piece ? fileName(piece.model) : ''),
        piece && piece.variants > 1 ? el('div', { class: 'stack' },
            el('div', { class: 'muted small' }, `Look ${((road[2] ?? 0) % piece.variants) + 1} of ${piece.variants}`),
            el('button', { class: 'block', onclick: () => cycleRoadLook(-1) }, '◀ Previous look'),
            el('button', { class: 'block', onclick: () => cycleRoadLook(1) }, 'Next look ▶')) : el('p', { class: 'muted small' }, 'This piece has one look.'),
        el('button', { class: 'block', onclick: () => removeSelection() }, count > 1 ? `🗑 Remove ${count} tiles` : '🗑 Remove this tile'),
        el('p', { class: 'muted small' }, 'Its neighbours fit themselves again, and the cars follow. Cars starting on a removed tile go too.'),
        shortcut('Del', 'remove'),
        shortcut('V', 'next look'),
        shortcut('F', 'focus the view on it'),
        shortcut('Esc', 'let go'),
        shortcut('Ctrl+Z', 'undo'),
        shortcut('Shift+click', roadMode ? 'remove directly' : 'select more tiles'),
    ].filter(Boolean);
}

/** The inspector while building roads, with nothing selected. */
function roadModeHelp() {
    return [
        el('div', { class: 'inspector-title' }, 'Building roads', el('span', { class: 'tag' }, 'B to finish')),
        el('p', { class: 'muted small' }, 'Pieces fit themselves to their neighbours, and the cars follow.'),
        shortcut('Click / drag', 'lay road'),
        shortcut('Shift+drag', 'remove road'),
        shortcut('Click a laid tile', 'select it'),
        shortcut('Del', 'remove the selected tile'),
        shortcut('V', 'its next look'),
        shortcut('Right-drag', 'pan'),
        shortcut('Wheel', 'zoom'),
        shortcut('Ctrl+Z', 'undo'),
    ];
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
    emptyGroup(trafficGroup);
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

/**
 * That many cars: the last ones go, or new ones start as far as they can from every other car, on waypoints with
 * a road out (each waypoint at most one, so there's as many as there are waypoints).
 */
function setCarCount(wanted) {
    const { waypoints, links, cars } = town.traffic;
    const models = mow.traffic?.models ?? [];
    const linked = new Set(links.flat());
    const spots = waypoints.filter((point) => linked.has(point.id));
    const count = Math.min(spots.length, Math.max(0, Math.round(wanted)));
    touch();
    if (count < cars.length) cars.length = count;
    while (cars.length < count) {
        const taken = cars.map((car) => waypoints[waypointIndex(car.at)]).filter(Boolean);
        const free = spots.filter((point) => !taken.includes(point));
        const clearance = (point) => Math.min(Infinity, ...taken.map((other) => Math.hypot(point.x - other.x, point.z - other.z)));
        const at = free.reduce((best, point) => (clearance(point) > clearance(best) ? point : best));
        cars.push({ at: at.id, ...(models.length ? { model: models[cars.length % models.length] } : {}) });
    }
    rebuildEntities();
    renderLists();
}

function renderTrafficList() {
    const { waypoints, links, cars } = town.traffic;
    host.querySelector('#townTrafficSummary').textContent = `${waypoints.length} waypoints · ${links.length} roads · ${cars.length} cars`;
    host.querySelector('#townCarCount').replaceChildren(numberField('Cars', cars.length, 1, (v) => setCarCount(v)));
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
    if (peopleOn) renderPeopleLists();
    host.querySelector('#townSectionList').replaceChildren(...town.sections.map((s, i) => listItem('section', i, `${i + 1}. ${s.name}`, `$${s.bonus}`)));
    host.querySelector('#townShoreList').replaceChildren(...(town.island?.outline ?? []).map((p, i) => listItem('shore', i, `Point ${i + 1}`, `${p.x}, ${p.z}`)));
    host.querySelector('#townPatchList').replaceChildren(...town.grassPatches.map((p, i) => listItem('patch', i, `${p.shape === 'round' ? '⬭' : '▭'} ${grassName(p.grass)}`, `${p.width}×${p.depth}`)));
    host.querySelector('#townAtmList').replaceChildren(...town.atms.map((a, i) => listItem('atm', i, `ATM ${i + 1}`, appearsLabel(a))));
    host.querySelector('#townWardrobeList').replaceChildren(...town.wardrobes.map((w, i) => listItem('wardrobe', i, `Wardrobe ${i + 1}`, appearsLabel(w))));
    host.querySelector('#townPavementList').replaceChildren(...town.pavements.map((p, i) => listItem('pavement', i, p.id, `${p.width}×${p.depth}`)));
    renderTrafficList();
    host.querySelector('#townOpenAll').replaceChildren(checkField('Every section open from the start (the player chooses where to go)', Boolean(town.openAll), (on) => {
        touch();
        if (on) town.openAll = true;
        else delete town.openAll;
    }), checkField('Grass over pavements (off: a pavement cuts its way through a lawn, like a park path)', Boolean(town.grassOverPavement), (on) => {
        touch();
        if (on) town.grassOverPavement = true;
        else delete town.grassOverPavement;
        rebuildAll();
    }));
    host.querySelector('#townColliderList').replaceChildren(...town.colliders.map((cube, i) => listItem('collider', i, `🧊 Cube ${i + 1}`,
        [cube.solid ? 'solid' : 'walk through', cube.fades ? `fades ${fileName(cube.fades)}` : ''].filter(Boolean).join(' · '))));
    host.querySelector('#townSecretList').replaceChildren(...town.secrets.map((s, i) => listItem('secret', i, `🤫 ${s.id}`, `$${s.reward} · ${s.width}×${s.depth}`)));
    host.querySelector('#townFarmList').replaceChildren(
        ...(town.farm?.pads ?? []).map((pad, i) => listItem('pad', i, pad.kind === 'tool' ? '⬆ Mower station' : pad.kind === 'blades' ? '🔪 Blades station' : '🎒 Bag station', pad.section ? `with ${pad.section}` : 'from the start')),
        ...(town.farm?.dens ?? []).map((den, i) => listItem('den', i, `🐔 ${den.name}`, `${den.width}×${den.depth}`)),
        ...(town.farm?.cropFarms ?? []).map((farm, i) => listItem('cropFarm', i, `🍓 ${farm.name}`, `${farm.width}×${farm.depth}`)),
        ...(town.farm?.cropFarms ?? []).flatMap((farm, i) => (farm.harbour ? [listItem('cropDock', i, '⚓ Harbour drop point', farm.name)] : [])),
        ...(town.farm?.trucks ? [listItem('dock', 0, '🚚 Truck dock', `$${town.farm.trucks.price} · level ${town.farm.trucks.level}`), listItem('truckCash', 0, '💵 Truck cash', '')] : []),
        ...(town.farm?.truckPath ?? []).map((point, i, all) => listItem('truckPoint', i, `🚚 Path point ${i + 1}`, i === 0 ? 'trucks come in' : i === all.length - 1 ? 'they park' : '')),
        ...PEOPLE_WAYS.flatMap((way) => (town.farm?.[way.key] ?? []).map((point, i, all) => listItem(way.type, i, `🧍 ${way.key === 'peopleIn' ? 'In' : 'Out'} point ${i + 1}`, i === 0 ? way.first : i === all.length - 1 ? way.last : ''))));
    host.querySelector('#townSpawnList').replaceChildren(...town.spawns.map((s, i) => listItem('spawn', i, `${s.kind === 'trucks' ? '🚚' : '🧍'} ${s.id}`, `${s.kind} · ${s.width}×${s.depth}`)),
        ...(town.footAreas ?? []).map((a, i) => listItem('footArea', i, '🚶 No-mower area', `${a.width}×${a.depth}`)),
        ...(town.shapes ?? []).map((s, i) => listItem('shape', i, '⬛ Shape cube', s.color)));
    host.querySelector('#townSoundList').replaceChildren(...town.sounds.map((s, i) => listItem('sound', i, `🔊 ${s.id}`, `${s.sound} · ${s.volume}`)));
    renderSoundSettings();
    host.querySelector('#townPropList').replaceChildren(...town.props.map((p, i) => listItem('prop', i, titleCase(fileName(p.model)), p.model.split('/').slice(0, -1).join('/'))));
}

/** The traffic's sound: each car's engine volume, full within `near`, gone from `far`. */
function renderSoundSettings() {
    const cars = town.soundSettings.cars;
    // The soundtrack: this level's own, or the game's (ui/mow.json music) while it has none.
    const music = town.soundSettings.music;
    const fallback = mow.music ?? { sound: '', volume: 0.18 };
    const editMusic = (change) => {
        touch();
        change();
        renderSoundSettings();
    };
    const editCars = (change) => {
        touch();
        change();
        renderSoundSettings();
    };
    host.querySelector('#townSoundSettings').replaceChildren(
        el('div', { class: 'inspector-title' }, 'Soundtrack'),
        selectField('Track', music?.sound ?? '', [['', `Game default (${fallback.sound})`], ...soundFiles.map((s) => [s, s])], (v) => editMusic(() => {
            if (v) town.soundSettings.music = { sound: v, volume: music?.volume ?? fallback.volume };
            else delete town.soundSettings.music;
        })),
        numberField('Volume (0-1)', music?.volume ?? fallback.volume, 0.01, (v) => editMusic(() => {
            town.soundSettings.music = { sound: music?.sound ?? fallback.sound, volume: round(Math.min(1, Math.max(0, v)), 0.01) };
        })),
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
        if (roadMode) box.replaceChildren(...roadModeHelp());
        else box.replaceChildren(el('p', { class: 'muted' }, 'Nothing selected. Click something in the town, or add one on the left.'));
        return;
    }
    if (selection.type === 'road') {
        box.replaceChildren(...roadInspector(data));
        return;
    }
    const type = selection.type;
    const titles = {
        prop: () => titleCase(fileName(data.model)), atm: () => `ATM ${selection.index + 1}`, wardrobe: () => `Wardrobe ${selection.index + 1}`, pavement: () => data.id,
        section: () => data.name, patch: () => `Grass patch: ${grassName(data.grass)}`, start: () => 'Player start',
        collider: () => `Collider cube ${selection.index + 1}`, sound: () => `Sound zone: ${data.id}`, waypoint: () => `Waypoint ${data.id}`, peopleArea: () => `Wander area ${selection.index + 1}`, peoplePoint: () => `Street path point ${data.id}`, secret: () => `Secret patch: ${data.id}`, spawn: () => `Spawn area: ${data.id}`, pad: () => (data.kind === 'tool' ? 'Mower upgrade station' : data.kind === 'blades' ? 'Blades upgrade station' : 'Bag upgrade station'), den: () => `Den: ${data.name}`, footArea: () => `No-mower area ${selection.index + 1}`, shape: () => `Shape cube ${selection.index + 1}`, areaUnlock: () => `Unlock square: ${town.sections[selection.index].name}`, beltPoint: () => `Conveyor belt point ${(selection.index % DEN_SLOTS) + 1}`, goldBeltPoint: () => `Gold belt point ${(selection.index % DEN_SLOTS) + 1}`, denPart: () => {
            const { egg, part } = denSlotInfo(selection.index % DEN_SLOTS);
            return part ? part.label : `Hen ${egg + 1}'s egg spot`;
        }, dock: () => 'Truck dock', cowDen: () => `Cow barn: ${data.name}`, cropFarm: () => `Crop farm: ${data.name}`, cropDock: () => 'Harbour drop point',
        cowPart: () => farmPartOf('cowPart', selection.index)?.part.label ?? 'Barn part', cropPart: () => farmPartOf('cropPart', selection.index)?.part.label ?? 'Farm part',
        cowBeltPoint: () => `Barn belt point ${selection.index + 1}`, boatPoint: () => `Boats in: point ${selection.index % DEN_SLOTS + 1}`, boatOutPoint: () => `Boats out: point ${selection.index % DEN_SLOTS + 1}`, cowDock: () => 'Cow barn truck dock', cowTruckPoint: () => `Cow trucks point ${selection.index + 1}`, truckPoint: () => `Truck path point ${selection.index + 1}`, peopleInPoint: () => `Customers in point ${selection.index + 1}`, peopleOutPoint: () => `Customers out point ${selection.index + 1}`, truckCash: () => 'Truck cash square', pen: () => `${town.sections[selection.index].name} pen`, centre: () => 'Grass noise centre', shore: () => `Shore point ${selection.index + 1}`, separator: () => `${town.sections[selection.index].name} separator`,
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
    if (type === 'peopleArea') {
        rows.push(
            numberField('People', data.count, 1, (v) => edit((d) => { d.count = Math.max(0, Math.round(v)); })),
            el('p', { class: 'muted small' }, 'They stand on what the area covers: green dots on the ground, pink ones on a roof.'));
    }
    if (type === 'peoplePoint') {
        const links = town.people.links.filter((link) => link.includes(data.id)).map(([a, b]) => (a === data.id ? b : a));
        rows.push(
            el('p', { class: 'muted small' }, links.length ? `Linked to ${links.join(', ')}.` : 'Not linked yet: walkers only use linked points.'),
            el('p', { class: 'muted small' }, 'D: a next point, linked to this one. Alt+click another point: link or unlink it.'));
    }
    if (type === 'collider') {
        const models = [...new Set([...town.props.map((prop) => prop.model), ...(data.fades ? [data.fades] : [])])]
            .sort((a, b) => fileName(a).localeCompare(fileName(b)));
        rows.push(
            checkField('Solid (blocks walking, no grass under it)', data.solid, (on) => edit((d) => { d.solid = on; })),
            selectField('Fades', data.fades ?? '', [['', 'Nothing'], ...models.map((model) => [model, titleCase(fileName(model))])], (v) => edit((d) => {
                if (v) d.fades = v;
                else delete d.fades;
            })),
            el('p', { class: 'muted small' }, 'While the player is in or touching this cube, that prop goes see-through. Once any cube names a prop, only cubes fade it.'));
    }
    if (type === 'pad') {
        rows.push(
            selectField('Upgrades', data.kind, [['tool', 'The next mower'], ['capacity', 'A bigger bag'], ['blades', 'The next blades (cutting power)']], (v) => edit((d) => { d.kind = v; })),
            selectField('There', data.section ?? '', [['', 'From the start'], ...town.sections.map((sec) => [sec.id, `With ${sec.name}`])], (v) => edit((d) => { if (v) d.section = v; else delete d.section; })),
            el('p', { class: 'muted small' }, 'Standing on the square pours the bag\'s grass in; paid in full, the upgrade happens. The stand (the next mower or the bag) is behind the square: turn it to put it at a side.'));
    }
    if (type === 'cowDen') {
        rows.push(
            textField('Name', data.name, (v) => edit((d) => { d.name = v || d.name; })),
            numberField('Gate width', data.gate ?? 2.8, 0.2, (v) => edit((d) => { d.gate = Math.max(1, v); })),
            numberField('Opens at level', data.level ?? 0, 1, (v) => edit((d) => { const level = Math.max(0, Math.round(v)); if (level > 1) d.level = level; else delete d.level; })),
            el('p', { class: 'muted small' }, 'The cow barn: stalls along the back (north), the butter churn west and the cheese press east, the customers\' counter by the east fence, the truck dock by the west fence. Its loop is farm.cowDen.loop in the level.'));
    }
    if (FARM_PART_SETS[type]) {
        const { set, den, part } = farmPartOf(type, selection.index);
        if (part.sized) {
            rows.push(
                numberField('Width', data.w ?? part.square[0], 0.1, (v) => edit((d) => { d.w = Math.max(0.6, round(v)); })),
                numberField('Depth', data.d ?? part.square[1], 0.1, (v) => edit((d) => { d.d = Math.max(0.6, round(v)); })));
        }
        rows.push(
            el('p', { class: 'muted small' }, `In the ${set.name} "${den.name}": X / Z are from its middle (+Z toward the gate), so it moves with it. The game puts it here. Drag it (W) or type it.`),
            el('button', { class: 'block', onclick: () => edit(() => { delete den.parts?.[part.key]; }) }, '↺ Back to its own layout'));
    }
    if (type === 'cowBeltPoint') {
        const den = town.farm.cowDen;
        rows.push(
            el('p', { class: 'muted small' }, `The barn's conveyor (X / Z from its middle): from point 1 (its start) through the points in between to the last, where the milk is split between the churn and the press. Milk joins it from each cow's spot where it passes nearest.`),
            el('div', { class: 'row' },
                el('button', { onclick: () => addCowBeltPoint(selection.index) }, '+ Point after this'),
                el('button', { onclick: () => {
                    if ((den.parts?.belt?.length ?? 0) <= 2) return toast('A belt needs a start and an end (2 points at least).', 'bad');
                    touch();
                    den.parts.belt.splice(selection.index, 1);
                    selection = null;
                    rebuildAll();
                } }, '− Remove this point')),
            el('button', { class: 'block', onclick: () => {
                touch();
                if (den.parts) delete den.parts.belt;
                selection = null;
                rebuildAll();
            } }, '↺ Back to the default path'));
    }
    if (type === 'cropFarm') {
        rows.push(
            textField('Name', data.name, (v) => edit((d) => { d.name = v || d.name; })),
            numberField('Gate width', data.gate ?? 2.4, 0.2, (v) => edit((d) => { d.gate = Math.max(1, v); })),
            numberField('Opens at level', data.level ?? 0, 1, (v) => edit((d) => { const level = Math.max(0, Math.round(v)); if (level > 1) d.level = level; else delete d.level; })),
            el('p', { class: 'muted small' }, `A crop farm growing "${data.crop}" (ui/mow.json crops): plots along the back, its machine and fresh crate, the counter by the east fence (customers outside it), and its harbour. Place its pieces (their markers), the harbour's drop point and the boats' paths.`));
    }
    if (type === 'cropDock') {
        rows.push(el('p', { class: 'muted small' }, 'Where the boats dock: the player (or the boat helper) loads them standing here. Put it on the shore by the water, the boats\' in path ending beside it. Bought like the trucks\' dock (its price and level in the level: farm.cropFarms[].harbour).'));
    }
    if (BOAT_WAYS[type]) {
        const farm = town.farm.cropFarms[Math.floor(selection.index / DEN_SLOTS)];
        const key = BOAT_WAYS[type];
        rows.push(
            el('p', { class: 'muted small' }, type === 'boatPoint'
                ? 'The boats\' way in: they appear at point 1 (out at sea) and sail point to point, docking at the last (beside the drop point).'
                : 'The boats\' way out: from the dock on through these points, gone at the last.'),
            el('div', { class: 'row' },
                el('button', { onclick: () => addBoatPoint(type, selection.index) }, '+ Point after this'),
                el('button', { onclick: () => {
                    if ((farm.harbour[key]?.length ?? 0) <= 2) return toast('A path needs 2 points at least.', 'bad');
                    touch();
                    farm.harbour[key].splice(selection.index % DEN_SLOTS, 1);
                    selection = null;
                    rebuildAll();
                } }, '− Remove this point')));
    }
    if (type === 'cowTruckPoint') {
        rows.push(
            checkField('They park here', Boolean(data.park), (on) => edit((d) => { if (on) d.park = true; else delete d.park; })),
            el('p', { class: 'muted small' }, 'The cow barn\'s trucks: in from point 1 to the park point (by its dock), then on out through the rest. Add or remove points in the level (farm.cowDen.truckPath).'));
    }
    if (type === 'den') {
        rows.push(
            textField('Name', data.name, (v) => edit((d) => { d.name = v || d.name; })),
            numberField('Gate width', data.gate ?? 2.4, 0.2, (v) => edit((d) => { d.gate = Math.max(1, v); })),
            numberField('Opens at level', data.level ?? 0, 1, (v) => edit((d) => { const level = Math.max(0, Math.round(v)); if (level > 1) d.level = level; else delete d.level; })),
            el('p', { class: 'muted small' }, 'Its hen house runs along the back (north), the packing machine and the sell counter inside; the customers\' path outside its west fence. Below its level its gate is boarded up (its sign says the level); from then, mowed up to its gate, it opens. Put tough grass round it (a grass patch) so it has to be mowed to.'));
    }
    if (type === 'beltPoint' || type === 'goldBeltPoint') {
        const key = BELT_KEYS[type];
        const denIndex = Math.floor(selection.index / DEN_SLOTS);
        const den = town.farm.dens[denIndex];
        const i = selection.index % DEN_SLOTS;
        rows.push(
            el('p', { class: 'muted small' }, key === 'goldBelt'
                ? `The gold belt in "${den.name}" (X / Z from its middle): from point 1 (by the packing machine: every pack packed rides it) to the last (into the gold machine: put it by its PACKS drop). Bought on its square once the gold machine's there; then everything's gold.`
                : `The conveyor belt in "${den.name}" (X / Z from its middle). It runs from point 1 (the start: its buy square, once every hen is owned) through the points in between to the last (into the packing machine: put it by the EGGS drop). Eggs from the egg spots join it where it passes nearest.`),
            el('div', { class: 'row' },
                el('button', { onclick: () => addBeltPoint(denIndex, i, key) }, '+ Point after this'),
                el('button', { onclick: () => {
                    if ((den.parts?.[key]?.length ?? 0) <= 2) return toast('A belt needs a start and an end (2 points at least).', 'bad');
                    touch();
                    den.parts[key].splice(i, 1);
                    selection = null;
                    rebuildAll();
                } }, '− Remove this point')),
            el('button', { class: 'block', onclick: () => {
                touch();
                if (den.parts) delete den.parts[key];
                selection = null;
                rebuildAll();
            } }, '↺ Back to the default path'));
    }
    if (type === 'denPart') {
        const den = town.farm.dens[Math.floor(selection.index / DEN_SLOTS)];
        const { part } = denSlotInfo(selection.index % DEN_SLOTS);
        // A square the player stands on: its size too (bigger fits its words better).
        if (part?.sized) {
            rows.push(
                numberField('Width', data.w ?? part.square[0], 0.1, (v) => edit((d) => { d.w = Math.max(0.6, round(v)); })),
                numberField('Depth', data.d ?? part.square[1], 0.1, (v) => edit((d) => { d.d = Math.max(0.6, round(v)); })));
        }
        rows.push(
            el('p', { class: 'muted small' }, `In the den "${den.name}": X / Z are from its middle (+Z toward the gate), so it moves with the den. ${part?.planned
                ? 'Planned: shown here only, to lay out the line (the conveyor from the packs to it, then out) before the gold machine is built.'
                : 'The game puts it here. Drag it (W) or type it.'}`),
            el('button', { class: 'block', onclick: () => edit(() => {
                const slot = selection.index % DEN_SLOTS;
                const info = denSlotInfo(slot);
                if (info.part) delete den.parts?.[info.part.key];
                else if (den.parts?.eggs) den.parts.eggs[info.egg] = null;
            }) }, '↺ Back to the den\'s own layout'));
    }
    if (type === 'shape') {
        rows.push(
            el('label', { class: 'field' }, el('span', {}, 'Colour'),
                el('input', { type: 'color', value: data.color, onchange: (event) => edit((d) => { d.color = event.target.value; }) })),
            numberField('Height', data.height, 0.1, (v) => edit((d) => { d.height = Math.max(0.05, v); })),
            numberField('Lifted (y)', data.y ?? 0, 0.1, (v) => edit((d) => { if (v) d.y = v; else delete d.y; })),
            el('p', { class: 'muted small' }, 'A plain box in its colour, unlit (a dark one reads as a hole): put it inside a tunnel or a doorway so what comes out seems to come from somewhere. Not solid. Move (W), turn (E), size it (R).'));
    }
    if (type === 'footArea') {
        rows.push(el('p', { class: 'muted small' }, 'Inside it the player walks without the mower (it\'s parked, nothing is cut), as in a den: over the customers\' path, by counters, wherever mowing over people looks wrong. Scale (R) to size it.'));
    }
    if (type === 'areaUnlock') {
        const section = town.sections[selection.index];
        rows.push(
            numberField('Price ($)', data.price, 50, (v) => edit((d) => { d.price = Math.max(0, Math.round(v)); })),
            numberField('Level', data.level, 1, (v) => edit((d) => { d.level = Math.max(1, Math.round(v)); })),
            el('p', { class: 'muted small' }, `Once the part before "${section.name}" is restored, this square comes out: the money pours in a bit at a time (carried money first, then the den's piles) and stays paid between visits; with the level reached and the price paid, the area opens. Put it at the edge of the area before.`),
            el('button', { class: 'block', onclick: () => edit(() => { delete section.unlock; selection = null; }) }, 'Opens by itself instead (no square)'));
    }
    if (type === 'truckCash') {
        rows.push(el('p', { class: 'muted small' }, 'A loaded truck pays here: its own pile of notes (the customers\' is by the counter). Keep it inside the den, near the dock.'));
    }
    if (peopleWay(type)) {
        rows.push(el('p', { class: 'muted small' }, "The customers' ways (2+ points each, both drawn or neither): IN (blue) — they pop in at point 1 and walk point to point, then to the queue at the den's counter; OUT (purple) — served, they walk from the counter point to point and pop out at the last. Put the last IN point and the first OUT point just outside the den's gate. Without them: the people spawn area and straight up the den's path."));
    }
    if (type === 'truckPoint') {
        const path = town.farm.truckPath;
        const i = selection.index;
        rows.push(
            el('label', { class: 'field' }, el('span', {}, 'They park here (and load)'),
                el('input', { type: 'checkbox', checked: !!data.park, disabled: i === 0, onchange: (event) => edit(() => {
                    // One park point: this one, or none (then they park at the last and drive back).
                    path.forEach((p) => delete p.park);
                    if (event.target.checked) path[i].park = true;
                }) })),
            el('p', { class: 'muted small' }, 'The trucks\' path (orange): they pop in at point 1, drive point to point to the park point (by the den\'s truck dock: they stop and load, the next ones queue behind), then drive on through the rest and pop out at the last. No park point: they park at the last and drive back. "🚚 Truck path point" adds one after the selected point. Lay a pavement under it for the road.'));
    }
    if (type === 'dock') {
        rows.push(
            numberField('Price ($)', data.price, 10, (v) => edit((d) => { d.price = Math.max(0, Math.round(v)); })),
            numberField('Level', data.level, 1, (v) => edit((d) => { d.level = Math.max(1, Math.round(v)); })),
            numberField('$ a tray', data.trayPrice, 1, (v) => edit((d) => { d.trayPrice = Math.max(1, Math.round(v)); })),
            numberField('Trays wanted (least)', data.wants[0], 1, (v) => edit((d) => { d.wants = [Math.max(1, Math.round(v)), Math.max(Math.round(v), d.wants[1])]; })),
            numberField('Trays wanted (most)', data.wants[1], 1, (v) => edit((d) => { d.wants = [Math.min(d.wants[0], Math.round(v)), Math.max(1, Math.round(v))]; })),
            el('p', { class: 'muted small' }, 'Keep it inside the den, by its fence: trucks park at the last point of the trucks\' path (🚚 Truck path point), so put that just outside the fence here.'));
    }
    if (type === 'spawn') {
        rows.push(
            textField('Id', data.id, (v) => edit((d) => { d.id = v || d.id; })),
            selectField('Who', data.kind, [['people', 'People (customers)'], ['trucks', 'Trucks']], (v) => edit((d) => { d.kind = v; })),
            el('p', { class: 'muted small' }, data.kind === 'trucks'
                ? 'Trucks pop in here and drive the roads (pavements named road-...) to the den\'s truck dock, and back. Keep it on (or next to) a road.'
                : 'Customers pop in somewhere in here and walk to the den\'s counter, and back. With several, each picks one at random.'));
    }
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
            el('label', { class: 'field' }, el('span', {}, 'Bought to open (unlock square)'),
                el('input', { type: 'checkbox', checked: !!data.unlock, onchange: (event) => edit((d) => {
                    if (event.target.checked) d.unlock = { price: 1000, level: 1, x: round(d.x - d.width / 2 + 2), z: round(d.z) };
                    else delete d.unlock;
                }) })),
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
            numberField('Clippings ×', data.valueScale ?? 1, 0.25, (v) => edit((d) => {
                const scale = Math.round(Math.min(10, Math.max(0.25, v || 1)) * 100) / 100;
                if (scale === 1) delete d.valueScale;
                else d.valueScale = scale;
            })),
            numberField('City goal: opens after N areas (0: no)', data.opensAfter ?? 0, 1, (v) => edit((d) => {
                const count = Math.max(0, Math.round(v || 0));
                if (count) d.opensAfter = count;
                else delete d.opensAfter;
            })),
            ...(data.opensAfter ? [
                el('div', { class: 'inspector-title' }, 'Goal model', el('span', { class: 'tag' }, data.goalModel ? titleCase(fileName(data.goalModel)) : 'none')),
                el('button', { class: 'block', onclick: () => chooseGoalModel(data) }, '🎯 Choose model…'),
                el('button', { class: 'block', onclick: () => importGoalModel(data) }, '📚 Import from 3D library…'),
                el('p', { class: 'muted small' }, 'The goal\'s mesh: placed in the level at its own size (move and scale it like any prop), shown on the HUD\'s timeline. Choosing another swaps it in the same place.'),
            ] : []),
            numberField('Corner radius (no grass past it)', data.cornerRadius ?? 0, 0.1, (v) => edit((d) => {
                if (v > 0) d.cornerRadius = v;
                else delete d.cornerRadius;
            })),
            selectField('Max growth', data.maxGrass ?? '', maxGrassOptions(), (v) => edit((d) => {
                if (v) d.maxGrass = v;
                else delete d.maxGrass;
            })),
            el('p', { class: 'muted small' }, 'Max growth: nothing tougher grows in this section (tougher spots grow this instead), so it can be finished with that mower.'),
            selectField('Spots of', data.spots?.grass ?? '', [['', 'No spots'], ...mow.grass.map((g) => [g.id, g.name])], (v) => edit((d) => {
                if (v) d.spots = { grass: v, share: d.spots?.share ?? 0.4 };
                else delete d.spots;
            })),
            ...(data.spots ? [numberField('Spots: how much (0–1)', data.spots.share, 0.05, (v) => edit((d) => {
                d.spots.share = Math.round(Math.min(1, Math.max(0, v || 0)) * 100) / 100;
            }))] : []),
            el('p', { class: 'muted small' }, 'Spots: clumps of another grass over the fill (usually the next tougher one: one step tougher only chews slowly), shaped by the town grass noise, so a lawn of one grass type does not look flat. They can be tougher than Max growth.'),
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
