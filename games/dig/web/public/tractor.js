// Tractor tab: the tractor the miner rides outside the hub (ui/dig.json `tractor`, read by TractorRide.ts).
// The preview puts the miner (the game's rig in its Sitting clip) on the seat exactly as the game does —
// tractor stood on the floor at `height`, turned by `rotationY`, the miner's feet at `seat` — and marks the
// exhaust. "Puff" plays the smoke. Saves only the tractor section of dig.json (PUT /api/dig/tractor); its price
// and digging stats are the last entry of `tools` (the tool path ends with the tractor).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { api, el, toast } from './shared.js';

/** Same as DigPlayer: the rig is authored in FBX units. */
const CHARACTER_SCALE = 0.0075;
const CHARACTER = 'characters/default/characterMedium.fbx';
const SIT_CLIP = 'characters/default/Sitting.glb';
const DEG = Math.PI / 180;

/** [path in the tractor config, label, step, min, max] */
const FIELDS = [
    ['Tractor', [
        ['height', 'Height', 0.05, 0.5, 4],
        ['rotationY', 'Turn (°)', 5, -180, 180, 'deg'],
        ['speedMultiplier', 'Speed ×', 0.1, 0.5, 4],
    ]],
    ['Seat (where the miner sits)', [
        ['seat.x', 'Left / right', 0.01, -2, 2],
        ['seat.y', 'Up / down', 0.01, -1, 3],
        ['seat.z', 'Back / front', 0.01, -2, 2],
    ]],
    ['Smoke puff (in / out of the hub)', [
        ['smoke.count', 'Puffs', 1, 1, 60],
        ['smoke.size', 'Size', 0.05, 0.1, 4],
    ]],
    ['Exhaust (while driving)', [
        ['exhaust.x', 'Left / right', 0.01, -2, 2],
        ['exhaust.y', 'Up / down', 0.01, 0, 4],
        ['exhaust.z', 'Back / front', 0.01, -3, 3],
        ['exhaust.interval', 'Every (s)', 0.02, 0.05, 2],
        ['exhaust.size', 'Size', 0.05, 0.05, 2],
    ]],
];

let host;
let dig;
let tractor;
let dirty = false;
let renderer;
let scene;
let camera;
let controls;
let mixer;
let puffTexture;
const tractorHolder = new THREE.Group();
const seatHolder = new THREE.Group();
const exhaustMarker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff7043 }));
const puffs = [];
const clock = new THREE.Clock();

export const hasUnsavedTractorChanges = () => dirty;

export async function initTractorTab(container) {
    host = container;
    dig = await api('/api/dig');
    tractor = dig.tractor;
    buildLayout();
    setupViewport(host.querySelector('#tractorViewport'));
    void loadTractor();
    void loadMiner();
}

export function refreshTractorTab() {
    resize();
}

const get = (path) => path.split('.').reduce((value, key) => value?.[key], tractor);
function set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((value, key) => value[key], tractor)[last] = value;
}

function buildLayout() {
    const sections = FIELDS.map(([title, fields]) => el('section', { class: 'card-section' },
        el('h2', {}, title),
        ...fields.map(([path, label, step, min, max, unit]) => {
            const shown = unit === 'deg' ? get(path) / DEG : get(path);
            const number = el('input', { type: 'number', step, value: Number(shown.toFixed(3)), style: { width: '72px', flex: 'none' } });
            const slider = el('input', { type: 'range', min, max, step, value: shown, style: { flex: '1', minWidth: '0' } });
            const apply = (raw) => {
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) return;
                set(path, unit === 'deg' ? Number((parsed * DEG).toFixed(4)) : parsed);
                number.value = parsed;
                slider.value = parsed;
                touch();
                place();
            };
            number.addEventListener('input', () => apply(number.value));
            slider.addEventListener('input', () => apply(slider.value));
            return el('label', { class: 'field' }, el('span', {}, label), el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', minWidth: '0' } }, slider, number));
        }),
        title.startsWith('Smoke') ? el('label', { class: 'field' }, el('span', {}, 'Colour'),
            el('input', { type: 'color', value: tractor.smoke.color, oninput: (event) => { tractor.smoke.color = event.target.value; touch(); } })) : ''));
    host.replaceChildren(
        el('aside', { class: 'sidebar left' }, ...sections.slice(0, 2)),
        el('div', { class: 'stage-area' },
            el('div', { class: 'toolbar' },
                el('button', { class: 'primary', onclick: () => void save() }, '💾 Save tractor'),
                el('button', { onclick: () => puff(new THREE.Vector3(0, 0.6, 0), tractor.smoke.count, tractor.smoke.size, 1) }, '💨 Puff'),
                el('span', { class: 'spacer' }),
                el('span', { id: 'tractor-status' })),
            el('div', { id: 'tractorViewport', style: { position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden' } }),
            el('div', { class: 'hint-bar' }, 'Drag to orbit, wheel to zoom. The miner faces +Z (the blue axis): turn the tractor so its front faces the same way. The orange dot is the exhaust.')),
        el('aside', { class: 'sidebar right' }, ...sections.slice(2)),
    );
    renderStatus();
}

function touch() {
    dirty = true;
    renderStatus();
}

function renderStatus() {
    const status = host.querySelector('#tractor-status');
    status.textContent = dirty ? 'Unsaved changes' : 'Saved';
    status.className = dirty ? 'dirty' : '';
}

async function save() {
    try {
        await api('/api/dig/tractor', { method: 'PUT', body: JSON.stringify(tractor) });
        dirty = false;
        renderStatus();
        toast('Tractor saved — reload the game to see it.');
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
    scene.add(tractorHolder, seatHolder, exhaustMarker);
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
    camera.position.set(3.2, 2.6, 3.6);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0);
    controls.update();
    puffTexture = makePuffTexture();
    new ResizeObserver(resize).observe(viewport);
    resize();
    const loop = () => {
        requestAnimationFrame(loop);
        const delta = Math.min(clock.getDelta(), 0.1);
        if (host.closest('[hidden]')) return;
        mixer?.update(delta);
        updatePuffs(delta);
        renderer.render(scene, camera);
    };
    loop();
}

function resize() {
    const viewport = host?.querySelector('#tractorViewport');
    if (!viewport || !renderer) return;
    renderer.setSize(viewport.clientWidth || 600, viewport.clientHeight || 500);
    camera.aspect = (viewport.clientWidth || 600) / (viewport.clientHeight || 500);
    camera.updateProjectionMatrix();
}

/** Re-applies the config to the preview: tractor size/turn (as TractorRide.load()), seat and exhaust. */
function place() {
    const model = tractorHolder.userData.model;
    if (model) {
        model.scale.setScalar(1);
        model.rotation.set(0, 0, 0);
        model.position.set(0, 0, 0);
        model.updateMatrixWorld(true);
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        if (size.y > 1e-4) model.scale.setScalar(tractor.height / size.y);
        model.rotation.y = tractor.rotationY;
        model.updateMatrixWorld(true);
        model.position.y = -new THREE.Box3().setFromObject(model).min.y;
    }
    seatHolder.position.set(tractor.seat.x, tractor.seat.y, tractor.seat.z);
    exhaustMarker.position.set(tractor.exhaust.x, tractor.exhaust.y, tractor.exhaust.z);
}

async function loadTractor() {
    const gltf = await new GLTFLoader().loadAsync(`/models/${tractor.model}`).catch((error) => {
        toast(`Could not load ${tractor.model}: ${error.message}`, 'bad');
        return null;
    });
    if (!gltf) return;
    tractorHolder.add(gltf.scene);
    tractorHolder.userData.model = gltf.scene;
    place();
}

/** The game's rig in its Sitting clip (the game's CharacterBody swaps the head for a cube; the bare rig is close enough to place the seat). */
async function loadMiner() {
    try {
        const [rig, sit] = await Promise.all([new FBXLoader().loadAsync(`/models/${CHARACTER}`), new GLTFLoader().loadAsync(`/models/${SIT_CLIP}`)]);
        rig.scale.setScalar(CHARACTER_SCALE);
        rig.traverse((node) => {
            if (node.isMesh) node.material = new THREE.MeshStandardMaterial({ color: 0x42a5f5, roughness: 0.7 });
        });
        seatHolder.add(rig);
        mixer = new THREE.AnimationMixer(rig);
        const clip = sit.animations[0];
        if (clip) mixer.clipAction(clip).play();
        place();
    } catch (error) {
        console.warn('[tractor] miner preview failed', error);
        const stand = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.8, 4, 12), new THREE.MeshStandardMaterial({ color: 0x42a5f5 }));
        stand.position.y = 0.65;
        seatHolder.add(stand);
    }
}

// ---------------------------------------------------------------- smoke preview (same feel as DigEffects.smoke)

function makePuffTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d');
    const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

function puff(at, count, size, spread) {
    for (let n = 0; n < count; n++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture, color: tractor.smoke.color, transparent: true, depthWrite: false, opacity: 0 }));
        const angle = Math.random() * Math.PI * 2;
        const out = (0.4 + Math.random() * 0.8) * spread;
        sprite.position.set(at.x + Math.cos(angle) * 0.3 * spread, at.y + Math.random() * 0.4 * spread, at.z + Math.sin(angle) * 0.3 * spread);
        scene.add(sprite);
        const maxLife = 0.7 + Math.random() * 0.6;
        puffs.push({ sprite, maxLife, life: maxLife, size: size * (0.7 + Math.random() * 0.6), velocity: new THREE.Vector3(Math.cos(angle) * out, 0.8 + Math.random() * 0.9, Math.sin(angle) * out) });
    }
}

let exhaustTimer = 0;
function updatePuffs(delta) {
    exhaustTimer -= delta;
    if (exhaustTimer <= 0) {
        exhaustTimer = tractor.exhaust.interval;
        puff(exhaustMarker.position, 1, tractor.exhaust.size, 0.25);
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i];
        p.life -= delta;
        if (p.life <= 0) {
            p.sprite.removeFromParent();
            p.sprite.material.dispose();
            puffs.splice(i, 1);
            continue;
        }
        const t = 1 - p.life / p.maxLife;
        p.velocity.multiplyScalar(Math.max(0, 1 - delta * 2.5));
        p.sprite.position.addScaledVector(p.velocity, delta);
        p.sprite.scale.setScalar(p.size * (0.5 + t * 1.3));
        p.sprite.material.opacity = 0.85 * Math.min(1, t * 6) * (1 - t);
    }
}
