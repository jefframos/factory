// Mowers tab: the walked tools (ui/mow.json `tools` without `ride`: the scissors and the push mowers), to fit the
// hands. The preview builds each one as MowPlayer.ts does — the placeholder cube in the tool's size and colour, a
// pushed one `gap` ahead of the feet with its push handle (rails from the deck's back corners up to a crossbar at the
// grip), a held one hanging at the grip — and poses the player's arms the same way (each arm aimed at its hand's spot,
// `spread` off the middle of the grip, over the idle or walk clip). Saves each walked tool's grip, gap and size
// (PUT /api/mow/tools); its price and stats stay in `tools`.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { api, el, toast } from './shared.js';

/** Same as MowPlayer. */
const CHARACTER_SCALE = 0.0075;
const CHARACTER = 'characters/default/characterMedium.fbx';
const CLIPS = { idle: 'characters/default/idle.glb', walk: 'characters/default/Walking.glb' };
const TOOL_GAP = 0.7;
const GRIP = { forward: 0.42, height: 0.95, spread: 0.2 };
const HELD = { forward: 0.4, height: 0.85, spread: 0.07 };
const HANDLE_RADIUS = 0.035;
const BAR_OVERHANG = 0.12;
const UP = new THREE.Vector3(0, 1, 0);

/** [path in the tool, label, step, min, max, pushed only] */
const FIELDS = [
    ['Grip (where the hands hold it)', [
        ['grip.forward', 'Ahead of the feet', 0.01, 0, 1.5],
        ['grip.height', 'Height', 0.01, 0.3, 1.6],
        ['grip.spread', 'Hands apart (each)', 0.01, 0, 0.5],
    ]],
    ['Mower', [
        ['gap', 'Gap feet → deck', 0.01, 0, 2, true],
        ['size.0', 'Width', 0.01, 0.1, 3],
        ['size.1', 'Height', 0.01, 0.05, 2],
        ['size.2', 'Length', 0.01, 0.1, 3],
    ]],
];

let host;
let tools = [];
let current;
let dirty = false;
let renderer;
let scene;
let camera;
let controls;
let mixer;
let rig;
const actions = {};
let clipName = 'idle';
const handRest = new Map();
const toolGroup = new THREE.Group();
const handMarkers = [0, 1].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd54f, depthTest: false })));
const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6 });
const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.8 });
const clock = new THREE.Clock();

export const hasUnsavedMowerChanges = () => dirty;

export async function initMowersTab(container) {
    host = container;
    const mow = await api('/api/mow');
    tools = mow.tools.filter((tool) => !tool.ride).map((tool) => ({
        ...tool,
        grip: { ...(tool.grip ?? (tool.handheld ? HELD : GRIP)) },
        gap: tool.gap ?? TOOL_GAP,
        size: [...tool.size],
    }));
    current = tools.find((tool) => !tool.handheld) ?? tools[0];
    buildLayout();
    setupViewport(host.querySelector('#mowersViewport'));
    void loadPlayer();
    buildTool();
}

export function refreshMowersTab() {
    resize();
}

const get = (path) => path.split('.').reduce((value, key) => value?.[key], current);
function set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((value, key) => value[key], current)[last] = value;
}

function buildLayout() {
    const picker = el('select', { onchange: (event) => { current = tools.find((tool) => tool.id === event.target.value); buildLayout(); buildTool(); } },
        ...tools.map((tool) => el('option', { value: tool.id, selected: tool === current }, tool.name)));
    const sections = FIELDS.map(([title, fields]) => el('section', { class: 'card-section' },
        el('h2', {}, title),
        ...fields.filter(([, , , , , pushedOnly]) => !(pushedOnly && current.handheld)).map(([path, label, step, min, max]) => {
            const number = el('input', { type: 'number', step, value: Number(get(path).toFixed(3)), style: { width: '72px', flex: 'none' } });
            const slider = el('input', { type: 'range', min, max, step, value: get(path), style: { flex: '1', minWidth: '0' } });
            const apply = (raw) => {
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) return;
                set(path, parsed);
                number.value = parsed;
                slider.value = parsed;
                touch();
                buildTool();
            };
            number.addEventListener('input', () => apply(number.value));
            slider.addEventListener('input', () => apply(slider.value));
            return el('label', { class: 'field' }, el('span', {}, label), el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', minWidth: '0' } }, slider, number));
        })));
    const clipButtons = Object.keys(CLIPS).map((name) => el('button', { class: name === clipName ? 'primary' : '', onclick: () => { playClip(name); buildLayout(); } },
        name === 'idle' ? '🧍 Idle' : '🚶 Walk'));
    host.replaceChildren(
        el('aside', { class: 'sidebar left' },
            el('section', { class: 'card-section' }, el('h2', {}, 'Tool'), el('label', { class: 'field' }, el('span', {}, 'Walked tool'), picker),
                el('p', { class: 'muted' }, current.handheld ? 'Held in the hands (hangs at the grip).' : 'Pushed: the crossbar sits at the grip.')),
            ...sections),
        el('div', { class: 'stage-area' },
            el('div', { class: 'toolbar' },
                el('button', { class: 'primary', onclick: () => void save() }, '💾 Save mowers'),
                ...clipButtons,
                el('span', { class: 'spacer' }),
                el('span', { id: 'mowers-status' })),
            el('div', { id: 'mowersViewport', style: { position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden' } }),
            el('div', { class: 'hint-bar' }, 'Drag to orbit, wheel to zoom. The player faces +Z (the blue axis). The yellow dots are where the hands go: fit the grip so they sit on the crossbar.')),
    );
    const viewport = host.querySelector('#mowersViewport');
    if (renderer) {
        viewport.append(renderer.domElement);
        resize();
    }
    renderStatus();
}

function touch() {
    dirty = true;
    renderStatus();
}

function renderStatus() {
    const status = host.querySelector('#mowers-status');
    status.textContent = dirty ? 'Unsaved changes' : 'Saved';
    status.className = dirty ? 'dirty' : '';
}

async function save() {
    try {
        const edits = tools.map(({ id, grip, gap, size }) => ({ id, grip, gap, size }));
        await api('/api/mow/tools', { method: 'PUT', body: JSON.stringify(edits) });
        dirty = false;
        renderStatus();
        toast('Mowers saved — reload the game to see them.');
    } catch (error) {
        toast(`Save failed: ${error.message}`, 'bad');
    }
}

// ---------------------------------------------------------------- preview

function setupViewport(viewport) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    viewport.append(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2b2622);
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a4a3a, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    scene.add(new THREE.GridHelper(8, 32, 0x4a4038, 0x3a322c), new THREE.AxesHelper(1.2));
    scene.add(toolGroup, ...handMarkers);
    handMarkers.forEach((marker) => { marker.renderOrder = 10; });
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    camera.position.set(2.6, 1.9, 2.4);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.6, 0.6);
    controls.update();
    new ResizeObserver(resize).observe(host);
    resize();
    const loop = () => {
        requestAnimationFrame(loop);
        const delta = Math.min(clock.getDelta(), 0.1);
        if (host.closest('[hidden]')) return;
        mixer?.update(delta);
        holdPose();
        renderer.render(scene, camera);
    };
    loop();
}

function resize() {
    const viewport = host?.querySelector('#mowersViewport');
    if (!viewport || !renderer) return;
    renderer.setSize(viewport.clientWidth || 600, viewport.clientHeight || 500);
    camera.aspect = (viewport.clientWidth || 600) / (viewport.clientHeight || 500);
    camera.updateProjectionMatrix();
}

/** As MowPlayer.tube(): a handle tube from `a` to `b`. */
function tube(a, b) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(HANDLE_RADIUS, HANDLE_RADIUS, a.distanceTo(b), 8), handleMaterial);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    return mesh;
}

/** As MowPlayer.showTool() + syncTool(), with the player at the origin facing +Z. */
function buildTool() {
    toolGroup.traverse((node) => node.geometry?.dispose());
    toolGroup.clear();
    const tool = current;
    const [width, height, length] = tool.size;
    const { grip } = tool;
    const cube = new THREE.Mesh(new THREE.BoxGeometry(width, height, length), new THREE.MeshStandardMaterial({ color: tool.color, roughness: 0.5 }));
    if (tool.handheld) {
        toolGroup.position.set(0, grip.height, grip.forward);
        toolGroup.add(cube);
    } else {
        const ahead = tool.gap + length / 2;
        toolGroup.position.set(0, 0, ahead);
        cube.position.y = height / 2 + 0.05;
        toolGroup.add(cube);
        const blade = new THREE.Mesh(new THREE.BoxGeometry(width * 1.05, 0.06, length * 1.05), deckMaterial);
        blade.position.y = 0.05;
        toolGroup.add(blade);
        const gripZ = grip.forward - ahead;
        const barHalf = grip.spread + BAR_OVERHANG;
        const railX = Math.max(0.08, Math.min(width / 2 - 0.08, barHalf));
        for (const side of [-1, 1]) {
            toolGroup.add(tube(new THREE.Vector3(side * railX, height + 0.05, -length / 2 + 0.08), new THREE.Vector3(side * barHalf, grip.height, gripZ)));
        }
        toolGroup.add(tube(new THREE.Vector3(-barHalf - HANDLE_RADIUS, grip.height, gripZ), new THREE.Vector3(barHalf + HANDLE_RADIUS, grip.height, gripZ)));
    }
    // Left is +X when facing +Z (MowPlayer: left = UP x forward).
    handMarkers[0].position.set(grip.spread, grip.height, grip.forward);
    handMarkers[1].position.set(-grip.spread, grip.height, grip.forward);
}

/** The game's rig over the idle / walk clip; its arms are posed each frame (holdPose). */
async function loadPlayer() {
    try {
        const loader = new GLTFLoader();
        const [loaded, idle, walk] = await Promise.all([new FBXLoader().loadAsync(`/models/${CHARACTER}`), loader.loadAsync(`/models/${CLIPS.idle}`), loader.loadAsync(`/models/${CLIPS.walk}`)]);
        rig = loaded;
        rig.scale.setScalar(CHARACTER_SCALE);
        rig.traverse((node) => {
            if (node.isMesh) node.material = new THREE.MeshStandardMaterial({ color: 0x42a5f5, roughness: 0.7 });
        });
        for (const side of ['Left', 'Right']) {
            const hand = bone(`${side}Hand`);
            if (hand) handRest.set(hand, hand.quaternion.clone());
        }
        scene.add(rig);
        mixer = new THREE.AnimationMixer(rig);
        if (idle.animations[0]) actions.idle = mixer.clipAction(idle.animations[0]);
        if (walk.animations[0]) actions.walk = mixer.clipAction(walk.animations[0]);
        playClip(clipName);
    } catch (error) {
        console.warn('[mowers] player preview failed', error);
        toast('Could not load the player preview', 'bad');
    }
}

function playClip(name) {
    clipName = name;
    for (const [key, action] of Object.entries(actions)) {
        if (key === name) action.reset().play();
        else action.stop();
    }
}

const bones = new Map();
function bone(name) {
    if (bones.has(name)) return bones.get(name);
    let found;
    const lower = name.toLowerCase();
    rig?.traverse((node) => {
        if (!found && node.name.toLowerCase() === lower) found = node;
    });
    if (rig) bones.set(name, found);
    return found;
}

const aimFrom = new THREE.Vector3();
const aimCurrent = new THREE.Vector3();
const aimWanted = new THREE.Vector3();
const aimTurn = new THREE.Quaternion();
const aimWorld = new THREE.Quaternion();
const aimParent = new THREE.Quaternion();

/** As MowPlayer.holdPose(): each arm aimed so its hand reaches its marker, the hand kept in its rest rotation. */
function holdPose() {
    if (!rig) return;
    rig.updateMatrixWorld(true);
    [['Left', handMarkers[0].position], ['Right', handMarkers[1].position]].forEach(([side, target]) => {
        const arm = bone(`${side}Arm`);
        const fore = bone(`${side}ForeArm`);
        const hand = bone(`${side}Hand`);
        if (!arm || !fore || !hand) return;
        aim(arm, fore, target);
        aim(fore, hand, target);
        const rest = handRest.get(hand);
        if (rest) {
            hand.quaternion.copy(rest);
            hand.updateMatrixWorld(true);
        }
    });
}

function aim(boneNode, toward, target) {
    const from = boneNode.getWorldPosition(aimFrom);
    const currentDir = toward.getWorldPosition(aimCurrent).sub(from).normalize();
    const wanted = aimWanted.copy(target).sub(from).normalize();
    aimTurn.setFromUnitVectors(currentDir, wanted);
    const world = boneNode.getWorldQuaternion(aimWorld).premultiply(aimTurn);
    const parent = boneNode.parent.getWorldQuaternion(aimParent).invert();
    boneNode.quaternion.copy(parent.multiply(world));
    boneNode.updateMatrixWorld(true);
}
