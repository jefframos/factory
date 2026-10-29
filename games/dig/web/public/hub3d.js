// 3D Hub tab: builds the miner's hub (levels/hub.json) in a perspective view the way the game draws it — checker
// floor, walls with their doorways, the stations (ATM / upgrade shop, collection totem, wardrobe), decoration,
// buildables (pieces the player buys to finish the hub: see-through with a price tag in the game until bought) and
// trophy tables (each shows one zone's finds along its long side; silhouettes in the game until dug up) and
// achievement trophies (decorations that appear once an achievement's last tier is claimed), and reveal areas
// (rectangles whose contents stay hidden in the game until their rule is met, so a new player meets the hub bit by bit).
// Orbit with the mouse, click to select, drag the gizmo to move (W), turn (E) or scale (R). Models come from the game
// (public/dig/models) or are imported from the 3D asset library (library.js). Saves with PUT /api/levels/hub.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { api, el, toast, isModalOpen } from './shared.js';
import { openModelPicker, setModelCatalog } from './modelPicker.js';
import { openLibraryPicker } from './library.js';

const HUB_ID = 'hub';
// Mirrors games/dig/game/world/HubRoom.ts, so the editor shows what the game builds.
const WALL = { height: 2.2, thickness: 0.3, bottomColor: 0x5d4030, topColor: 0xc49a6c, bottomHeight: 0.8 };
const FLOOR_COLORS = ['#d9c29b', '#c9ae84'];
const STATION_RADIUS = 1.3;
const STATION_MODEL_OFFSET = STATION_RADIUS + 0.25;
const BUILD_RADIUS = 0.9;
const STATIONS = {
    atm: { label: 'Upgrade shop (ATM)', color: 0x3fd16b, model: 'mine/atm-01.glb', height: 2.1, pedestal: 0 },
    collection: { label: 'Collection totem', color: 0xf4b400, model: 'mine/idol-a.glb', height: 1.4, pedestal: 0.8 },
    wardrobe: { label: 'Wardrobe', color: 0xe266c8, model: 'mine/closet-01.glb', height: 2.2, pedestal: 0 },
};
const GHOST = new THREE.MeshStandardMaterial({ color: 0x8fd3ff, emissive: 0x8fd3ff, emissiveIntensity: 0.25, transparent: true, opacity: 0.4, depthWrite: false });
const SNAP = 0.25;
const ROTATE_SNAP = THREE.MathUtils.degToRad(15);
const UNDO_LIMIT = 60;
/** Mirrors HubRoom's TROPHY_SIZE: a find on its table is this big on its biggest side. */
const TROPHY_SIZE = 0.55;
const DEFAULT_TABLE = 'hub/furniture-table-medium-long/furniture-table-medium-long.gltf';

let host;
let level;
let dirty = false;
let selection = null; // { type: 'station' | 'prop' | 'buildable' | 'start', index }
let showBought = false;
let snap = true;
let gameUrl = 'http://localhost:9001/';
let dig = { zones: [], finds: [] };
const undoStack = [];

let renderer;
let scene;
let camera;
let orbit;
let gizmo;
const roomGroup = new THREE.Group();
const entityGroup = new THREE.Group();
const holders = new Map(); // "type:index" -> THREE.Group
const loader = new GLTFLoader();
const modelCache = new Map();
const raycaster = new THREE.Raycaster();

export const hasUnsavedHub3d = () => dirty;

export async function initHub3dTab(container, options = {}) {
    host = container;
    gameUrl = options.gameUrl ?? gameUrl;
    dig = await api('/api/dig');
    buildLayout();
    setupViewport(host.querySelector('#hub3dViewport'));
    await reload();
}

/** Called when the tab is shown again: picks up hub.json changes made elsewhere (unless there are unsaved edits here). */
export async function refreshHub3dTab() {
    resize();
    if (!dirty) await reload();
}

async function reload() {
    const levels = await api('/api/levels');
    level = levels.find((entry) => entry.id === HUB_ID);
    if (!level) {
        host.querySelector('#hub3dHint').textContent = 'No levels/hub.json found.';
        return;
    }
    level.stations ??= [];
    level.props ??= [];
    level.buildables ??= [];
    level.trophyTables ??= [];
    level.achievementDecor ??= [];
    level.areas ??= [];
    selection = null;
    undoStack.length = 0;
    setDirty(false);
    rebuildRoom();
    rebuildEntities();
    renderLists();
    renderInspector();
}

// ---------------------------------------------------------------- layout

function buildLayout() {
    const stationButtons = Object.entries(STATIONS).map(([kind, look]) => el('button', {
        class: 'block', style: { borderLeft: `4px solid #${look.color.toString(16).padStart(6, '0')}` },
        onclick: () => placeStation(kind),
    }, look.label));
    host.replaceChildren(
        el('aside', { class: 'sidebar left' },
            el('section', { class: 'card-section' },
                el('h2', {}, 'Stations'),
                el('p', { class: 'muted small' }, 'One of each. Click to add it, or to select it if it is already in the hub.'),
                el('div', { class: 'stack' }, ...stationButtons)),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Add'),
                el('div', { class: 'stack' },
                    el('button', { class: 'block', onclick: () => pickModel('prop') }, '🪴 Decoration (game model)…'),
                    el('button', { class: 'block', onclick: () => pickModel('buildable') }, '🏗 Buildable (game model)…'),
                    el('button', { class: 'block primary', onclick: () => importFromLibrary() }, '📚 Import from 3D library…')),
                el('p', { class: 'muted small' }, 'Buildables are bought by the player in the hub: see-through with a price tag until bought.')),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Buildables ', el('span', { id: 'hub3dBuildTotal', class: 'tag' })),
                el('ul', { id: 'hub3dBuildList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Trophy tables'),
                el('p', { class: 'muted small' }, "Each shows one zone's 3 finds (silhouettes in the game until dug up)."),
                el('ul', { id: 'hub3dTableList', class: 'list' }),
                el('button', { class: 'block', onclick: () => addTable() }, '＋ Trophy table')),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Reveal areas'),
                el('p', { class: 'muted small' }, "Everything inside an area stays hidden in the game until its rule is met (first upgrade, or another area fully built). Outside every area = always there."),
                el('ul', { id: 'hub3dAreaList', class: 'list' }),
                el('button', { class: 'block', onclick: () => addArea() }, '＋ Reveal area')),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Achievement trophies'),
                el('p', { class: 'muted small' }, "Appear in the hub once the achievement's last level is claimed."),
                el('ul', { id: 'hub3dRewardList', class: 'list' }),
                el('button', { class: 'block', onclick: () => addReward() }, '＋ Achievement trophy…')),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Decoration'),
                el('ul', { id: 'hub3dPropList', class: 'list' }))),
        el('div', { class: 'stage-area' },
            el('div', { class: 'toolbar' },
                el('div', { class: 'segmented', id: 'hub3dMode' },
                    el('button', { dataset: { mode: 'translate' }, class: 'active', onclick: () => setMode('translate') }, 'Move (W)'),
                    el('button', { dataset: { mode: 'rotate' }, onclick: () => setMode('rotate') }, 'Turn (E)'),
                    el('button', { dataset: { mode: 'scale' }, onclick: () => setMode('scale') }, 'Scale (R)')),
                el('label', {}, el('input', { type: 'checkbox', checked: snap, onchange: (event) => { snap = event.target.checked; applySnap(); } }), ' Snap'),
                el('label', {}, el('input', { type: 'checkbox', checked: showBought, onchange: (event) => { showBought = event.target.checked; rebuildEntities(); } }), ' Show buildables as bought'),
                el('span', { class: 'spacer' }),
                el('span', { id: 'hub3dStatus' }),
                el('button', { class: 'primary', onclick: () => void save() }, '💾 Save'),
                el('button', { onclick: () => window.open(gameUrl, 'dig-game') }, '▶ Play')),
            el('div', { id: 'hub3dViewport', style: { position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden' } }),
            el('div', { id: 'hub3dHint', class: 'hint-bar' }, 'Left-drag: orbit · Right-drag: pan · Wheel: zoom · Click: select · W/E/R: move/turn/scale · D: duplicate · Del: remove · Ctrl+Z: undo · Ctrl+S: save')),
        el('aside', { class: 'sidebar right' },
            el('section', { class: 'card-section' }, el('h2', {}, 'Selection'), el('div', { id: 'hub3dInspector' }))),
    );
}

function setDirty(value) {
    dirty = value;
    const status = host.querySelector('#hub3dStatus');
    status.textContent = dirty ? 'Unsaved changes' : 'Saved';
    status.className = dirty ? 'dirty' : '';
}

/** Snapshot for undo, then mark unsaved. Call before changing `level`. */
function touch() {
    undoStack.push(JSON.stringify(level));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    setDirty(true);
}

function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    level = JSON.parse(previous);
    if (selection && !entityData(selection)) selection = null;
    setDirty(true);
    rebuildEntities();
    renderLists();
    renderInspector();
}

// ---------------------------------------------------------------- viewport

function setupViewport(viewport) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    viewport.append(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2b2622);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a3a, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(6, 14, 8);
    scene.add(sun);
    const grid = new THREE.GridHelper(40, 80, 0x4a4038, 0x3a322c);
    grid.position.y = -0.01;
    scene.add(grid, roomGroup, entityGroup);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(0, 16, 14);
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, 0);
    orbit.maxPolarAngle = Math.PI / 2 - 0.05;
    orbit.update();

    gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', (event) => {
        orbit.enabled = !event.value;
        if (event.value) touch();
        else if (gizmo.getMode() === 'scale') commitScale();
        else renderInspector();
    });
    gizmo.addEventListener('objectChange', () => syncFromGizmo());
    scene.add(gizmo.getHelper());
    setMode('translate');

    let down = null;
    renderer.domElement.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
    renderer.domElement.addEventListener('pointerup', (event) => {
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
    const viewport = host?.querySelector('#hub3dViewport');
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
    host.querySelectorAll('#hub3dMode button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
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
    } else if (key === 'w') setMode('translate');
    else if (key === 'e') setMode('rotate');
    else if (key === 'r') setMode('scale');
    else if (key === 'd' && selection) duplicateSelection();
    else if ((key === 'delete' || key === 'backspace') && selection) removeSelection();
    else if (key === 'escape') select(null);
    else if (key === 'f' && selection) focusSelection();
}

function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // A piece standing inside a reveal area wins over the area's floor rectangle.
    const entities = raycaster.intersectObjects(entityGroup.children, true).filter((entry) => entry.object.visible).map((entry) => {
        let node = entry.object;
        while (node && !node.userData.entity) node = node.parent;
        return node?.userData.entity;
    }).filter(Boolean);
    select(entities.find((entity) => entity.type !== 'area') ?? entities[0] ?? null);
}

// ---------------------------------------------------------------- room (floor + walls, read-only here)

function checkerTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    for (let i = 0; i < 4; i++) {
        g.fillStyle = FLOOR_COLORS[(i + Math.floor(i / 2)) % 2];
        g.fillRect((i % 2) * 32, Math.floor(i / 2) * 32, 32, 32);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    return texture;
}

function rebuildRoom() {
    roomGroup.clear();
    const rects = level.floor.rects?.length ? level.floor.rects : [{ x: 0, z: 0, width: level.floor.width, depth: level.floor.depth }];
    for (const rect of rects) {
        const texture = checkerTexture();
        texture.repeat.set(rect.width / 2, rect.depth / 2);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(rect.width, rect.depth), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(rect.x, 0, rect.z);
        roomGroup.add(floor);
    }
    const bottom = new THREE.MeshStandardMaterial({ color: WALL.bottomColor, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ color: WALL.topColor, roughness: 0.8 });
    for (const wall of level.walls ?? []) {
        const points = wall.points;
        const count = wall.closed ? points.length : points.length - 1;
        for (let i = 0; i < count; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            for (const [from, to] of wallPieces(a, b, wall.openings ?? [])) {
                addWallPiece(from, to, bottom, top);
            }
        }
    }
}

/** A wall segment minus its openings (axis-aligned segments; others are drawn whole). */
function wallPieces(a, b, openings) {
    const horizontal = Math.abs(a.z - b.z) < 1e-3;
    const vertical = Math.abs(a.x - b.x) < 1e-3;
    if (!horizontal && !vertical) return [[a, b]];
    const along = horizontal ? 'x' : 'z';
    const across = horizontal ? 'z' : 'x';
    const lo = Math.min(a[along], b[along]);
    const hi = Math.max(a[along], b[along]);
    const cuts = openings
        .filter((o) => {
            const min = across === 'x' ? o.minX : o.minZ;
            const max = across === 'x' ? o.maxX : o.maxZ;
            return a[across] >= min && a[across] <= max;
        })
        .map((o) => (along === 'x' ? [o.minX, o.maxX] : [o.minZ, o.maxZ]))
        .sort((p, q) => p[0] - q[0]);
    const pieces = [];
    let start = lo;
    for (const [min, max] of cuts) {
        if (min > start) pieces.push([start, Math.min(min, hi)]);
        start = Math.max(start, max);
    }
    if (start < hi) pieces.push([start, hi]);
    return pieces.map(([p, q]) => (along === 'x'
        ? [{ x: p, z: a.z }, { x: q, z: a.z }]
        : [{ x: a.x, z: p }, { x: a.x, z: q }]));
}

function addWallPiece(a, b, bottom, top) {
    const length = Math.hypot(b.x - a.x, b.z - a.z) + WALL.thickness;
    if (length <= WALL.thickness + 1e-3) return;
    const angle = Math.atan2(b.z - a.z, b.x - a.x);
    for (const [material, y0, y1] of [[bottom, 0, WALL.bottomHeight], [top, WALL.bottomHeight, WALL.height]]) {
        const piece = new THREE.Mesh(new THREE.BoxGeometry(length, y1 - y0, WALL.thickness), material);
        piece.position.set((a.x + b.x) / 2, (y0 + y1) / 2, (a.z + b.z) / 2);
        piece.rotation.y = -angle;
        roomGroup.add(piece);
    }
}

// ---------------------------------------------------------------- entities

const keyOf = (sel) => `${sel.type}:${sel.index}`;
const LISTS = { station: 'stations', prop: 'props', buildable: 'buildables', table: 'trophyTables', reward: 'achievementDecor', area: 'areas' };
/** Reveal rules (see HubData.HubArea): their label and the colour an area is drawn in. */
const REVEAL_COLORS = { start: 0x9aa4b2, upgrade: 0x4fc3f7, find: 0xffd23f, build: 0x8fe3a1, built: 0xffa94d };
function revealColor(reveal) {
    const rule = reveal.split('|')[0];
    if (rule.startsWith('built:')) return REVEAL_COLORS.built;
    if (rule === 'firstUpgrade' || rule.startsWith('upgrade:')) return REVEAL_COLORS.upgrade;
    if (rule === 'firstFind') return REVEAL_COLORS.find;
    if (rule === 'firstBuild') return REVEAL_COLORS.build;
    return REVEAL_COLORS.start;
}
/** A reveal rule in words ('|' = or), as HubRoom reads it. */
function revealLabel(reveal) {
    return reveal.split('|').map((rule) => {
        if (rule === 'firstUpgrade') return 'after the first upgrade';
        if (rule.startsWith('upgrade:')) return `after upgrade ${rule.slice(8)}`;
        if (rule === 'firstFind') return 'after the first find';
        if (rule === 'firstBuild') return 'after the first buildable';
        if (rule.startsWith('built:')) return `after ${level.areas.find((a) => a.id === rule.slice(6))?.name ?? '?'} is built`;
        return 'from the start';
    }).join(' or ');
}
const achievementOf = (id) => dig.achievements?.find((a) => a.id === id);
const listOf = (type) => (LISTS[type] ? level[LISTS[type]] : null);
const zoneName = (index) => dig.zones[index]?.name ?? `Zone ${index + 1}`;

function entityData(sel) {
    if (!sel) return null;
    if (sel.type === 'start') return level.start;
    return listOf(sel.type)?.[sel.index] ?? null;
}

function loadModel(path) {
    if (!modelCache.has(path)) {
        modelCache.set(path, loader.loadAsync(`/models/${path}`).then((gltf) => gltf.scene, (error) => {
            console.warn(`[hub3d] could not load ${path}`, error);
            return null;
        }));
    }
    return modelCache.get(path);
}

/** A model scaled to `height`, standing on `elevation`, in a holder (the holder carries x/z and the turn). */
async function fillModel(holder, path, height, elevation, ghost, stretch) {
    const source = await loadModel(path);
    if (!source || !holder.parent) return null;
    const model = source.clone(true);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (size.y > 1e-4) model.scale.multiplyScalar(height / size.y);
    // Same as HubRoom.placeProp(): extra width/depth stretch on top of the height fit.
    if (stretch) model.scale.multiply(new THREE.Vector3(stretch.x, 1, stretch.z));
    model.updateMatrixWorld(true);
    model.position.y = elevation - new THREE.Box3().setFromObject(model).min.y;
    if (ghost) model.traverse((node) => { if (node.isMesh) node.material = GHOST; });
    holder.add(model);
    holder.userData.model = model;
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
    sprite.scale.set(1.8, 0.675, 1);
    return sprite;
}

function rebuildEntities() {
    gizmo.detach();
    entityGroup.clear();
    holders.clear();
    level.stations.forEach((station, index) => addHolder({ type: 'station', index }, buildStation(station)));
    level.props.forEach((prop, index) => addHolder({ type: 'prop', index }, buildProp(prop, false)));
    level.buildables.forEach((buildable, index) => addHolder({ type: 'buildable', index }, buildProp(buildable, true)));
    level.trophyTables.forEach((table, index) => addHolder({ type: 'table', index }, buildTable(table)));
    level.achievementDecor.forEach((reward, index) => addHolder({ type: 'reward', index }, buildReward(reward)));
    level.areas.forEach((area, index) => addHolder({ type: 'area', index }, buildArea(area)));
    addHolder({ type: 'start', index: 0 }, buildStart());
    attachGizmo();
}

function addHolder(sel, holder) {
    holder.userData.entity = sel;
    holders.set(keyOf(sel), holder);
    entityGroup.add(holder);
}

function buildStation(station) {
    const look = STATIONS[station.kind];
    const size = station.scale ?? 1;
    const holder = new THREE.Group();
    holder.position.set(station.x, 0, station.z);
    holder.rotation.y = station.rotationY ?? 0;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(STATION_RADIUS, STATION_RADIUS, 0.06, 40),
        new THREE.MeshStandardMaterial({ color: look.color, emissive: look.color, emissiveIntensity: 0.35 }));
    pad.position.y = 0.03;
    holder.add(pad);
    const stand = new THREE.Group();
    stand.position.z = -STATION_MODEL_OFFSET;
    holder.add(stand);
    if (look.pedestal > 0) {
        const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.9 * size, look.pedestal * size, 0.9 * size), new THREE.MeshStandardMaterial({ color: 0x4a3a30 }));
        pedestal.position.y = (look.pedestal * size) / 2;
        stand.add(pedestal);
    }
    void fillModel(stand, look.model, look.height * size, look.pedestal * size, false);
    const label = labelSprite(look.label.replace(/ \(.*\)/, ''), `#${look.color.toString(16).padStart(6, '0')}`);
    label.position.set(0, (look.pedestal + look.height) * size + 0.6, -STATION_MODEL_OFFSET);
    holder.add(label);
    return holder;
}

function buildProp(prop, isBuildable) {
    const holder = new THREE.Group();
    holder.position.set(prop.x, 0, prop.z);
    holder.rotation.y = prop.rotationY ?? 0;
    void fillModel(holder, prop.model, prop.height, prop.elevation ?? 0, isBuildable && !showBought, prop.stretch);
    if (isBuildable) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(BUILD_RADIUS, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: 0x8fd3ff }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.05;
        holder.add(ring);
        const tag = labelSprite(`$${Number(prop.price).toLocaleString('en-US')}\n${prop.name}`, '#ffe066');
        tag.position.y = (prop.elevation ?? 0) + prop.height + 0.7;
        holder.add(tag);
    }
    return holder;
}

/** A trophy table: the table, its zone's name and its finds along the table's long side (local X), as in HubRoom. */
function buildTable(table) {
    const holder = buildProp(table, false);
    const elevation = table.elevation ?? 0;
    const sign = labelSprite(zoneName(table.zone).toUpperCase(), '#ffd86b');
    sign.scale.multiplyScalar(0.8);
    sign.position.y = elevation + table.height + 1.05;
    holder.add(sign);
    // 3 to a row along the table; more go in a second row behind (as HubRoom).
    const finds = dig.finds.filter((find) => find.zone === table.zone);
    const rows = Math.ceil(finds.length / 3);
    const spacing = Math.min(0.85, (table.height * 3) / 3.5);
    finds.forEach((find, i) => {
        const row = Math.floor(i / 3);
        const inRow = Math.min(3, finds.length - row * 3);
        const along = ((i % 3) - (inRow - 1) / 2) * spacing;
        const depth = rows > 1 ? (row - (rows - 1) / 2) * 0.62 : 0;
        void loadModel(find.model).then((source) => {
            if (!source || !holder.parent) return;
            const model = source.clone(true);
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            model.scale.multiplyScalar(TROPHY_SIZE / Math.max(size.x, size.y, size.z, 1e-4));
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.set(along - center.x, elevation + table.height - box.min.y, depth - center.z);
            holder.add(model);
        });
    });
    return holder;
}

/** A reveal area: a tinted rectangle on the floor (colour = its rule) with an outline and its name. Scaling it
 *  with the gizmo changes its width (x) / depth (z). */
function buildArea(area) {
    const holder = new THREE.Group();
    holder.position.set(area.x, 0, area.z);
    const color = revealColor(area.reveal);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.04;
    plane.scale.set(area.width, area.depth, 1);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)), new THREE.LineBasicMaterial({ color }));
    outline.rotation.x = -Math.PI / 2;
    outline.position.y = 0.05;
    outline.scale.set(area.width, area.depth, 1);
    const label = labelSprite(`${area.name}\n${revealLabel(area.reveal)}`, `#${color.toString(16).padStart(6, '0')}`);
    label.position.y = 2.8;
    holder.add(plane, outline, label);
    return holder;
}

function addArea() {
    touch();
    const n = level.areas.length + 1;
    const previous = level.areas[level.areas.length - 1];
    level.areas.push({ id: `area-${n}`, name: `Area ${n}`, ...dropPoint(), width: 6, depth: 6, reveal: previous ? `built:${previous.id}` : 'firstUpgrade' });
    rebuildEntities();
    select({ type: 'area', index: level.areas.length - 1 });
}

/** An achievement trophy: its model and a tag naming the achievement that unlocks it. */
function buildReward(reward) {
    const holder = buildProp(reward, false);
    const achievement = achievementOf(reward.achievement);
    const tag = labelSprite(`${achievement?.decor ?? 'Trophy'}\n${achievement?.name ?? reward.achievement} max level`, '#e2a6ff');
    tag.scale.multiplyScalar(0.8);
    tag.position.y = (reward.elevation ?? 0) + reward.height + 0.6;
    holder.add(tag);
    return holder;
}

/** Adds a trophy for the first achievement without one, from the model picker. */
function addReward() {
    const used = new Set(level.achievementDecor.map((reward) => reward.achievement));
    const achievement = (dig.achievements ?? []).find((a) => !used.has(a.id)) ?? dig.achievements?.[0];
    if (!achievement) return toast('No achievements in dig.json');
    openModelPicker({
        title: `Trophy for ${achievement.name}`,
        confirmLabel: 'Place in hub',
        onPick: (path) => {
            touch();
            level.achievementDecor.push({ achievement: achievement.id, model: path, ...dropPoint(), rotationY: 0, height: 1.2, collider: { halfX: 0.5, halfY: 0.6, halfZ: 0.5 } });
            rebuildEntities();
            select({ type: 'reward', index: level.achievementDecor.length - 1 });
        },
    });
}

/** Adds a table for the first zone without one (or zone 1), styled like the existing tables. */
function addTable() {
    const used = new Set(level.trophyTables.map((table) => table.zone));
    const zone = Math.max(0, dig.zones.findIndex((_, index) => !used.has(index)));
    const like = level.trophyTables[0];
    touch();
    level.trophyTables.push({
        zone, model: like?.model ?? DEFAULT_TABLE, ...dropPoint(), rotationY: 0, height: like?.height ?? 0.8,
        collider: { halfX: 1.2, halfY: 0.4, halfZ: 0.8 },
    });
    rebuildEntities();
    select({ type: 'table', index: level.trophyTables.length - 1 });
}

function buildStart() {
    const holder = new THREE.Group();
    holder.position.set(level.start.x, 0, level.start.z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0x4fd2ff }));
    disc.position.y = 0.03;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.7, 4, 12), new THREE.MeshStandardMaterial({ color: 0x4fd2ff, transparent: true, opacity: 0.6 }));
    body.position.y = 0.6;
    const label = labelSprite('START', '#4fd2ff');
    label.position.y = 1.6;
    label.scale.multiplyScalar(0.7);
    holder.add(disc, body, label);
    return holder;
}

// ---------------------------------------------------------------- selection + gizmo

function select(sel) {
    selection = sel;
    attachGizmo();
    renderLists();
    renderInspector();
}

function attachGizmo() {
    const holder = selection ? holders.get(keyOf(selection)) : null;
    if (holder) gizmo.attach(holder);
    else gizmo.detach();
}

// toFixed drops float noise (0.69 * 1 → 0.6900000000000001) so hub.json stays readable.
const round = (value, step = 0.001) => Number((Math.round(value / step) * step).toFixed(4));

/** The gizmo moved/turned the holder: write it back into the level. */
function syncFromGizmo() {
    const data = entityData(selection);
    const holder = gizmo.object;
    if (!data || !holder) return;
    if (gizmo.getMode() === 'scale') {
        // Stations only grow evenly; pieces take each axis on its own (X = width, Y = height, Z = depth;
        // the centre handle scales all three). Folded into the data when the drag ends (commitScale).
        if (selection.type === 'station' || selection.type === 'start') {
            const factor = [holder.scale.x, holder.scale.y, holder.scale.z].reduce((best, v) => (Math.abs(v - 1) > Math.abs(best - 1) ? v : best), 1);
            holder.scale.setScalar(Math.max(0.05, factor));
        } else {
            holder.scale.set(Math.max(0.05, holder.scale.x), Math.max(0.05, holder.scale.y), Math.max(0.05, holder.scale.z));
        }
        setDirty(true);
        return;
    }
    data.x = round(holder.position.x);
    data.z = round(holder.position.z);
    if (selection.type !== 'start' && selection.type !== 'area') data.rotationY = round(holder.rotation.y, 0.0001);
    setDirty(true);
}

/** A scale drag ended: fold the holder's scale into the data (height for pieces, scale for stations) and redraw. */
function commitScale() {
    const data = entityData(selection);
    const scale = gizmo.object?.scale ?? new THREE.Vector3(1, 1, 1);
    if (data && selection.type === 'area') {
        data.width = round(Math.max(0.5, data.width * scale.x), 0.05);
        data.depth = round(Math.max(0.5, data.depth * scale.z), 0.05);
    } else if (data && selection.type !== 'station' && selection.type !== 'start' && (Math.abs(scale.x - scale.y) > 1e-3 || Math.abs(scale.z - scale.y) > 1e-3)) {
        // Height takes the Y scale (and with it the whole model grows); width/depth keep the rest as a stretch.
        stretch(data, scale.x / scale.y, scale.z / scale.y);
        resize3d(data, scale.y);
    } else if (data && Math.abs(scale.x - 1) > 1e-3) {
        resize3d(data, scale.x);
    }
    rebuildEntities();
    renderInspector();
}

/** Multiplies a piece's width/depth stretch (dropped again when it's back to 1 x 1). */
function stretch(data, x, z) {
    const next = { x: round((data.stretch?.x ?? 1) * x, 0.01), z: round((data.stretch?.z ?? 1) * z, 0.01) };
    if (Math.abs(next.x - 1) < 1e-3 && Math.abs(next.z - 1) < 1e-3) delete data.stretch;
    else data.stretch = next;
}

/** Grows/shrinks a piece by `factor`: pieces keep their size as a height, stations as a scale. */
function resize3d(data, factor) {
    if (selection.type === 'station') data.scale = round(Math.max(0.2, (data.scale ?? 1) * factor), 0.01);
    else if (selection.type !== 'start') data.height = round(Math.max(0.05, data.height * factor), 0.01);
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

function placeStation(kind) {
    const index = level.stations.findIndex((station) => station.kind === kind);
    if (index >= 0) {
        select({ type: 'station', index });
        focusSelection();
        return;
    }
    touch();
    level.stations.push({ kind, ...dropPoint(), rotationY: 0 });
    rebuildEntities();
    select({ type: 'station', index: level.stations.length - 1 });
}

const fileName = (path) => path.split('/').pop().replace(/\.(glb|gltf)$/i, '');
const titleCase = (text) => text.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function uniqueId(base) {
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'piece';
    const taken = new Set(level.buildables.map((b) => b.id));
    let id = slug;
    for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
    return id;
}

function addModel(type, path) {
    touch();
    const base = { model: path, ...dropPoint(), rotationY: 0, height: 1.2, collider: { halfX: 0.5, halfY: 0.6, halfZ: 0.5 } };
    if (type === 'buildable') {
        const name = titleCase(fileName(path));
        level.buildables.push({ id: uniqueId(name), name, price: 500, ...base });
    } else {
        level.props.push(base);
    }
    rebuildEntities();
    select({ type, index: listOf(type).length - 1 });
}

function pickModel(type) {
    openModelPicker({
        title: type === 'buildable' ? 'Model for the buildable' : 'Decoration model',
        confirmLabel: 'Place in hub',
        onPick: (path) => addModel(type, path),
    });
}

async function importFromLibrary() {
    await openLibraryPicker({
        onImported: async (path) => {
            setModelCatalog(await api('/api/models'));
            // Lands as decoration; "Make purchasable" in the inspector turns it into a buildable.
            addModel('prop', path);
            toast('Imported as decoration — "Make purchasable" in Selection to sell it. Run "npm run models" before a build.');
        },
    });
}

function duplicateSelection() {
    if (!selection || selection.type === 'start') return;
    const data = entityData(selection);
    if (selection.type === 'station') return toast('There is only one of each station.');
    touch();
    const copy = { ...structuredClone(data), x: data.x + 1, z: data.z + 1 };
    if (selection.type === 'buildable') copy.id = uniqueId(data.name);
    if (selection.type === 'area') {
        let n = level.areas.length + 1;
        while (level.areas.some((other) => other.id === `area-${n}`)) n++;
        copy.id = `area-${n}`;
        copy.name = `${data.name} copy`;
    }
    listOf(selection.type).push(copy);
    rebuildEntities();
    select({ type: selection.type, index: listOf(selection.type).length - 1 });
}

/** Switches the selected piece between decoration (always there) and buildable (the player buys it). */
function convertSelection() {
    const from = selection.type;
    const to = from === 'prop' ? 'buildable' : 'prop';
    const data = entityData(selection);
    touch();
    listOf(from).splice(selection.index, 1);
    const { id, name, price, ...piece } = data;
    if (to === 'buildable') {
        const label = titleCase(fileName(piece.model));
        listOf(to).push({ id: uniqueId(label), name: label, price: 500, ...piece });
    } else {
        listOf(to).push(piece);
    }
    rebuildEntities();
    select({ type: to, index: listOf(to).length - 1 });
}

function removeSelection() {
    if (!selection || selection.type === 'start') return;
    touch();
    listOf(selection.type).splice(selection.index, 1);
    selection = null;
    rebuildEntities();
    renderLists();
    renderInspector();
}

/** Re-derives each blocking piece's collider from its model's bounds (axis-aligned, as the game uses it). */
function refreshColliders() {
    for (const type of ['prop', 'buildable', 'table', 'reward']) {
        listOf(type).forEach((data, index) => {
            if (!data.collider) return;
            const model = holders.get(keyOf({ type, index }))?.userData.model;
            if (!model) return;
            model.updateMatrixWorld(true);
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            data.collider = { halfX: round(size.x / 2, 0.01), halfY: round(size.y / 2, 0.01), halfZ: round(size.z / 2, 0.01) };
        });
    }
}

async function save() {
    if (!level) return;
    refreshColliders();
    try {
        await api(`/api/levels/${HUB_ID}`, { method: 'PUT', body: JSON.stringify(level) });
        setDirty(false);
        toast('Hub saved — reload the game to see it.');
    } catch (error) {
        toast(`Save failed: ${error.message}`, 'bad');
    }
}

// ---------------------------------------------------------------- lists + inspector

function renderLists() {
    const buildList = host.querySelector('#hub3dBuildList');
    const total = level.buildables.reduce((sum, b) => sum + Number(b.price || 0), 0);
    host.querySelector('#hub3dBuildTotal').textContent = `${level.buildables.length} · $${total.toLocaleString('en-US')}`;
    buildList.replaceChildren(...level.buildables.map((b, index) => el('li', {
        class: selection?.type === 'buildable' && selection.index === index ? 'active' : '',
        onclick: () => { select({ type: 'buildable', index }); focusSelection(); },
    }, b.name, el('small', {}, `$${Number(b.price).toLocaleString('en-US')}`))));
    host.querySelector('#hub3dTableList').replaceChildren(...level.trophyTables.map((table, index) => el('li', {
        class: selection?.type === 'table' && selection.index === index ? 'active' : '',
        onclick: () => { select({ type: 'table', index }); focusSelection(); },
    }, zoneName(table.zone), el('small', {}, `zone ${table.zone + 1}`))));
    host.querySelector('#hub3dAreaList').replaceChildren(...level.areas.map((area, index) => el('li', {
        class: selection?.type === 'area' && selection.index === index ? 'active' : '',
        onclick: () => { select({ type: 'area', index }); focusSelection(); },
    }, area.name, el('small', {}, revealLabel(area.reveal)))));
    host.querySelector('#hub3dRewardList').replaceChildren(...level.achievementDecor.map((reward, index) => el('li', {
        class: selection?.type === 'reward' && selection.index === index ? 'active' : '',
        onclick: () => { select({ type: 'reward', index }); focusSelection(); },
    }, achievementOf(reward.achievement)?.decor ?? reward.achievement, el('small', {}, achievementOf(reward.achievement)?.name ?? ''))));
    const propList = host.querySelector('#hub3dPropList');
    propList.replaceChildren(...level.props.map((p, index) => el('li', {
        class: selection?.type === 'prop' && selection.index === index ? 'active' : '',
        onclick: () => { select({ type: 'prop', index }); focusSelection(); },
    }, titleCase(fileName(p.model)), el('small', {}, p.model.split('/').slice(0, -1).join('/')))));
}

function numberField(label, value, step, onChange) {
    const input = el('input', { type: 'number', step, value: round(value, step < 1 ? 0.001 : 1) });
    input.addEventListener('change', () => {
        const parsed = Number(input.value);
        if (Number.isFinite(parsed)) onChange(parsed);
    });
    return el('label', { class: 'field' }, el('span', {}, label), input);
}

function textField(label, value, onChange) {
    const input = el('input', { value });
    input.addEventListener('change', () => onChange(input.value.trim()));
    return el('label', { class: 'field' }, el('span', {}, label), input);
}

/** Applies an inspector edit: snapshot, change, rebuild that entity's look. */
function edit(change) {
    touch();
    change(entityData(selection));
    rebuildEntities();
    renderLists();
    renderInspector();
}

function renderInspector() {
    const box = host.querySelector('#hub3dInspector');
    const data = entityData(selection);
    if (!data) {
        box.replaceChildren(el('p', { class: 'muted' }, 'Nothing selected. Click something in the hub, or add a station, decoration or buildable on the left.'));
        return;
    }
    const type = selection.type;
    const title = type === 'station' ? STATIONS[data.kind].label : type === 'start' ? 'Player start' : type === 'buildable' ? data.name
        : type === 'table' ? `${zoneName(data.zone)} table` : type === 'area' ? data.name
            : type === 'reward' ? (achievementOf(data.achievement)?.decor ?? 'Trophy') : titleCase(fileName(data.model));
    const tag = type === 'prop' ? 'decoration' : type === 'table' ? 'trophy table' : type === 'reward' ? 'achievement' : type === 'area' ? 'reveal area' : type;
    const rows = [
        el('div', { class: 'inspector-title' }, title, el('span', { class: 'tag' }, tag)),
        numberField('X', data.x, 0.25, (v) => edit((d) => { d.x = v; })),
        numberField('Z', data.z, 0.25, (v) => edit((d) => { d.z = v; })),
    ];
    if (type === 'area') {
        const rules = [['start', 'From the start'], ['firstUpgrade', 'After the first upgrade'], ['upgrade:2', 'After the 2nd upgrade'],
            ['upgrade:3', 'After the 3rd upgrade'], ['firstFind', 'After the first find'], ['firstBuild', 'After the first buildable'],
            ['firstBuild|upgrade:2', 'After the first buildable or the 2nd upgrade'],
            ...level.areas.filter((a) => a.id !== data.id).map((a) => [`built:${a.id}`, `After "${a.name}" is fully built`])];
        if (!rules.some(([value]) => value === data.reveal)) rules.push([data.reveal, revealLabel(data.reveal)]);
        rows.push(
            textField('Name', data.name, (v) => edit((d) => { d.name = v || d.name; })),
            el('label', { class: 'field' }, el('span', {}, 'Reveal'), el('select', { onchange: (event) => edit((d) => { d.reveal = event.target.value; }) },
                ...rules.map(([value, label]) => el('option', { value, selected: value === data.reveal }, label)))),
            numberField('Width', data.width, 0.5, (v) => edit((d) => { d.width = Math.max(0.5, v); })),
            numberField('Depth', data.depth, 0.5, (v) => edit((d) => { d.depth = Math.max(0.5, v); })),
            el('div', { class: 'muted small' }, `id: ${data.id} — other areas can wait for this one to be built.`),
        );
    }
    if (type !== 'start' && type !== 'area') {
        rows.push(numberField('Turn (°)', THREE.MathUtils.radToDeg(data.rotationY ?? 0), 15, (v) => edit((d) => { d.rotationY = round(THREE.MathUtils.degToRad(v), 0.0001); })));
    }
    if (type === 'table') {
        const zoneSelect = el('select', { onchange: (event) => edit((d) => { d.zone = Number(event.target.value); }) },
            ...dig.zones.map((zone, index) => el('option', { value: index, selected: index === data.zone }, `${index + 1}. ${zone.name}`)));
        rows.push(el('label', { class: 'field' }, el('span', {}, 'Zone'), zoneSelect));
    }
    if (type === 'reward') {
        const pick = el('select', { onchange: (event) => edit((d) => { d.achievement = event.target.value; }) },
            ...(dig.achievements ?? []).map((a) => el('option', { value: a.id, selected: a.id === data.achievement }, `${a.name} → ${a.decor}`)));
        rows.push(el('label', { class: 'field' }, el('span', {}, 'Unlocked by'), pick));
    }
    if (type === 'prop' || type === 'buildable' || type === 'table' || type === 'reward') {
        rows.push(
            numberField('Height', data.height, 0.1, (v) => edit((d) => { d.height = Math.max(0.05, v); })),
            numberField('Scale (×)', 1, 0.1, (v) => { if (v > 0) edit((d) => resize3d(d, v)); }),
            numberField('Width (×)', data.stretch?.x ?? 1, 0.05, (v) => { if (v > 0) edit((d) => stretch(d, v / (d.stretch?.x ?? 1), 1)); }),
            numberField('Depth (×)', data.stretch?.z ?? 1, 0.05, (v) => { if (v > 0) edit((d) => stretch(d, 1, v / (d.stretch?.z ?? 1))); }),
            numberField('Elevation', data.elevation ?? 0, 0.1, (v) => edit((d) => { d.elevation = v || undefined; })),
            el('label', { class: 'field check' },
                el('input', { type: 'checkbox', checked: Boolean(data.collider), onchange: (event) => edit((d) => { d.collider = event.target.checked ? { halfX: 0.5, halfY: 0.5, halfZ: 0.5 } : null; }) }),
                el('span', {}, 'Blocks the miner (collider from the model bounds on save)')),
            el('div', { class: 'muted small' }, data.model),
            el('button', { onclick: () => openModelPicker({ current: data.model, title: 'Swap model', confirmLabel: 'Use model', onPick: (path) => edit((d) => { d.model = path; }) }) }, 'Swap model…'),
        );
    }
    if (type === 'buildable') {
        rows.splice(1, 0,
            textField('Name', data.name, (v) => edit((d) => { d.name = v || d.name; })),
            numberField('Price ($)', data.price, 50, (v) => edit((d) => { d.price = Math.max(0, Math.round(v)); })),
            el('div', { class: 'muted small' }, `id: ${data.id} (saves remember bought pieces by id)`));
    }
    if (type === 'station') {
        rows.push(numberField('Scale (×)', data.scale ?? 1, 0.1, (v) => edit((d) => { d.scale = round(Math.max(0.2, v), 0.01); })));
        rows.push(el('p', { class: 'muted small' }, 'The pad is where the miner stands to use it; the model stands behind the pad.'));
    }
    const actions = el('div', { class: 'row' },
        el('button', { onclick: () => focusSelection() }, 'Focus (F)'));
    if (type === 'prop' || type === 'buildable' || type === 'table' || type === 'reward' || type === 'area') actions.append(el('button', { onclick: () => duplicateSelection() }, 'Duplicate (D)'));
    const convert = type === 'prop' ? '💰 Make purchasable' : type === 'buildable' ? '🪴 Make decoration (free)' : null;
    if (type !== 'start') actions.append(el('button', { class: 'danger', onclick: () => removeSelection() }, 'Delete'));
    box.replaceChildren(...rows, actions, convert ? el('button', { class: 'block', onclick: () => convertSelection() }, convert) : '');
}
