// Model picker popup: searchable thumbnail grid + interactive 3D preview (orbit, wireframe, stats).
// Thumbnails are rendered once in the browser and cached on the server (web/.thumbs).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { el, openModal, createQueue } from './shared.js';

const THUMB_SIZE = 192;
const loader = new GLTFLoader();
const sourceCache = new Map();
const enqueue = createQueue();
let catalog = [];
let thumbRenderer;
let thumbScene;
let thumbCamera;

export function setModelCatalog(models) {
    catalog = models;
}

export function modelThumbUrl(path) {
    const model = catalog.find((entry) => entry.path === path);
    return model?.thumb ? `/thumbs/${encodeURIComponent(model.thumb)}` : null;
}

function loadSource(path) {
    if (!sourceCache.has(path)) {
        sourceCache.set(path, loader.loadAsync(`/models/${path}`).then((gltf) => gltf.scene));
    }
    return sourceCache.get(path);
}

function addLights(scene) {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
}

/** Centers the object on the origin and returns a camera distance that fits it. */
function frame(object, camera, controls) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const radius = Math.max(size.length() / 2, 0.01);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.position.set(distance * 0.55, distance * 0.4, distance * 0.8);
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    if (controls) {
        controls.target.set(0, 0, 0);
        controls.minDistance = distance * 0.2;
        controls.maxDistance = distance * 4;
        controls.update();
    }
    return size;
}

function ensureThumbRenderer() {
    if (thumbRenderer) return;
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
    thumbRenderer.setPixelRatio(1);
    thumbScene = new THREE.Scene();
    addLights(thumbScene);
    thumbCamera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
}

async function renderThumb(model) {
    ensureThumbRenderer();
    const object = (await loadSource(model.path)).clone(true);
    thumbScene.add(object);
    frame(object, thumbCamera);
    thumbRenderer.render(thumbScene, thumbCamera);
    const blob = await new Promise((resolve) => thumbRenderer.domElement.toBlob(resolve, 'image/png'));
    thumbScene.remove(object);
    await fetch(`/api/thumb?name=${encodeURIComponent(model.thumbName)}`, { method: 'POST', body: blob });
    model.thumb = model.thumbName;
}

function ensureThumb(model, image, placeholder) {
    if (model.thumb) {
        image.src = `/thumbs/${encodeURIComponent(model.thumb)}`;
        placeholder.remove();
        return;
    }
    if (model.thumbPending) return;
    model.thumbPending = true;
    enqueue(async () => {
        try {
            await renderThumb(model);
            image.src = `/thumbs/${encodeURIComponent(model.thumb)}?v=${Date.now()}`;
            placeholder.remove();
        } catch {
            placeholder.textContent = '⚠';
        } finally {
            model.thumbPending = false;
        }
    });
}

const topFolder = (path) => path.split('/')[0];
const fileLabel = (path) => path.split('/').pop().replace(/\.(glb|gltf)$/i, '');

/**
 * @param {{ current?: string|null, title?: string, confirmLabel?: string, onPick: (path: string) => void }} options
 */
export function openModelPicker({ current = null, title = 'Choose a model', confirmLabel = 'Use model', onPick }) {
    let selected = current && catalog.some((model) => model.path === current) ? current : null;
    let category = 'All';
    let query = '';
    let preview;

    const modal = openModal({ title, wide: true, onClose: () => preview?.dispose() });
    modal.dialog.classList.add('picker');

    const search = el('input', { class: 'search', type: 'search', placeholder: 'Search models…', autofocus: true });
    const chips = el('div', { class: 'chips' });
    const grid = el('div', { class: 'grid models' });
    const count = el('span', { class: 'muted' });
    const left = el('div', { class: 'picker-main' }, el('div', { class: 'picker-tools' }, search, count), chips, grid);

    const canvasHost = el('div', { class: 'preview-canvas' });
    const nameLabel = el('div', { class: 'preview-name' }, 'Select a model');
    const pathLabel = el('div', { class: 'muted small' });
    const stats = el('div', { class: 'stats' });
    const wireframe = el('input', { type: 'checkbox' });
    const spin = el('input', { type: 'checkbox', checked: true });
    const options = el('div', { class: 'preview-options' },
        el('label', {}, spin, ' Auto-rotate'), el('label', {}, wireframe, ' Wireframe'));
    const right = el('aside', { class: 'picker-side' }, canvasHost, nameLabel, pathLabel, stats, options);
    modal.body.append(el('div', { class: 'picker-layout' }, left, right));

    const confirm = el('button', { class: 'primary', disabled: true, onclick: () => pick() }, confirmLabel);
    modal.footer.append(el('span', { class: 'muted' }, 'Double-click a model to use it right away.'), el('span', { class: 'spacer' }),
        el('button', { onclick: () => modal.close() }, 'Cancel'), confirm);

    function pick() {
        if (!selected) return;
        const path = selected;
        modal.close();
        onPick(path);
    }

    function createPreview() {
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        canvasHost.append(renderer.domElement);
        const scene = new THREE.Scene();
        addLights(scene);
        const grid3 = new THREE.GridHelper(10, 10, 0x4b5563, 0x2f3641);
        scene.add(grid3);
        const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        let object;
        let raf = 0;
        let disposed = false;

        const resize = () => {
            const width = canvasHost.clientWidth || 300;
            const height = canvasHost.clientHeight || 300;
            renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvasHost);
        resize();

        const tick = () => {
            if (disposed) return;
            raf = requestAnimationFrame(tick);
            controls.autoRotate = spin.checked;
            controls.autoRotateSpeed = 2.5;
            controls.update();
            renderer.render(scene, camera);
        };
        tick();

        return {
            async show(path) {
                if (object) scene.remove(object);
                stats.textContent = 'Loading…';
                try {
                    const source = await loadSource(path);
                    if (disposed || selected !== path) return;
                    object = source.clone(true);
                    let triangles = 0;
                    object.traverse((node) => {
                        if (node.isMesh) {
                            triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.attributes.position.count) / 3;
                            node.userData.baseMaterial = node.material;
                        }
                    });
                    scene.add(object);
                    const size = frame(object, camera, controls);
                    const floor = -size.y / 2;
                    grid3.position.y = floor;
                    grid3.scale.setScalar(Math.max(size.x, size.z, 0.5) / 5);
                    stats.textContent = `${Math.round(triangles).toLocaleString()} triangles · ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
                    this.setWireframe(wireframe.checked);
                } catch (error) {
                    stats.textContent = `Could not load: ${error.message}`;
                }
            },
            setWireframe(on) {
                object?.traverse((node) => {
                    if (!node.isMesh) return;
                    const materials = Array.isArray(node.material) ? node.material : [node.material];
                    materials.forEach((material) => { material.wireframe = on; });
                });
            },
            dispose() {
                disposed = true;
                cancelAnimationFrame(raf);
                observer.disconnect();
                controls.dispose();
                renderer.dispose();
            },
        };
    }

    function select(path) {
        selected = path;
        nameLabel.textContent = fileLabel(path);
        pathLabel.textContent = path;
        confirm.disabled = false;
        grid.querySelectorAll('.card.selected').forEach((card) => card.classList.remove('selected'));
        grid.querySelector(`.card[data-path="${CSS.escape(path)}"]`)?.classList.add('selected');
        preview ??= createPreview();
        void preview.show(path);
    }

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const model = catalog.find((candidate) => candidate.path === entry.target.dataset.path);
            ensureThumb(model, entry.target.querySelector('img'), entry.target.querySelector('.ph'));
        }
    }, { root: grid, rootMargin: '200px' });

    function renderChips() {
        const categories = ['All', ...new Set(catalog.map((model) => topFolder(model.path)).filter((name) => name))].filter((name, index, list) => list.indexOf(name) === index);
        chips.replaceChildren(...categories.map((name) => el('button', {
            class: `chip${name === category ? ' active' : ''}`,
            onclick: () => { category = name; renderChips(); renderGrid(); },
        }, name)));
    }

    function renderGrid() {
        observer.disconnect();
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const visible = catalog.filter((model) => (category === 'All' || topFolder(model.path) === category)
            && terms.every((term) => model.path.toLowerCase().includes(term)));
        count.textContent = `${visible.length} model${visible.length === 1 ? '' : 's'}`;
        grid.replaceChildren(...visible.map((model) => {
            const image = el('img', { alt: '', draggable: false });
            const card = el('div', {
                class: `card${model.path === selected ? ' selected' : ''}`,
                dataset: { path: model.path },
                title: model.path,
                onclick: () => select(model.path),
                ondblclick: () => { select(model.path); pick(); },
            }, el('div', { class: 'thumb' }, image, el('div', { class: 'ph' }, '…')),
            el('div', { class: 'label' }, fileLabel(model.path)),
            el('div', { class: 'sub' }, model.path.split('/').slice(0, -1).join('/')));
            observer.observe(card);
            return card;
        }));
        grid.querySelector('.card.selected')?.scrollIntoView({ block: 'center' });
    }

    search.addEventListener('input', () => { query = search.value; renderGrid(); });
    wireframe.addEventListener('change', () => preview?.setWireframe(wireframe.checked));
    renderChips();
    renderGrid();
    if (selected) select(selected);
    search.focus();
}
