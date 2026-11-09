// mob-gaps.js
//
// The level panel's Check gaps (the server runs tools/gap-check.ts on the level as it is in the editor, saved or not:
// the battle's own collision, with each unit's body from the Units tab). Drawn over the field, for the unit picked:
//   - red: a gap plain mobs get through and it doesn't (too narrow for it: it stops there or goes round);
//   - amber: it only just fits (a tight spot: it rubs along, and a crowd jams it);
//   - its test runs' trails (from the cannon across the field, out of its houses; red giants down from the far end):
//     white, red where the unit got stuck for good;
//   - each spot it stalled, a ring with how many seconds it was there.
// Sliding bars, spinners and swinging gates aren't in the map (they move); the runs have them.
// Each level's last check is kept (ui/gaps.json) and shown by its grade in the lists: ✓ every test unit got through,
// ! some stood still a while, ✗ one got stuck for good (grey: the level's changed since). Check all gaps: every level.

import { levelHash } from './mob-grade-key.js';

const UNITS = [
    ['giant', 'Giant', 'giant'],
    ['truck', 'Truck', 'truck'],
    ['car', 'Car', 'car'],
    ['redGiant', 'Red giant', 'redGiant'],
];
/** Where it only just fits: the room it has (across or along, the narrower) under this, in world units. */
const TIGHT = 0.5;

/** The lists' mark for each result: its sign, colour and what it means. */
const MARKS = {
    pass: ['✓', '#3fcf62', 'Gaps checked: every test unit got through'],
    stall: ['!', '#ffb020', 'Gaps checked: test units stood still a while (no one stuck for good)'],
    fail: ['✗', '#ff4458', 'Gaps checked: a test unit got stuck for good'],
};

export function createGaps({ el, api, toast, redraw, onSummary = () => {} }) {
    /** Each level's last check in short (ui/gaps.json). */
    let summaries = {};
    let checkingAll = false;
    /** The last check: its level (id, hash), the result. */
    let result = null;
    let busy = false;
    let unit = 'giant';
    let shown = true;
    /** The red / amber cells for the unit picked (worked out once per result and unit). */
    let cells = null;

    /** The red cells (a gap plain mobs get through and it doesn't: a run of room for plain mobs, across or along,
     *  with no room in it at all for the unit) and the amber ones (room for it, but less than TIGHT either way). */
    function cellsFor(data, id) {
        const map = data.map;
        // A red giant against plain reds (enemy walls are in both their ways).
        const plain = id === 'redGiant' && map.rows.redPlain ? map.rows.redPlain : map.rows.plain;
        const own = map.rows[id] ?? map.rows.giant;
        const free = (rows, i, j) => rows[j]?.[i] === '1';
        const red = new Set();
        const out = { blocked: [], tight: [] };
        // Runs of `rows`' free cells along a line of cells (cell(k) → [i, j]); each one's cells.
        const runsOf = (rows, length, cell) => {
            const runs = [];
            let run = [];
            for (let k = 0; k <= length; k++) {
                const [i, j] = k < length ? cell(k) : [-1, -1];
                if (k < length && free(rows, i, j)) {
                    run.push([i, j]);
                    continue;
                }
                if (run.length) runs.push(run);
                run = [];
            }
            return runs;
        };
        const lines = [];
        for (let j = 0; j < map.nz; j++) lines.push([map.nx, (k) => [k, j]]);
        for (let i = 0; i < map.nx; i++) lines.push([map.nz, (k) => [i, k]]);
        // Too narrow: plain mobs' room with none of the unit's in it.
        for (const [length, cell] of lines) {
            for (const run of runsOf(plain, length, cell)) {
                if (run.some(([i, j]) => free(own, i, j))) continue;
                for (const [i, j] of run) red.add(j * map.nx + i);
            }
        }
        // Tight: the unit's room, across and along, the narrower under TIGHT.
        const room = new Float32Array(map.nx * map.nz).fill(Infinity);
        for (const [length, cell] of lines) {
            for (const run of runsOf(own, length, cell)) for (const [i, j] of run) room[j * map.nx + i] = Math.min(room[j * map.nx + i], run.length * map.step);
        }
        for (let j = 0; j < map.nz; j++) {
            for (let i = 0; i < map.nx; i++) {
                const at = [map.x0 + i * map.step, map.z0 + j * map.step];
                if (red.has(j * map.nx + i)) out.blocked.push(at);
                else if (free(own, i, j) && room[j * map.nx + i] < TIGHT) out.tight.push(at);
            }
        }
        return out;
    }

    async function check(id, level) {
        if (busy) return;
        busy = true;
        redraw(true);
        try {
            const data = await api('/api/mob/gaps', { method: 'POST', body: { id, level } });
            result = { id, hash: levelHash(level), data };
            await loadSummaries();
            cells = null;
            shown = true;
            const stuck = data.runs.filter((r) => r.end === 'stuck').length;
            const stalls = data.runs.reduce((n, r) => n + r.stalls.length, 0);
            toast(stuck ? `${stuck} test unit(s) stuck for good, ${stalls} stall(s) in all` : stalls ? `No unit stuck for good; ${stalls} stall(s)` : 'Every test unit got through', stuck ? 'error' : 'ok');
        } catch (error) {
            toast(error.message, 'error');
        }
        busy = false;
        redraw(true);
    }

    /** The level panel's section. */
    function panel(id, level) {
        const mine = result?.id === id ? result : null;
        const children = [el('h3', {}, 'Stuck spots')];
        children.push(el('div', { class: 'field' },
            el('button', { class: 'primary', disabled: busy, title: 'Test units walk the level (the battle\'s own collision) and the field is mapped for where each fits: a few seconds', onclick: () => check(id, level) }, busy ? 'Checking…' : 'Check gaps'),
            mine ? el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: shown, onchange: (e) => { shown = e.target.checked; redraw(false); } }), ' show') : null));
        if (mine) {
            if (mine.hash !== levelHash(level)) children.push(el('p', { class: 'hint', style: { color: '#ffcf4a' } }, 'The level changed since: check it again.'));
            const picker = el('div', { class: 'gap-units' }, ...UNITS.map(([key, name]) => {
                const runs = mine.data.runs.filter((r) => r.unit === key);
                if (!runs.length) return null;
                const stuck = runs.filter((r) => r.end === 'stuck').length;
                const stalls = runs.reduce((n, r) => n + r.stalls.length, 0);
                return el('button', { class: key === unit ? 'on' : '', title: `${runs.length} test runs: ${runs.filter((r) => r.end === 'target' || r.end === 'through').length} got there, ${stuck} stuck for good, ${stalls} stall(s)`, onclick: () => { unit = key; cells = null; redraw(true); } },
                    name, el('small', { class: stuck ? 'bad' : stalls ? 'warn' : 'good' }, stuck ? ` ${stuck} stuck` : stalls ? ` ${stalls} stall${stalls > 1 ? 's' : ''}` : ' ok'));
            }));
            children.push(picker);
            const body = mine.data.bodies[unit === 'redGiant' ? 'giant' : unit];
            if (body) children.push(el('p', { class: 'hint' }, `Its size ${body.size.toFixed(2)}, its body against walls ${body.body.toFixed(2)} (the Units tab's body). Red: plain mobs fit, it doesn't. Amber: it only just fits. Rings: where it stalled (seconds).`));
        } else {
            children.push(el('p', { class: 'hint' }, 'Where giants, trucks and cars can get stuck: the gaps too narrow for them and where test units stall.'));
        }
        return el('div', { class: 'difficulty' }, ...children);
    }

    /** Over the field (draw()'s end), for the level `id` open. */
    function draw(ctx, id, toScreen, scale) {
        if (!shown || result?.id !== id) return;
        const data = result.data;
        const mapId = UNITS.find(([key]) => key === unit)[2];
        cells ??= cellsFor(data, mapId);
        const size = data.map.step * scale;
        ctx.save();
        ctx.fillStyle = 'rgba(255, 40, 60, 0.38)';
        for (const [x, z] of cells.blocked) {
            const [sx, sy] = toScreen(x, z);
            ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
        }
        ctx.fillStyle = 'rgba(255, 190, 40, 0.5)';
        for (const [x, z] of cells.tight) {
            const [sx, sy] = toScreen(x, z);
            ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
        }
        for (const run of data.runs) {
            if (run.unit !== unit) continue;
            ctx.strokeStyle = run.end === 'stuck' ? 'rgba(255, 60, 70, 0.95)' : 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = run.end === 'stuck' ? 2 : 1.2;
            ctx.beginPath();
            run.trail.forEach(([x, z], k) => (k ? ctx.lineTo(...toScreen(x, z)) : ctx.moveTo(...toScreen(x, z))));
            ctx.stroke();
        }
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const run of data.runs) {
            if (run.unit !== unit) continue;
            for (const [x, z, seconds] of run.stalls) {
                const [sx, sy] = toScreen(x, z);
                ctx.strokeStyle = run.end === 'stuck' ? '#ff3346' : '#ffb020';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.arc(sx, sy, Math.min(22, 7 + seconds * 1.5), 0, Math.PI * 2);
                ctx.stroke();
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(15, 18, 45, 0.9)';
                ctx.strokeText(`${Math.round(seconds)}s`, sx, sy);
                ctx.fillStyle = '#fff';
                ctx.fillText(`${Math.round(seconds)}s`, sx, sy);
            }
        }
        ctx.restore();
    }

    async function loadSummaries() {
        try {
            summaries = (await api('/api/mob/gaps-summary')).levels ?? {};
        } catch {
            // None yet.
        }
        onSummary();
    }

    /** The lists' ✓ ! ✗ for level `id` (as it is now: `level`); nothing if it's never been checked. */
    function mark(id, level) {
        const summary = summaries[id];
        if (checkingAll) return el('span', { class: 'gap-mark busy', title: 'Checking gaps…' }, '…');
        if (!summary) return null;
        const [sign, colour, what] = MARKS[summary.result] ?? MARKS.fail;
        const stale = !level || summary.hash !== levelHash(level);
        const counts = `${summary.stuck} stuck for good, ${summary.stalls} stall(s) in ${summary.runs} test runs`;
        return el('span', {
            class: `gap-mark${stale ? ' stale' : ''}`,
            style: stale ? {} : { color: colour },
            title: `${what} (${counts})${stale ? ' — the level changed since: check it again' : ''}`,
        }, sign);
    }

    /** Every level in `levels` ({ id: level }, as the editor has them) checked; the marks after. */
    async function checkAll(levels) {
        if (checkingAll) return;
        checkingAll = true;
        onSummary();
        try {
            const out = await api('/api/mob/gaps-all', { method: 'POST', body: { levels } });
            summaries = out.levels ?? {};
            const counts = Object.keys(levels).map((id) => summaries[id]?.result);
            const n = (r) => counts.filter((c) => c === r).length;
            toast(`Gaps: ${n('pass')} pass, ${n('stall')} stall, ${n('fail')} fail${out.failed?.length ? ` (${out.failed.length} could not be checked)` : ''}`, n('fail') ? 'error' : 'ok');
        } catch (error) {
            toast(`Check all gaps: ${error.message}`, 'error');
        }
        checkingAll = false;
        onSummary();
    }

    void loadSummaries();
    return { panel, draw, mark, checkAll, get busy() { return busy; }, get checkingAll() { return checkingAll; } };
}
