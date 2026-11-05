// Hangar tab: the saucer's looks (ui/saucers.json). UFO styles: a skin, a dome colour, where the alien sits, and
// attachments. Aliens: built from pieces. A piece is a simple shape or a model from the game or the 3D library, with a
// colour and a transform (core/pieces/Pieces.ts: the game's own code, so what's here is what plays).
//
// Click a piece in the view or the list; W/E/R move, turn, scale it; D duplicates, Del removes, Ctrl+Z undoes, Ctrl+S saves.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createGLTFLoader } from './gltf.js';
import { api, el, toast } from './shared.js';
import { openModelPicker, setModelCatalog } from './modelPicker.js';
import { openLibraryPicker } from './library.js';
import { PIECE_SHAPES, buildPiece, freePiece, placePiece } from '/core/pieces/Pieces.ts';

const SHAPE_ICONS = { sphere: '⚪', box: '🟦', cylinder: '🥫', cone: '🔺', torus: '🍩', capsule: '💊' };
const DEFAULT_SIZE = 0.25;
/** A model added to a piece list is fitted to this, in the units of what it's added to. */
const FIT = { ufo: 0.4, alien: 0.6 };
const UNDO_LIMIT = 40;
const IDENTITY = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
const round = (value, step = 0.001) => Math.round(value / step) * step;
/** An alien's shape: its id without the colour on the end of it. */
const alienFamily = (id) => id.replace(/-(blue|pink|orange|purple|red|teal)$/, '');

let host;
let doc;
let skins = [];
let gameUrl = '';
let dirty = false;
/** What's being edited: its kind and id, and what's chosen (a piece's index; 'seat': where the alien sits; 'whole': all of the alien). */
let editing = 'alien';
let uiUfo;
let uiAlien;
let selected = null;
const undoStack = [];

const loader = createGLTFLoader();
const modelCache = new Map();
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
let renderer;
let scene;
let camera;
let orbit;
let gizmo;
let hull = null;
let bodyMaterial = null;
let glassMaterial = null;
const attachments = new THREE.Group();
const seat = new THREE.Group();
const alien = new THREE.Group();
let gunsNode = null;
/** What's built now: { object, piece, kind } for each. */
let built = [];
let buildToken = 0;

export const hasUnsavedHangar = () => dirty;

const ufoStyle = () => doc.ufos.find((style) => style.id === uiUfo);
const alienStyle = () => doc.aliens.find((style) => style.id === uiAlien);
const currentPieces = () => (editing === 'ufo' ? ufoStyle() : alienStyle())?.pieces ?? [];

function setDirty(on) {
    dirty = on;
    const status = host.querySelector('#hangarStatus');
    if (status) status.textContent = on ? 'Unsaved changes' : 'Saved';
}

/** Before any change: for Ctrl+Z. */
function touch() {
    undoStack.push(JSON.stringify(doc));
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    setDirty(true);
}

function undo() {
    if (!undoStack.length) return;
    doc = JSON.parse(undoStack.pop());
    if (!ufoStyle()) uiUfo = doc.ufos[0].id;
    if (!alienStyle()) uiAlien = doc.aliens[0].id;
    selected = null;
    setDirty(true);
    refresh();
}

// ---------------------------------------------------------------- fields

function field(label, input) {
    return el('label', { class: 'field' }, el('span', {}, label), input);
}

function numberField(label, value, step, onChange) {
    const input = el('input', { type: 'number', step, value: String(round(value)) });
    input.addEventListener('change', () => {
        const parsed = Number(input.value);
        if (Number.isFinite(parsed)) onChange(parsed);
    });
    return field(label, input);
}

function textField(label, value, onChange) {
    const input = el('input', { type: 'text', value });
    input.addEventListener('change', () => onChange(input.value.trim()));
    return field(label, input);
}

function colorField(label, value, onChange) {
    const input = el('input', { type: 'color', value });
    input.addEventListener('change', () => onChange(input.value));
    return field(label, input);
}

function checkField(label, checked, onChange) {
    const input = el('input', { type: 'checkbox' });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return el('label', { class: 'field check' }, input, el('span', {}, label));
}

function selectField(label, value, options, onChange) {
    const input = el('select', {}, options.map(([id, name]) => new Option(name, id)));
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    return field(label, input);
}

// ---------------------------------------------------------------- layout

function buildLayout() {
    host.replaceChildren(
        el('aside', { class: 'sidebar left' },
            el('section', { class: 'card-section' }, el('h2', {}, '🛸 UFO styles'), el('ul', { id: 'hangarUfoList', class: 'list' }), el('div', { id: 'hangarUfoButtons', class: 'stack' }), el('div', { id: 'hangarUfoFields' })),
            el('section', { class: 'card-section' }, el('h2', {}, '👽 Aliens'), el('ul', { id: 'hangarAlienList', class: 'list' }), el('div', { id: 'hangarAlienButtons', class: 'stack' }), el('div', { id: 'hangarAlienFields' }))),
        el('div', { class: 'stage-area' },
            el('div', { class: 'toolbar' },
                el('div', { class: 'segmented', id: 'hangarMode' },
                    el('button', { dataset: { mode: 'translate' }, class: 'active', onclick: () => setMode('translate') }, 'Move (W)'),
                    el('button', { dataset: { mode: 'rotate' }, onclick: () => setMode('rotate') }, 'Turn (E)'),
                    el('button', { dataset: { mode: 'scale' }, onclick: () => setMode('scale') }, 'Scale (R)')),
                el('span', { class: 'spacer' }),
                el('span', { id: 'hangarStatus' }),
                el('button', { class: 'primary', onclick: () => void save() }, '💾 Save'),
                el('button', { onclick: () => window.open(gameUrl, 'ufo-game') }, '▶ Play')),
            el('div', { id: 'hangarViewport', style: { position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden' } }),
            el('div', { class: 'hint-bar' }, 'Left-drag: orbit · Right-drag: pan · Wheel: zoom · Click: select a piece · W/E/R: move/turn/scale · D: duplicate · Del: remove · Ctrl+Z: undo · Ctrl+S: save')),
        el('aside', { class: 'sidebar right' },
            el('section', { class: 'card-section' },
                el('h2', {}, 'Pieces'),
                el('div', { class: 'segmented', id: 'hangarEditing' },
                    el('button', { dataset: { editing: 'alien' }, onclick: () => setEditing('alien') }, '👽 Alien'),
                    el('button', { dataset: { editing: 'ufo' }, onclick: () => setEditing('ufo') }, '🛸 UFO')),
                el('div', { id: 'hangarAdd', class: 'stack', style: { marginTop: '8px' } }),
                el('ul', { id: 'hangarPieceList', class: 'list' })),
            el('section', { class: 'card-section' }, el('h2', {}, 'Selection'), el('div', { id: 'hangarInspector' }))));
}

function styleButtons(kind) {
    const list = kind === 'ufo' ? doc.ufos : doc.aliens;
    const current = kind === 'ufo' ? ufoStyle() : alienStyle();
    const choose = (id) => {
        if (kind === 'ufo') uiUfo = id;
        else uiAlien = id;
    };
    const uniqueId = (name) => {
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || kind;
        let id = base;
        for (let n = 2; list.some((style) => style.id === id); n++) id = `${base}-${n}`;
        return id;
    };
    return [
        el('button', {
            class: 'block',
            onclick: () => {
                touch();
                const blank = kind === 'ufo'
                    ? { ...structuredClone(current), name: 'New style', pieces: [] }
                    : { name: 'New alien', root: { ...IDENTITY }, pieces: [{ name: 'Head', shape: 'sphere', color: '#7be04a', x: 0, y: 0.5, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }] };
                blank.id = uniqueId(blank.name);
                list.push(blank);
                choose(blank.id);
                selected = null;
                refresh();
            },
        }, kind === 'ufo' ? '＋ New style' : '＋ New alien'),
        el('button', {
            class: 'block',
            onclick: () => {
                touch();
                const copy = structuredClone(current);
                copy.name = `${current.name} copy`;
                copy.id = uniqueId(copy.name);
                list.push(copy);
                choose(copy.id);
                selected = null;
                refresh();
            },
        }, '⧉ Duplicate'),
        el('button', {
            class: 'block danger',
            onclick: () => {
                if (list.length < 2) return toast('Keep at least one.', 'bad');
                if (!window.confirm(`Delete ${current.name}?`)) return undefined;
                touch();
                list.splice(list.indexOf(current), 1);
                if (doc[kind] === current.id) doc[kind] = list[0].id;
                choose(list[0].id);
                selected = null;
                return refresh();
            },
        }, '🗑 Delete'),
    ];
}

function renderLists() {
    const row = (kind, style, active) => el('li', {
        class: active ? 'active' : '',
        onclick: () => {
            if (kind === 'ufo') uiUfo = style.id;
            else uiAlien = style.id;
            selected = null;
            refresh();
        },
    }, style.name, doc[kind] === style.id ? el('small', {}, '▶ in game') : '');
    host.querySelector('#hangarUfoList').replaceChildren(...doc.ufos.map((style) => row('ufo', style, style.id === uiUfo)));
    host.querySelector('#hangarAlienList').replaceChildren(...doc.aliens.map((style) => row('alien', style, style.id === uiAlien)));
    host.querySelector('#hangarUfoButtons').replaceChildren(...styleButtons('ufo'));
    host.querySelector('#hangarAlienButtons').replaceChildren(...styleButtons('alien'));

    const ufo = ufoStyle();
    const edit = (change, rebuild = refresh) => {
        touch();
        change();
        rebuild();
    };
    host.querySelector('#hangarUfoFields').replaceChildren(
        textField('Name', ufo.name, (v) => edit(() => { ufo.name = v || ufo.name; })),
        selectField('Skin', ufo.skin, skins.map((skin) => [skin, skin.replace(/^saucer-/, '')]), (v) => edit(() => { ufo.skin = v; })),
        checkField('Guns (side and bottom)', ufo.guns === true, (on) => edit(() => { ufo.guns = on; })),
        colorField('Dome colour', ufo.domeColor, (v) => edit(() => { ufo.domeColor = v; })),
        numberField('Dome opacity', ufo.domeOpacity, 0.05, (v) => edit(() => { ufo.domeOpacity = Math.max(0, Math.min(1, v)); })),
        numberField('Shop price (0: a classic, unlocked at random)', ufo.price ?? 0, 50, (v) => edit(() => { if (v > 0) ufo.price = v; else delete ufo.price; })),
        el('button', { class: 'block', title: 'Where every alien sits in this UFO. To change one alien, use the button in the Aliens card.', onclick: () => { editing = 'ufo'; select('seat'); } }, '🪑 Move the seat (all aliens in this UFO)'),
        el('button', { class: 'block', disabled: doc.ufo === ufo.id, onclick: () => edit(() => { doc.ufo = ufo.id; }) }, doc.ufo === ufo.id ? '▶ In the game' : '▶ Use in the game'));
    const creature = alienStyle();
    host.querySelector('#hangarAlienFields').replaceChildren(
        el('button', { class: 'block primary', onclick: () => { editing = 'alien'; select('whole'); } }, '📏 Size / move / turn this whole alien'),
        textField('Name', creature.name, (v) => edit(() => { creature.name = v || creature.name; })),
        numberField('Shop price (0: a classic, unlocked at random)', creature.price ?? 0, 50, (v) => edit(() => { if (v > 0) creature.price = v; else delete creature.price; })),
        el('button', { class: 'block', disabled: doc.alien === creature.id, onclick: () => edit(() => { doc.alien = creature.id; }) }, doc.alien === creature.id ? '▶ In the game' : '▶ Use in the game'));

    host.querySelectorAll('#hangarEditing button').forEach((button) => button.classList.toggle('active', button.dataset.editing === editing));
    const newPiece = (piece) => {
        touch();
        currentPieces().push(piece);
        selected = currentPieces().length - 1;
        refresh();
    };
    host.querySelector('#hangarAdd').replaceChildren(
        el('div', { class: 'row', style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } }, PIECE_SHAPES.map((shape) => el('button', {
            title: `Add a ${shape}`,
            onclick: () => {
                const size = editing === 'ufo' ? DEFAULT_SIZE : DEFAULT_SIZE * 1.5;
                newPiece({ name: shape[0].toUpperCase() + shape.slice(1), shape, color: '#ffd23f', x: 0, y: editing === 'ufo' ? 1.5 : 0.5, z: 0, rx: 0, ry: 0, rz: 0, sx: size, sy: size, sz: size });
            },
        }, `${SHAPE_ICONS[shape]} ${shape}`))),
        el('button', { class: 'block', onclick: () => openModelPicker({ title: 'A model as a piece', confirmLabel: 'Add', onPick: (path) => void addModelPiece(path, newPiece) }) }, '🪴 Game model…'),
        el('button', {
            class: 'block primary',
            onclick: () => void openLibraryPicker({
                onImported: async (path) => {
                    setModelCatalog(await api('/api/models'));
                    await addModelPiece(path, newPiece);
                },
            }),
        }, '📚 From the 3D library…'));
    host.querySelector('#hangarPieceList').replaceChildren(...currentPieces().map((piece, index) => el('li', {
        class: selected === index ? 'active' : '',
        onclick: () => select(index),
    }, `${piece.shape === 'model' ? '🪴' : SHAPE_ICONS[piece.shape] ?? ''} ${piece.name}`, piece.look ? el('small', {}, 'googly') : '')));
    if (!currentPieces().length) host.querySelector('#hangarPieceList').append(el('li', { class: 'muted small' }, editing === 'ufo' ? 'No attachments yet: add one above.' : 'No pieces yet: add one above.'));
}

async function addModelPiece(path, add) {
    const source = await loadModel(path);
    const size = new THREE.Box3().setFromObject(source).getSize(new THREE.Vector3());
    const scale = round(FIT[editing] / Math.max(size.x, size.y, size.z, 1e-4));
    add({ name: path.split('/').pop().replace(/\.(glb|gltf)$/i, ''), shape: 'model', model: path, x: 0, y: editing === 'ufo' ? 1.5 : 0.5, z: 0, rx: 0, ry: 0, rz: 0, sx: scale, sy: scale, sz: scale });
}

function target() {
    if (selected === 'seat') return ufoStyle().seat;
    if (selected === 'whole') return alienStyle().root;
    return typeof selected === 'number' ? currentPieces()[selected] ?? null : null;
}

function renderInspector() {
    const box = host.querySelector('#hangarInspector');
    const data = target();
    if (!data) {
        box.replaceChildren(el('p', { class: 'muted small' }, 'Pick a piece in the view or the list.'));
        return;
    }
    const edit = (change) => {
        touch();
        change();
        refresh();
    };
    const transform = [['X', 'x', 0.01], ['Y', 'y', 0.01], ['Z', 'z', 0.01]].map(([label, key, step]) => numberField(label, data[key], step, (v) => edit(() => { data[key] = v; })));
    const turn = [['Turn X°', 'rx'], ['Turn Y°', 'ry'], ['Turn Z°', 'rz']].map(([label, key]) => numberField(label, THREE.MathUtils.radToDeg(data[key]), 5, (v) => edit(() => { data[key] = round(THREE.MathUtils.degToRad(v), 0.0001); })));
    const scale = [['Size X', 'sx'], ['Size Y', 'sy'], ['Size Z', 'sz']].map(([label, key]) => numberField(label, data[key], 0.01, (v) => edit(() => { data[key] = Math.max(0.001, v); })));
    if (selected === 'whole') {
        box.replaceChildren(el('div', { class: 'inspector-title' }, `All of ${alienStyle().name}`),
            numberField('Size', data.sx, 0.05, (v) => edit(() => {
                const size = Math.max(0.01, v);
                data.sx = size;
                data.sy = size;
                data.sz = size;
            })),
            ...transform, ...turn,
            el('button', {
                class: 'block', title: 'The same size, place and turn on the other colours of this alien',
                onclick: () => {
                    const family = alienFamily(alienStyle().id);
                    const others = doc.aliens.filter((other) => other !== alienStyle() && alienFamily(other.id) === family);
                    edit(() => others.forEach((other) => { other.root = { ...data }; }));
                    toast(`Copied to ${others.length} other colours`);
                },
            }, '🎨 Use on all its colours'),
            el('p', { class: 'muted small' }, 'Changes only this alien: moves, turns and sizes all its pieces together, from its feet. With Scale (R), drag the gizmo\'s middle to keep its shape. It stays this way in every UFO.'));
        return;
    }
    if (selected === 'seat') {
        box.replaceChildren(el('div', { class: 'inspector-title' }, 'Where the alien sits'), ...transform, ...turn, ...scale,
            el('p', { class: 'muted small' }, 'In saucer units (the disc\'s radius is 1). In the game the alien keeps turned to the camera, so keep it facing front here.'));
        return;
    }
    const isShape = data.shape !== 'model';
    box.replaceChildren(
        el('div', { class: 'inspector-title' }, data.name, el('span', { class: 'tag' }, data.shape)),
        textField('Name', data.name, (v) => edit(() => { data.name = v || data.name; })),
        isShape ? selectField('Shape', data.shape, PIECE_SHAPES.map((shape) => [shape, shape]), (v) => edit(() => { data.shape = v; })) : '',
        isShape ? colorField('Colour', data.color ?? '#ffffff', (v) => edit(() => { data.color = v; })) : '',
        isShape ? numberField('Glow', data.glow ?? 0, 0.1, (v) => edit(() => {
            if (v > 0) data.glow = v;
            else delete data.glow;
        })) : '',
        numberField('Googly', data.look ?? 0, 0.01, (v) => edit(() => {
            if (v > 0) data.look = v;
            else delete data.look;
        })),
        el('p', { class: 'muted small' }, 'Googly: how far it slides about as the UFO moves (in the game). For pupils.'),
        ...transform, ...turn, ...scale,
        el('div', { class: 'stack', style: { marginTop: '8px' } },
            el('button', { class: 'block', onclick: () => duplicatePiece() }, '⧉ Duplicate (D)'),
            el('button', { class: 'block', onclick: () => mirrorPiece() }, '⇋ Mirrored copy (left / right)'),
            el('button', { class: 'block danger', onclick: () => removePiece() }, '🗑 Remove (Del)')));
}

function duplicatePiece() {
    const data = target();
    if (!data || typeof selected !== 'number') return;
    touch();
    currentPieces().push({ ...structuredClone(data), name: `${data.name} copy`, x: data.x + 0.05 });
    selected = currentPieces().length - 1;
    refresh();
}

/** The other eye: a copy on the far side of the middle, turned to match. */
function mirrorPiece() {
    const data = target();
    if (!data || typeof selected !== 'number') return;
    touch();
    const name = /left/i.test(data.name) ? data.name.replace(/left/i, (word) => (word[0] === 'L' ? 'Right' : 'right'))
        : /right/i.test(data.name) ? data.name.replace(/right/i, (word) => (word[0] === 'R' ? 'Left' : 'left')) : `${data.name} mirrored`;
    currentPieces().push({ ...structuredClone(data), name, x: -data.x, ry: -data.ry, rz: -data.rz });
    selected = currentPieces().length - 1;
    refresh();
}

function removePiece() {
    if (typeof selected !== 'number' || !target()) return;
    touch();
    currentPieces().splice(selected, 1);
    selected = null;
    refresh();
}

// ---------------------------------------------------------------- the view

function setupViewport(viewport) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    viewport.append(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x232a33);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(6, 14, 8);
    scene.add(sun, attachments, seat);
    seat.add(alien);
    const floor = new THREE.GridHelper(4, 16, 0x46505c, 0x343c46);
    scene.add(floor);
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(0.9, 2.1, 3);
    orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 1.1, 0);
    orbit.update();
    gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.8);
    gizmo.addEventListener('dragging-changed', (event) => {
        orbit.enabled = !event.value;
        if (event.value) touch();
        else refresh();
    });
    gizmo.addEventListener('objectChange', writeGizmo);
    scene.add(gizmo.getHelper());
    const resize = () => {
        const { clientWidth: width, clientHeight: height } = viewport;
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(viewport);
    resize();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
    renderer.domElement.addEventListener('pointerup', (event) => {
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5 && !gizmo.dragging) pick(event);
        down = null;
    });
    renderer.setAnimationLoop(() => {
        if (host.hidden) return;
        orbit.update();
        renderer.render(scene, camera);
    });
    window.addEventListener('keydown', onKey);
}

function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(built.map(({ object }) => object), true)[0];
    if (!hit) return select(null);
    let node = hit.object;
    while (node && !built.some(({ object }) => object === node)) node = node.parent;
    const found = built.find(({ object }) => object === node);
    if (!found) return select(null);
    editing = found.kind;
    return select(found.index);
}

function select(index) {
    selected = index;
    attachGizmo();
    renderLists();
    renderInspector();
}

function setEditing(kind) {
    editing = kind;
    selected = null;
    attachGizmo();
    renderLists();
    renderInspector();
}

function setMode(mode) {
    gizmo.setMode(mode);
    host.querySelectorAll('#hangarMode button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
}

function attachGizmo() {
    gizmo.detach();
    if (selected === 'seat') return gizmo.attach(seat);
    if (selected === 'whole') return gizmo.attach(alien);
    const found = built.find((entry) => entry.kind === editing && entry.index === selected);
    if (found) gizmo.attach(found.object);
    return undefined;
}

/** The gizmo moved something: into the data. */
function writeGizmo() {
    const data = target();
    const object = gizmo.object;
    if (!data || !object) return;
    data.x = round(object.position.x);
    data.y = round(object.position.y);
    data.z = round(object.position.z);
    data.rx = round(object.rotation.x, 0.0001);
    data.ry = round(object.rotation.y, 0.0001);
    data.rz = round(object.rotation.z, 0.0001);
    data.sx = Math.max(0.001, round(object.scale.x));
    data.sy = Math.max(0.001, round(object.scale.y));
    data.sz = Math.max(0.001, round(object.scale.z));
}

function onKey(event) {
    if (host.hidden || event.target.matches?.('input, select, textarea') || document.querySelector('.modal-backdrop')) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        void save();
    } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        undo();
    } else if (event.ctrlKey || event.metaKey) {
        if (key === 'd') {
            event.preventDefault();
            duplicatePiece();
        }
    } else if (key === 'w') setMode('translate');
    else if (key === 'e') setMode('rotate');
    else if (key === 'r') setMode('scale');
    else if (key === 'd') duplicatePiece();
    else if (key === 'delete' || key === 'backspace') removePiece();
    else if (key === 'escape') select(null);
}

function loadModel(path) {
    if (!modelCache.has(path)) modelCache.set(path, loader.loadAsync(`/models/${path}`).then((gltf) => gltf.scene));
    return modelCache.get(path).then((source) => source.clone(true));
}

function loadTexture(name, color) {
    if (!textureCache.has(name)) {
        textureCache.set(name, textureLoader.loadAsync(`/api/saucer-texture?name=${encodeURIComponent(name)}`).then((texture) => {
            texture.flipY = false;
            if (color) texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        }));
    }
    return textureCache.get(name);
}

async function loadHull() {
    const config = await api('/api/mow');
    const gltf = await loader.loadAsync(`/models/${config.saucer.model}`);
    const [normal, emissive] = await Promise.all([loadTexture('saucer-normal', false), loadTexture('saucer-emissive', true)]);
    gltf.scene.traverse((child) => {
        if (!child.isMesh) return;
        if (child.material.name === 'Glass') {
            glassMaterial = child.material;
            glassMaterial.transparent = true;
            glassMaterial.roughness = 0.15;
            glassMaterial.metalness = 0;
            return;
        }
        bodyMaterial = child.material;
        bodyMaterial.normalMap = normal;
        bodyMaterial.emissiveMap = emissive;
        bodyMaterial.emissive.setHex(0xffffff);
        bodyMaterial.roughness = 0.8;
        bodyMaterial.metalness = 0;
    });
    hull = gltf.scene;
    gunsNode = hull.getObjectByName('guns') ?? null;
    scene.add(hull);
}

/** The view from the data. */
async function rebuildView() {
    const token = ++buildToken;
    const ufo = ufoStyle();
    const creature = alienStyle();
    placePiece(seat, ufo.seat);
    placePiece(alien, creature.root);
    if (gunsNode) gunsNode.visible = ufo.guns === true;
    if (bodyMaterial) {
        const map = await loadTexture(ufo.skin, true).catch(() => null);
        if (token !== buildToken) return;
        bodyMaterial.map = map;
        bodyMaterial.needsUpdate = true;
        glassMaterial?.color.set(ufo.domeColor);
        if (glassMaterial) glassMaterial.opacity = ufo.domeOpacity;
    }
    const make = (kind, pieces) => pieces.map(async (piece, index) => {
        const object = await buildPiece(piece, loadModel);
        return object && { object, piece, kind, index };
    });
    const next = (await Promise.all([...make('ufo', ufo.pieces), ...make('alien', creature.pieces)])).filter(Boolean);
    if (token !== buildToken) {
        next.forEach(({ object, piece }) => freePiece(object, piece));
        return;
    }
    gizmo.detach();
    built.forEach(({ object, piece }) => {
        object.removeFromParent();
        freePiece(object, piece);
    });
    built = next;
    for (const { object, kind } of built) (kind === 'ufo' ? attachments : alien).add(object);
    attachGizmo();
}

function refresh() {
    renderLists();
    renderInspector();
    void rebuildView();
}

async function save() {
    try {
        await api('/api/saucers', { method: 'PUT', body: JSON.stringify(doc) });
        setDirty(false);
        toast('Saved: the game reloads with it.');
    } catch (error) {
        toast(error.message, 'bad');
    }
}

export async function initHangarTab(container, options = {}) {
    host = container;
    gameUrl = options.gameUrl ?? '';
    doc = await api('/api/saucers');
    for (const creature of doc.aliens) creature.root ??= { ...IDENTITY };
    skins = (await api('/api/mow')).saucer.skins;
    uiUfo = doc.ufo;
    uiAlien = doc.alien;
    buildLayout();
    setupViewport(host.querySelector('#hangarViewport'));
    setDirty(false);
    await loadHull().catch((error) => toast(`Could not load the UFO: ${error.message}`, 'bad'));
    refresh();
}
