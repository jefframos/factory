// Library picker popup: browses the 3D asset library (D:/projects/PIXI3d/library3d, glTF/GLB only, the formats the
// game loads), previews a model in 3D and imports it into the game (server: /api/library/import copies it and its
// textures under raw-assets/models/hub{m}/ and public/dig/models/hub/). Pack chips + search like the library viewer.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { api, el, openModal, toast } from './shared.js';

const PAGE = 240;
const loader = new GLTFLoader();
let library;

/** Opens the picker; `onImported(path)` gets the imported model's path under models/. */
export async function openLibraryPicker({ onImported }) {
    library ??= await api('/api/library');
    if (!library.available) {
        toast(`3D library not found at ${library.dir} (set LIBRARY3D_DIR)`, 'bad');
        return;
    }
    let selected = null;
    let pack = 'All';
    let query = '';
    let shown = PAGE;

    const modal = openModal({ title: '📚 Import from the 3D library', wide: true, onClose: () => preview.dispose() });
    modal.dialog.classList.add('picker');
    const search = el('input', { class: 'search', type: 'search', placeholder: 'Search the library (name, tag, pack)…' });
    const count = el('span', { class: 'muted' });
    const chips = el('div', { class: 'chips' });
    const grid = el('div', { class: 'grid models' });
    const canvasHost = el('div', { class: 'preview-canvas' });
    const nameLabel = el('div', { class: 'preview-name' }, 'Select a model');
    const info = el('div', { class: 'muted small', style: { whiteSpace: 'pre-line' } });
    modal.body.append(el('div', { class: 'picker-layout' },
        el('div', { class: 'picker-main' }, el('div', { class: 'picker-tools' }, search, count), chips, grid),
        el('aside', { class: 'picker-side' }, canvasHost, nameLabel, info)));
    const confirm = el('button', { class: 'primary', disabled: true, onclick: () => void importSelected() }, 'Import into the game');
    modal.footer.append(el('span', { class: 'muted' }, 'Copies the model and its textures into games/dig (no rebuild needed).'),
        el('span', { class: 'spacer' }), el('button', { onclick: () => modal.close() }, 'Cancel'), confirm);
    const preview = createPreview(canvasHost);

    async function importSelected() {
        if (!selected) return;
        confirm.disabled = true;
        confirm.textContent = 'Importing…';
        try {
            const result = await api('/api/library/import', { method: 'POST', body: JSON.stringify({ id: selected.id }) });
            result.warnings?.forEach((warning) => toast(warning, 'warn'));
            modal.close();
            onImported(result.path);
        } catch (error) {
            toast(`Import failed: ${error.message}`, 'bad');
            confirm.disabled = false;
            confirm.textContent = 'Import into the game';
        }
    }

    function select(asset) {
        selected = asset;
        nameLabel.textContent = asset.name;
        info.textContent = `${asset.pack} · ${asset.collection}\n${asset.tags.join(', ')}`;
        confirm.disabled = false;
        grid.querySelectorAll('.card.selected').forEach((card) => card.classList.remove('selected'));
        grid.querySelector(`.card[data-id="${CSS.escape(asset.id)}"]`)?.classList.add('selected');
        void preview.show(`/library-files/${asset.file}`);
    }

    function matches(asset) {
        if (pack !== 'All' && asset.pack !== pack) return false;
        const haystack = `${asset.name} ${asset.collection} ${asset.pack} ${asset.tags.join(' ')}`.toLowerCase();
        return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
    }

    function renderChips() {
        const packs = ['All', ...new Set(library.assets.map((asset) => asset.pack))];
        chips.replaceChildren(...packs.map((name) => el('button', {
            class: `chip${name === pack ? ' active' : ''}`,
            onclick: () => { pack = name; shown = PAGE; renderChips(); renderGrid(); },
        }, name)));
    }

    function renderGrid() {
        const visible = library.assets.filter(matches);
        count.textContent = `${visible.length} model${visible.length === 1 ? '' : 's'}`;
        const cards = visible.slice(0, shown).map((asset) => el('div', {
            class: `card${asset === selected ? ' selected' : ''}`,
            dataset: { id: asset.id },
            title: asset.id,
            onclick: () => select(asset),
            ondblclick: () => { select(asset); void importSelected(); },
        }, el('div', { class: 'thumb' }, asset.thumb ? el('img', { src: asset.thumb, alt: '', loading: 'lazy', draggable: false }) : el('div', { class: 'ph' }, '🧊')),
        el('div', { class: 'label' }, asset.name),
        el('div', { class: 'sub' }, asset.collection || asset.pack)));
        if (visible.length > shown) {
            cards.push(el('button', { onclick: () => { shown += PAGE; renderGrid(); } }, `Show more (${visible.length - shown} left)`));
        }
        grid.replaceChildren(...cards);
    }

    search.addEventListener('input', () => { query = search.value; shown = PAGE; renderGrid(); });
    renderChips();
    renderGrid();
    search.focus();
}

function createPreview(host) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 2.5;
    let object;
    let raf = 0;
    let token = 0;
    const resize = () => {
        renderer.setSize(host.clientWidth || 300, host.clientHeight || 300);
        camera.aspect = (host.clientWidth || 300) / (host.clientHeight || 300);
        camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const tick = () => {
        raf = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
    };
    tick();
    return {
        async show(url) {
            const mine = ++token;
            const gltf = await loader.loadAsync(url).catch(() => null);
            if (mine !== token) return;
            if (object) scene.remove(object);
            object = gltf?.scene;
            if (!object) return;
            scene.add(object);
            const box = new THREE.Box3().setFromObject(object);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const radius = Math.max(size.x, size.y, size.z, 0.1);
            controls.target.copy(center);
            camera.position.copy(center).add(new THREE.Vector3(radius * 1.4, radius * 0.9, radius * 1.6));
            camera.near = radius / 100;
            camera.far = radius * 100;
            camera.updateProjectionMatrix();
        },
        dispose() {
            cancelAnimationFrame(raf);
            observer.disconnect();
            controls.dispose();
            renderer.dispose();
        },
    };
}
