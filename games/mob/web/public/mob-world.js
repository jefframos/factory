// mob-world.js — the editor's World map tab: the main screen's map (games/mob/ui/worldmap.json), made of KayKit's
// Medieval Hexagon pack (public/mob/models/hexa/, served here at /models/hexa/): each cell a ground tile (grass, water,
// coast, river, road) and maybe something standing on it (a building, trees, a mountain, a prop).
//
// The grid top-down: paint (the palette's pick: a ground tile replaces the cell's ground, keeping what stands on it;
// something to stand puts it on the cell, on grass if the cell was empty; with the area picked to paint with), select
// one to change it, erase. Each tile can belong to an area (a zone): an area's tiles are a group on the main screen (in
// colour once it's reached, outlined while it's being played, its marker over them). A tile with no area is scenery: it shows once
// an area next to it is reached. Wheel to zoom, right-drag to pan, R turns the selected tile, PageUp / PageDown raise
// or lower it (Shift: what stands on it); the whole map can be raised out of the sea too. Colour: the whole map's hue,
// saturation and brightness, and each tile's on top (grass turned to desert sand, or snow), the ground's only (what
// stands on it keeps its own): the Colour brush paints one colour over many tiles (drag across them; Alt+click picks a
// tile's up). What stands on a tile comes off with Clear top (a tool: click or drag over tiles), the panel's Remove, or C.
//
// The pack's hexagons are pointy-topped (the game's WorldMap.ts: x = q + r / 2, z = 0.866 r, times their width).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROW = Math.sqrt(3) / 2;
const RADIUS = 1 / Math.sqrt(3);
/** A colour per kind of tile (by its name's start), for the grid. */
const KIND_COLOURS = [
    ['hex_water', '#3fa9f0'], ['hex_river', '#5fc0ff'], ['hex_coast', '#e9d58f'], ['hex_road', '#c8b07a'], ['hex_grass', '#7cc95a'],
];
const MODELS = '/models/hexa/';
/** A tile seen straight down (the grid's pictures): the pack's tiles are 2 across (flat side to flat side), so a
 *  square picture 2 / sqrt(3) either way of the middle holds one point to point; drawn on the grid that size, every
 *  tile (and what stands on it) is at its true size and lines up with its neighbours. */
const TOP = { half: 2 / Math.sqrt(3), size: 160 };
/** How much a tile's raised or lowered a step (world units). */
const HEIGHT_STEP = 0.1;
const round2 = (v) => Math.round(v * 100) / 100;
/** Each area's outline colour, by its place in the zones list. */
const ZONE_COLOURS = ['#ffd23f', '#ff6b9e', '#4cff7a', '#7ad7ff', '#ff9f3a', '#c58bff', '#ffffff'];

const kindColour = (model) => (KIND_COLOURS.find(([prefix]) => model.startsWith(prefix)) ?? [null, '#8f8f8f'])[1];
const toWorld = (q, r) => [q + r / 2, r * ROW];
function toHex(x, z) {
    const r = z / ROW;
    const q = x - r / 2;
    // Round in cube coordinates (the nearest hexagon).
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(-q - r);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - (-q - r));
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return [rq, rr];
}

/**
 * Builds the tab into `panel`. `tools`: the editor's helpers (el, api, toast), its state (the zones), its status line,
 * and the game's URL (for the preview).
 */
export function buildWorldTab(panel, { el, api, toast, state, statusLine }) {
    const world = { tiles: [], lift: 0, hue: 0, saturation: 1, brightness: 1, models: [], decor: [], pick: 'hex_grass', paintZone: '', tool: 'paint', selected: -1, dirty: false };
    /** The Colour brush: what it paints on the tiles it goes over (all three as they are: it takes their colour off). */
    const brush = { hue: 0, saturation: 1, brightness: 1 };
    const view = { scale: 46, ox: 0, oy: 0 };
    const thumbs = new Map();
    const palette = el('div', { class: 'list', style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', padding: '6px', alignContent: 'start' } });
    const canvas = el('canvas', { style: { position: 'absolute', inset: '0', width: '100%', height: '100%', cursor: 'crosshair' } });
    const ctx = canvas.getContext('2d');
    const props = el('div', { class: 'props' });
    const preview = el('iframe', { title: 'Main screen', style: { flex: 1, border: 0, width: '100%', background: '#0b0d1a' } });
    const zoneSelect = el('select', { title: 'The area a painted tile belongs to', onchange: (e) => { world.paintZone = e.target.value; } });
    /** What the preview shows: '' the player's own progress, 'all' the whole map (every area beaten), or an area's id
     *  (the player just come to it). The game's ?map= (HomeScene); the save isn't touched. */
    let previewMap = 'all';
    const viewSelect = el('select', { title: 'What the main screen preview shows', onchange: (e) => { previewMap = e.target.value; reloadPreview(); } });
    const toolButtons = {};
    const tool = (id, label, title) => {
        toolButtons[id] = el('button', { title, onclick: () => setTool(id) }, label);
        return toolButtons[id];
    };
    const setTool = (id, redraw = true) => {
        world.tool = id;
        Object.entries(toolButtons).forEach(([key, button]) => button.classList.toggle('on', key === id));
        // Not while the tab is being built (the panel's helpers further down aren't there yet).
        if (redraw) renderProps();
    };

    panel.append(
        el('aside', { style: { width: '250px' } }, el('div', { class: 'hint', style: { padding: '6px 8px', margin: 0 } }, 'Pick one, then paint: a ground tile, or something to stand on one'), palette),
        el('div', { class: 'editor' },
            el('div', { class: 'toolbar' },
                tool('paint', 'Paint', 'Click a cell: the picked tile goes there (with the area chosen next to it)'),
                el('span', { class: 'hint', style: { margin: '0 2px' } }, 'area'), zoneSelect,
                tool('select', 'Select', 'Click a tile to change it (R turns it)'),
                tool('erase', 'Erase', 'Click a tile to take it out'),
                tool('tint', 'Colour', 'Paint the brush\'s colour (set in the panel) on the tiles you click or drag over; Alt+click picks a tile\'s up'),
                tool('clear', 'Clear top', 'Click (or drag over) tiles: what stands on them comes off, the ground stays (C: the selected one)'),
                el('span', { class: 'sep' }),
                el('button', { title: 'Back to the middle', onclick: () => { view.ox = 0; view.oy = 0; resize(); } }, 'Centre'),
                el('span', { style: { flex: 1 } }),
                el('button', { class: 'primary', onclick: () => save() }, 'Save map')),
            el('div', { class: 'work' }, el('div', { class: 'canvas-wrap' }, canvas), props)),
        el('div', { class: 'preview' },
            el('div', { class: 'bar' }, el('span', { class: 'hint' }, 'The main screen (saved map)'), el('span', { style: { flex: 1 } }),
                viewSelect, el('button', { onclick: () => reloadPreview() }, 'Reload')),
            preview),
    );
    setTool('paint', false);

    const zones = () => state.zones.zones;
    const zoneColour = (id) => ZONE_COLOURS[Math.max(0, zones().findIndex((zone) => zone.id === id)) % ZONE_COLOURS.length];
    const at = (q, r) => world.tiles.findIndex((tile) => tile.q === q && tile.r === r);
    const changed = () => {
        world.dirty = true;
        statusLine.textContent = 'World map not saved';
        renderProps();
        draw();
    };

    function refreshZones() {
        zoneSelect.replaceChildren(el('option', { value: '' }, '(scenery)'), ...zones().map((zone) => el('option', { value: zone.id, selected: zone.id === world.paintZone }, zone.name)));
        if (previewMap && previewMap !== 'all' && !zones().some((zone) => zone.id === previewMap)) previewMap = 'all';
        viewSelect.replaceChildren(
            el('option', { value: 'all', selected: previewMap === 'all' }, 'Whole map'),
            el('option', { value: '', selected: previewMap === '' }, "Player's progress (the save)"),
            ...zones().map((zone, i) => el('option', { value: zone.id, selected: zone.id === previewMap }, `At area ${i + 1}: ${zone.name}`)));
    }

    // ---------------------------------------------------------------- the palette (thumbnails rendered once)

    let renderer = null;
    /** One render at a time (a model's load, then its picture), in the order asked. */
    let queue = Promise.resolve();
    const pending = new Map();
    /** `model`'s picture: from above at an angle (the palette), or `top`: straight down at its true size (the grid). */
    function thumbnail(model, top = false) {
        const key = top ? `top:${model}` : model;
        if (thumbs.has(key)) return Promise.resolve(thumbs.get(key));
        if (!pending.has(key)) {
            const job = queue.then(() => renderThumbnail(model, top));
            queue = job.catch(() => undefined);
            pending.set(key, job);
        }
        return pending.get(key);
    }
    async function renderThumbnail(model, top) {
        const key = top ? `top:${model}` : model;
        if (thumbs.has(key)) return thumbs.get(key);
        if (!renderer) {
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
            renderer.setSize(96, 96);
        }
        const scene = new THREE.Scene();
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(2, 4, 3);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 2.2), sun);
        const gltf = await new GLTFLoader().loadAsync(`${MODELS}${model}.gltf`);
        scene.add(gltf.scene);
        // Framed to its size (a tile's 2 across; a castle's tall).
        let camera;
        if (top) {
            // Straight down on the tile's middle (where it stands, not its box: a building off-centre stays so), up
            // the picture = -z, as the grid has it.
            renderer.setSize(TOP.size, TOP.size);
            camera = new THREE.OrthographicCamera(-TOP.half, TOP.half, TOP.half, -TOP.half, 0.1, 200);
            camera.position.set(0, 100, 0);
            camera.up.set(0, 0, -1);
            camera.lookAt(0, 0, 0);
        } else {
            renderer.setSize(96, 96);
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const size = box.getSize(new THREE.Vector3());
            const reach = Math.max(size.x, size.z, size.y * 0.9, 0.5);
            camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
            const middle = box.getCenter(new THREE.Vector3());
            camera.position.set(middle.x, middle.y + reach * 1.9, middle.z + reach * 1.75);
            camera.lookAt(middle);
        }
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL();
        thumbs.set(key, url);
        // What it loaded is freed: only the picture's kept.
        gltf.scene.traverse((child) => {
            if (!child.isMesh) return;
            child.geometry.dispose();
            [child.material].flat().forEach((material) => { material.map?.dispose(); material.dispose(); });
        });
        return url;
    }

    function renderPalette() {
        const heading = (text) => el('div', { class: 'hint', style: { gridColumn: '1 / -1', margin: '6px 0 0' } }, text);
        palette.replaceChildren(heading('Tiles (the ground)'), ...world.models.map(paletteCell), heading('On top (buildings, nature, props)'), ...world.decor.map(paletteCell));
    }

    function paletteCell(model) {
        {
            const image = el('img', { width: 64, height: 64, style: { display: 'block', margin: '0 auto' } });
            const cell = el('div', {
                title: model,
                style: { cursor: 'pointer', borderRadius: '6px', padding: '3px', textAlign: 'center', fontSize: '10px', color: '#c9d0ff', background: model === world.pick ? '#2f3a7a' : '#262b52', border: `2px solid ${model === world.pick ? '#4f8cff' : 'transparent'}` },
                onclick: () => {
                    world.pick = model;
                    setTool('paint');
                    renderPalette();
                },
            }, image, model);
            void thumbnail(model).then((url) => { image.src = url; }).catch(() => { image.alt = '?'; });
            return cell;
        }
    }

    // ---------------------------------------------------------------- the grid

    function resize() {
        const box = canvas.parentElement.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, box.width * ratio);
        canvas.height = Math.max(1, box.height * ratio);
        draw();
    }
    const screenOf = (x, z) => {
        const box = canvas.getBoundingClientRect();
        return [box.width / 2 + view.ox + x * view.scale, box.height / 2 + view.oy + z * view.scale];
    };
    const worldOf = (sx, sy) => {
        const box = canvas.getBoundingClientRect();
        return [(sx - box.width / 2 - view.ox) / view.scale, (sy - box.height / 2 - view.oy) / view.scale];
    };

    function hexPath(q, r, inset = 0) {
        const [x, z] = toWorld(q, r);
        const radius = RADIUS - inset;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
            const angle = Math.PI / 6 + (k * Math.PI) / 3;
            const [sx, sy] = screenOf(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius);
            if (k === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
    }

    function draw() {
        const ratio = window.devicePixelRatio || 1;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const box = canvas.getBoundingClientRect();
        ctx.fillStyle = '#0f1a33';
        ctx.fillRect(0, 0, box.width, box.height);
        // The empty grid round what's placed.
        const [cq, cr] = toHex(...worldOf(box.width / 2, box.height / 2));
        const reach = Math.ceil(Math.max(box.width, box.height) / view.scale / 1.6) + 2;
        ctx.strokeStyle = 'rgba(120,140,220,0.18)';
        ctx.lineWidth = 1;
        for (let r = cr - reach; r <= cr + reach; r++) {
            for (let q = cq - reach - Math.ceil(reach / 2); q <= cq + reach + Math.ceil(reach / 2); q++) {
                hexPath(q, r);
                ctx.stroke();
            }
        }
        // Each area's fill order.
        const order = new Map();
        for (const tile of world.tiles) {
            if (!tile.zone) continue;
            order.set(tile.zone, (order.get(tile.zone) ?? 0) + 1);
            tile.__n = order.get(tile.zone);
        }
        world.tiles.forEach((tile, i) => {
            hexPath(tile.q, tile.r, 0.02);
            ctx.fillStyle = kindColour(tile.model);
            ctx.fill();
            const [x, z] = toWorld(tile.q, tile.r);
            const [sx, sy] = screenOf(x, z);
            // Its ground (its colour changed), and what stands on it over that: both seen straight down at their true
            // size (a grid cell is 1 across, the pack's tile 2: the picture's 2 * TOP.half of the pack's units).
            for (const name of [tile.model, tile.decor]) {
                const thumb = name && thumbs.get(`top:${name}`);
                if (!thumb) continue;
                const image = imageOf(thumb);
                const px = view.scale * TOP.half;
                ctx.save();
                hexPath(tile.q, tile.r, 0.04);
                ctx.clip();
                ctx.translate(sx, sy);
                // The game turns it about y (rotation.y): seen from above with z down the screen, the other way round.
                ctx.rotate(-((tile.rot ?? 0) * Math.PI) / 3);
                ctx.filter = name === tile.model ? filterOf(tile) : 'none';
                if (image.complete) ctx.drawImage(image, -px / 2, -px / 2, px, px);
                ctx.restore();
            }
            if (tile.zone) {
                hexPath(tile.q, tile.r, 0.05);
                ctx.strokeStyle = zoneColour(tile.zone);
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.fillStyle = '#000a';
                ctx.beginPath();
                ctx.arc(sx, sy + view.scale * 0.2, view.scale * 0.17, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = zoneColour(tile.zone);
                ctx.font = `bold ${Math.round(view.scale * 0.22)}px system-ui`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(tile.__n), sx, sy + view.scale * 0.2);
            }
            if (i === world.selected) {
                hexPath(tile.q, tile.r, 0);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 3;
                ctx.setLineDash([5, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });
        // The hovered cell.
        if (hover) {
            hexPath(hover[0], hover[1]);
            ctx.strokeStyle = world.tool === 'erase' ? '#ff4f63' : '#ffe14d';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
    const images = new Map();
    function imageOf(url) {
        let image = images.get(url);
        if (!image) {
            image = new Image();
            image.onload = () => draw();
            image.src = url;
            images.set(url, image);
        }
        return image;
    }

    // ---------------------------------------------------------------- pointer

    let hover = null;
    let pan = null;
    let painting = false;
    const cellOf = (event) => {
        const box = canvas.getBoundingClientRect();
        return toHex(...worldOf(event.clientX - box.left, event.clientY - box.top));
    };
    function apply(q, r) {
        const index = at(q, r);
        if (world.tool === 'paint') {
            const standing = world.decor.includes(world.pick);
            const old = index >= 0 ? world.tiles[index] : null;
            // A ground tile replaces the ground (what stands there stays); something to stand goes on it (on grass, on an
            // empty cell). Painting over keeps its turn.
            const decor = standing ? world.pick : old?.decor;
            const tile = {
                q, r,
                model: standing ? old?.model ?? 'hex_grass' : world.pick,
                ...(decor ? { decor } : {}),
                ...(old?.rot ? { rot: old.rot } : {}),
                // Its colour and height stay too.
                ...(old ? Object.fromEntries(["hue", "saturation", "brightness", "y"].filter((key) => old[key] !== undefined).map((key) => [key, old[key]])) : {}),
                ...(world.paintZone ? { zone: world.paintZone } : {}),
            };
            if (old && old.model === tile.model && old.decor === tile.decor && (old.zone ?? '') === (tile.zone ?? '')) return;
            if (old) world.tiles[index] = tile;
            else world.tiles.push(tile);
            void thumbnail(tile.model, true).then(draw).catch(() => undefined);
            if (tile.decor) void thumbnail(tile.decor, true).then(draw).catch(() => undefined);
            world.selected = at(q, r);
            changed();
        } else if (world.tool === 'tint') {
            const tile = world.tiles[index];
            if (!tile) return;
            for (const [key, neutral] of [['hue', 0], ['saturation', 1], ['brightness', 1]]) {
                if (brush[key] === neutral) delete tile[key];
                else tile[key] = brush[key];
            }
            world.selected = index;
            changed();
        } else if (world.tool === 'clear') {
            const tile = world.tiles[index];
            if (!tile?.decor) return;
            delete tile.decor;
            delete tile.decorY;
            world.selected = index;
            changed();
        } else if (world.tool === 'erase') {
            if (index < 0) return;
            world.tiles.splice(index, 1);
            world.selected = -1;
            changed();
        } else {
            world.selected = index;
            renderProps();
            draw();
        }
    }
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => {
        canvas.setPointerCapture(event.pointerId);
        if (event.button === 2 || event.button === 1) {
            pan = { x: event.clientX, y: event.clientY, ox: view.ox, oy: view.oy };
            return;
        }
        // Alt+click with the brush: it takes that tile's colour up.
        if (world.tool === 'tint' && event.altKey) {
            const tile = world.tiles[at(...cellOf(event))];
            if (tile) pickColour(tile);
            return;
        }
        painting = world.tool !== 'select';
        apply(...cellOf(event));
    });
    canvas.addEventListener('pointermove', (event) => {
        if (pan) {
            view.ox = pan.ox + event.clientX - pan.x;
            view.oy = pan.oy + event.clientY - pan.y;
            draw();
            return;
        }
        const cell = cellOf(event);
        if (!hover || hover[0] !== cell[0] || hover[1] !== cell[1]) {
            hover = cell;
            if (painting) apply(...cell);
            draw();
        }
    });
    const stop = () => { pan = null; painting = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', () => { hover = null; draw(); });
    canvas.addEventListener('wheel', (event) => {
        event.preventDefault();
        view.scale = Math.min(140, Math.max(14, view.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
        draw();
    }, { passive: false });
    window.addEventListener('keydown', (event) => {
        if (panel.hidden || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
        if (event.key === 'r' || event.key === 'R') turn(event.shiftKey ? -1 : 1);
        if (event.key === 'c' || event.key === 'C') clearTop();
        if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            raise(event.key === 'PageUp' ? 1 : -1, event.shiftKey ? 'decorY' : 'y');
        }
        if (event.key === 'Delete' && world.selected >= 0) {
            world.tiles.splice(world.selected, 1);
            world.selected = -1;
            changed();
        }
    });
    new ResizeObserver(resize).observe(canvas.parentElement);

    /** The selected tile (`key` 'y') or what stands on it ('decorY') raised a step (`step` -1 lowers). */
    function raise(step, key) {
        const tile = world.tiles[world.selected];
        if (!tile || (key === 'decorY' && !tile.decor)) return;
        tile[key] = round2((tile[key] ?? 0) + step * HEIGHT_STEP);
        if (!tile[key]) delete tile[key];
        changed();
    }

    /** The brush takes `tile`'s colour up. */
    function pickColour(tile) {
        brush.hue = tile.hue ?? 0;
        brush.saturation = tile.saturation ?? 1;
        brush.brightness = tile.brightness ?? 1;
        setTool('tint');
        renderProps();
    }

    /** What stands on the selected tile, off (its ground stays). */
    function clearTop() {
        const tile = world.tiles[world.selected];
        if (!tile?.decor) return;
        delete tile.decor;
        delete tile.decorY;
        changed();
    }

    /** A colour slider (`key`: hue, saturation, brightness) for `object` (the map, or a tile: no key there means as it is). */
    function colourSlider(object, key, label, min, max, step, neutral) {
        const value = el('span', { class: 'hint', style: { margin: 0, minWidth: '34px', display: 'inline-block' } }, String(object[key] ?? neutral));
        const slider = el('input', { type: 'range', min, max, step, value: object[key] ?? neutral, style: { width: '120px' } });
        slider.addEventListener('input', () => {
            const v = Number(slider.value);
            // The brush keeps every value (it paints them); a tile or the map drops one that's as it is.
            if (v === neutral && object !== brush) delete object[key];
            else object[key] = v;
            value.textContent = slider.value;
            if (object === brush) return;
            world.dirty = true;
            statusLine.textContent = 'World map not saved';
            draw();
        });
        return el('div', { class: 'field' }, el('label', {}, label), el('span', {}, slider, ' ', value));
    }
    const colourSliders = (object) => [
        colourSlider(object, 'hue', 'hue', -180, 180, 1, 0),
        colourSlider(object, 'saturation', 'saturation', 0, 2, 0.05, 1),
        colourSlider(object, 'brightness', 'brightness', 0.3, 2, 0.05, 1),
    ];
    /** A tile's colour change for the grid's pictures (the map's and its own, as the game: WorldMap.tileShift). */
    const filterOf = (tile) => {
        const hue = (world.hue ?? 0) + (tile.hue ?? 0);
        const saturation = (world.saturation ?? 1) * (tile.saturation ?? 1);
        const brightness = (world.brightness ?? 1) * (tile.brightness ?? 1);
        return hue === 0 && saturation === 1 && brightness === 1 ? 'none' : `hue-rotate(${hue}deg) saturate(${saturation}) brightness(${brightness})`;
    };

    function turn(step) {
        const tile = world.tiles[world.selected];
        if (!tile) return;
        tile.rot = (((tile.rot ?? 0) + step) % 6 + 6) % 6;
        if (!tile.rot) delete tile.rot;
        changed();
    }

    // ---------------------------------------------------------------- the panel

    function renderProps() {
        const tile = world.tiles[world.selected];
        const children = [];
        // The brush, when it's the tool.
        if (world.tool === 'tint') {
            children.push(el('h3', {}, 'Colour brush'), el('p', { class: 'hint' }, 'Drag over tiles to paint this colour on their ground. Alt+click a tile to take its colour up.'),
                ...colourSliders(brush),
                el('div', { class: 'field' },
                    el('button', { disabled: !tile, onclick: () => tile && pickColour(tile) }, 'Pick from selected'),
                    el('button', { onclick: () => { brush.hue = 0; brush.saturation = 1; brush.brightness = 1; renderProps(); } }, 'As it is')));
        }
        if (tile) {
            children.push(el('h3', {}, `Tile ${tile.q}, ${tile.r}`));
            const model = el('select', { onchange: (e) => { tile.model = e.target.value; changed(); } }, ...world.models.map((name) => el('option', { value: name, selected: name === tile.model }, name)));
            children.push(el('div', { class: 'field' }, el('label', {}, 'ground'), model));
            const decor = el('select', {
                onchange: (e) => {
                    if (e.target.value) tile.decor = e.target.value;
                    else delete tile.decor;
                    changed();
                },
            }, el('option', { value: '' }, '(nothing)'), ...world.decor.map((name) => el('option', { value: name, selected: name === tile.decor }, name)));
            children.push(el('div', { class: 'field' }, el('label', { title: 'What stands on it' }, 'on it'),
                el('span', {}, decor, ' ', el('button', { title: 'Take what stands on it off (C)', disabled: !tile.decor, onclick: () => clearTop() }, 'Remove'))));
            children.push(el('div', { class: 'hint', style: { margin: '10px 0 2px' } }, 'Its colour (on top of the whole map\'s)'), ...colourSliders(tile),
                el('button', { onclick: () => { delete tile.hue; delete tile.saturation; delete tile.brightness; changed(); } }, 'Reset colour'));
            const heightRow = (key, label, title) => el('div', { class: 'field' },
                el('label', { title }, `${label} ${tile[key] ?? 0}`),
                el('span', {}, el('button', { onclick: () => raise(-1, key) }, '▼'), ' ', el('button', { onclick: () => raise(1, key) }, '▲')));
            children.push(heightRow('y', 'height', 'Raises the tile and what stands on it (PageUp / PageDown)'));
            if (tile.decor) children.push(heightRow('decorY', 'on it, height', 'Raises what stands on it, on its own (Shift + PageUp / PageDown)'));
            children.push(el('div', { class: 'field' }, el('label', { title: 'Sixths of a turn (R / Shift+R)' }, `turn ${tile.rot ?? 0}/6`),
                el('span', {}, el('button', { onclick: () => turn(-1) }, '⟲'), ' ', el('button', { onclick: () => turn(1) }, '⟳'))));
            const zone = el('select', {
                onchange: (e) => {
                    if (e.target.value) tile.zone = e.target.value;
                    else delete tile.zone;
                    changed();
                },
            }, el('option', { value: '' }, '(scenery)'), ...zones().map((z) => el('option', { value: z.id, selected: z.id === tile.zone }, z.name)));
            children.push(el('div', { class: 'field' }, el('label', { title: 'The area it belongs to: it fills in as that area\'s levels are beaten' }, 'area'), zone));
            if (tile.zone) {
                const count = world.tiles.filter((t) => t.zone === tile.zone).length;
                children.push(el('p', { class: 'hint' }, `One of ${count} tiles of its area: they show together on the main screen, outlined while it's the area being played.`));
            } else {
                children.push(el('p', { class: 'hint' }, 'Scenery: shows on the main screen once an area next to it is reached.'));
            }
            children.push(el('div', { class: 'field', style: { marginTop: '10px' } }, el('button', { class: 'danger', onclick: () => { world.tiles.splice(world.selected, 1); world.selected = -1; changed(); } }, 'Delete')));
        } else {
            children.push(el('h3', {}, 'World map'), el('p', { class: 'hint' }, 'Pick a tile on the left and paint it on the grid. Give tiles an area (next to Paint, or here once selected): an area\'s tiles fill in, in their order, as its levels are beaten. Tiles with no area are scenery, shown once an area next to them is reached.'));
        }
        // The whole map, raised out of the sea.
        const lift = el('input', { type: 'number', step: HEIGHT_STEP, value: world.lift ?? 0 });
        lift.addEventListener('change', () => {
            world.lift = round2(Number(lift.value) || 0);
            changed();
        });
        children.push(el('div', { class: 'field', style: { marginTop: '14px' } }, el('label', { title: 'How far all of the map is raised out of the sea (world units)' }, 'raise whole map'), lift));
        children.push(el('div', { class: 'hint', style: { margin: '10px 0 2px' } }, 'The whole map\'s colour'), ...colourSliders(world));
        // The areas: how many tiles each has against its levels.
        children.push(el('h3', { style: { marginTop: '16px' } }, 'Areas'));
        for (const zone of zones()) {
            const count = world.tiles.filter((t) => t.zone === zone.id).length;
            children.push(el('div', { class: 'field' },
                el('label', { style: { color: zoneColour(zone.id) } }, zone.name),
                el('span', { class: 'hint', style: { margin: 0 } }, `${count} tile${count === 1 ? '' : 's'} · ${zone.levels.length} levels`)));
        }
        props.replaceChildren(...children);
    }

    // ---------------------------------------------------------------- load, save, preview

    function reloadPreview() {
        const url = new URL(state.gameUrl);
        url.searchParams.set('home', '1');
        if (previewMap) url.searchParams.set('map', previewMap);
        url.searchParams.set('t', String(Date.now()));
        preview.src = url.toString();
    }

    async function save() {
        try {
            await api('/api/mob/worldmap', {
                method: 'PUT',
                body: {
                    lift: world.lift, hue: world.hue, saturation: world.saturation, brightness: world.brightness,
                    tiles: world.tiles.map(({ q, r, model, decor, rot, zone, y, decorY, hue, saturation, brightness }) => ({ q, r, model, decor, rot, zone, y, decorY, hue, saturation, brightness })),
                },
            });
            world.dirty = false;
            statusLine.textContent = '';
            toast('World map saved', 'ok');
            // The game bundles the file: give the dev server a moment to rebuild.
            setTimeout(reloadPreview, 600);
        } catch (error) {
            toast(`Not saved: ${error.message}`, 'error');
        }
    }

    async function load() {
        try {
            const [pieces, map] = await Promise.all([api('/api/mob/hex-tiles'), api('/api/mob/worldmap')]);
            world.models = pieces.tiles ?? [];
            world.decor = pieces.decor ?? [];
            world.tiles = map.tiles ?? [];
            world.lift = map.lift ?? 0;
            world.hue = map.hue ?? 0;
            world.saturation = map.saturation ?? 1;
            world.brightness = map.brightness ?? 1;
            if (!world.models.includes(world.pick)) world.pick = world.models[0] ?? 'hex_grass';
        } catch (error) {
            toast(`Could not load the world map: ${error.message}`, 'error');
        }
        refreshZones();
        renderPalette();
        renderProps();
        resize();
        // The tiles' pictures on the grid, as they're rendered.
        for (const model of new Set(world.tiles.flatMap((t) => [t.model, t.decor].filter(Boolean)))) void thumbnail(model, true).then(draw).catch(() => undefined);
    }
    void load();

    return {
        /** The tab's shown: the zones may have changed, the canvas has a size now. */
        show() {
            refreshZones();
            renderProps();
            resize();
            if (!preview.src) reloadPreview();
        },
        get dirty() { return world.dirty; },
    };
}
