// mob-settings.js — the editor's Settings tab: the game's global settings (games/mob/ui/settings.json, read by the
// game's Settings.ts): how retries get easier, how much harder each loop of the levels gets, a new player's coins,
// whether reds bump into houses, and the cannon's three upgrades (their names, how many levels, what a level adds, and
// each level's price).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const CARDS = [['giant', 'Giant'], ['truck', 'Truck'], ['saucer', 'UFO'], ['car', 'Rammer']];
/** The drawers left open (kept as the form's drawn again). */
const openDrawers = new Set();

// ---------------------------------------------------------------- the card preview (as the game draws it)

/** The card's sizes (the game's CardTray CARD) and the blue panel. */
const CARD = { width: 124, height: 152, inset: 9, picture: 150, barHeight: 16, barGap: 6, panel: '#0e81fb' };
const pictures = new Map();
let previewRenderer = null;

/** The unit's picture, as the game renders it (UnitIcons.ts): framed by its bounds, from the front and a little above.
 *  The giant as the game has it: a little way into its run, its painted parts in `giantColour`. */
function unitPicture(kind, giantColour = '#a600ff') {
    if (pictures.has(kind)) return pictures.get(kind);
    const job = (async () => {
        // The picture saved for the game (raw-assets/images/entities{tps}/card-<kind>.png, edited by hand or not), if there is
        // one (asked first: no failed loads for the ones not saved yet).
        const there = await fetch('/api/mob/card-pictures').then((response) => response.json()).catch(() => []);
        if (there.includes(`card-${kind}.png`)) {
            const saved = new Image();
            saved.src = `/api/mob/card-picture?kind=${kind}&t=${Date.now()}`;
            try {
                await saved.decode();
                return saved;
            } catch {
                // Unreadable: rendered here instead.
            }
        }
        return renderPicture(kind, giantColour);
    })();
    pictures.set(kind, job);
    return job;
}

/** The unit rendered as the game renders it, when there's no picture saved. */
function renderPicture(kind, giantColour) {
    return (async () => {
        if (!previewRenderer) {
            previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
            previewRenderer.setSize(256, 256);
        }
        const loader = new GLTFLoader();
        let object;
        if (kind === 'giant') {
            const [gltf, anims] = await Promise.all([loader.loadAsync('/models/mob/mob.glb'), loader.loadAsync('/models/mob/mob-anims.glb')]);
            object = cloneSkinned(gltf.scene);
            const team = new THREE.Color(giantColour);
            object.traverse((child) => {
                if (!child.isMesh) return;
                const material = new THREE.MeshLambertMaterial({ vertexColors: true });
                material.onBeforeCompile = (shader) => {
                    shader.uniforms.uTeam = { value: team };
                    shader.vertexShader = shader.vertexShader
                        .replace('#include <common>', '#include <common>\nuniform vec3 uTeam;')
                        .replace('#include <color_vertex>', '#include <color_vertex>\nvColor = vec4(mix(color.rgb, uTeam * color.rgb * 2.0, step(0.5, color.a)), 1.0);');
                };
                child.material = material;
            });
            const clip = anims.animations.find((a) => a.name === 'run') ?? anims.animations[0];
            if (clip) {
                const mixer = new THREE.AnimationMixer(object);
                mixer.clipAction(clip).play();
                mixer.setTime(clip.duration * 0.3);
            }
        } else {
            object = (await loader.loadAsync(`/models/props/full/${kind}.glb`)).scene;
        }
        object.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(object);
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        object.position.sub(centre);
        const scene = new THREE.Scene();
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(2, 4, 4);
        scene.add(object, new THREE.AmbientLight(0xffffff, 1.4), sun);
        const radius = Math.max(size.x, size.y, size.z) * 0.48;
        const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 10);
        camera.position.set(radius * 0.9, radius * 1.1, radius * 2.4);
        camera.lookAt(0, 0, 0);
        previewRenderer.render(scene, camera);
        const image = new Image();
        image.src = previewRenderer.domElement.toDataURL();
        await image.decode();
        return image;
    })();
}

/** The card on `canvas` (2x): the blue panel and the picture framed by `icon` (offset, a share of it, and zoom), cropped to it. */
async function drawCardPreview(canvas, kind, icon) {
    const g = canvas.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, CARD.width, CARD.height);
    g.fillStyle = '#3d6dff';
    g.beginPath();
    g.roundRect(0, 0, CARD.width, CARD.height, 14);
    g.fill();
    const innerWidth = CARD.width - CARD.inset * 2;
    const innerHeight = CARD.height - CARD.inset * 2 - CARD.barHeight - CARD.barGap;
    g.save();
    g.beginPath();
    g.roundRect(CARD.inset, CARD.inset, innerWidth, innerHeight, 10);
    g.fillStyle = CARD.panel;
    g.fill();
    g.clip();
    try {
        const image = await unitPicture(kind);
        const size = CARD.picture * (icon.zoom || 1);
        const cx = CARD.width / 2 + icon.x * CARD.picture;
        const cy = CARD.inset + innerHeight / 2 + icon.y * CARD.picture;
        g.drawImage(image, cx - size / 2, cy - size / 2, size, size);
    } catch {
        // No picture: the panel alone.
    }
    g.restore();
    g.fillStyle = '#10123a';
    g.beginPath();
    g.roundRect(CARD.inset, CARD.height - CARD.inset - CARD.barHeight, innerWidth, CARD.barHeight, 8);
    g.fill();
}

const UPGRADES = [
    ['fire', 'Fire rate', 'share of the fire rate each level adds (0.22 = +22%)'],
    ['capacity', 'Energy', 'shots each level adds to the cannon'],
    ['recharge', 'Recharge', 'seconds each level takes off a full recharge'],
];

export function buildSettingsTab(panel, { el, api, toast, statusLine }) {
    let settings = null;
    let dirty = false;
    const form = el('div', { style: { flex: 1, overflow: 'auto', padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignContent: 'flex-start' } });
    panel.append(el('div', { class: 'editor' },
        el('div', { class: 'toolbar' },
            el('span', { class: 'hint' }, 'The game\'s global settings (ui/settings.json): the game reloads with them once saved.'),
            el('span', { style: { flex: 1 } }),
            el('button', { class: 'primary', onclick: () => save() }, 'Save settings')),
        form));

    const changed = () => {
        dirty = true;
        statusLine.textContent = 'Settings not saved';
    };
    const card = (title, ...children) => el('div', { style: { width: '330px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '10px', padding: '10px 12px' } },
        el('h3', { style: { margin: '2px 0 10px', fontSize: '13px', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.05em' } }, title), ...children);
    const number = (object, key, label, hint, step = 1) => {
        const input = el('input', { type: 'number', step, value: object[key] });
        input.addEventListener('change', () => {
            object[key] = Number(input.value) || 0;
            changed();
        });
        return el('div', { class: 'field' }, el('label', { title: hint }, label), input);
    };
    const text = (object, key, label) => {
        const input = el('input', { type: 'text', value: object[key] });
        input.addEventListener('change', () => {
            object[key] = input.value;
            changed();
        });
        return el('div', { class: 'field' }, el('label', {}, label), input);
    };

    function render() {
        const s = settings;
        const houses = el('input', { type: 'checkbox', checked: s.housesBlockReds });
        houses.addEventListener('change', () => {
            s.housesBlockReds = houses.checked;
            changed();
        });
        const cards = [
            card('Retries',
                number(s.retry, 'step', 'easier a loss', 'Each loss in a row on a level makes its next try this much easier (0.1 = 10%)', 0.05),
                number(s.retry, 'most', 'at most', 'The most easier it gets (0.7 = 70%)', 0.05),
                el('p', { class: 'hint' }, 'Easier: fewer reds a second, red giants less often, a base and forts with fewer hits. Back to normal on the next level.')),
            card('Levels',
                number(s, 'loopHarder', 'each loop harder', 'After the last level they play again: each time round this much harder (0.15 = 15%)', 0.05),
                number(s, 'startCoins', 'new player coins', 'The coins a new player starts with', 10)),
            card('Coins',
                number(s, 'loseCoins', 'for a loss', 'The coins a lost battle still gives', 5),
                number(s, 'replayReward', 'replay share', 'A replayed level (one already beaten) pays this share of its reward (0.2 = 20%)', 0.05)),
            el('div', { style: { width: '100%' } },
                el('h3', { style: { margin: '6px 0', fontSize: '13px', color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.05em' } }, 'Cards'),
                el('p', { class: 'hint' }, 'A card is won by beating the first level with its house; in battle it charges, then lights up: a tap on it sends its unit out of the cannon. Its unit is its own (these stats), not the houses\' (the Units tab).'),
                el('div', { class: 'field', style: { justifyContent: 'flex-start', gap: '8px' } },
                    el('button', { title: 'Each card\'s picture into raw-assets/images/entities{tps}/card-<kind>.png (only those not there yet: yours are kept), to edit by hand; then npm run image', onclick: () => saveCardPictures(false) }, 'Save card pictures'),
                    el('button', { class: 'danger', title: 'Every card\'s picture saved again, over what\'s there (your edits too)', onclick: () => saveCardPictures(true) }, 'Overwrite all'),
                    el('button', { title: 'The previews from the saved pictures again (after editing them)', onclick: () => { pictures.clear(); render(); } }, 'Reload pictures')),
                ...CARDS.map(([kind, name]) => cardDrawer(kind, name))),
            card('Houses',
                el('div', { class: 'field' }, el('label', { title: 'On: reds and giants bump into houses and go round them. Off: they walk over them.' }, 'reds bump into houses'), houses),
                el('p', { class: 'hint' }, 'Off: reds (and giants) walk over the houses as if they weren\'t there.')),
        ];
        for (const [kind, title, hint] of UPGRADES) {
            const upgrade = s.upgrades[kind];
            const costs = el('input', { type: 'text', value: upgrade.cost.join(', '), style: { width: '100%' } });
            costs.addEventListener('change', () => {
                upgrade.cost = costs.value.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
                changed();
                render();
            });
            const first = el('input', { type: 'number', step: 10, value: upgrade.cost[0] ?? 50, title: 'The first level\'s price' });
            const growth = el('input', { type: 'number', step: 5, value: 35, title: 'How much dearer each level is than the last (%)' });
            const fill = el('button', {
                title: 'Prices for every level from the first price, each this much dearer than the last',
                onclick: () => {
                    const base = Number(first.value) || 50;
                    const rate = 1 + (Number(growth.value) || 0) / 100;
                    upgrade.cost = Array.from({ length: Math.max(0, upgrade.max - 1) }, (_, i) => Math.round((base * rate ** i) / 5) * 5);
                    changed();
                    render();
                },
            }, 'Fill costs');
            const missing = upgrade.max - 1 - upgrade.cost.length;
            cards.push(card(`Upgrade: ${title}`,
                text(upgrade, 'name', 'name'),
                number(upgrade, 'max', 'levels', 'How many levels it has (1 is where it starts)'),
                number(upgrade, 'perLevel', 'each level adds', hint, 0.01),
                el('div', { class: 'hint', style: { margin: '8px 0 4px' } }, `Prices, level 2 to ${upgrade.max} (${Math.max(0, upgrade.max - 1)} of them)`),
                costs,
                missing > 0 ? el('p', { class: 'hint', style: { color: '#ffcf4a' } }, `${missing} price(s) missing: those levels go on getting dearer by the last step.`) : null,
                missing < 0 ? el('p', { class: 'hint', style: { color: '#ffcf4a' } }, `${-missing} price(s) past the last level: not used.`) : null,
                el('div', { class: 'field', style: { marginTop: '6px' } }, el('label', {}, 'first'), first, el('label', {}, '+%'), growth, fill)));
        }
        form.replaceChildren(...cards);
    }

    function colourField(object, key, label, hint) {
        const input = el('input', { type: 'color', value: object[key] ?? '#3d6dff' });
        input.addEventListener('input', () => { object[key] = input.value; changed(); });
        return el('div', { class: 'field' }, el('label', { title: hint }, label), input);
    }

    /** A card's drawer: its levels and prices, each stat at level 1 and at the top, and its picture's framing (previewed). */
    function cardDrawer(kind, name) {
        const c = settings.cards[kind];
        const drawer = el('details', { open: openDrawers.has(kind), style: { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '10px', padding: '8px 12px', margin: '8px 0' } });
        drawer.addEventListener('toggle', () => { if (drawer.open) openDrawers.add(kind); else openDrawers.delete(kind); });
        const range = (key, label, hint, step) => {
            const pair = c[key];
            const input = (i) => {
                const box = el('input', { type: 'number', step, value: pair[i] });
                box.addEventListener('change', () => { pair[i] = Number(box.value) || 0; changed(); });
                return box;
            };
            return el('div', { class: 'field' }, el('label', { title: hint }, label), el('span', {}, input(0), ' → ', input(1)));
        };
        const costs = el('input', { type: 'text', value: c.cost.join(', '), style: { width: '100%' } });
        costs.addEventListener('change', () => {
            c.cost = costs.value.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0);
            changed();
        });
        // The picture's framing, with the card it makes.
        const preview = el('canvas', { width: 248, height: 304, style: { width: '124px', height: '152px', borderRadius: '10px', background: '#000' } });
        const framing = (key, label, min, max, step) => {
            const slider = el('input', { type: 'range', min, max, step, value: c.icon[key], style: { width: '150px' } });
            const value = el('span', { class: 'hint', style: { margin: 0, minWidth: '38px', display: 'inline-block' } }, String(c.icon[key]));
            slider.addEventListener('input', () => {
                c.icon[key] = Number(slider.value);
                value.textContent = slider.value;
                changed();
                drawCardPreview(preview, kind, c.icon);
            });
            return el('div', { class: 'field' }, el('label', {}, label), el('span', {}, slider, ' ', value));
        };
        drawCardPreview(preview, kind, c.icon);
        drawer.append(
            el('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, `${name} card`),
            el('div', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', marginTop: '8px' } },
                el('div', { style: { minWidth: '320px' } },
                    colourField(c, 'colour', 'main colour', 'Its frame, bar and glow; its panel a lighter one'),
                    number(c, 'maxLevel', 'levels', 'How many levels it has (1 is where it starts)'),
                    c.hp ? range('hp', 'hits', 'Its hits at level 1 → at the top (0: it can\'t be destroyed)', 1) : null,
                    range('damage', 'damage', 'The most it takes off a building, at level 1 → at the top', 1),
                    range('seconds', 'charge (s)', 'Seconds to charge, at level 1 → at the top', 0.5),
                    el('div', { class: 'hint', style: { margin: '8px 0 4px' } }, `Prices, level 2 to ${c.maxLevel}`),
                    costs),
                el('div', {},
                    el('div', { class: 'hint', style: { margin: '0 0 4px' } }, 'Its picture on the card'),
                    el('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start' } },
                        preview,
                        el('div', {},
                            framing('x', 'across', -0.6, 0.6, 0.01),
                            framing('y', 'up / down', -0.6, 0.6, 0.01),
                            framing('zoom', 'zoom', 0.5, 3, 0.05),
                            el('button', { onclick: () => { c.icon = { x: 0, y: 0, zoom: 1 }; changed(); render(); } }, 'Reset'))))));
        return drawer;
    }

    /** The cards' pictures, rendered as the game does, into raw-assets/images/entities{tps} (`all`: over those there). */
    async function saveCardPictures(all) {
        if (all && !window.confirm('Save every card picture again, over the ones there (your edits too)?')) return;
        try {
            const there = new Set(await api('/api/mob/card-pictures'));
            let saved = 0;
            for (const [kind] of CARDS) {
                if (!all && there.has(`card-${kind}.png`)) continue;
                // Saved over: rendered afresh (not the saved one).
                const image = await renderPicture(kind, settings.cards.giant.colour);
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 256;
                canvas.getContext('2d').drawImage(image, 0, 0, 256, 256);
                const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
                const response = await fetch(`/api/mob/card-picture?kind=${kind}`, { method: 'POST', body: blob });
                if (!response.ok) throw new Error(`${kind}: ${response.status}`);
                saved++;
            }
            toast(saved ? `${saved} picture(s) saved: run npm run image to pack them` : 'All the pictures are there already (Overwrite all to redo them)', 'ok');
            // The previews show the saved ones now.
            pictures.clear();
            render();
        } catch (error) {
            toast(`Not saved: ${error.message}`, 'error');
        }
    }

    async function save() {
        try {
            await api('/api/mob/settings', { method: 'PUT', body: settings });
            dirty = false;
            statusLine.textContent = '';
            toast('Settings saved', 'ok');
        } catch (error) {
            toast(`Not saved: ${error.message}`, 'error');
        }
    }

    async function load() {
        try {
            settings = await api('/api/mob/settings');
            render();
        } catch (error) {
            toast(`Could not load the settings: ${error.message}`, 'error');
        }
    }
    void load();

    return {
        show() {
            statusLine.textContent = dirty ? 'Settings not saved' : '';
        },
        get dirty() { return dirty; },
    };
}
