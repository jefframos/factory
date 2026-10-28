// Shared named styles (floor, wall, door, window, ground, path) stored in ui/worldstyles.json.
// A level only references style ids, so editing a style changes every level that uses it.
import { api, el, toast } from './shared.js';

const SCHEMA = {
    floor: { label: 'Floor', defaults: { colorA: '#5f93d6', colorB: '#5f93d6', checkerScale: 1.5 }, fields: [['colorA', 'color'], ['colorB', 'color'], ['checkerScale', 'number', 0.25]] },
    wall: { label: 'Walls', defaults: { bottomColor: '#378f91', topColor: '#ffd889', bottomHeight: 1.4, height: 6, thickness: 0.35 }, fields: [['bottomColor', 'color'], ['topColor', 'color'], ['bottomHeight', 'number', 0.1], ['height', 'number', 0.25], ['thickness', 'number', 0.05]] },
    door: { label: 'Doors', defaults: { color: '#493023', opacity: 1, model: 'heist/doors/door_A' }, fields: [['color', 'color'], ['opacity', 'number', 0.05], ['model', 'text']] },
    window: { label: 'Windows', defaults: { color: '#8bd9f4', opacity: 0.34 }, fields: [['color', 'color'], ['opacity', 'number', 0.05]] },
    ground: { label: 'Ground', defaults: { color: '#77a970' }, fields: [['color', 'color']] },
    path: { label: 'Entry path', defaults: { color: '#9a744d' }, fields: [['color', 'color']] },
};

let styles = null;
let dirty = false;
let host = null;
let hooks = null;
const open = {};

export const loadWorldStyles = async () => {
    styles = await api('/api/worldstyles');
    dirty = false;
    return styles;
};

export const hasUnsavedStyles = () => dirty;

export function styleOf(category, id) {
    const set = styles?.[category] ?? {};
    return set[id] ?? Object.values(set)[0] ?? SCHEMA[category].defaults;
}

export async function saveWorldStyles() {
    if (!dirty) return;
    await api('/api/worldstyles', { method: 'PUT', body: JSON.stringify(styles) });
    dirty = false;
    renderWorldStyles();
    toast('Styles saved');
}

export function initWorldStyles(container, callbacks) {
    host = container;
    hooks = callbacks;
}

function touch() {
    dirty = true;
    hooks.onStylesChange();
}

function usageCount(category, id) {
    return hooks.levels().filter((l) => (l.styles?.[category] ?? Object.keys(styles[category])[0]) === id).length;
}

export function renderWorldStyles() {
    if (!host || !styles) return;
    const level = hooks.level();
    host.replaceChildren(el('div', { class: 'hint' }, 'Styles are shared: editing one changes every level that uses it.'));
    for (const [category, schema] of Object.entries(SCHEMA)) {
        styles[category] ??= {};
        const set = styles[category];
        const ids = Object.keys(set);
        const current = level.styles?.[category] && set[level.styles[category]] ? level.styles[category] : ids[0];
        const select = el('select', {
            onchange: () => {
                level.styles = { ...level.styles, [category]: select.value };
                hooks.onLevelChange();
                renderWorldStyles();
            },
        }, ids.map((id) => el('option', { value: id, selected: id === current }, set[id].name || id)));
        const duplicate = el('button', {
            title: 'New style from this one',
            onclick: () => {
                let n = ids.length + 1;
                while (set[`${category}Style${n}`]) n++;
                const id = `${category}Style${n}`;
                set[id] = { ...structuredClone(set[current] ?? schema.defaults), name: `${schema.label} ${n}` };
                level.styles = { ...level.styles, [category]: id };
                open[category] = true;
                touch();
                hooks.onLevelChange();
                renderWorldStyles();
            },
        }, '+');
        const toggle = el('button', { onclick: () => { open[category] = !open[category]; renderWorldStyles(); } }, open[category] ? '▾' : '✎');
        const group = el('div', { class: 'style-group' },
            el('div', { class: 'field' }, el('span', {}, schema.label), select, duplicate, toggle));
        if (open[category]) {
            const style = set[current];
            const used = usageCount(category, current);
            group.append(el('div', { class: 'hint' }, `id: ${current} · used by ${used} level${used === 1 ? '' : 's'}`));
            group.append(el('label', { class: 'field' }, el('span', {}, 'name'), el('input', {
                value: style.name ?? '',
                onchange: (e) => { style.name = e.target.value; touch(); renderWorldStyles(); },
            })));
            for (const [key, type, step] of schema.fields) {
                const input = el('input', {
                    type,
                    value: style[key] ?? schema.defaults[key],
                    step,
                    onchange: () => {
                        style[key] = type === 'number' ? Number(input.value) : input.value;
                        touch();
                    },
                });
                group.append(el('label', { class: 'field' }, el('span', {}, key), input));
            }
        }
        host.append(group);
    }
    host.append(el('div', { class: 'row' }, el('button', {
        class: dirty ? 'primary' : '',
        onclick: () => saveWorldStyles().catch((e) => toast(e.message, 'error')),
    }, dirty ? 'Save styles *' : 'Save styles')));
}
