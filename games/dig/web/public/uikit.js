// "UI Kit" tab: pick the images / texts / colors used by the game's popups and preview them.
// Data lives in games/dig/ui/uikit.json and is read by game/ui/UiKit.ts.

import { api, el, openModal, toast } from './shared.js';
import { openImagePicker, imageUrl } from './imagePicker.js';

const STAGE = { width: 480, height: 854 };
const POPUP_CENTER_Y = 0.78;

// Mirrors the layout constants in the game (center-origin pixels). `native` images keep their file size.
const SCREENS = {
    levelComplete: {
        size: [380, 250],
        sample: { level: 3, money: 75, bonus: '  (x2 BONUS)', buttonText: 'NEXT LEVEL' },
        items: [
            { id: 'panel', x: 0, y: 0, w: 380, h: 250 },
            { id: 'ribbon', x: 0, y: -125, scale: 1.1, native: true },
            { id: 'title', x: 0, y: -122 },
            { id: 'total', x: 0, y: -35 },
            { id: 'button', x: 0, y: 60, w: 240, h: 90, scale: 0.7 },
            { id: 'buttonLabel', x: 0, y: 60, scale: 0.7 },
        ],
    },
    busted: {
        size: [380, 230],
        sample: {},
        items: [
            { id: 'panel', x: 0, y: 0, w: 380, h: 230 },
            { id: 'ribbon', x: 0, y: -115, scale: 1.1, native: true },
            { id: 'title', x: 0, y: -112 },
            { id: 'message', x: 0, y: -35 },
            { id: 'button', x: 0, y: 50, w: 240, h: 90, scale: 0.7 },
            { id: 'buttonLabel', x: 0, y: 50, scale: 0.7 },
        ],
    },
    bonusMeter: {
        size: [380, 260],
        sample: {},
        items: [
            { id: 'panel', x: 0, y: 0, w: 380, h: 260 },
            { id: 'title', x: 0, y: -104 },
            { id: 'gauge', x: 0, y: 25, decoration: 'gauge' },
            { id: 'button', x: 0, y: 86, w: 220, h: 90, scale: 0.7 },
            { id: 'buttonLabel', x: 0, y: 86, scale: 0.7 },
        ],
    },
};

const ELEMENT_LABELS = {
    panel: 'Panel background', ribbon: 'Title ribbon', title: 'Title text', total: 'Money text', message: 'Message text',
    button: 'Button image', buttonLabel: 'Button text', gauge: 'Gauge (drawn by code)',
};

let kit = null;
let images = [];
let fonts = [];
let currentScreen = 'levelComplete';
let selectedElement = 'panel';
let dirty = false;
let root;
const imageCache = new Map();

function loadImage(name) {
    const entry = images.find((image) => image.name === name && image.source === 'game') ?? images.find((image) => image.name === name);
    if (!entry) return Promise.resolve(null);
    if (!imageCache.has(name)) {
        imageCache.set(name, new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = imageUrl(entry);
        }));
    }
    return imageCache.get(name);
}

/** Draws an image into a canvas the way PIXI would: nine-sliced or stretched, multiplied by the tint. */
function drawImage(canvas, image, { slice, tint }, width, height, scale = 1) {
    const ratio = 2;
    canvas.width = Math.max(1, Math.round(width * scale * ratio));
    canvas.height = Math.max(1, Math.round(height * scale * ratio));
    canvas.style.width = `${width * scale}px`;
    canvas.style.height = `${height * scale}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!image) return;
    const paint = () => {
        if (!slice) {
            ctx.drawImage(image, 0, 0, width, height);
            return;
        }
        const [l, t, r, b] = slice;
        const sw = image.naturalWidth;
        const sh = image.naturalHeight;
        const xs = [0, l, sw - r, sw];
        const ys = [0, t, sh - b, sh];
        const xd = [0, l, width - r, width];
        const yd = [0, t, height - b, height];
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                const dw = xd[col + 1] - xd[col];
                const dh = yd[row + 1] - yd[row];
                const ssw = xs[col + 1] - xs[col];
                const ssh = ys[row + 1] - ys[row];
                if (dw > 0 && dh > 0 && ssw > 0 && ssh > 0) {
                    ctx.drawImage(image, xs[col], ys[row], ssw, ssh, xd[col], yd[row], dw, dh);
                }
            }
        }
    };
    paint();
    if (tint && tint.toLowerCase() !== '#ffffff') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = tint;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'destination-in';
        paint();
        ctx.globalCompositeOperation = 'source-over';
    }
}

function fillTemplate(text, values) {
    return text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}

function markDirty() {
    dirty = true;
    renderStatus();
}

function renderStatus() {
    const status = root.querySelector('#ui-status');
    status.textContent = dirty ? 'Unsaved changes' : 'Saved';
    status.className = dirty ? 'dirty' : '';
}

function layoutItem(id) {
    return SCREENS[currentScreen].items.find((item) => item.id === id);
}

/** Mirrors UiKit.ts: size overrides and slices from the kit win over the layout defaults. */
function effectiveSize(item, spec, image) {
    const natural = { w: image?.naturalWidth ?? 0, h: image?.naturalHeight ?? 0 };
    if (item.native) {
        const stretched = spec.w || spec.h || spec.slice;
        return stretched
            ? { w: spec.w ?? natural.w, h: spec.h ?? natural.h, slice: spec.slice }
            : { ...natural, slice: null };
    }
    return { w: spec.w ?? item.w, h: spec.h ?? item.h, slice: spec.slice };
}

const STYLE_FIELDS = [
    { key: 'fontFamily', label: 'Font', type: 'font' },
    { key: 'fill', label: 'Fill', type: 'color' },
    { key: 'stroke', label: 'Outline', type: 'color' },
    { key: 'strokeWidth', label: 'Outline width', type: 'number', min: 0, step: 1 },
    { key: 'letterSpacing', label: 'Letter spacing', type: 'number', step: 0.5 },
    { key: 'shadow.enabled', label: 'Shadow', type: 'check' },
    { key: 'shadow.color', label: 'Shadow color', type: 'color', shadow: true },
    { key: 'shadow.alpha', label: 'Shadow opacity', type: 'number', min: 0, max: 1, step: 0.1, shadow: true },
    { key: 'shadow.angle', label: 'Shadow angle °', type: 'number', step: 15, shadow: true },
    { key: 'shadow.distance', label: 'Shadow distance', type: 'number', min: 0, step: 1, shadow: true },
    { key: 'shadow.blur', label: 'Shadow blur', type: 'number', min: 0, step: 1, shadow: true },
];
const DEFAULT_STYLE = {
    fontFamily: 'sans-serif', fill: '#ffffff', stroke: '#000000', strokeWidth: 0, letterSpacing: 0,
    shadow: { enabled: false, color: '#000000', alpha: 0.5, angle: 90, distance: 2, blur: 0 },
};

const getPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
function setPath(object, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((node, key) => (node[key] ??= {}), object);
    target[last] = value;
}
function deletePath(object, path) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((node, key) => node?.[key], object);
    if (target) delete target[last];
    if (keys[0] === 'shadow' && object.shadow && !Object.keys(object.shadow).length) delete object.shadow;
}

/** Mirrors UiKit.resolveStyle: the named style plus the element's own overrides. */
function resolveStyle(role, overrides = {}) {
    const base = kit.styles?.[role ?? 'primary'] ?? DEFAULT_STYLE;
    const own = Object.fromEntries(Object.entries(overrides).filter(([key]) => STYLE_FIELDS.some((field) => field.key === key)));
    return { ...base, ...own, shadow: { ...base.shadow, ...(overrides.shadow ?? {}) } };
}

function overriddenKeys(spec) {
    return STYLE_FIELDS.map((field) => field.key).filter((key) => getPath(spec, key) !== undefined);
}

/** Style rows shared by the sidebar style editor and the per-element overrides. */
function styleRows({ get, set, overridden = () => false, rerender }) {
    return STYLE_FIELDS.filter((field) => !field.shadow || get('shadow.enabled')).map((field) => {
        const value = get(field.key);
        let input;
        if (field.type === 'font') {
            input = el('select', { onchange: (event) => set(field.key, event.target.value) },
                ...fonts.map((name) => el('option', { value: name, selected: name === value }, name)));
        } else if (field.type === 'check') {
            input = el('input', { type: 'checkbox', checked: Boolean(value), onchange: (event) => { set(field.key, event.target.checked); rerender(); } });
        } else if (field.type === 'color') {
            input = el('input', { type: 'color', value, oninput: (event) => set(field.key, event.target.value) });
        } else {
            input = el('input', { type: 'number', min: field.min, max: field.max, step: field.step, value, onchange: (event) => set(field.key, Number(event.target.value)) });
        }
        const row = labeled(field.label, input);
        if (overridden(field.key)) row.classList.add('overridden');
        return row;
    });
}

function hexAlpha(hex, alpha) {
    const value = parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function renderStage() {
    const layout = SCREENS[currentScreen];
    const data = kit.screens[currentScreen].elements;
    const stage = root.querySelector('#ui-stage');
    stage.replaceChildren();
    const frame = el('div', { class: 'phone' });
    frame.style.width = `${STAGE.width}px`;
    frame.style.height = `${STAGE.height}px`;
    const popup = el('div', { class: 'popup' });
    popup.style.left = `${STAGE.width / 2}px`;
    popup.style.top = `${STAGE.height * POPUP_CENTER_Y}px`;
    frame.append(el('div', { class: 'phone-hint' }, 'World view'), popup);

    for (const item of layout.items) {
        if (item.decoration === 'gauge') {
            popup.append(gaugeDecoration(item));
            continue;
        }
        const spec = data[item.id];
        if (!spec) continue;
        const holder = el('div', {
            class: `ui-el${item.id === selectedElement ? ' selected' : ''}`,
            title: ELEMENT_LABELS[item.id] ?? item.id,
            onclick: (event) => { event.stopPropagation(); selectedElement = item.id; renderAll(); },
        });
        if (spec.type === 'image') {
            const canvas = el('canvas');
            holder.append(canvas);
            void loadImage(spec.image).then((image) => {
                const scale = item.scale ?? 1;
                const { w, h, slice } = effectiveSize(item, spec, image);
                holder.style.left = `${item.x - (w * scale) / 2}px`;
                holder.style.top = `${item.y - (h * scale) / 2}px`;
                drawImage(canvas, image, { slice, tint: spec.tint }, w, h, scale);
                if (!image) holder.classList.add('missing');
            });
        } else {
            const scale = item.scale ?? 1;
            holder.classList.add('text');
            holder.textContent = fillTemplate(spec.text, layout.sample);
            const style = resolveStyle(spec.style, spec);
            const angle = (style.shadow.angle * Math.PI) / 180;
            const shadow = style.shadow.enabled
                ? `${Math.cos(angle) * style.shadow.distance * scale}px ${Math.sin(angle) * style.shadow.distance * scale}px ${style.shadow.blur * scale}px ${hexAlpha(style.shadow.color, style.shadow.alpha)}`
                : 'none';
            Object.assign(holder.style, {
                left: `${item.x}px`,
                top: `${item.y}px`,
                fontFamily: `"${style.fontFamily}", sans-serif`,
                fontWeight: 'normal',
                fontSize: `${spec.size * scale}px`,
                color: style.fill,
                letterSpacing: `${style.letterSpacing * scale}px`,
                webkitTextStroke: `${style.strokeWidth * scale}px ${style.stroke}`,
                paintOrder: 'stroke fill',
                textShadow: shadow,
                textAlign: spec.align ?? 'center',
                whiteSpace: spec.wrapWidth > 0 ? 'normal' : 'pre',
                width: spec.wrapWidth > 0 ? `${spec.wrapWidth * scale}px` : 'auto',
            });
        }
        popup.append(holder);
    }
    stage.append(frame);
    fitStage();
}

function gaugeDecoration(item) {
    const holder = el('div', { class: 'ui-el decoration', title: ELEMENT_LABELS.gauge });
    const canvas = el('canvas', { width: 260, height: 150 });
    canvas.style.width = '260px';
    canvas.style.height = '150px';
    holder.style.left = `${item.x - 130}px`;
    holder.style.top = `${item.y - 125}px`;
    const ctx = canvas.getContext('2d');
    const zones = [[0, 0.4, '#3fd16b'], [0.4, 0.6, '#ffc928'], [0.6, 1, '#3fd16b']];
    ctx.lineWidth = 34 * (130 / 120);
    zones.forEach(([from, to, color]) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.arc(130, 130, 130 - ctx.lineWidth / 2 - 2, Math.PI * (1 + from), Math.PI * (1 + to));
        ctx.stroke();
    });
    ctx.fillStyle = '#ff4a4a';
    ctx.beginPath();
    ctx.moveTo(122, 130);
    ctx.lineTo(130, 28);
    ctx.lineTo(138, 130);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(130, 130, 12, 0, Math.PI * 2);
    ctx.fill();
    holder.append(canvas);
    return holder;
}

const camera = { auto: true, scale: 1, x: 0, y: 0 };

function fitStage() {
    const area = root.querySelector('#ui-stage-wrap');
    const stage = root.querySelector('#ui-stage');
    if (camera.auto) {
        camera.scale = Math.max(0.2, Math.min(1.4, (area.clientHeight - 24) / STAGE.height, (area.clientWidth - 24) / STAGE.width));
        camera.x = 0;
        camera.y = 0;
    }
    stage.style.width = `${STAGE.width}px`;
    stage.style.height = `${STAGE.height}px`;
    stage.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    const zoom = root.querySelector('#ui-zoom');
    if (zoom) zoom.textContent = `${Math.round(camera.scale * 100)}%`;
}

function zoomAt(factor, clientX, clientY) {
    const area = root.querySelector('#ui-stage-wrap');
    const rect = area.getBoundingClientRect();
    const cx = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const cy = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    const next = Math.min(4, Math.max(0.15, camera.scale * factor));
    const ratio = next / camera.scale;
    camera.x = cx - (cx - camera.x) * ratio;
    camera.y = cy - (cy - camera.y) * ratio;
    camera.scale = next;
    camera.auto = false;
    fitStage();
}

function bindCamera() {
    const area = root.querySelector('#ui-stage-wrap');
    area.addEventListener('wheel', (event) => {
        event.preventDefault();
        zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    }, { passive: false });
    let pan = null;
    area.addEventListener('pointerdown', (event) => {
        const onElement = event.target.closest('.ui-el');
        if (event.button === 0 && onElement && !event.altKey && !event.shiftKey) return;
        pan = { x: event.clientX - camera.x, y: event.clientY - camera.y };
        area.setPointerCapture(event.pointerId);
        area.classList.add('panning');
    });
    area.addEventListener('pointermove', (event) => {
        if (!pan) return;
        camera.x = event.clientX - pan.x;
        camera.y = event.clientY - pan.y;
        camera.auto = false;
        fitStage();
    });
    const end = () => { pan = null; area.classList.remove('panning'); };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);
    root.querySelector('#ui-fit').addEventListener('click', () => { camera.auto = true; fitStage(); });
    root.querySelector('#ui-100').addEventListener('click', () => { camera.auto = false; camera.scale = 1; camera.x = 0; camera.y = 0; fitStage(); });
    root.querySelector('#ui-zoom-in').addEventListener('click', () => zoomAt(1.25));
    root.querySelector('#ui-zoom-out').addEventListener('click', () => zoomAt(0.8));
}

// ---------------------------------------------------------------- inspector

function labeled(label, control, hint) {
    return el('label', { class: 'field' }, el('span', {}, label), control, hint ? el('small', { class: 'muted' }, hint) : null);
}

function renderInspector() {
    const panel = root.querySelector('#ui-inspector');
    panel.replaceChildren();
    const item = layoutItem(selectedElement);
    if (item?.decoration) {
        panel.append(el('p', { class: 'muted' }, 'The gauge ring and needle are drawn by code. Colors and zones are not part of the kit yet.'));
        return;
    }
    const spec = kit.screens[currentScreen].elements[selectedElement];
    if (!spec) return;
    const change = () => { markDirty(); renderStage(); };

    panel.append(el('div', { class: 'inspector-title' }, ELEMENT_LABELS[selectedElement] ?? selectedElement,
        el('span', { class: 'tag' }, spec.type)));

    if (spec.type === 'image') {
        const thumb = el('canvas', { class: 'thumb-big checker' });
        void loadImage(spec.image).then((image) => {
            if (!image) return;
            const scale = Math.min(1, 220 / image.naturalWidth, 120 / image.naturalHeight);
            drawImage(thumb, image, { slice: null, tint: spec.tint }, image.naturalWidth * scale, image.naturalHeight * scale);
        });
        panel.append(
            el('div', { class: 'image-chip' }, thumb, el('div', {},
                el('div', { class: 'strong' }, spec.image),
                el('button', { onclick: () => openImagePicker({
                    images, current: spec.image, title: `Image for ${ELEMENT_LABELS[selectedElement]}`,
                    onPick: (image) => { spec.image = image.name; imageCache.delete(image.name); change(); renderInspector(); },
                }) }, 'Change image…'))),
            labeled('Tint', el('input', { type: 'color', value: spec.tint, oninput: (event) => { spec.tint = event.target.value; change(); } }),
                'Multiplies the image color (white = unchanged)'),
        );
        const defaults = item.native ? null : { w: item.w, h: item.h };
        const sizeInput = (key, label) => el('input', {
            type: 'number', min: 1, step: 1, value: spec[key] ?? '', placeholder: defaults ? String(defaults[key]) : 'native',
            onchange: (event) => {
                if (event.target.value === '') delete spec[key];
                else spec[key] = Math.max(1, Number(event.target.value));
                change();
            },
            title: label,
        });
        panel.append(
            el('div', { class: 'slice-grid' }, labeled('Width', sizeInput('w', 'Width')), labeled('Height', sizeInput('h', 'Height'))),
            el('p', { class: 'muted small' }, item.native
                ? 'Empty = native image size. Set a size (or 9-slice) to stretch it.'
                : 'Empty = the screen layout default. Sizes are before the element\'s on-screen scale.'),
            el('button', { onclick: () => { delete spec.w; delete spec.h; change(); renderInspector(); } }, 'Reset size'),
        );
        const sliced = Boolean(spec.slice);
        panel.append(labeled('9-slice borders', el('input', {
            type: 'checkbox', checked: sliced,
            onchange: (event) => { spec.slice = event.target.checked ? [20, 20, 20, 20] : null; change(); renderInspector(); },
        }), 'Keeps corners crisp when the image is stretched'));
        if (spec.slice) {
            const row = el('div', { class: 'slice-grid' });
            ['Left', 'Top', 'Right', 'Bottom'].forEach((name, index) => row.append(labeled(name, el('input', {
                type: 'number', min: 0, step: 1, value: spec.slice[index],
                onchange: (event) => { spec.slice[index] = Math.max(0, Number(event.target.value)); change(); },
            }))));
            panel.append(row);
        }
    } else {
        const own = overriddenKeys(spec);
        const styleName = spec.style ?? 'primary';
        panel.append(
            labeled('Text', el('textarea', { rows: 3, value: spec.text, oninput: (event) => { spec.text = event.target.value; change(); } }),
                placeholderHint()),
            labeled('Size', el('input', { type: 'number', min: 8, step: 1, value: spec.size, onchange: (event) => { spec.size = Number(event.target.value); change(); } })),
            labeled('Wrap width', el('input', {
                type: 'number', min: 0, step: 10, value: spec.wrapWidth ?? '', placeholder: 'off',
                onchange: (event) => { if (event.target.value === '' || Number(event.target.value) <= 0) delete spec.wrapWidth; else spec.wrapWidth = Number(event.target.value); change(); },
            }), 'Max line width in px (before scale); empty = no wrapping'),
            labeled('Align', el('select', { onchange: (event) => { spec.align = event.target.value; change(); } },
                ...['left', 'center', 'right'].map((value) => el('option', { value, selected: (spec.align ?? 'center') === value }, value)))),
            el('div', { class: 'subhead' }, 'Style'),
            labeled('Text style', el('select', { onchange: (event) => { spec.style = event.target.value; change(); renderInspector(); } },
                ...Object.keys(kit.styles).map((name) => el('option', { value: name, selected: name === styleName }, name)))),
            ...styleRows({
                get: (key) => getPath(resolveStyle(styleName, spec), key),
                set: (key, value) => { setPath(spec, key, value); change(); },
                overridden: (key) => getPath(spec, key) !== undefined,
                rerender: () => { change(); renderInspector(); },
            }),
            el('p', { class: 'muted small' }, own.length
                ? `${own.length} value${own.length === 1 ? '' : 's'} overridden on this element (highlighted).`
                : `Following the “${styleName}” style.`),
            el('div', { class: 'row' },
                el('button', { disabled: !own.length, title: `Copy this element's overridden values into the “${styleName}” style, so every element using it changes`, onclick: () => {
                    const target = kit.styles[styleName];
                    own.forEach((key) => setPath(target, key, getPath(spec, key)));
                    own.forEach((key) => deletePath(spec, key));
                    change(); renderAll();
                } }, 'Apply to style'),
                el('button', { disabled: !own.length, title: 'Drop the overrides and use the style as is', onclick: () => {
                    own.forEach((key) => deletePath(spec, key));
                    change(); renderInspector();
                } }, 'Reset to style')),
        );
    }
}

function placeholderHint() {
    const names = Object.keys(SCREENS[currentScreen].sample);
    return names.length ? `Placeholders: ${names.map((name) => `{${name}}`).join(' ')}` : null;
}

function renderElementList() {
    const list = root.querySelector('#ui-elements');
    list.replaceChildren(...SCREENS[currentScreen].items.filter((item) => !item.decoration).map((item) => {
        const spec = kit.screens[currentScreen].elements[item.id];
        return el('li', {
            class: item.id === selectedElement ? 'active' : '',
            onclick: () => { selectedElement = item.id; renderAll(); },
        }, el('span', {}, ELEMENT_LABELS[item.id] ?? item.id), el('small', {}, spec?.type === 'image' ? spec.image : 'text'));
    }));
}

function renderScreens() {
    const list = root.querySelector('#ui-screens');
    list.replaceChildren(...Object.keys(SCREENS).map((id) => el('li', {
        class: id === currentScreen ? 'active' : '',
        onclick: () => {
            currentScreen = id;
            selectedElement = SCREENS[id].items.find((item) => !item.decoration).id;
            renderAll();
        },
    }, kit.screens[id]?.label ?? id)));
}

let editingStyle = 'primary';

function renderStyles() {
    const host = root.querySelector('#ui-fonts');
    const target = kit.styles[editingStyle];
    host.replaceChildren(
        el('div', { class: 'segmented block' }, ...Object.keys(kit.styles).map((name) => el('button', {
            class: name === editingStyle ? 'active' : '',
            onclick: () => { editingStyle = name; renderStyles(); },
        }, name))),
        ...styleRows({
            get: (key) => getPath(target, key) ?? getPath(DEFAULT_STYLE, key),
            set: (key, value) => { setPath(target, key, value); markDirty(); renderStage(); renderInspector(); },
            rerender: () => { markDirty(); renderStyles(); renderStage(); renderInspector(); },
        }),
    );
}

function renderAll() {
    renderStyles();
    renderScreens();
    renderElementList();
    renderStage();
    renderInspector();
    renderStatus();
}

// ---------------------------------------------------------------- actions

async function save() {
    try {
        const result = await api('/api/uikit', { method: 'PUT', body: JSON.stringify(kit) });
        dirty = false;
        renderStatus();
        if (result.imported.length) {
            images = await api('/api/ui/images');
            toast(`Saved. Copied ${result.imported.length} image(s) from pizza — run “Pack atlas” so the game can use them.`, 'warn');
        } else {
            toast('UI kit saved');
        }
    } catch (error) {
        window.alert(`Save failed: ${error.message}`);
    }
}

async function packAtlas() {
    const modal = openModal({ title: 'Pack texture atlas', persistent: true });
    const log = el('pre', { class: 'log' }, 'Running “npm run image”… this can take a minute.');
    modal.body.append(log);
    const close = el('button', { disabled: true, onclick: () => modal.close() }, 'Close');
    modal.footer.append(el('span', { class: 'spacer' }), close);
    try {
        const result = await api('/api/ui/atlas', { method: 'POST', body: '{}' });
        log.textContent = `${result.ok ? '✔ Atlas updated' : '✖ Failed'}\n\n${result.log}`;
    } catch (error) {
        log.textContent = `Failed: ${error.message}`;
    }
    close.disabled = false;
}

export function hasUnsavedUiChanges() {
    return dirty;
}

export function saveUiKit() {
    return save();
}

export async function initUiTab(container) {
    root = container;
    root.innerHTML = `
      <aside class="sidebar left">
        <section class="card-section">
          <h2>Screens</h2>
          <ul id="ui-screens" class="list"></ul>
        </section>
        <section class="card-section">
          <h2>Elements</h2>
          <ul id="ui-elements" class="list"></ul>
        </section>
        <section class="card-section">
          <h2>Text styles</h2>
          <div id="ui-fonts"></div>
          <p class="muted small">Font, colors, outline and shadow live in the style. Elements pick a style and may override single values. Add fonts to raw-assets/fonts and run <code>npm run font</code>.</p>
        </section>
        <section class="card-section">
          <h2>Atlas</h2>
          <p class="muted small">Images picked from the pizza game are copied into this game. Pack the atlas so the game can load them.</p>
          <button id="ui-pack" class="block">Pack atlas</button>
        </section>
      </aside>
      <main class="stage-area">
        <div class="toolbar">
          <span class="muted">Click an element to edit · wheel: zoom · drag background: pan</span>
          <span class="spacer"></span>
          <div class="segmented">
            <button id="ui-zoom-out" title="Zoom out">−</button>
            <button id="ui-zoom" disabled>100%</button>
            <button id="ui-zoom-in" title="Zoom in">+</button>
            <button id="ui-fit">Fit</button>
            <button id="ui-100">100%</button>
          </div>
          <span id="ui-status"></span>
          <button id="ui-save" class="primary">Save (⌘/Ctrl+S)</button>
        </div>
        <div id="ui-stage-wrap"><div id="ui-stage"></div></div>
      </main>
      <aside class="sidebar right">
        <section class="card-section"><h2>Properties</h2><div id="ui-inspector"></div></section>
      </aside>`;
    root.querySelector('#ui-save').addEventListener('click', save);
    root.querySelector('#ui-pack').addEventListener('click', packAtlas);
    bindCamera();
    window.addEventListener('resize', () => root.offsetParent && fitStage());
    [kit, images, fonts] = await Promise.all([api('/api/uikit'), api('/api/ui/images'), api('/api/fonts')]);
    kit.styles ??= {};
    for (const role of ['primary', 'secondary']) kit.styles[role] = { ...DEFAULT_STYLE, fontFamily: fonts[0], ...kit.styles[role] };
    await Promise.all(fonts.map(async (name) => {
        const face = new FontFace(name, `url(/fonts/${name}.woff2) format('woff2')`);
        document.fonts.add(await face.load().catch(() => face));
    }));
    renderAll();
}

export function refreshUiTab() {
    if (kit) renderAll();
}
