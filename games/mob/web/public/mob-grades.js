// mob-grades.js
//
// The levels' difficulty grades in the editor (the grader: tools/grade-levels.ts, robot players of six profiles playing
// each level where it is in the game, with the coins and upgrades they'd have by then):
//   - a coloured badge with each level's grade (0 easy, green .. 100 hard, red) in the level list and the Zones tab;
//     greyed out when it no longer holds — the level moved in the order, was edited, or the levels before it (their
//     rewards and houses) or the settings changed — so you know to grade it again;
//   - a row of coloured letters with what's in each level (gates, houses, pipes, …), to see the variety at a glance;
//   - in a level's panel (nothing selected): its grade, each profile's (with what it had), and Grade this level;
//   - Grade all levels (the whole game, in the background: a minute or two).
// Grading uses the editor's order and the level as it is now, saved or not.

import { contextHash, gradeColour, gradeWord, levelHash } from './mob-grade-key.js';

/** The robot players (game/sim/Grading.ts PROFILES), in the order shown. */
const PROFILE_NAMES = {
    pro: 'Pro, upgrades everything',
    'pro-raw': 'Pro, never upgrades',
    average: 'Average, upgrades everything',
    'average-raw': 'Average, never upgrades',
    casual: 'Casual, spends half',
    newbie: 'Newbie, never upgrades',
};

/** What a level has in it: a letter each, its colour, what it is, how many (0: not there). */
const FEATURES = [
    ['G', '#2fbf55', 'gates', (l) => (l.gates ?? []).filter((g) => !g.lock && !g.swing).length],
    ['S', '#17a589', 'sliding gates', (l) => (l.gates ?? []).filter((g) => !g.lock && g.swing).length],
    ['L', '#8a93a6', 'locked gates', (l) => (l.gates ?? []).filter((g) => g.lock).length],
    ['E', '#ff3d4f', 'enemy walls (only reds bump into them)', (l) => (l.obstacles ?? []).filter((o) => o.kind === 'enemyWall').length],
    ['B', '#b9773e', 'breakable blocks', (l) => (l.obstacles ?? []).filter((o) => o.kind === 'breakable').length],
    ['W', '#3fa9f5', 'water holes', (l) => (l.obstacles ?? []).filter((o) => o.kind === 'water').length],
    ['H', '#a600ff', 'giant houses', (l) => (l.pads ?? []).filter((p) => (p.kind ?? 'giant') === 'giant').length],
    ['B', '#ff3d4f', 'bomb houses', (l) => (l.pads ?? []).filter((p) => p.kind === 'bomb').length],
    ['U', '#e6b400', 'UFO houses', (l) => (l.pads ?? []).filter((p) => p.kind === 'saucer').length],
    ['C', '#ff8a1f', 'car houses', (l) => (l.pads ?? []).filter((p) => p.kind === 'car').length],
    ['K', '#c0392b', 'PUSH blocks', (l) => (l.pushBlocks ?? []).length],
    ['P', '#21b8c9', 'pipes', (l) => (l.pipes ?? []).length],
    ['X', '#7b241c', 'grinders', (l) => (l.grinders ?? []).length],
    ['O', '#e04fb5', 'spinners', (l) => (l.spinners ?? []).length],
    ['M', '#5d6d7e', 'sliding bars (pushers)', (l) => (l.pushers ?? []).length],
    ['A', '#b08d57', 'attack barriers (viking hats)', (l) => (l.helmets ?? []).filter((h) => h.kind === 'attack').length],
    ['D', '#5b7bd5', 'helmet barriers', (l) => (l.helmets ?? []).filter((h) => (h.kind ?? 'hp') === 'hp').length],
    ['F', '#6d4bd8', 'forts', (l) => ((l.targets ?? []).length > 1 ? l.targets.length : 0)],
    ['R', '#8b0000', 'red giants', (l) => (l.redGiantEvery > 0 ? 1 : 0)],
    ['Z', '#34495e', 'a bigger field', (l) => ((l.width ?? 10) > 10 || (l.length ?? 24) > 24 ? 1 : 0)],
];

export function createGrades({ el, api, toast, state, statusLine, onChange }) {
    let grades = { levels: {} };
    let settings = null;
    let status = null;
    let polling = 0;

    async function load() {
        try {
            [grades, settings] = await Promise.all([api('/api/mob/grades'), api('/api/mob/settings')]);
        } catch (error) {
            toast(`Could not load the grades: ${error.message}`, 'error');
        }
        onChange();
    }

    /** The play order as the editor has it (as the game builds it: zone by zone, levels that exist). */
    function order() {
        const ids = [];
        for (const zone of state.zones.zones) for (const id of zone.levels) if (state.levels.has(id)) ids.push(id);
        return ids;
    }

    /** A level's grade and, if it no longer holds, why (null: it does). */
    function gradeOf(id) {
        const grade = grades.levels?.[id];
        if (!grade) return null;
        const ids = order();
        const index = ids.indexOf(id);
        if (index < 0) return { grade, stale: 'it is in no zone now' };
        if (index !== grade.index) return { grade, stale: `it moved: graded as level ${grade.index + 1}, now level ${index + 1}` };
        if (levelHash(state.levels.get(id)) !== grade.levelHash) return { grade, stale: 'it was edited since' };
        if (settings && contextHash(index, ids.slice(0, index).map((other) => state.levels.get(other)), settings) !== grade.contextHash) {
            return { grade, stale: 'the levels before it (rewards, houses) or the settings changed' };
        }
        return { grade, stale: null };
    }

    /** The coloured badge with a level's grade (grey when it no longer holds; nothing if it's never been graded). */
    function badge(id) {
        const found = gradeOf(id);
        const running = status?.running && status.levels?.includes(id) && !status.finished?.some((f) => f.id === id);
        if (running) return el('span', { class: 'grade busy', title: 'Being graded…' }, '…');
        if (!found) return el('span', { class: 'grade none', title: 'Not graded yet' }, '–');
        const { grade, stale } = found;
        return el('span', {
            class: `grade${stale ? ' stale' : ''}`,
            style: stale ? {} : { background: gradeColour(grade.score) },
            title: `${gradeWord(grade.score)} (${grade.score}/100)${stale ? ` — out of date: ${stale}; grade it again` : ''}`,
        }, String(grade.score));
    }

    /** A level's contents as coloured letters. */
    function chips(level) {
        const found = FEATURES.map(([letter, colour, what, count]) => [letter, colour, what, level ? count(level) : 0]).filter(([, , , n]) => n > 0);
        return el('span', { class: 'chips' }, ...found.map(([letter, colour, what, n]) => el('span', { class: 'chip', style: { background: colour }, title: `${n} ${what}` }, letter)));
    }

    /** The letters' key (for the panel). */
    function chipKey() {
        return el('div', { class: 'chip-key' }, ...FEATURES.map(([letter, colour, what]) => el('span', {}, el('span', { class: 'chip', style: { background: colour } }, letter), ` ${what}`)));
    }

    /** Grades `ids` (none: every level) in the background, then shows the new grades. */
    /** `ids`: those (none: all). `everything`: with no ids, every level, not only the out-of-date ones. */
    async function run(ids = [], everything = false) {
        if (status?.running) {
            toast('Already grading', 'error');
            return;
        }
        const ids_ = ids.filter((id) => order().includes(id));
        if (ids.length && !ids_.length) {
            toast('Put the level in a zone first: it\'s graded where it is in the game', 'error');
            return;
        }
        // The editor's unsaved levels go with it (graded as they are here).
        const levels = Object.fromEntries([...state.dirty].filter((id) => state.levels.has(id)).map((id) => [id, state.levels.get(id)]));
        try {
            await api('/api/mob/grade', { method: 'POST', body: { ids: ids_, changedOnly: !everything, zones: state.zones, levels } });
        } catch (error) {
            toast(error.message, 'error');
            return;
        }
        status = { running: true, done: 0, total: 0, levels: ids_.length ? ids_ : order(), finished: [] };
        onChange();
        poll();
    }

    async function cancel() {
        await api('/api/mob/grade-cancel', { method: 'POST' }).catch(() => {});
    }

    function poll() {
        clearTimeout(polling);
        polling = setTimeout(async () => {
            try {
                const before = status?.finished?.length ?? 0;
                status = await api('/api/mob/grade-status');
                statusLine.textContent = status.running ? `Grading… ${status.done}/${status.total || '?'} games played` : statusLine.textContent;
                if ((status.finished?.length ?? 0) !== before || !status.running) {
                    grades = await api('/api/mob/grades');
                    onChange();
                }
                if (status.running) {
                    poll();
                } else {
                    const graded = status.finished.length
                        ? `Graded ${status.finished.length} level(s)`
                        : 'Every grade was up to date: nothing to grade (Shift+click Grade all to grade them all anyway)';
                    statusLine.textContent = status.error ? `Grading stopped: ${status.error}` : graded;
                    toast(status.error ? `Grading: ${status.error}` : graded, status.error ? 'error' : 'ok');
                }
            } catch (error) {
                toast(`Grading: ${error.message}`, 'error');
            }
        }, 800);
    }

    /** The level panel's Difficulty section. */
    function panel(id) {
        const found = gradeOf(id);
        const busy = !!status?.running;
        const children = [el('h3', {}, 'Difficulty')];
        if (found) {
            const { grade, stale } = found;
            children.push(el('div', { class: 'field' },
                el('span', { class: `grade big${stale ? ' stale' : ''}`, style: stale ? {} : { background: gradeColour(grade.score) } }, String(grade.score)),
                el('span', {}, `${gradeWord(grade.score)} · as level ${grade.index + 1} · ${new Date(grade.at).toLocaleString()}`)));
            if (stale) children.push(el('p', { class: 'hint', style: { color: '#ffcf4a' } }, `Out of date: ${stale}. Grade it again.`));
            const table = el('div', { class: 'grade-table' });
            for (const p of grade.profiles) {
                const l = p.loadout;
                const cards = Object.entries(l.cards ?? {}).map(([kind, level]) => `${kind} ${level}`).join(', ') || 'none';
                const firstWin = Math.round(p.firstWin * 100);
                const tries = p.tries === null ? 'never won' : `${p.tries} tr${p.tries === 1 ? 'y' : 'ies'}`;
                table.append(el('div', { class: 'grade-row', title: `Coins by then ${l.coins} (spent ${l.spent}) · fire ${l.fire}, energy ${l.capacity}, recharge ${l.recharge} · cards: ${cards}\nEach go (W won / L lost, seconds): ${p.goes.map((go) => go.map(([won, time]) => `${won ? 'W' : 'L'}${time}`).join(' ')).join('  |  ')}` },
                    el('span', { class: 'grade', style: { background: gradeColour(p.score) } }, String(p.score)),
                    el('span', { class: 'who' }, PROFILE_NAMES[p.id] ?? p.id),
                    el('small', {}, `${firstWin}% first go · ${tries}${p.never ? ` · ${Math.round(p.never * 100)}% never` : ''} · F${l.fire} E${l.capacity} R${l.recharge}`)));
            }
            children.push(table);
        } else {
            children.push(el('p', { class: 'hint' }, 'Not graded yet. Robot players of six kinds (pro to newbie, upgrading or not, with the coins they\'d have by this level) play it until they win, each loss easier as in the game.'));
        }
        children.push(el('div', { class: 'field' },
            el('button', { class: 'primary', disabled: busy, title: 'Robot players play this level where it is in the game (its unsaved changes too): about 10-30 seconds', onclick: () => run([id]) }, 'Grade this level'),
            el('button', { disabled: busy, title: 'Every level, in the order the game plays them (a minute or two)', onclick: () => run([]) }, 'Grade all levels'),
            busy ? el('button', { class: 'danger', onclick: cancel }, 'Stop') : null));
        if (busy) children.push(el('p', { class: 'hint' }, `Grading… ${status.done}/${status.total || '?'} games played`));
        children.push(el('p', { class: 'hint', style: { marginTop: '6px' } }, '0 anyone wins it first go … 100 most never do. Hover a profile for what it had and how each go went.'));
        children.push(chipKey());
        return el('div', { class: 'difficulty' }, ...children);
    }

    /**
     * How long a level takes: the robots' winning tries, averaged (seconds; the casual and average players, those most
     * like the people playing), from its grade (out of date or not); null if it's never been graded or never won.
     */
    function seconds(id) {
        const grade = gradeOf(id)?.grade;
        if (!grade) return null;
        const wins = [];
        for (const profile of grade.profiles ?? []) {
            if (profile.id !== 'casual' && profile.id !== 'average') continue;
            for (const go of profile.goes ?? []) {
                const won = go.find((attempt) => attempt[0] === 1);
                if (won) wins.push(won[1]);
            }
        }
        return wins.length ? Math.round(wins.reduce((sum, time) => sum + time, 0) / wins.length) : null;
    }

    /** A level's grade score (out of date or not), or null if it's never been graded. */
    function score(id) {
        return gradeOf(id)?.grade.score ?? null;
    }

    return { load, badge, chips, panel, run, score, seconds, get running() { return !!status?.running; } };
}
