// Hats tab: positions, scales and turns each hat on the character's head. Writes ui/hatfits.json, which
// CharacterBody.setHat() reads, so a saved change shows up in the game on its next reload. The preview uses
// the same head (rounded cube, face on +Z) and the same placement math as the game, in head-size units.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { api, el, toast } from './shared.js';

const FIELDS = [
    ['x', 'Left / right', -1, 1, 0.01],
    ['y', 'Up / down', -1.2, 1, 0.01],
    ['z', 'Back / front', -1, 1, 0.01],
    ['scale', 'Scale', 0.3, 2.5, 0.01],
    ['rotationY', 'Turn (°)', -180, 180, 1],
];

let host;
let fits;
let hats = [];
let selected;
let dirty = false;
let renderer;
let scene;
let camera;
let controls;
let hatHolder;
let hatModel;
let hatSize;
let loadToken = 0;
const loader = new GLTFLoader();
const modelCache = new Map();

export const hasUnsavedHatChanges = () => dirty;

export async function initHatsTab(container) {
    host = container;
    [fits, hats] = await Promise.all([api('/api/hatfits'), api('/api/hats')]);
    fits.hats ??= {};
    selected = hats[0];
    buildLayout();
    void showHat();
}

export function refreshHatsTab() {
    resize();
}

const nameOf = (file) => file.replace(/\.(glb|gltf)$/i, '');
const fitFor = (file) => ({ ...fits.default, ...fits.hats[nameOf(file)] });
const isCustom = (file) => Boolean(fits.hats[nameOf(file)]);

function buildLayout() {
    const list = el('ul', { class: 'list', id: 'hatList' });
    const fields = el('div', { id: 'hatFields' });
    const status = el('span', { id: 'hat-status' });
    const viewport = el('div', { id: 'hatViewport', style: { position: 'relative', flex: '1', minHeight: '0', overflow: 'hidden' } });
    host.replaceChildren(
        el('aside', { class: 'sidebar left' },
            el('section', { class: 'card-section' },
                el('h2', {}, 'Hats'),
                el('div', { class: 'hint' }, '• = has its own fit; the rest use the default.'),
                list)),
        el('div', { class: 'stage-area' },
            el('div', { class: 'toolbar' },
                el('button', { class: 'primary', onclick: () => void saveHats() }, '💾 Save hats'),
                el('button', { onclick: () => copyJson() }, 'Copy JSON'),
                status),
            viewport,
            el('div', { id: 'hint' }, 'Drag to orbit, wheel to zoom. The blue face is the front of the head.')),
        el('aside', { class: 'sidebar right' },
            el('section', { class: 'card-section' }, el('h2', { id: 'hatTitle' }, ''), fields)),
    );
    setupViewport(viewport);
    renderList();
    renderFields();
    renderStatus();
}

function renderList() {
    const list = host.querySelector('#hatList');
    list.replaceChildren(...hats.map((file) => el('li', {
        class: file === selected ? 'active' : '',
        onclick: () => { selected = file; renderList(); renderFields(); void showHat(); },
    }, `${isCustom(file) ? '• ' : ''}${nameOf(file).replace(/_/g, ' ')}`)));
}

function renderFields() {
    const box = host.querySelector('#hatFields');
    host.querySelector('#hatTitle').textContent = selected ? nameOf(selected).replace(/_/g, ' ') : 'No hats found';
    if (!selected) {
        box.replaceChildren();
        return;
    }
    const fit = fitFor(selected);
    const rows = FIELDS.map(([key, label, min, max, step]) => {
        const number = el('input', { type: 'number', step, value: fit[key] });
        const slider = el('input', { type: 'range', min, max, step, value: fit[key] });
        const apply = (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return;
            fits.hats[nameOf(selected)] = { ...fitFor(selected), [key]: parsed };
            number.value = parsed;
            slider.value = parsed;
            touch();
            placeHat();
        };
        number.addEventListener('input', () => apply(number.value));
        slider.addEventListener('input', () => apply(slider.value));
        return el('label', { class: 'field' }, el('span', {}, label), el('div', {}, slider, number));
    });
    box.replaceChildren(
        ...rows,
        el('div', { class: 'row' },
            el('button', {
                onclick: () => { delete fits.hats[nameOf(selected)]; touch(); renderFields(); placeHat(); },
            }, 'Use default'),
            el('button', {
                onclick: () => { fits.default = { ...fitFor(selected) }; touch(); renderFields(); placeHat(); toast('Default updated'); },
            }, 'Make default')),
    );
}

function touch() {
    dirty = true;
    renderList();
    renderStatus();
}

function renderStatus() {
    const status = host.querySelector('#hat-status');
    status.textContent = dirty ? 'Unsaved changes' : 'Saved';
    status.className = dirty ? 'dirty' : '';
}

export async function saveHats() {
    if (!fits) return;
    await api('/api/hatfits', { method: 'PUT', body: JSON.stringify(fits) });
    dirty = false;
    renderStatus();
    toast('Hats saved — reload the game to see them');
}

function copyJson() {
    void navigator.clipboard.writeText(JSON.stringify(fits, null, 2));
    toast('Hat fits copied');
}

// ---------------------------------------------------------------- preview

function setupViewport(viewport) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    viewport.append(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d2230);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(1.6, 1.4, 3.2);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.3, 0);
    controls.update();

    // Same head as the game: a rounded cube, size 1, face on +Z.
    const head = new THREE.Mesh(new RoundedBoxGeometry(1, 1, 1, 4, 0.25), new THREE.MeshStandardMaterial({ color: 0x4fb6ff, roughness: 0.6 }));
    scene.add(head);
    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x14161c });
    for (const x of [-0.2, 0.2]) {
        const eye = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), eyeMaterial);
        eye.position.set(x, 0.05, 0.501);
        head.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.05), eyeMaterial);
    mouth.position.set(0, -0.2, 0.501);
    head.add(mouth);
    const grid = new THREE.GridHelper(3, 12, 0x3a4256, 0x2a3040);
    grid.position.y = -0.5;
    scene.add(grid);

    hatHolder = new THREE.Group();
    scene.add(hatHolder);
    new ResizeObserver(() => resize()).observe(viewport);
    resize();
    const loop = () => {
        requestAnimationFrame(loop);
        if (host.closest('.tab-panel')?.hidden) return;
        controls.update();
        renderer.render(scene, camera);
    };
    loop();
}

function resize() {
    if (!renderer) return;
    const viewport = renderer.domElement.parentElement;
    const width = viewport.clientWidth || 1;
    const height = viewport.clientHeight || 1;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}

async function showHat() {
    const token = ++loadToken;
    hatHolder.clear();
    hatModel = undefined;
    if (!selected) return;
    const url = `/models/hats/${selected}`;
    if (!modelCache.has(url)) {
        modelCache.set(url, loader.loadAsync(url).then((gltf) => gltf.scene));
    }
    const source = await modelCache.get(url);
    if (token !== loadToken) return;
    // Same normalisation as CharacterBody.setHat(): centred on X/Z, resting on its lowest point.
    const object = source.clone(true);
    object.updateWorldMatrix(false, true);
    const box = new THREE.Box3().setFromObject(object);
    hatSize = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.set(-center.x, -box.min.y, -center.z);
    hatModel = new THREE.Group();
    hatModel.add(object);
    hatHolder.add(hatModel);
    placeHat();
}

function placeHat() {
    if (!hatModel || !selected) return;
    const fit = fitFor(selected);
    hatModel.scale.setScalar(fit.scale / Math.max(hatSize.x, hatSize.z, 1e-6));
    hatModel.position.set(fit.x, 0.5 + fit.y, fit.z);
    hatModel.rotation.y = THREE.MathUtils.degToRad(fit.rotationY);
}
