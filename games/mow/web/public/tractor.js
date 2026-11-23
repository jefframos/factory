// Tractor tab: the tractor the ridden mowers use (ui/mow.json `tractor`, read by TractorRide.ts): mounted in the
// sections not restored yet. The preview puts the player (the game's person in the people's sit clip) on the seat exactly as
// the game does — tractor stood on the floor at `height`, turned by `rotationY`, the player's feet at `seat` — and
// marks the exhaust, where it cuts and where the hands hold the steering wheel (`steer`). "Puff" plays the smoke. Saves only the tractor section of mow.json
// (PUT /api/mow/tractor); each ridden mower's price, stats, colour and size (`rideScale`) are its entry in `tools`.
//
// Also here, both in the tractor's frame (so they sit the same on every ridden mower, each just scaled by its rideScale):
//   - the bag's spot (`bag`: where the rucksack rides, its bottom middle; the tan box);
//   - the blades of each Blades level (`blades[level]`: middle and width): pick a level, place it, the next... Their
//     look per level (how many side by side, their size) is mow.json `bladeLevels` (PUT /api/mow/blade-levels), and
//     levels can be added or removed (the Blades upgrade's levels follow).

import * as THREE from 'three';
import { createGLTFLoader } from './gltf.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { api, el, toast } from './shared.js';

/** Same as MowPlayer / farm/People.ts: the player's person and their size (in the tractor's frame, at playerScale 1: the game scales both together). */
const PERSON = 'people/person-01.glb';
const PEOPLE_ANIMS = 'people/people-anims.glb';
const PERSON_SCALE = 1.6 / 1.83;
const DEG = Math.PI / 180;

/** [path in the tractor config, label, step, min, max] */
const FIELDS = [
    ['Tractor', [
        ['height', 'Height', 0.05, 0.5, 4],
        ['rotationY', 'Turn (°)', 5, -180, 180, 'deg'],
        ['bodyRadius', 'Footprint radius', 0.05, 0.2, 2],
        ['cutAhead', 'Cuts up to (ahead)', 0.05, 0, 4],
    ]],
    ['Seat (where the player sits)', [
        ['seat.x', 'Left / right', 0.01, -2, 2],
        ['seat.y', 'Up / down', 0.01, -1, 3],
        ['seat.z', 'Back / front', 0.01, -2, 2],
    ]],
    ['Steering wheel (where the hands hold, yellow dots)', [
        ['steer.x', 'Left / right', 0.01, -2, 2],
        ['steer.y', 'Up / down', 0.01, 0, 4],
        ['steer.z', 'Back / front', 0.01, -2, 2],
        ['steer.spread', 'Hands apart (each side)', 0.01, 0, 1],
        ['steer.hand.x', 'Hand turn X (°)', 1, -180, 180],
        ['steer.hand.y', 'Hand turn Y (°)', 1, -180, 180],
        ['steer.hand.z', 'Hand turn Z (°)', 1, -180, 180],
    ]],
    ['Hands on the biggest tractor (pink dots: where the hands sit from the seat, as shown)', [
        ['steerBig.x', 'Left / right', 0.01, -2, 2],
        ['steerBig.y', 'Up / down', 0.01, 0, 4],
        ['steerBig.z', 'Back / front', 0.01, -2, 2],
        ['steerBig.spread', 'Hands apart (each side)', 0.01, 0, 1],
    ]],
    ['Smoke puff (getting on / off)', [
        ['smoke.count', 'Puffs', 1, 1, 60],
        ['smoke.size', 'Size', 0.05, 0.1, 4],
    ]],
    ['Bag (where it rides: the same spot on every tractor)', [
        ['bag.x', 'Left / right', 0.01, -2, 2],
        ['bag.y', 'Up / down', 0.01, 0, 3],
        ['bag.z', 'Back / front', 0.01, -3, 3],
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
let mow;
let tractor;
let dirty = false;
/** The blade levels' look (mow.json bladeLevels: count side by side, size), and the level being placed. */
let bladeLevels = [];
let bladeLevel = 0;
let bladeLevelsDirty = false;
/** The blades shown (the level being placed), spinning; the bag's stand-in. */
const bladesHolder = new THREE.Group();
const bagMarker = new THREE.Group();
let renderer;
let scene;
let camera;
let controls;
let mixer;
let puffTexture;
const tractorHolder = new THREE.Group();
const seatHolder = new THREE.Group();
/** Where the hands hold the wheel (the game's IK targets: steer ± spread). */
const handMarkers = [0, 1].map(() => {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true }));
    // Over everything (the rig sits in front of the wheel).
    marker.renderOrder = 10;
    return marker;
});
/**
 * Where the hands hold on the biggest tractor (steerBig ± spread, pink): the game blends from the yellow dots (the
 * smallest tractor) to these by each tractor's size.
 */
const bigHandMarkers = [0, 1].map(() => {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff5fd2, depthTest: false, transparent: true }));
    marker.renderOrder = 10;
    return marker;
});
const exhaustMarker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff7043 }));
/** Where it cuts: a line from under the tractor to `cutAhead`. */
const cutMarker = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 1), new THREE.MeshBasicMaterial({ color: 0x5fd35a }));
const puffs = [];
const clock = new THREE.Clock();

export const hasUnsavedTractorChanges = () => dirty;

export async function initTractorTab(container) {
    host = container;
    mow = await api('/api/mow');
    tractor = mow.tractor;
    // Older configs have no steering wheel: one in front of the seat to start from.
    tractor.steer ??= { x: 0, y: tractor.seat.y + 0.3, z: tractor.seat.z + 0.6, spread: 0.17, hand: { x: 0, y: 63, z: 0 } };
    tractor.steer.hand ??= { x: 0, y: 0, z: 0 };
    // The biggest tractor's grip starts where the base one is.
    tractor.steerBig ??= { x: tractor.steer.x, y: tractor.steer.y, z: tractor.steer.z, spread: tractor.steer.spread };
    // Where the bag rides without one (the game's default: behind the seat).
    tractor.bag ??= { x: 0, y: 0.74, z: -1.2 };
    tractor.blades ??= [];
    bladeLevels = (mow.bladeLevels ?? [{ count: 1, size: 0.6 }]).map((level) => ({ ...level }));
    // The bag's stand-in: the rucksack's size (Backpack.ts BAG), its bottom on the spot.
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.28), new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.8 }));
    bag.position.y = 0.25;
    bagMarker.add(bag);
    buildLayout();
    setupViewport(host.querySelector('#tractorViewport'));
    void loadTractor();
    void loadPlayer();
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
            el('div', { class: 'hint-bar' }, 'Drag to orbit, wheel to zoom. The player faces +Z (the blue axis): turn the tractor so its front faces the same way. The orange dot is the exhaust, the green line where it cuts, the tan box the bag, the spinning blades the level being placed (right).')),
        el('aside', { class: 'sidebar right' }, bladesSection(), ...sections.slice(2)),
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

// ---------------------------------------------------------------- blades (per Blades level)

/** A level's placement: the saved one, else where the game puts it without (against the front, about the cut's width). */
function bladePlace(level) {
    const placed = tractor.blades[level];
    if (placed) return placed;
    const model = tractorHolder.userData.model;
    const front = model ? new THREE.Box3().setFromObject(model).max.z : 1;
    const width = 2;
    const look = bladeLevels[level] ?? { count: 1, size: 1 };
    const radius = Math.max(...bladeSpots(look, width).map((spot) => spot.length)) / 2;
    return { x: 0, y: 0.06, z: Number((front + radius * 0.3).toFixed(3)), width };
}

/** How many blades a level has (a grid's rows x cols, else its count): as the game's bladeCount(). */
const bladeCount = (look) => (look.layout === 'grid' ? Math.max(1, look.rows ?? 1) * Math.max(1, look.cols ?? 1) : look.count);

/** Each blade's spot and length across `width`: as the game's MowerBlades bladeSpots() (alternate, or a rows x cols grid). */
function bladeSpots(look, width) {
    const spots = [];
    if (look.layout === 'grid') {
        const rows = Math.max(1, Math.round(look.rows ?? 1));
        const cols = Math.max(1, Math.round(look.cols ?? 1));
        const span = width / cols;
        const length = span * look.size;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) spots.push({ x: -width / 2 + span * (c + 0.5), z: ((rows - 1) / 2 - r) * span, length });
        }
        return spots;
    }
    const count = Math.max(1, Math.round(look.count));
    const span = width / count;
    const length = count > 1 ? Math.max(span * look.size * 1.06, width * 0.45) : span * look.size;
    for (let i = 0; i < count; i++) spots.push({ x: -width / 2 + span * (i + 0.5), z: count > 1 ? (i % 2 === 0 ? 1 : -1) * length * 0.5 : 0, length });
    return spots;
}

/** A level's name in the list: its blades, its layout, whether it's placed. */
function levelName(i) {
    const l = bladeLevels[i];
    const count = bladeCount(l);
    const what = l.layout === 'grid' ? `${l.rows ?? 1} x ${l.cols ?? 1} grid` : count > 1 ? `${count} blades` : l.size >= 1 ? '1 big blade' : '1 small blade';
    return `${i}: ${what}${tractor.blades[i] ? '' : ' (not placed)'}`;
}

/** The Blades section: the level to place, its look (count, size), its middle and width; levels added / removed. */
function bladesSection() {
    const section = el('section', { class: 'card-section', id: 'bladesSection' });
    const render = () => {
        bladeLevel = Math.min(bladeLevel, bladeLevels.length - 1);
        const look = bladeLevels[bladeLevel];
        const place = bladePlace(bladeLevel);
        const row = (label, value, step, min, max, apply) => {
            const number = el('input', { type: 'number', step, value: Number(value.toFixed(3)), style: { width: '72px', flex: 'none' } });
            const slider = el('input', { type: 'range', min, max, step, value, style: { flex: '1', minWidth: '0' } });
            const set = (raw) => {
                const parsed = Number(raw);
                if (!Number.isFinite(parsed)) return;
                number.value = parsed;
                slider.value = parsed;
                apply(parsed);
                showBlades();
            };
            number.addEventListener('input', () => set(number.value));
            slider.addEventListener('input', () => set(slider.value));
            return el('label', { class: 'field' }, el('span', {}, label), el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', minWidth: '0' } }, slider, number));
        };
        // Editing a placement saves it for the level (a copy of where it showed).
        const placeField = (key, label, step, min, max) => row(label, place[key], step, min, max, (v) => {
            tractor.blades[bladeLevel] = { ...bladePlace(bladeLevel), [key]: v };
            touch();
        });
        const lookField = (key, label, step, min, max) => row(label, look[key] ?? 1, step, min, max, (v) => {
            look[key] = ['count', 'rows', 'cols'].includes(key) ? Math.max(1, Math.round(v)) : v;
            bladeLevelsDirty = true;
            touch();
            // (The level's name in the list follows its blades' number.)
            section.querySelector('select option:checked').textContent = levelName(bladeLevel);
        });
        const grid = look.layout === 'grid';
        section.replaceChildren(
            el('h2', {}, 'Blades (per Blades level: the same on every tractor)'),
            el('label', { class: 'field' }, el('span', {}, 'Level'),
                el('select', { onchange: (event) => { bladeLevel = Number(event.target.value); render(); showBlades(); } },
                    ...bladeLevels.map((l, i) => el('option', { value: i, selected: i === bladeLevel }, levelName(i))))),
            el('label', { class: 'field' }, el('span', {}, 'Layout'),
                el('select', { onchange: (event) => {
                    look.layout = event.target.value;
                    // A grid starts as the blades in one line; alternate keeps its count.
                    if (look.layout === 'grid') {
                        look.rows ??= 1;
                        look.cols ??= look.count;
                    } else {
                        delete look.rows;
                        delete look.cols;
                        delete look.layout;
                    }
                    bladeLevelsDirty = true;
                    touch();
                    render();
                    showBlades();
                } },
                    el('option', { value: 'alternate', selected: !grid }, 'Alternate (staggered ahead / behind)'),
                    el('option', { value: 'grid', selected: grid }, 'Grid (rows x columns, evenly spaced)'))),
            ...(grid
                ? [lookField('rows', 'Rows (front to back)', 1, 1, 6), lookField('cols', 'Columns (across)', 1, 1, 12)]
                : [lookField('count', 'Blades side by side', 1, 1, 12)]),
            lookField('size', 'Size (share of the width each)', 0.05, 0.1, 2),
            placeField('x', 'Left / right', 0.01, -2, 2),
            placeField('y', 'Up / down', 0.01, -0.5, 2),
            placeField('z', 'Back / front', 0.01, -3, 4),
            placeField('width', 'Width (across, all of them)', 0.02, 0.2, 6),
            el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                el('button', { onclick: () => {
                    // The next level: one blade more than the last, placed where the last was.
                    const last = bladeLevels[bladeLevels.length - 1];
                    bladeLevels.push(last.layout === 'grid'
                        ? { count: bladeCount(last) + 1, size: last.size, layout: 'grid', rows: last.rows ?? 1, cols: (last.cols ?? 1) + 1 }
                        : { count: last.count + 1, size: 1 });
                    if (tractor.blades[bladeLevels.length - 2]) tractor.blades[bladeLevels.length - 1] = { ...tractor.blades[bladeLevels.length - 2] };
                    bladeLevel = bladeLevels.length - 1;
                    bladeLevelsDirty = true;
                    touch();
                    render();
                    showBlades();
                } }, '+ Add level'),
                el('button', { onclick: () => {
                    if (bladeLevels.length <= 1) return;
                    bladeLevels.pop();
                    tractor.blades.length = Math.min(tractor.blades.length, bladeLevels.length);
                    bladeLevelsDirty = true;
                    touch();
                    render();
                    showBlades();
                } }, '− Remove last level'),
                el('button', { onclick: () => {
                    // Back to the game's default (unplaced).
                    tractor.blades[bladeLevel] = null;
                    touch();
                    render();
                    showBlades();
                } }, 'Reset this level')),
            el('p', { class: 'muted small' }, 'The blades show spinning on the tractor at its base size; in the game every tractor is this scaled by its size, so a level sits the same on all of them.'));
    };
    section.render = render;
    render();
    return section;
}

/** The level being placed, built as the game's MowerBlades (same shape: bars with red tips, hubs, sweep discs). */
function showBlades() {
    for (const child of [...bladesHolder.children]) child.removeFromParent();
    const look = bladeLevels[bladeLevel] ?? { count: 1, size: 1 };
    const place = bladePlace(bladeLevel);
    const width = place.width;
    const steel = new THREE.MeshStandardMaterial({ color: 0xe9eef3, metalness: 0.55, roughness: 0.3 });
    const tip = new THREE.MeshStandardMaterial({ color: 0xe0402f, roughness: 0.5 });
    const hub = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.7 });
    const sweep = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide });
    bladeSpots(look, width).forEach(({ x, z, length }, i) => {
        const blade = new THREE.Group();
        const wide = length * 0.13;
        blade.add(new THREE.Mesh(new THREE.BoxGeometry(length * 0.78, 0.03, wide), steel));
        for (const side of [-1, 1]) {
            const end = new THREE.Mesh(new THREE.BoxGeometry(length * 0.11, 0.036, wide * 1.15), tip);
            end.position.set(side * length * 0.445, 0, side * wide * 0.12);
            end.rotation.y = side * 0.25;
            blade.add(end);
        }
        blade.add(new THREE.Mesh(new THREE.CylinderGeometry(length * 0.12, length * 0.12, 0.072, 14), hub));
        const disc = new THREE.Mesh(new THREE.CircleGeometry(length / 2, 28), sweep);
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = -0.03;
        blade.add(disc);
        blade.position.set(x, 0, z);
        blade.userData.spin = i % 2 === 0 ? 1 : -1;
        bladesHolder.add(blade);
    });
    bladesHolder.position.set(place.x, place.y, place.z);
}

async function save() {
    try {
        if (bladeLevelsDirty) {
            await api('/api/mow/blade-levels', { method: 'PUT', body: JSON.stringify(bladeLevels) });
            bladeLevelsDirty = false;
        }
        // Unplaced levels as null (the game's default); none past the levels.
        tractor.blades = Array.from({ length: bladeLevels.length }, (_, i) => tractor.blades[i] ?? null);
        await api('/api/mow/tractor', { method: 'PUT', body: JSON.stringify(tractor) });
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
    scene.add(tractorHolder, seatHolder, exhaustMarker, cutMarker, bladesHolder, bagMarker, ...handMarkers, ...bigHandMarkers);
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
        for (const blade of bladesHolder.children) blade.rotation.y += delta * 6 * blade.userData.spin;
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
    handMarkers.forEach((marker, i) => marker.position.set(tractor.steer.x + (i ? -1 : 1) * tractor.steer.spread, tractor.steer.y, tractor.steer.z));
    bigHandMarkers.forEach((marker, i) => marker.position.set(tractor.steerBig.x + (i ? -1 : 1) * tractor.steerBig.spread, tractor.steerBig.y, tractor.steerBig.z));
    cutMarker.scale.z = Math.max(0.01, tractor.cutAhead);
    cutMarker.position.set(0, 0.03, tractor.cutAhead / 2);
    bagMarker.position.set(tractor.bag.x, tractor.bag.y, tractor.bag.z);
    showBlades();
}

async function loadTractor() {
    const gltf = await createGLTFLoader().loadAsync(`/models/${tractor.model}`).catch((error) => {
        toast(`Could not load ${tractor.model}: ${error.message}`, 'bad');
        return null;
    });
    if (!gltf) return;
    tractorHolder.add(gltf.scene);
    tractorHolder.userData.model = gltf.scene;
    place();
}

/** The game's player (a person) in the people's sit clip. */
async function loadPlayer() {
    try {
        const [rig, anims] = await Promise.all([createGLTFLoader().loadAsync(`/models/${PERSON}`).then((gltf) => gltf.scene), createGLTFLoader().loadAsync(`/models/${PEOPLE_ANIMS}`)]);
        rig.scale.setScalar(PERSON_SCALE);
        rig.traverse((node) => {
            if (node.isSkinnedMesh) node.frustumCulled = false;
        });
        seatHolder.add(rig);
        mixer = new THREE.AnimationMixer(rig);
        const clip = THREE.AnimationClip.findByName(anims.animations, 'sit');
        if (clip) mixer.clipAction(clip).play();
        place();
    } catch (error) {
        console.warn('[tractor] player preview failed', error);
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
