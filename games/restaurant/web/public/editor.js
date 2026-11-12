// Restaurant layout editor: levels/restaurant.json in 3D, the way the game builds it (games/restaurant/game/world/
// RestaurantLayout.ts + core/rooms): checker floors, walls with their openings (windows, doors — sliding glass ones —
// and gaps) in their two-band colours, props, the stations (the burger station's pieces: counters, cooktop, pan, plate,
// serve spot, customer spot, ingredient piles, decoration) and each station's camera shots (order / bench), plus the
// customers' way in. A stage picker shows what's there at each stage (`from` / `until`).
//
// Orbit with the mouse, click to select, drag the gizmo to move (W), turn (E) or size (R). Station cameras: Look
// through, frame the shot inside the gold 720 x 1080 frame (the game's screen), Use this view. Save writes the file; the
// game (Vite) reloads with it.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createGLTFLoader } from './gltf.js';
import { api, el, toast, isModalOpen } from './shared.js';
import { openModelPicker, setModelCatalog } from './modelPicker.js';
import { openLibraryPicker } from './library.js';

// Mirrors the game (Kitchen.ts's LAYOUT / STOVE_SINK, RestaurantLayout.ts's SHOT_ASPECT), so the editor shows what it builds.
const SHOT_ASPECT = 720 / 1080;
const BENCH_TOP = 1;
const STOVE_TOP = 1.21;
const SIZES = { food: 0.5, pan: 0.75, dish: 0.72, pileDish: 0.6 };
const PILE_MODELS = {
    bunBottom: 'food_ingredient_bun_bottom', bunTop: 'food_ingredient_bun_top', patty: 'food_ingredient_burger_uncooked',
    cheese: 'food_ingredient_cheese_slice', lettuce: 'food_ingredient_lettuce_slice', tomato: 'food_ingredient_tomato_slice',
};
const ROLES = ['counter', 'stove', 'pan', 'plate', 'served', 'customer', 'pile', 'decor'];
const OPENING_KINDS = ['window', 'door', 'gap'];
const SNAP = 0.25;
const ROTATE_SNAP = THREE.MathUtils.degToRad(15);
const UNDO_LIMIT = 80;
const EDITOR_FOV = 45;

/** A layout model name as a path under models/ (a bare name is a kitchen model), and back. */
const modelPath = (name) => (name.includes('/') ? name : `kitchen/${name}.gltf`);
const modelName = (path) => (path.startsWith('kitchen/') && path.endsWith('.gltf') ? path.slice('kitchen/'.length, -'.gltf'.length) : path);

let layout;
let version = 0;
let stage = 0;
let stageNames = [];
let selection = null;
let dirty = false;
let snap = true;
let gameUrl = 'http://localhost:9001/?dev=1';
const undoStack = [];
/** Looking through a station camera: { station, key }. */
let looking = null;

let renderer;
let scene;
let camera;
let orbit;
let gizmo;
const world = new THREE.Group();
const loader = createGLTFLoader();
const modelCache = new Map();
/** Everything clickable: its selection key -> object. */
const pickables = new Map();
const viewport = document.getElementById('layoutViewport');

// ---------------------------------------------------------------- start

async function start() {
    const config = await api('/api/config').catch(() => ({}));
    gameUrl = config.gameUrl ?? gameUrl;
    setModelCatalog(await api('/api/models'));
    setupViewport();
    bindUi();
    await reload();
}

async function reload() {
    const result = await api('/api/layout');
    layout = result.layout;
    version = result.version;
    stageNames = layout.stages ?? ['Stage 1'];
    const stageSelect = document.getElementById('stage');
    stageSelect.replaceChildren(...stageNames.map((name, i) => el('option', { value: i }, `${i + 1}: ${name}`)));
    stageSelect.value = String(stage);
    selection = null;
    setDirty(false);
    rebuild();
    renderStyles();
}

function setDirty(value) {
    dirty = value;
    const status = document.getElementById('status');
    status.textContent = dirty ? '● unsaved' : 'saved';
    status.className = dirty ? 'dirty' : '';
}

/** Every change goes through here: undo point, the change, then everything's shown again. */
function edit(change, { rebuildScene = true } = {}) {
    undoStack.push(JSON.stringify(layout));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    change();
    setDirty(true);
    if (rebuildScene) rebuild();
    else renderPanels();
}

function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    layout = JSON.parse(previous);
    setDirty(true);
    rebuild();
    renderStyles();
}

async function save() {
    try {
        const result = await api('/api/layout', { method: 'PUT', body: JSON.stringify({ layout, version }) });
        version = result.version;
        setDirty(false);
        toast('Saved — the game reloads with it', 'good');
    } catch (error) {
        toast(`Save failed: ${error.message}`, 'bad');
    }
}

// ---------------------------------------------------------------- viewport

function setupViewport() {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.shadowMap.enabled = true;
    viewport.prepend(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xbfe3f2);
    scene.add(new THREE.HemisphereLight(0xfff6ea, 0xd9b08a, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-4, 12, -6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
    scene.add(sun, world);
    const grid = new THREE.GridHelper(40, 40, 0x000000, 0x000000);
    grid.material.opacity = 0.08;
    grid.material.transparent = true;
    grid.position.y = 0.02;
    scene.add(grid);

    camera = new THREE.PerspectiveCamera(EDITOR_FOV, 1, 0.1, 400);
    camera.position.set(0, 14, -14);
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0, 2);
    orbit.update();

    gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.addEventListener('dragging-changed', (event) => {
        orbit.enabled = !event.value;
        if (event.value) {
            undoStack.push(JSON.stringify(layout));
        } else {
            setDirty(true);
            rebuild();
        }
    });
    gizmo.addEventListener('objectChange', syncFromGizmo);
    scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);
    applySnap();

    // A click (not a drag) selects.
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (event) => (down = { x: event.clientX, y: event.clientY }));
    renderer.domElement.addEventListener('pointerup', (event) => {
        if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4 || gizmo.dragging) return;
        pickAt(event);
    });
    new ResizeObserver(resize).observe(viewport);
    window.addEventListener('keydown', onKey);
    resize();
    renderer.setAnimationLoop(() => {
        orbit.update();
        renderer.render(scene, camera);
    });
}

function resize() {
    const { width, height } = viewport.getBoundingClientRect();
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    camera.aspect = Math.max(1, width) / Math.max(1, height);
    camera.updateProjectionMatrix();
}

function applySnap() {
    gizmo.setTranslationSnap(snap ? SNAP : null);
    gizmo.setRotationSnap(snap ? ROTATE_SNAP : null);
}

function setMode(mode) {
    gizmo.setMode(mode);
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    attachGizmo();
}

function onKey(event) {
    if (isModalOpen() || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') { event.preventDefault(); void save(); return; }
    if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); undo(); return; }
    if (key === 'w') setMode('translate');
    else if (key === 'e') setMode('rotate');
    else if (key === 'r') setMode('scale');
    else if (key === 'f') focusSelection();
    else if (key === 'd') duplicateSelection();
    else if (key === 'delete' || key === 'backspace') removeSelection();
    else if (key === 'escape') { if (looking) exitLook(); else select(null); }
}

function pickAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...pickables.values()], true);
    for (const hit of hits) {
        let object = hit.object;
        while (object && !object.userData.sel) object = object.parent;
        if (object?.userData.sel) {
            select(object.userData.sel);
            return;
        }
    }
    select(null);
}

// ---------------------------------------------------------------- stages

const shownAt = (item) => (item.from === undefined || stage >= item.from) && (item.until === undefined || stage < item.until);
const keyOf = (sel) => (sel ? [sel.type, sel.i, sel.j, sel.key, sel.part].filter((v) => v !== undefined).join(':') : '');

// ---------------------------------------------------------------- building the scene

function loadModel(name) {
    const path = modelPath(name);
    if (!modelCache.has(path)) {
        modelCache.set(path, loader.loadAsync(`/models/${path}`).then((gltf) => {
            gltf.scene.traverse((child) => {
                if (child.isMesh) child.castShadow = child.receiveShadow = true;
            });
            return gltf.scene;
        }).catch((error) => {
            console.warn('model', path, error);
            return null;
        }));
    }
    return modelCache.get(path);
}

/** A model into `holder` once it's loaded: fitted (height or scale), its bottom at `y`. */
async function fillModel(holder, name, { height, scale = 1, y = 0 } = {}) {
    const source = await loadModel(name);
    if (!source || !holder.parent) return;
    const model = source.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const factor = height !== undefined && size.y > 1e-4 ? height / size.y : scale;
    model.scale.multiplyScalar(factor);
    model.position.y = y - box.min.y * factor;
    holder.add(model);
}

function labelSprite(text, color = '#ffffff', background = 'rgba(20,24,32,0.85)') {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = 'bold 34px sans-serif';
    canvas.width = Math.ceil(context.measureText(text).width) + 28;
    canvas.height = 52;
    context.font = 'bold 34px sans-serif';
    context.fillStyle = background;
    context.beginPath();
    context.roundRect(0, 0, canvas.width, canvas.height, 14);
    context.fill();
    context.fillStyle = color;
    context.textBaseline = 'middle';
    context.fillText(text, 14, canvas.height / 2 + 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(canvas.width / 110, canvas.height / 110, 1);
    sprite.renderOrder = 10;
    return sprite;
}

function register(sel, object) {
    object.userData.sel = sel;
    pickables.set(keyOf(sel), object);
    world.add(object);
    return object;
}

function rebuild() {
    gizmo.detach();
    world.traverse((child) => {
        if (child.isMesh && child.geometry && !child.userData.shared) child.geometry.dispose();
    });
    world.clear();
    pickables.clear();
    layout.floors.forEach((floor, i) => shownAt(floor) && buildFloor(floor, i));
    layout.walls.forEach((wall, i) => shownAt(wall) && buildWall(wall, i));
    layout.props.forEach((prop, i) => shownAt(prop) && buildProp(prop, i));
    layout.stations.forEach((station, i) => shownAt(station) && buildStation(station, i));
    buildPath();
    if (selection && !pickables.has(keyOf(selection))) selection = null;
    attachGizmo();
    renderPanels();
}

// Floors: a checker plane, world-anchored like the game's (two rects side by side line up).
const checkerCache = new Map();
function checkerTexture(colorA, colorB) {
    const key = `${colorA}|${colorB}`;
    if (!checkerCache.has(key)) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 2;
        const context = canvas.getContext('2d');
        context.fillStyle = colorA;
        context.fillRect(0, 0, 2, 2);
        context.fillStyle = colorB;
        context.fillRect(1, 0, 1, 1);
        context.fillRect(0, 1, 1, 1);
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        checkerCache.set(key, texture);
    }
    return checkerCache.get(key);
}

function buildFloor(floor, i) {
    const style = layout.styles.floors[floor.style] ?? Object.values(layout.styles.floors)[0];
    const period = (floor.tileSize ?? 1) * (style?.scale ?? 1) * 2;
    const texture = checkerTexture(style?.colorA ?? '#ddd', style?.colorB ?? '#bbb').clone();
    texture.needsUpdate = true;
    texture.repeat.set(floor.width / period, floor.depth / period);
    texture.offset.set((floor.x - floor.width / 2) / period, -(floor.z + floor.depth / 2) / period);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(floor.width, floor.depth), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    const holder = new THREE.Group();
    holder.position.set(floor.x, floor.elevation ?? 0, floor.z);
    holder.rotation.y = floor.rotationY ?? 0;
    holder.add(mesh);
    register({ type: 'floor', i }, holder);
}

// Walls: each segment as boxes round its openings, in its two colour bands; windows get glass, doors a glass leaf.
function openingRange(a, b, opening) {
    // Where along a -> b (0..1) the segment runs inside the opening's rect (slab clipping).
    let t0 = 0;
    let t1 = 1;
    const d = { x: b.x - a.x, z: b.z - a.z };
    for (const [p, dp, min, max] of [[a.x, d.x, opening.minX, opening.maxX], [a.z, d.z, opening.minZ, opening.maxZ]]) {
        if (Math.abs(dp) < 1e-9) {
            if (p < min || p > max) return null;
        } else {
            let u0 = (min - p) / dp;
            let u1 = (max - p) / dp;
            if (u0 > u1) [u0, u1] = [u1, u0];
            t0 = Math.max(t0, u0);
            t1 = Math.min(t1, u1);
        }
    }
    return t1 > t0 ? [t0, t1] : null;
}

function holeHeights(opening, setup) {
    if (opening.kind === 'gap') return [0, setup.height];
    if (opening.kind === 'door') return [0, opening.fitToCeiling ? setup.height : Math.min(opening.high ? setup.tallDoorHeight : setup.doorHeight, setup.height)];
    const windowHeight = Math.min(setup.windowHeight, setup.height);
    const bottom = (setup.height - windowHeight) / 2;
    return [bottom, bottom + windowHeight];
}

function buildWall(wall, i) {
    const setup = layout.setups[wall.setup] ?? Object.values(layout.setups)[0];
    const style = layout.styles.walls[wall.style] ?? Object.values(layout.styles.walls)[0];
    const holder = new THREE.Group();
    const bottomMaterial = new THREE.MeshStandardMaterial({ color: style.bottomColor, roughness: 0.8 });
    const topMaterial = new THREE.MeshStandardMaterial({ color: style.topColor, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.3, depthWrite: false });
    const points = wall.points;
    const count = wall.closed ? points.length : points.length - 1;
    const box = (a, dir, length, u0, u1, y0, y1, material) => {
        if (u1 - u0 < 1e-3 || y1 - y0 < 1e-3) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(u1 - u0, y1 - y0, setup.thickness), material);
        const mid = (u0 + u1) / 2;
        mesh.position.set(a.x + dir.x * mid, (y0 + y1) / 2, a.z + dir.z * mid);
        mesh.rotation.y = Math.atan2(-dir.z, dir.x);
        mesh.castShadow = mesh.receiveShadow = true;
        holder.add(mesh);
    };
    for (let s = 0; s < count; s++) {
        const a = points[s];
        const b = points[(s + 1) % points.length];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 1e-4) continue;
        const dir = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
        // Overlapping the corners by half a thickness closes them.
        const reach = setup.thickness / 2;
        const holes = [];
        for (const opening of wall.openings ?? []) {
            const range = openingRange(a, b, opening);
            if (range) holes.push({ u0: range[0] * length, u1: range[1] * length, ys: holeHeights(opening, setup), opening });
        }
        const cuts = [...new Set([-reach, length + reach, ...holes.flatMap((h) => [h.u0, h.u1])])].sort((p, q) => p - q);
        for (let k = 0; k < cuts.length - 1; k++) {
            const u0 = cuts[k];
            const u1 = cuts[k + 1];
            const mid = (u0 + u1) / 2;
            const covering = holes.filter((h) => mid > h.u0 && mid < h.u1);
            // The solid y ranges left once the holes over this stretch are taken out.
            let solid = [[0, setup.height]];
            for (const hole of covering) {
                solid = solid.flatMap(([y0, y1]) => [[y0, Math.min(y1, hole.ys[0])], [Math.max(y0, hole.ys[1]), y1]]).filter(([y0, y1]) => y1 - y0 > 1e-3);
            }
            for (const [y0, y1] of solid) {
                const split = Math.min(Math.max(style.bottomHeight, y0), y1);
                box(a, dir, length, u0, u1, y0, split, bottomMaterial);
                box(a, dir, length, u0, u1, split, y1, topMaterial);
            }
            for (const hole of covering) {
                if (hole.opening.kind === 'window') box(a, dir, length, u0, u1, hole.ys[0], hole.ys[1], glass);
            }
        }
        // A door's leaf: a glass panel standing in the doorway (it slides open in the game).
        for (const hole of holes.filter((h) => h.opening.kind === 'door')) {
            const doorStyle = layout.styles.doors?.[hole.opening.style] ?? { color: '#9fd8ff', opacity: 0.35 };
            const leaf = new THREE.MeshStandardMaterial({ color: doorStyle.color, transparent: doorStyle.opacity < 1, opacity: doorStyle.opacity, depthWrite: doorStyle.opacity >= 1 });
            box(a, dir, length, hole.u0, hole.u1, 0.02, hole.ys[1] - 0.03, leaf);
        }
    }
    register({ type: 'wall', i }, holder);
    // The selected wall's corners: handles to drag.
    if (selection?.type === 'wall' && selection.i === i || selection?.type === 'point' && selection.i === i) {
        points.forEach((point, j) => {
            const handle = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd36b, depthTest: false }));
            handle.renderOrder = 5;
            handle.position.set(point.x, setup.height + 0.3, point.z);
            const group = new THREE.Group();
            group.add(handle);
            register({ type: 'point', i, j }, group);
        });
    }
}

function buildProp(prop, i) {
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.set(prop.stretch?.x ?? 1, 1, prop.stretch?.z ?? 1);
    holder.add(inner);
    holder.position.set(prop.x, prop.elevation ?? 0, prop.z);
    holder.rotation.y = prop.rotationY ?? 0;
    register({ type: 'prop', i }, holder);
    void fillModel(inner, prop.model, { height: prop.height, scale: prop.scale ?? 1 });
}

/** A station: its spot (a marker to drag the whole station by), its pieces, its camera shots. */
function buildStation(station, i) {
    const marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 32), new THREE.MeshBasicMaterial({ color: 0x4c8dff, side: THREE.DoubleSide, depthTest: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;
    const label = labelSprite(station.name ?? station.id, '#9cc2ff');
    label.position.y = 3.2;
    marker.add(ring, label);
    marker.position.set(station.x, 0.03, station.z);
    register({ type: 'station', i }, marker);
    station.pieces.forEach((piece, j) => buildPiece(station, piece, i, j));
    for (const key of ['order', 'bench']) buildCamera(station, i, key);
}

function buildPiece(station, piece, i, j) {
    const holder = new THREE.Group();
    holder.position.set(station.x + piece.x, 0, station.z + piece.z);
    holder.rotation.y = piece.rotationY ?? 0;
    register({ type: 'piece', i, j }, holder);
    const role = piece.role;
    if ((role === 'counter' || role === 'decor' || role === 'stove') && piece.model) {
        const y = role === 'counter' ? 0 : role === 'stove' ? BENCH_TOP - 0.07 : BENCH_TOP;
        void fillModel(holder, piece.model, { y });
    } else if (role === 'pan') {
        void fillModel(holder, 'pan_A', { scale: SIZES.pan, y: STOVE_TOP });
    } else if (role === 'plate') {
        void fillModel(holder, 'plate', { scale: SIZES.dish, y: BENCH_TOP });
    } else if (role === 'pile') {
        void fillModel(holder, 'plate', { scale: SIZES.pileDish, y: BENCH_TOP });
        const food = PILE_MODELS[piece.piece];
        if (food) for (let k = 0; k < 3; k++) void fillModel(holder, food, { scale: SIZES.food, y: BENCH_TOP + 0.03 + k * 0.09 });
    } else if (role === 'served') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 24), new THREE.MeshBasicMaterial({ color: 0x35b36a }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = BENCH_TOP + 0.03;
        const tag = labelSprite('served', '#8be0a8');
        tag.position.y = BENCH_TOP + 0.5;
        holder.add(ring, tag);
    } else if (role === 'customer') {
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.6, 4, 12), new THREE.MeshStandardMaterial({ color: 0xf39a2d, transparent: true, opacity: 0.55 }));
        body.position.y = 1.15;
        const tag = labelSprite('customer', '#ffd39a');
        tag.position.y = 2.7;
        holder.add(body, tag);
    }
    if (!holder.children.length || role === 'stove' || role === 'counter' || role === 'decor') {
        // Something to click while the model loads (or a piece without one).
        const stub = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ visible: false }));
        stub.position.y = BENCH_TOP;
        holder.add(stub);
    }
}

/** A camera shot: a little camera (its frustum lines) at its position, a ball at its target. */
function buildCamera(station, i, key) {
    const shot = station.cameras?.[key];
    if (!shot) return;
    const color = key === 'order' ? 0xffd36b : 0xff7ad9;
    const position = new THREE.Vector3(shot.position.x, shot.position.y, shot.position.z);
    const target = new THREE.Vector3(shot.target.x, shot.target.y, shot.target.z);
    const lens = new THREE.PerspectiveCamera(shot.fov, SHOT_ASPECT, 0.3, Math.max(1, position.distanceTo(target)));
    lens.position.copy(position);
    lens.lookAt(target);
    lens.updateMatrixWorld();
    const helper = new THREE.CameraHelper(lens);
    helper.setColors(new THREE.Color(color), new THREE.Color(color), new THREE.Color(color), new THREE.Color(color), new THREE.Color(color));
    world.add(helper);
    const body = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), new THREE.MeshBasicMaterial({ color }));
    const tag = labelSprite(`${key} camera`, '#111', key === 'order' ? '#ffd36b' : '#ff9ae4');
    tag.position.y = 0.6;
    body.add(box, tag);
    body.position.copy(position);
    register({ type: 'camera', i, key, part: 'position' }, body);
    const aim = new THREE.Group();
    aim.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false })));
    aim.children[0].renderOrder = 5;
    aim.position.copy(target);
    register({ type: 'camera', i, key, part: 'target' }, aim);
}

/** The customers' way in: outside and just inside the door. */
function buildPath() {
    for (const key of ['outside', 'inside']) {
        const point = layout.customer?.[key];
        if (!point) continue;
        const group = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 24), new THREE.MeshBasicMaterial({ color: 0xf39a2d }));
        const tag = labelSprite(`way in: ${key}`, '#ffd39a');
        tag.position.y = 0.8;
        group.add(disc, tag);
        group.position.set(point.x, 0.05, point.z);
        register({ type: 'path', key }, group);
    }
}

// ---------------------------------------------------------------- selection + gizmo

function dataOf(sel) {
    if (!sel) return null;
    if (sel.type === 'floor') return layout.floors[sel.i];
    if (sel.type === 'wall' || sel.type === 'point') return layout.walls[sel.i];
    if (sel.type === 'prop') return layout.props[sel.i];
    if (sel.type === 'station') return layout.stations[sel.i];
    if (sel.type === 'piece') return layout.stations[sel.i]?.pieces[sel.j];
    if (sel.type === 'camera') return layout.stations[sel.i]?.cameras[sel.key];
    if (sel.type === 'path') return layout.customer[sel.key];
    return null;
}

const wallOf = (sel) => (sel?.type === 'wall' || sel?.type === 'point' ? sel.i : null);

function select(sel) {
    // A wall's corner handles show while it (or one of its corners) is selected: built again when that changes.
    const wallChanged = wallOf(selection) !== wallOf(sel);
    selection = sel;
    // A wall's corner handles show while it (or a corner) is selected.
    if (wallChanged) rebuild();
    else {
        attachGizmo();
        renderPanels();
    }
}

function attachGizmo() {
    gizmo.detach();
    const object = selection && pickables.get(keyOf(selection));
    if (!object) return;
    const mode = gizmo.mode;
    const type = selection.type;
    // What each thing can do: turning (props, pieces, floors), sizing (props).
    const turns = ['prop', 'piece', 'floor'].includes(type);
    const sizes = type === 'prop';
    if ((mode === 'rotate' && !turns) || (mode === 'scale' && !sizes)) return;
    gizmo.attach(object);
    // Turning: round the vertical only. Moving: on the floor, but cameras and props (lifted off it) go up too.
    gizmo.showX = gizmo.showZ = mode !== 'rotate';
    gizmo.showY = mode !== 'translate' || type === 'camera' || type === 'prop';
}

const round = (value) => Math.round(value * 1000) / 1000;

/** The gizmo moved something: into the data (walls redraw as they go). */
function syncFromGizmo() {
    const object = gizmo.object;
    const sel = selection;
    if (!object || !sel) return;
    const data = dataOf(sel);
    const p = object.position;
    if (sel.type === 'floor') {
        data.x = round(p.x);
        data.z = round(p.z);
        data.rotationY = round(object.rotation.y);
    } else if (sel.type === 'prop') {
        data.x = round(p.x);
        data.z = round(p.z);
        data.rotationY = round(object.rotation.y);
        if (Math.abs(p.y) > 1e-3 || data.elevation !== undefined) data.elevation = round(p.y);
        if (gizmo.mode === 'scale') {
            // Sizing: uniform (its height), and stretch across / along.
            const s = object.scale;
            const inner = object.children[0];
            const box = new THREE.Box3().setFromObject(inner);
            const size = box.getSize(new THREE.Vector3());
            if (Math.abs(s.y - 1) > 1e-3) data.height = round(size.y);
            if (Math.abs(s.x - s.y) > 1e-3 || Math.abs(s.z - s.y) > 1e-3) data.stretch = { x: round((data.stretch?.x ?? 1) * s.x / s.y), z: round((data.stretch?.z ?? 1) * s.z / s.y) };
        }
    } else if (sel.type === 'station') {
        data.x = round(p.x);
        data.z = round(p.z);
    } else if (sel.type === 'piece') {
        const station = layout.stations[sel.i];
        data.x = round(p.x - station.x);
        data.z = round(p.z - station.z);
        data.rotationY = round(object.rotation.y);
    } else if (sel.type === 'camera') {
        data[sel.part] = { x: round(p.x), y: round(p.y), z: round(p.z) };
    } else if (sel.type === 'path') {
        data.x = round(p.x);
        data.z = round(p.z);
    } else if (sel.type === 'point') {
        data.points[sel.j] = { x: round(p.x), z: round(p.z) };
    } else if (sel.type === 'wall') {
        // The whole wall (its openings with it) by the handle's move since the drag started.
        const start = object.userData.dragFrom ?? (object.userData.dragFrom = { x: 0, z: 0 });
        const dx = round(p.x - start.x);
        const dz = round(p.z - start.z);
        if (dx || dz) {
            data.points = data.points.map((q) => ({ x: round(q.x + dx), z: round(q.z + dz) }));
            for (const o of data.openings ?? []) Object.assign(o, { minX: round(o.minX + dx), maxX: round(o.maxX + dx), minZ: round(o.minZ + dz), maxZ: round(o.maxZ + dz) });
            start.x = p.x;
            start.z = p.z;
        }
    }
    renderInspector();
}

function focusSelection() {
    const object = selection && pickables.get(keyOf(selection));
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    const center = box.isEmpty() ? object.position.clone() : box.getCenter(new THREE.Vector3());
    const offset = camera.position.clone().sub(orbit.target);
    orbit.target.copy(center);
    camera.position.copy(center).add(offset.setLength(Math.max(4, box.isEmpty() ? 6 : box.getSize(new THREE.Vector3()).length() * 2)));
}

// ---------------------------------------------------------------- adding / removing

/** Where something new goes: the middle of the view on the floor. */
function dropPoint() {
    return { x: Math.round(orbit.target.x * 4) / 4, z: Math.round(orbit.target.z * 4) / 4 };
}

function addFloor() {
    const { x, z } = dropPoint();
    edit(() => layout.floors.push({ x, z, width: 4, depth: 4, tileSize: 1, style: Object.keys(layout.styles.floors)[0], elevation: 0.01 }));
    select({ type: 'floor', i: layout.floors.length - 1 });
}

function addWall() {
    const { x, z } = dropPoint();
    edit(() => layout.walls.push({ points: [{ x: x - 2, z }, { x: x + 2, z }], closed: false, style: Object.keys(layout.styles.walls)[0], setup: Object.keys(layout.setups)[0], openings: [] }));
    select({ type: 'wall', i: layout.walls.length - 1 });
}

function addProp(path) {
    const { x, z } = dropPoint();
    edit(() => layout.props.push({ model: modelName(path), x, z, rotationY: 0 }));
    select({ type: 'prop', i: layout.props.length - 1 });
}

function addPiece(i, role) {
    const station = layout.stations[i];
    const piece = { role, x: 0, z: 0 };
    if (['counter', 'decor', 'stove'].includes(role)) piece.model = role === 'counter' ? 'kitchencounter_straight_A' : role === 'stove' ? 'stove_single_countertop' : 'ketchup';
    if (role === 'pile') piece.piece = 'cheese';
    edit(() => station.pieces.push(piece));
    select({ type: 'piece', i, j: station.pieces.length - 1 });
}

function duplicateSelection() {
    const sel = selection;
    if (!sel) return;
    const offset = 0.5;
    if (sel.type === 'prop') {
        edit(() => layout.props.push({ ...structuredClone(layout.props[sel.i]), x: layout.props[sel.i].x + offset }));
        select({ type: 'prop', i: layout.props.length - 1 });
    } else if (sel.type === 'piece') {
        const pieces = layout.stations[sel.i].pieces;
        edit(() => pieces.push({ ...structuredClone(pieces[sel.j]), x: pieces[sel.j].x + offset }));
        select({ type: 'piece', i: sel.i, j: pieces.length - 1 });
    } else if (sel.type === 'floor') {
        edit(() => layout.floors.push({ ...structuredClone(layout.floors[sel.i]), x: layout.floors[sel.i].x + offset }));
        select({ type: 'floor', i: layout.floors.length - 1 });
    } else if (sel.type === 'wall') {
        const wall = structuredClone(layout.walls[sel.i]);
        wall.points = wall.points.map((p) => ({ x: p.x + offset, z: p.z + offset }));
        for (const o of wall.openings ?? []) Object.assign(o, { minX: o.minX + offset, maxX: o.maxX + offset, minZ: o.minZ + offset, maxZ: o.maxZ + offset });
        edit(() => layout.walls.push(wall));
        select({ type: 'wall', i: layout.walls.length - 1 });
    }
}

function removeSelection() {
    const sel = selection;
    if (!sel) return;
    if (sel.type === 'floor') edit(() => layout.floors.splice(sel.i, 1));
    else if (sel.type === 'wall') edit(() => layout.walls.splice(sel.i, 1));
    else if (sel.type === 'point') {
        const wall = layout.walls[sel.i];
        if (wall.points.length <= 2) return toast('A wall needs two corners at least', 'warn');
        edit(() => wall.points.splice(sel.j, 1));
    } else if (sel.type === 'prop') edit(() => layout.props.splice(sel.i, 1));
    else if (sel.type === 'piece') edit(() => layout.stations[sel.i].pieces.splice(sel.j, 1));
    else return;
    selection = null;
    rebuild();
}

// ---------------------------------------------------------------- looking through a camera

function lookThrough(i, key) {
    const shot = layout.stations[i].cameras[key];
    looking = { i, key };
    camera.fov = shot.fov;
    camera.position.set(shot.position.x, shot.position.y, shot.position.z);
    orbit.target.set(shot.target.x, shot.target.y, shot.target.z);
    camera.updateProjectionMatrix();
    orbit.update();
    document.getElementById('shotFrame').hidden = false;
    document.getElementById('shotBar').hidden = false;
    document.getElementById('shotName').textContent = `${layout.stations[i].name ?? layout.stations[i].id}: ${key} camera`;
    gizmo.detach();
    // The camera itself mustn't show (its box and frustum would be in its own shot).
    world.children.forEach((child) => {
        if (child.isCameraHelper || child.userData.sel?.type === 'camera') child.visible = false;
    });
}

function useView() {
    if (!looking) return;
    const { i, key } = looking;
    edit(() => {
        layout.stations[i].cameras[key] = {
            position: { x: round(camera.position.x), y: round(camera.position.y), z: round(camera.position.z) },
            target: { x: round(orbit.target.x), y: round(orbit.target.y), z: round(orbit.target.z) },
            fov: round(camera.fov),
        };
    });
    toast(`${key} camera set — save to see it in the game`, 'good');
    lookThrough(i, key);
}

function exitLook() {
    looking = null;
    camera.fov = EDITOR_FOV;
    camera.updateProjectionMatrix();
    document.getElementById('shotFrame').hidden = true;
    document.getElementById('shotBar').hidden = true;
    rebuild();
}

// ---------------------------------------------------------------- panels

function renderPanels() {
    renderOutline();
    renderInspector();
}

function outlineItem(label, sel, tag, shown = true) {
    const item = el('li', { class: `${keyOf(sel) === keyOf(selection) ? 'selected' : ''} ${shown ? '' : 'hiddenAtStage'}`, onclick: () => select(sel) }, label, tag ? el('span', { class: 'tag' }, tag) : null);
    return item;
}

const rangeTag = (item) => (item.from === undefined && item.until === undefined ? '' : `${item.from !== undefined ? item.from + 1 : 1}–${item.until !== undefined ? item.until : stageNames.length}`);

function renderOutline() {
    const host = document.getElementById('outline');
    const group = (title, items, extra) => [el('div', { class: 'group-title' }, el('h3', {}, title), extra ?? null), el('ul', { class: 'tree' }, ...items)];
    host.replaceChildren(
        ...group('Stations', layout.stations.flatMap((station, i) => [
            outlineItem(`🍔 ${station.name ?? station.id}`, { type: 'station', i }, rangeTag(station), shownAt(station)),
            el('li', { class: 'sub', style: { cursor: 'default' } }, el('ul', { class: 'tree' },
                outlineItem('🎥 order camera', { type: 'camera', i, key: 'order', part: 'position' }),
                outlineItem('🎥 bench camera', { type: 'camera', i, key: 'bench', part: 'position' }),
                ...station.pieces.map((piece, j) => outlineItem(`${piece.role}${piece.piece ? ': ' + piece.piece : piece.model ? ': ' + modelName(piece.model) : ''}`, { type: 'piece', i, j })))),
        ])),
        ...group('Way in', ['outside', 'inside'].map((key) => outlineItem(`🚶 ${key}`, { type: 'path', key }))),
        ...group('Walls', layout.walls.map((wall, i) => outlineItem(`🧱 ${wall.style ?? 'wall'} (${wall.points.length} corners${wall.openings?.length ? `, ${wall.openings.length} openings` : ''})`, { type: 'wall', i }, rangeTag(wall), shownAt(wall)))),
        ...group('Floors', layout.floors.map((floor, i) => outlineItem(`▦ ${floor.style ?? 'floor'} ${floor.width}×${floor.depth}`, { type: 'floor', i }, rangeTag(floor), shownAt(floor)))),
        ...group('Props', layout.props.map((prop, i) => outlineItem(`🧊 ${modelName(prop.model).split('/').pop()}`, { type: 'prop', i }, rangeTag(prop), shownAt(prop)))),
    );
}

// Inspector field helpers: each change goes through edit().
function numberField(label, value, step, onChange, { rebuildScene = true } = {}) {
    const input = el('input', { type: 'number', step, value: value ?? '' });
    input.addEventListener('change', () => edit(() => onChange(input.value === '' ? undefined : Number(input.value)), { rebuildScene }));
    return el('label', { class: 'field' }, el('span', {}, label), input);
}

function textField(label, value, onChange) {
    const input = el('input', { value: value ?? '' });
    input.addEventListener('change', () => edit(() => onChange(input.value.trim() || undefined)));
    return el('label', { class: 'field' }, el('span', {}, label), input);
}

function selectField(label, value, options, onChange) {
    const select = el('select', {}, ...options.map((o) => el('option', { value: o, selected: o === value }, o)));
    select.addEventListener('change', () => edit(() => onChange(select.value)));
    return el('label', { class: 'field' }, el('span', {}, label), select);
}

function checkField(label, value, onChange) {
    const input = el('input', { type: 'checkbox', checked: Boolean(value) });
    input.addEventListener('change', () => edit(() => onChange(input.checked)));
    return el('label', { class: 'field check' }, input, el('span', {}, label));
}

/** From / Until: the stages it's there for (1-based in the editor, 0-based in the file). */
function stageFields(item) {
    const options = ['—', ...stageNames.map((name, i) => `${i + 1}: ${name}`)];
    const toIndex = (value) => (value === '—' ? undefined : Number(value.split(':')[0]) - 1);
    const fromValue = item.from === undefined ? '—' : options[item.from + 1];
    const untilValue = item.until === undefined ? '—' : options[item.until + 1] ?? '—';
    return el('div', {},
        selectField('From stage', fromValue, options, (v) => (v === '—' ? delete item.from : (item.from = toIndex(v)))),
        selectField('Gone at stage', untilValue, options, (v) => (v === '—' ? delete item.until : (item.until = toIndex(v)))));
}

function xyzField(label, point, onChange) {
    const inputs = ['x', 'y', 'z'].map((axis) => {
        const input = el('input', { type: 'number', step: 0.1, value: point[axis] });
        input.addEventListener('change', () => edit(() => onChange({ ...point, [axis]: Number(input.value) })));
        return input;
    });
    return el('label', { class: 'field' }, el('span', {}, label), el('div', { class: 'xyz' }, ...inputs));
}

const degrees = (radians) => Math.round(THREE.MathUtils.radToDeg(radians ?? 0) * 10) / 10;

function renderInspector() {
    const host = document.getElementById('inspector');
    const sel = selection;
    const data = dataOf(sel);
    if (!sel || !data) {
        host.replaceChildren(el('p', { class: 'muted' }, 'Nothing selected. Click something in the view or the list.'));
        return;
    }
    const remove = el('button', { class: 'danger', onclick: removeSelection }, 'Delete');
    const parts = [];
    if (sel.type === 'floor') {
        parts.push(el('h3', {}, 'Floor'),
            numberField('X', data.x, 0.25, (v) => (data.x = v)), numberField('Z', data.z, 0.25, (v) => (data.z = v)),
            numberField('Width', data.width, 0.5, (v) => (data.width = Math.max(0.5, v ?? 1))), numberField('Depth', data.depth, 0.5, (v) => (data.depth = Math.max(0.5, v ?? 1))),
            numberField('Tile size', data.tileSize ?? 1, 0.25, (v) => (data.tileSize = v)),
            numberField('Lift (over others)', data.elevation ?? 0, 0.002, (v) => (data.elevation = v)),
            selectField('Style', data.style, Object.keys(layout.styles.floors), (v) => (data.style = v)),
            stageFields(data), el('div', { class: 'row' }, remove));
    } else if (sel.type === 'wall' || sel.type === 'point') {
        parts.push(el('h3', {}, sel.type === 'point' ? `Wall corner ${sel.j + 1}` : 'Wall'),
            selectField('Style', data.style, Object.keys(layout.styles.walls), (v) => (data.style = v)),
            selectField('Size', data.setup, Object.keys(layout.setups), (v) => (data.setup = v)),
            checkField('Closed loop', data.closed, (v) => (data.closed = v)),
            stageFields(data),
            el('h2', {}, 'Corners'),
            ...data.points.map((point, j) => el('div', { class: 'xyz' },
                el('input', { type: 'number', step: 0.25, value: point.x, onchange: (e) => edit(() => (point.x = Number(e.target.value))) }),
                el('input', { type: 'number', step: 0.25, value: point.z, onchange: (e) => edit(() => (point.z = Number(e.target.value))) }),
                el('button', { onclick: () => select({ type: 'point', i: sel.i, j }) }, '◎'))),
            el('button', { onclick: () => edit(() => { const last = data.points[data.points.length - 1]; data.points.push({ x: last.x + 2, z: last.z }); }) }, '＋ Corner'),
            el('h2', {}, 'Openings'),
            ...(data.openings ?? []).map((o, k) => el('div', { class: 'opening' },
                selectField('Kind', o.kind, OPENING_KINDS, (v) => (o.kind = v)),
                el('div', { class: 'xyz' },
                    ...['minX', 'maxX'].map((f) => el('input', { type: 'number', step: 0.1, value: o[f], title: f, onchange: (e) => edit(() => (o[f] = Number(e.target.value))) })), el('span', { class: 'muted small' }, 'x from / to')),
                el('div', { class: 'xyz' },
                    ...['minZ', 'maxZ'].map((f) => el('input', { type: 'number', step: 0.1, value: o[f], title: f, onchange: (e) => edit(() => (o[f] = Number(e.target.value))) })), el('span', { class: 'muted small' }, 'z from / to')),
                o.kind === 'door' ? el('div', {},
                    checkField('Sliding', o.sliding, (v) => (o.sliding = v || undefined)),
                    checkField('Double', o.double, (v) => (o.double = v || undefined)),
                    selectField('Door style', o.style ?? '', ['', ...Object.keys(layout.styles.doors ?? {})], (v) => (o.style = v || undefined))) : null,
                el('button', { class: 'danger', onclick: () => edit(() => data.openings.splice(k, 1)) }, 'Remove opening'))),
            el('button', { onclick: () => edit(() => {
                const a = data.points[0];
                const b = data.points[1] ?? a;
                const mx = (a.x + b.x) / 2;
                const mz = (a.z + b.z) / 2;
                (data.openings ??= []).push({ kind: 'window', minX: round(mx - 0.75), maxX: round(mx + 0.75), minZ: round(mz - 0.3), maxZ: round(mz + 0.3) });
            }) }, '＋ Opening (on the first side)'),
            el('div', { class: 'row' }, remove));
    } else if (sel.type === 'prop') {
        parts.push(el('h3', {}, modelName(data.model).split('/').pop()),
            el('button', { class: 'block', onclick: () => openModelPicker({ current: modelPath(data.model), onPick: (path) => edit(() => (data.model = modelName(path))) }) }, '🧊 Change model…'),
            textField('Id (for the game to find it)', data.id, (v) => (v ? (data.id = v) : delete data.id)),
            numberField('X', data.x, 0.25, (v) => (data.x = v)), numberField('Z', data.z, 0.25, (v) => (data.z = v)),
            numberField('Turn (°)', degrees(data.rotationY), 15, (v) => (data.rotationY = round(THREE.MathUtils.degToRad(v ?? 0)))),
            numberField('Height (fit)', data.height, 0.1, (v) => (v === undefined ? delete data.height : (data.height = v))),
            numberField('Scale (no height)', data.scale ?? 1, 0.1, (v) => (data.scale = v)),
            numberField('Lift off floor', data.elevation ?? 0, 0.05, (v) => (data.elevation = v)),
            stageFields(data), el('div', { class: 'row' }, el('button', { onclick: duplicateSelection }, 'Duplicate'), remove));
    } else if (sel.type === 'station') {
        parts.push(el('h3', {}, data.name ?? data.id),
            el('p', { class: 'muted small' }, 'Drag the blue ring to move the whole station; its pieces follow.'),
            textField('Name', data.name, (v) => (data.name = v)),
            numberField('X', data.x, 0.25, (v) => (data.x = v)), numberField('Z', data.z, 0.25, (v) => (data.z = v)),
            stageFields(data),
            el('h2', {}, 'Cameras'),
            el('div', { class: 'row' },
                el('button', { onclick: () => lookThrough(sel.i, 'order') }, '👁 Order camera'),
                el('button', { onclick: () => lookThrough(sel.i, 'bench') }, '👁 Bench camera')),
            el('h2', {}, 'Add a piece'),
            selectField('Role', '', ['', ...ROLES], (role) => role && addPiece(sel.i, role)));
    } else if (sel.type === 'piece') {
        const station = layout.stations[sel.i];
        parts.push(el('h3', {}, `${station.name ?? station.id}: ${data.role}`),
            selectField('Role', data.role, ROLES, (v) => (data.role = v)),
            ['counter', 'stove', 'decor'].includes(data.role)
                ? el('button', { class: 'block', onclick: () => openModelPicker({ current: data.model ? modelPath(data.model) : null, onPick: (path) => edit(() => (data.model = modelName(path))) }) }, `🧊 ${data.model ? modelName(data.model) : 'Pick model…'}`)
                : null,
            data.role === 'pile' ? selectField('Ingredient', data.piece, Object.keys(PILE_MODELS), (v) => (data.piece = v)) : null,
            numberField('X (from station)', data.x, 0.05, (v) => (data.x = v)), numberField('Z (from station)', data.z, 0.05, (v) => (data.z = v)),
            numberField('Turn (°)', degrees(data.rotationY), 15, (v) => (data.rotationY = round(THREE.MathUtils.degToRad(v ?? 0)))),
            el('div', { class: 'row' }, el('button', { onclick: duplicateSelection }, 'Duplicate'), remove));
    } else if (sel.type === 'camera') {
        const station = layout.stations[sel.i];
        parts.push(el('h3', {}, `${station.name ?? station.id}: ${sel.key} camera`),
            el('p', { class: 'muted small' }, sel.key === 'order' ? 'The customer ordering over the counter.' : 'The work top while cooking.'),
            el('button', { class: 'primary block', onclick: () => lookThrough(sel.i, sel.key) }, '👁 Look through (frame it, then Use this view)'),
            el('div', { class: 'row' },
                el('button', { onclick: () => select({ ...sel, part: 'position' }) }, '🎥 Move camera'),
                el('button', { onclick: () => select({ ...sel, part: 'target' }) }, '◎ Move target')),
            xyzField('Position', data.position, (v) => (data.position = v)),
            xyzField('Target', data.target, (v) => (data.target = v)),
            numberField('Field of view (°)', data.fov, 1, (v) => (data.fov = v ?? 40)));
    } else if (sel.type === 'path') {
        parts.push(el('h3', {}, `Way in: ${sel.key}`),
            el('p', { class: 'muted small' }, sel.key === 'outside' ? 'Where customers appear and leave to.' : 'Just inside the door: then they walk to the station\'s customer spot.'),
            numberField('X', data.x, 0.25, (v) => (data.x = v)), numberField('Z', data.z, 0.25, (v) => (data.z = v)));
    }
    host.replaceChildren(...parts.filter(Boolean));
}

// Styles: wall colours, floor checkers, doors, wall sizes.
function renderStyles() {
    const host = document.getElementById('styles');
    const color = (label, value, onChange) => {
        const input = el('input', { type: 'color', value });
        input.addEventListener('change', () => edit(() => onChange(input.value)));
        return el('label', { class: 'field' }, el('span', {}, label), input);
    };
    const add = (record, base, label) => el('button', { onclick: () => {
        const name = prompt(`New ${label} style name`);
        if (!name || record[name]) return;
        edit(() => (record[name] = structuredClone(base)));
        renderStyles();
    } }, `＋ ${label}`);
    const walls = layout.styles.walls;
    const floors = layout.styles.floors;
    const doors = (layout.styles.doors ??= {});
    host.replaceChildren(
        el('h2', {}, 'Walls'),
        ...Object.entries(walls).map(([name, style]) => el('div', { class: 'opening' }, el('strong', {}, name),
            color('Bottom', style.bottomColor, (v) => (style.bottomColor = v)), color('Top', style.topColor, (v) => (style.topColor = v)),
            numberField('Bottom band height', style.bottomHeight, 0.1, (v) => (style.bottomHeight = v ?? 1)))),
        add(walls, Object.values(walls)[0], 'wall'),
        el('h2', {}, 'Floors'),
        ...Object.entries(floors).map(([name, style]) => el('div', { class: 'opening' }, el('strong', {}, name),
            color('Colour A', style.colorA, (v) => (style.colorA = v)), color('Colour B', style.colorB, (v) => (style.colorB = v)),
            numberField('Square (tiles)', style.scale, 0.25, (v) => (style.scale = v ?? 1)))),
        add(floors, Object.values(floors)[0], 'floor'),
        el('h2', {}, 'Doors'),
        ...Object.entries(doors).map(([name, style]) => el('div', { class: 'opening' }, el('strong', {}, name),
            color('Colour', style.color, (v) => (style.color = v)), numberField('Opacity (1 solid)', style.opacity, 0.05, (v) => (style.opacity = v ?? 1)))),
        add(doors, { color: '#9fd8ff', opacity: 0.35 }, 'door'),
        el('h2', {}, 'Wall sizes'),
        ...Object.entries(layout.setups).map(([name, setup]) => el('div', { class: 'opening' }, el('strong', {}, name),
            ...['height', 'thickness', 'doorHeight', 'tallDoorHeight', 'windowHeight'].map((f) => numberField(f, setup[f], 0.05, (v) => (setup[f] = v ?? setup[f]))))),
    );
}

// ---------------------------------------------------------------- UI wiring

function bindUi() {
    document.getElementById('stage').addEventListener('change', (event) => {
        stage = Number(event.target.value);
        rebuild();
    });
    document.querySelectorAll('#modes button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
    document.getElementById('snap').addEventListener('change', (event) => {
        snap = event.target.checked;
        applySnap();
    });
    document.getElementById('undo').addEventListener('click', undo);
    document.getElementById('save').addEventListener('click', () => void save());
    document.getElementById('play').addEventListener('click', () => window.open(gameUrl, 'restaurant-game'));
    document.getElementById('addFloor').addEventListener('click', addFloor);
    document.getElementById('addWall').addEventListener('click', addWall);
    document.getElementById('addProp').addEventListener('click', () => openModelPicker({ title: 'Add a prop', confirmLabel: 'Add', onPick: addProp }));
    document.getElementById('importProp').addEventListener('click', () => void openLibraryPicker({
        onImported: async (path) => {
            setModelCatalog(await api('/api/models'));
            addProp(path);
            toast('Imported — run npm run models before a build, so it\'s in the raw assets too', 'good');
        },
    }));
    document.getElementById('shotSet').addEventListener('click', useView);
    document.getElementById('shotExit').addEventListener('click', exitLook);
    window.addEventListener('beforeunload', (event) => {
        if (dirty) event.preventDefault();
    });
}

void start().catch((error) => toast(`Editor failed to start: ${error.message}`, 'bad'));
