// Town tab: builds Mow Town (levels/town.json) in a perspective view the way the game draws it — the ground and the
// pavements, the props (library models fitted to their height), the ATMs (each sells the bag and opens the shop; one
// tied to a section appears when that section opens), the sections (the districts to restore, in unlock order: their
// rect is where grass grows, their separator is the fence that keeps them closed until the previous one is restored,
// and what happens when they open), the grass patches (painted over the sections: a grass type, `auto`, or `none` to
// carve) and the grass noise (rings around a centre: the further out, the tougher the `auto` grass).
//
// The grass preview shows every cell as the game generates it (same noise, same rings, nothing under a collider or a
// pavement). Orbit with the mouse, click to select, drag the gizmo to move (W), turn (E) or scale (R). Models come from
// the game (public/mow/models) or are imported from the 3D asset library (library.js). Saves with PUT /api/town.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { api, el, toast, isModalOpen } from './shared.js';
import { openModelPicker, setModelCatalog } from './modelPicker.js';
import { openLibraryPicker } from './library.js';

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
let dirty = false;
let selection = null; // { type, index }
let snap = true;
let showGrass = true;
let gameUrl = 'http://localhost:9001/';
const undoStack = [];

let renderer;
let scene;
let camera;
let orbit;
let gizmo;
const groundGroup = new THREE.Group();
const entityGroup = new THREE.Group();
const grassGroup = new THREE.Group();
const holders = new Map(); // "type:index" -> THREE.Group
const loader = new GLTFLoader();
const modelCache = new Map();
const raycaster = new THREE.Raycaster();
let grassTimer = 0;

export const hasUnsavedTown = () => dirty;

export async function initTownTab(container, options = {}) {
    host = container;
    gameUrl = options.gameUrl ?? gameUrl;
    mow = await api('/api/mow');
    buildLayout();
    setupViewport(host.querySelector('#townViewport'));
    await reload();
}

async function reload() {
    town = await api('/api/town');
    town.props ??= [];
    town.atms ??= [];
    town.pavements ??= [];
    town.sections ??= [];
    town.grassPatches ??= [];
    town.grassNoise ??= { centre: { x: 0, z: 0 }, scale: 0.2, rings: [{ upTo: 999, mix: { grass: 1 } }] };
    selection = null;
    undoStack.length = 0;
    setDirty(false);
    rebuildAll();
}

function rebuildAll() {
    rebuildGround();
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
                    el('button', { class: 'block', onclick: () => addAtm() }, '🏧 ATM'),
                    el('button', { class: 'block', onclick: () => addPatch('auto') }, '🌿 Grass patch (noise)'),
                    el('button', { class: 'block', onclick: () => addPatch('tallgrass') }, '🌾 Dense patch (tall grass)'),
                    el('button', { class: 'block', onclick: () => addPatch('none') }, '✂ Bare patch (no grass)'),
                    el('button', { class: 'block', onclick: () => addPavement() }, '⬜ Pavement'),
                    el('button', { class: 'block', onclick: () => addSection() }, '🗺 Section (next to unlock)'))),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Sections'),
                el('p', { class: 'muted small' }, 'In unlock order: each opens when the one before is restored. Grass grows inside their rect.'),
                el('ul', { id: 'townSectionList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Grass noise'),
                el('p', { class: 'muted small' }, 'Which grass "auto" cells get: rings around the centre, tougher further out. Shares per grass type.'),
                el('div', { id: 'townNoise' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Grass patches'),
                el('ul', { id: 'townPatchList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'ATMs'),
                el('ul', { id: 'townAtmList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Pavements'),
                el('ul', { id: 'townPavementList', class: 'list' })),
            el('section', { class: 'card-section' },
                el('h2', {}, 'Props'),
                el('ul', { id: 'townPropList', class: 'list' }))),
        el('div', { class: 'stage-area' },
            el('div', { class: 'toolbar' },
                el('div', { class: 'segmented', id: 'townMode' },
                    el('button', { dataset: { mode: 'translate' }, class: 'active', onclick: () => setMode('translate') }, 'Move (W)'),
                    el('button', { dataset: { mode: 'rotate' }, onclick: () => setMode('rotate') }, 'Turn (E)'),
                    el('button', { dataset: { mode: 'scale' }, onclick: () => setMode('scale') }, 'Scale (R)')),
                el('label', {}, el('input', { type: 'checkbox', checked: snap, onchange: (event) => { snap = event.target.checked; applySnap(); } }), ' Snap'),
                el('label', {}, el('input', { type: 'checkbox', checked: showGrass, onchange: (event) => { showGrass = event.target.checked; grassGroup.visible = showGrass; } }), ' Grass preview'),
                el('span', { class: 'spacer' }),
                el('span', { id: 'townStatus' }),
                el('button', { class: 'primary', onclick: () => void save() }, '💾 Save'),
                el('button', { onclick: () => window.open(gameUrl, 'mow-game') }, '▶ Play')),
            el('div', { id: 'townViewport', style: { position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden' } }),
            el('div', { class: 'hint-bar' }, 'Left-drag: orbit · Right-drag: pan · Wheel: zoom · Click: select · W/E/R: move/turn/scale · D: duplicate · Del: remove · F: focus · Ctrl+Z: undo · Ctrl+S: save')),
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
    undoStack.push(JSON.stringify(town));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    setDirty(true);
}

function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    town = { ...JSON.parse(previous), _version: town._version };
    if (selection && !entityData(selection)) selection = null;
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
    scene.add(sun, groundGroup, grassGroup, entityGroup);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 800);
    camera.position.set(0, 34, 30);
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, -6);
    orbit.maxPolarAngle = Math.PI / 2 - 0.05;
    orbit.update();

    gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', (event) => {
        orbit.enabled = !event.value;
        if (event.value) touch();
        else if (gizmo.getMode() === 'scale') commitScale();
        else afterMove();
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
    } else if (key === 'w') setMode('translate');
    else if (key === 'e') setMode('rotate');
    else if (key === 'r') setMode('scale');
    else if (key === 'd' && selection) duplicateSelection();
    else if ((key === 'delete' || key === 'backspace') && selection) removeSelection();
    else if (key === 'escape') select(null);
    else if (key === 'f' && selection) focusSelection();
}

/** Flat things (sections, pavements, patches) lose to anything standing on them. */
const FLAT_TYPES = new Set(['section', 'pavement', 'patch']);

function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const entities = raycaster.intersectObjects(entityGroup.children, true).filter((entry) => entry.object.visible).map((entry) => {
        let node = entry.object;
        while (node && !node.userData.entity) node = node.parent;
        return node?.userData.entity;
    }).filter(Boolean);
    // A patch over a section wins over the section; anything standing wins over both.
    select(entities.find((e) => !FLAT_TYPES.has(e.type)) ?? entities.find((e) => e.type === 'patch') ?? entities[0] ?? null);
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

function rebuildGround() {
    groundGroup.clear();
    const ground = town.ground;
    if (ground) {
        const mesh = plane(ground.width, ground.depth, ground.color, -0.05);
        mesh.position.x = ground.x;
        mesh.position.z = ground.z;
        groundGroup.add(mesh);
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

/** What blocks grass (Town.isBlocked): pavements, prop colliders, ATM boxes, all padded. */
function blockers() {
    const boxes = town.pavements.map((p) => ({ x: p.x, z: p.z, halfX: p.width / 2, halfZ: p.depth / 2 }));
    for (const prop of town.props) if (prop.collider) boxes.push({ x: prop.x, z: prop.z, halfX: prop.collider.halfX, halfZ: prop.collider.halfZ });
    for (const atm of town.atms) boxes.push(atmBox(atm));
    return boxes;
}

function atmBox(atm) {
    const look = town.atm;
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
                const type = kind === 'auto' ? autoType(x, z, noise) : Math.max(0, mow.grass.findIndex((gr) => gr.id === kind));
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
const LISTS = { prop: 'props', atm: 'atms', pavement: 'pavements', section: 'sections', patch: 'grassPatches' };
const listOf = (type) => (LISTS[type] ? town[LISTS[type]] : null);
const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;
const grassColor = (id) => (id === 'none' ? '#c9b48a' : id === 'auto' ? '#9be37a' : (mow.grass.find((g) => g.id === id)?.color ?? '#5cbf4a'));
const grassName = (id) => (id === 'none' ? 'no grass' : id === 'auto' ? 'noise' : (mow.grass.find((g) => g.id === id)?.name ?? id));

function entityData(sel) {
    if (!sel) return null;
    if (sel.type === 'start') return town.start;
    if (sel.type === 'centre') return town.grassNoise.centre;
    if (sel.type === 'separator') return town.sections[sel.index]?.separator ?? null;
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
        if (section.separator) addHolder({ type: 'separator', index }, buildSeparator(section.separator, index));
    });
    town.grassPatches.forEach((patch, index) => addHolder({ type: 'patch', index }, buildPatch(patch)));
    town.props.forEach((prop, index) => addHolder({ type: 'prop', index }, buildProp(prop)));
    town.atms.forEach((atm, index) => addHolder({ type: 'atm', index }, buildAtm(atm)));
    addHolder({ type: 'start', index: 0 }, buildStart());
    addHolder({ type: 'centre', index: 0 }, buildCentre());
    attachGizmo();
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

function buildSection(section, index) {
    const holder = new THREE.Group();
    holder.position.set(section.x, 0, section.z);
    const color = SECTION_COLORS[index % SECTION_COLORS.length];
    const fill = plane(section.width, section.depth, section.ground ?? '#4f7d35', 0.01);
    const edge = outline(color);
    edge.scale.set(section.width, section.depth, 1);
    edge.position.y = 0.08;
    const label = labelSprite(`${index + 1}. ${section.name}\n$${section.bonus} bonus · grass: ${grassName(section.fill ?? 'auto')}`, hex(color));
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

function buildAtm(atm) {
    const look = town.atm;
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
    const label = labelSprite(section ? `ATM\nappears with ${section.name}` : 'ATM', '#3fd16b');
    label.position.set(0, look.label, -look.back);
    holder.add(label);
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

// toFixed drops float noise (0.69 * 1 → 0.6900000000000001) so town.json stays readable.
const round = (value, step = 0.001) => Number((Math.round(value / step) * step).toFixed(4));
/** Things that turn (the rest only move / resize). */
const TURNS = new Set(['prop', 'atm', 'patch', 'separator']);
/** Things whose size is width x depth (scaling changes those, not a height). */
const SIZED = new Set(['pavement', 'section', 'patch']);

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
        separator: { x, z: z + depth / 2, width, rotationY: 0 }, onUnlock: { pan: true },
    });
    added('section');
    focusSelection();
}

function duplicateSelection() {
    if (!selection || !LISTS[selection.type] || selection.type === 'section') return;
    const data = entityData(selection);
    touch();
    const copy = { ...structuredClone(data), x: data.x + 1, z: data.z + 1 };
    if (selection.type === 'pavement') copy.id = `${data.id}-copy`;
    listOf(selection.type).push(copy);
    added(selection.type);
}

function removeSelection() {
    if (!selection || selection.type === 'start' || selection.type === 'centre') return;
    touch();
    if (selection.type === 'separator') delete town.sections[selection.index].separator;
    else listOf(selection.type).splice(selection.index, 1);
    selection = null;
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
    if (!town) return;
    refreshColliders();
    try {
        const saved = await api('/api/town', { method: 'PUT', body: JSON.stringify(town) });
        town._version = saved.version;
        setDirty(false);
        toast('Town saved — reload the game to see it.');
    } catch (error) {
        toast(`Save failed: ${error.message}`, 'bad');
    }
}

// ---------------------------------------------------------------- lists + inspector

function listItem(type, index, label, small) {
    return el('li', {
        class: selection?.type === type && selection.index === index ? 'active' : '',
        onclick: () => { select({ type, index }); focusSelection(); },
    }, label, small ? el('small', {}, small) : '');
}

function renderLists() {
    host.querySelector('#townSectionList').replaceChildren(...town.sections.map((s, i) => listItem('section', i, `${i + 1}. ${s.name}`, `$${s.bonus}`)));
    host.querySelector('#townPatchList').replaceChildren(...town.grassPatches.map((p, i) => listItem('patch', i, `${p.shape === 'round' ? '⬭' : '▭'} ${grassName(p.grass)}`, `${p.width}×${p.depth}`)));
    host.querySelector('#townAtmList').replaceChildren(...town.atms.map((a, i) => listItem('atm', i, `ATM ${i + 1}`, town.sections.find((s) => s.id === a.section)?.name ?? 'always')));
    host.querySelector('#townPavementList').replaceChildren(...town.pavements.map((p, i) => listItem('pavement', i, p.id, `${p.width}×${p.depth}`)));
    host.querySelector('#townPropList').replaceChildren(...town.props.map((p, i) => listItem('prop', i, titleCase(fileName(p.model)), p.model.split('/').slice(0, -1).join('/'))));
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
        prop: () => titleCase(fileName(data.model)), atm: () => `ATM ${selection.index + 1}`, pavement: () => data.id,
        section: () => data.name, patch: () => `Grass patch: ${grassName(data.grass)}`, start: () => 'Player start',
        centre: () => 'Grass noise centre', separator: () => `${town.sections[selection.index].name} separator`,
    };
    const rows = [
        el('div', { class: 'inspector-title' }, titles[type](), el('span', { class: 'tag' }, type)),
        numberField('X', data.x, 0.25, (v) => edit((d) => { d.x = v; })),
        numberField('Z', data.z, 0.25, (v) => edit((d) => { d.z = v; })),
    ];
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
            selectField('Appears', data.section ?? '', [['', 'From the start'], ...town.sections.map((s) => [s.id, `When ${s.name} opens`])], (v) => edit((d) => { if (v) d.section = v; else delete d.section; })),
            el('p', { class: 'muted small' }, 'Standing on the pad sells the bag and opens the shop. The machine stands behind the pad.'));
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
    if (type === 'section') {
        const index = selection.index;
        rows.push(
            textField('Name', data.name, (v) => edit((d) => { d.name = v || d.name; })),
            textField('Id', data.id, (v) => edit((d) => {
                const old = d.id;
                d.id = v || d.id;
                town.atms.forEach((a) => { if (a.section === old) a.section = d.id; });
            })),
            selectField('Grass', data.fill ?? 'auto', grassOptions(true), (v) => edit((d) => { d.fill = v; })),
            numberField('Bonus ($)', data.bonus, 50, (v) => edit((d) => { d.bonus = Math.max(0, Math.round(v)); })),
            numberField('Restored at (0-1)', data.completeAt, 0.01, (v) => edit((d) => { d.completeAt = Math.min(1, Math.max(0.5, v)); })),
            textField('Ground', data.ground, (v) => edit((d) => { d.ground = v; }), 'color'),
            textField('Restored ground', data.restoredGround, (v) => edit((d) => { d.restoredGround = v; }), 'color'),
            index > 0 ? checkField('When it opens, the camera glides over to show it', Boolean(data.onUnlock?.pan), (on) => edit((d) => { d.onUnlock = { ...(d.onUnlock ?? {}), pan: on }; })) : el('p', { class: 'muted small' }, 'Open from the start.'),
            index > 0 ? (data.separator
                ? el('button', { class: 'block', onclick: () => select({ type: 'separator', index }) }, '🚧 Select its separator')
                : el('button', { class: 'block', onclick: () => edit((d) => { d.separator = { x: d.x, z: d.z + d.depth / 2, width: d.width, rotationY: 0 }; }) }, '🚧 Add a separator')) : '',
            el('div', { class: 'row' },
                el('button', { onclick: () => moveSection(index, -1) }, '▲ Earlier'),
                el('button', { onclick: () => moveSection(index, 1) }, '▼ Later')),
            el('p', { class: 'muted small' }, 'Opens when the section before it is restored: its separator sinks, its ATMs pop in.'));
    }
    if (type === 'separator') {
        rows.push(el('p', { class: 'muted small' }, 'The fence (with its sign) that keeps the section closed. Scale X / Length sets how long it is.'));
    }
    if (type === 'centre') {
        rows.push(el('p', { class: 'muted small' }, 'Rings are measured from here: the rings and their mixes are in "Grass noise" on the left.'));
    }
    const actions = el('div', { class: 'row' }, el('button', { onclick: () => focusSelection() }, 'Focus (F)'));
    if (LISTS[type] && type !== 'section') actions.append(el('button', { onclick: () => duplicateSelection() }, 'Duplicate (D)'));
    if (type !== 'start' && type !== 'centre') actions.append(el('button', { class: 'danger', onclick: () => removeSelection() }, 'Delete'));
    box.replaceChildren(...rows, actions);
}
