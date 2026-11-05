// The Levels tab: the game's areas (ui/areas.json), each with the town shown on the home screen as its miniature and the
// levels played in it, in order. A level is a town plus a goal, so the same town can be played many ways. Towns are built
// in the Town tab; "New miniature" copies the area's current one, assigns it and opens it there, to simplify or replace.

import { api, el, toast } from './shared.js';

const GOALS = [
    ['all', 'Eat everything'],
    ['points', 'Reach this many points'],
    ['share', 'Reach this share of the town\'s points'],
    ['object', 'Swallow the town\'s goal'],
];

let dirty = false;
export const hasUnsavedLevels = () => dirty;

const goalOf = (level) => (level.type === 'points' ? (level.points !== undefined ? 'points' : 'share') : level.type);

export async function initLevelsTab(host, { onNewTown, openTown }) {
    const data = await api('/api/areas');
    let towns = await api('/api/levels');
    const list = el('div', { class: 'levels-list' });

    const changed = () => { dirty = true; };
    const townSelect = (value, onchange) => {
        const select = el('select', { onchange: (event) => { onchange(event.target.value); changed(); } },
            towns.map((town) => new Option(`${town.name} (${town.level})`, town.level)));
        select.value = value;
        return select;
    };
    const number = (title, value, onchange, step = 'any') => el('label', { class: 'levels-field' }, el('span', {}, title), el('input', {
        type: 'number', step, value: value === undefined ? '' : String(value),
        oninput: (event) => {
            const parsed = event.target.valueAsNumber;
            if (Number.isFinite(parsed)) { onchange(parsed); changed(); }
        },
    }));
    const move = (items, index, by) => {
        const to = index + by;
        if (to < 0 || to >= items.length) return;
        [items[index], items[to]] = [items[to], items[index]];
        changed();
        render();
    };

    /** A copy of a town, under a name asked for; its entry, or null. */
    async function copyTown(question, from) {
        const name = window.prompt(question);
        if (!name) return null;
        try {
            const entry = await api('/api/towns', { method: 'POST', body: JSON.stringify({ name, from }) });
            towns = await api('/api/levels');
            onNewTown(entry);
            return entry;
        } catch (error) {
            toast(error.message, 'error');
            return null;
        }
    }

    const saveAreas = () => api('/api/areas', { method: 'PUT', body: JSON.stringify(data) });

    /** Makes the area its own miniature, saves that, and opens it in the Town tab. */
    async function newMiniature(area) {
        const entry = await copyTown(`A name for ${area.name}'s miniature? It starts as a copy of the town it shows now. You'll go to the Town tab to edit it.`, area.miniature);
        if (!entry) return;
        area.miniature = entry.level;
        render();
        try {
            if (window.confirm('Start it empty? OK keeps just the island, Cancel keeps the copy of everything.')) {
                await api('/api/towns/erase', { method: 'POST', body: JSON.stringify({ level: entry.level }) });
            }
            await saveAreas();
            dirty = false;
            openTown(entry.level);
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    function levelRow(area, level, index, number1, fixed = false) {
        const goal = el('select', {
            onchange: (event) => {
                const chosen = event.target.value;
                delete level.points;
                delete level.share;
                level.type = chosen === 'share' ? 'points' : chosen;
                if (chosen === 'points') level.points = 500;
                if (chosen === 'share') level.share = 0.5;
                changed();
                render();
            },
        }, GOALS.map(([value, name]) => new Option(name, value)));
        goal.value = goalOf(level);
        const amount = goal.value === 'points' ? number('Points', level.points, (value) => { level.points = value; }, 10)
            : goal.value === 'share' ? number('Share (0-1)', level.share, (value) => { level.share = value; }, 0.05) : null;
        return el('div', { class: 'levels-row' },
            el('strong', { class: 'levels-number' }, fixed ? 'Tutorial' : `Level ${number1}`),
            el('label', { class: 'levels-field' }, el('span', {}, 'Town'), townSelect(level.level, (value) => { level.level = value; })),
            el('label', { class: 'levels-field' }, el('span', {}, 'Goal'), goal),
            amount,
            number('Seconds', level.seconds, (value) => { level.seconds = value; }, 10),
            number('Rivals', level.rivals, (value) => { level.rivals = value; }, 1),
            number('Coins', level.reward, (value) => { level.reward = value; }, 10),
            fixed ? null : el('div', { class: 'levels-buttons' },
                el('button', { title: 'Earlier', onclick: () => move(area.levels, index, -1) }, '▲'),
                el('button', { title: 'Later', onclick: () => move(area.levels, index, 1) }, '▼'),
                el('button', { title: 'Remove this level', onclick: () => { area.levels.splice(index, 1); changed(); render(); } }, '✕')));
    }

    function render() {
        let count = 0;
        list.replaceChildren(el('section', { class: 'levels-area' },
            el('div', { class: 'levels-area-head' }, 'What a new player plays first. Seconds 0: no clock.'),
            levelRow(null, data.tutorial, 0, 0, true)), ...data.areas.map((area, areaIndex) => el('section', { class: 'levels-area' },
            el('div', { class: 'levels-area-head' },
                el('label', { class: 'levels-field' }, el('span', {}, 'Area'), el('input', {
                    value: area.name, oninput: (event) => { area.name = event.target.value; changed(); },
                })),
                el('label', { class: 'levels-field', title: 'The town shown as the island on the home screen while this area\'s being played.' },
                    el('span', {}, 'Miniature (home screen)'), townSelect(area.miniature, (value) => { area.miniature = value; })),
                el('button', { title: 'Copy the town it shows now into a new town of its own, and open that in the Town tab', onclick: () => newMiniature(area) }, '＋ New miniature'),
                el('label', { class: 'levels-field', title: 'The fence and the wooden pilings round the shore, on the home screen only. Playing the town always keeps them.' },
                    el('span', {}, 'Poles on miniature'), el('input', {
                        type: 'checkbox', checked: area.miniaturePoles === true,
                        onchange: (event) => { area.miniaturePoles = event.target.checked; changed(); },
                    })),
                el('div', { class: 'levels-buttons' },
                    el('button', { title: 'Earlier', onclick: () => move(data.areas, areaIndex, -1) }, '▲'),
                    el('button', { title: 'Later', onclick: () => move(data.areas, areaIndex, 1) }, '▼'),
                    el('button', {
                        title: 'Remove this area',
                        onclick: () => {
                            if (!window.confirm(`Remove ${area.name} and its levels?`)) return;
                            data.areas.splice(areaIndex, 1);
                            changed();
                            render();
                        },
                    }, '✕'))),
            area.levels.map((level, index) => levelRow(area, level, index, ++count)),
            el('button', {
                onclick: () => {
                    area.levels.push({ level: area.miniature, type: 'all', seconds: 240, rivals: 3, reward: 200 });
                    changed();
                    render();
                },
            }, '＋ Level'))));
    }

    const addArea = () => {
        const name = window.prompt('The new area\'s name?');
        if (!name) return;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `area-${data.areas.length + 1}`;
        data.areas.push({ id, name, miniature: towns[0].level, levels: [{ level: towns[0].level, type: 'all', seconds: 240, rivals: 3, reward: 200 }] });
        changed();
        render();
    };
    const newTown = async () => {
        const entry = await copyTown('The new town\'s name? It starts as a copy of the town open in the Town tab.', localStorage.getItem('ufoEditor.level') ?? towns[0].level);
        if (!entry) return;
        render();
        toast(`${entry.name} made: pick it at the top to edit it in the Town tab`);
    };
    const save = async () => {
        try {
            await saveAreas();
            dirty = false;
            toast('Saved');
        } catch (error) {
            toast(error.message, 'error');
        }
    };
    render();
    host.replaceChildren(el('div', { class: 'levels-tab' },
        el('div', { class: 'toolbar levels-toolbar' },
            el('button', { onclick: addArea }, '＋ Area'),
            el('button', { onclick: newTown }, '＋ New town'),
            el('button', { class: 'primary', onclick: save }, '💾 Save')),
        list));
}
