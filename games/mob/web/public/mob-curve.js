// mob-curve.js
//
// The editor's Curve tab: the difficulty curve of the whole game from a grading report (reports/*.json, written by the
// grader: tools/grade-levels.ts), drawn against the curve to aim for, so the levels can be rebalanced.
//
// The curve to aim for (casual / hyper-casual pacing, on the grader's 0..100: 0 anyone wins it first go, ~35 an average
// player only just wins it first go, ~43 one retry, 100 most never win it):
//   - a gentle start (the first levels teach: nearly always won first go), then a steady climb to the end;
//   - a sawtooth inside each area: it climbs through the area to its last level, the hardest (its "boss"), and the
//     next area opens with a breather, a dip below the climb (a new look, an easier level: relief, then build again);
//   - no jump between neighbours much over ~15 (a wall players quit at).
// Its numbers (start, end, how it bends, the area rise, the boss, the breather) are the sliders; they're kept in this
// browser. The band round it (± tolerance) is "on the curve"; outside, each level gets a suggestion: a rough first
// guess at its red rate and buildings' hits (a retry step, 10% easier, is about 7.5 points of grade), with Apply to
// put it in the level (unsaved: save it, then grade again).

import { gradeColour } from './mob-grade-key.js';

const DEFAULT_CURVE = { start: 6, end: 60, bend: 0.85, rise: 10, boss: 8, breather: 8, tolerance: 8 };
const CURVE_KEY = 'mob-editor.curve';
/** A grade point per 1% of red rate and buildings' hits (a 10% retry ease is about one try: ~7.5 points). */
const POINTS_PER_PERCENT = 0.75;
const PROFILE_COLOURS = { pro: '#7fd1ff', 'pro-raw': '#3f8cff', average: '#9cff8a', 'average-raw': '#3fcf5e', casual: '#ffd23f', newbie: '#ff7b7b' };
const CHART = { height: 360, padLeft: 40, padRight: 16, padTop: 26, padBottom: 34 };

/** The curve's numbers as set in the Curve tab (kept in this browser), so the level list judges by the same. */
export function loadCurve() {
    try {
        return { ...DEFAULT_CURVE, ...JSON.parse(localStorage.getItem(CURVE_KEY) ?? '{}') };
    } catch {
        return { ...DEFAULT_CURVE };
    }
}

/** The curve to aim for at each level of `levels` (in play order, each with its `zone`). */
export function targetCurve(levels, curve) {
    const n = levels.length;
    // Each area's levels: where each one is in it.
    const zoneOf = [];
    let k = 0;
    levels.forEach((level, i) => {
        if (i > 0 && level.zone !== levels[i - 1].zone) k = 0;
        zoneOf.push({ k: k++ });
    });
    let start = 0;
    for (let i = 0; i <= n; i++) {
        if (i === n || (i > 0 && levels[i].zone !== levels[i - 1].zone)) {
            for (let j = start; j < i; j++) zoneOf[j].size = i - start;
            start = i;
        }
    }
    return levels.map((level, i) => {
        const t = n > 1 ? i / (n - 1) : 0;
        let value = curve.start + (curve.end - curve.start) * Math.pow(t, curve.bend);
        const { k: at, size } = zoneOf[i];
        if (size > 2) {
            // Climbing through the area: from rise/2 under the line to rise/2 over it at its second last.
            if (at < size - 1) value += curve.rise * (at / (size - 2) - 0.5);
            else value += curve.rise / 2 + curve.boss;
        }
        // An area's first level (not the game's first): a breather.
        if (at === 0 && i > 0) value -= curve.breather;
        return Math.max(0, Math.min(100, value));
    });
}

export function buildCurveTab(panel, { el, api, toast, state, grades, onLevelChanged, openLevel }) {
    let curve = loadCurve();
    let reports = [];
    let report = null;
    let compare = null;
    let reportName = 'latest.json';
    let compareName = '';
    const shown = new Set(['average']);
    let hover = -1;

    const reportSelect = el('select', { onchange: (e) => { reportName = e.target.value; loadReport(); } });
    const compareSelect = el('select', { title: 'Another report drawn faintly under it (to see what a rebalance changed)', onchange: (e) => { compareName = e.target.value; loadReport(); } });
    const canvas = el('canvas', { style: { width: '100%', height: `${CHART.height}px`, display: 'block', cursor: 'pointer' } });
    const ctx = canvas.getContext('2d');
    const legend = el('div', { class: 'curve-legend' });
    const summary = el('div', { class: 'curve-summary' });
    const table = el('div', { class: 'curve-table' });
    const sliders = el('div', { class: 'curve-sliders' });
    panel.append(el('div', { class: 'editor', style: { overflow: 'auto' } },
        el('div', { class: 'toolbar' },
            el('span', { class: 'hint' }, 'Report'), reportSelect,
            el('span', { class: 'hint' }, 'compare with'), compareSelect,
            el('button', { title: 'Look for new reports', onclick: () => show() }, 'Reload'),
            el('span', { style: { flex: 1 } }),
            el('button', { class: 'primary', title: 'Robot players grade every level (a minute or two); a new report comes out of it', onclick: () => grades?.run([]) }, 'Grade all levels')),
        el('div', { class: 'curve-body' },
            el('div', { class: 'curve-main' }, canvas, legend, summary, table),
            el('div', { class: 'curve-side' },
                el('h3', {}, 'The curve to aim for'),
                el('p', { class: 'hint' }, 'Casual pacing: an easy start, a steady climb, each area climbing to its hardest last level (its boss) and the next one opening with a breather. 35 is about where an average player only just wins first go; 43 needs one retry.'),
                sliders,
                el('button', { onclick: () => { curve = { ...DEFAULT_CURVE }; keepCurve(); renderSliders(); draw(); } }, 'Back to the suggested curve')))));

    const keepCurve = () => {
        try {
            localStorage.setItem(CURVE_KEY, JSON.stringify(curve));
        } catch {
            // No storage.
        }
    };

    function renderSliders() {
        const slider = (key, label, min, max, step, hint) => {
            const value = el('span', { class: 'hint', style: { minWidth: '34px', display: 'inline-block', margin: 0 } }, String(curve[key]));
            const input = el('input', { type: 'range', min, max, step, value: curve[key], style: { width: '130px' } });
            input.addEventListener('input', () => {
                curve[key] = Number(input.value);
                value.textContent = input.value;
                keepCurve();
                draw();
            });
            return el('div', { class: 'field' }, el('label', { title: hint }, label), el('span', {}, input, ' ', value));
        };
        sliders.replaceChildren(
            slider('start', 'start', 0, 40, 1, 'The first levels\' grade'),
            slider('end', 'end', 20, 100, 1, 'The last level\'s grade (before its area\'s boss bump)'),
            slider('bend', 'bend', 0.4, 2, 0.05, 'Under 1: it climbs early, then levels off; over 1: slow at first, steep at the end'),
            slider('rise', 'area rise', 0, 30, 1, 'How much each area climbs from its start to its second last level'),
            slider('boss', 'boss', 0, 25, 1, 'How much harder an area\'s last level is'),
            slider('breather', 'breather', 0, 25, 1, 'How much easier an area\'s first level is'),
            slider('tolerance', 'tolerance ±', 2, 20, 1, 'How far off the curve still counts as on it'));
    }

    async function show() {
        try {
            reports = await api('/api/mob/reports');
        } catch (error) {
            toast(`Could not list the reports: ${error.message}`, 'error');
            return;
        }
        if (!reports.some((r) => r.name === reportName)) reportName = reports[0]?.name ?? '';
        const label = (r) => (r.name === 'latest.json' ? `Latest (${new Date(r.at).toLocaleString()})` : `${new Date(r.at).toLocaleString()}${r.full ? '' : ' (part)'}`);
        reportSelect.replaceChildren(...reports.map((r) => el('option', { value: r.name, selected: r.name === reportName }, label(r))));
        compareSelect.replaceChildren(el('option', { value: '' }, '(none)'), ...reports.map((r) => el('option', { value: r.name, selected: r.name === compareName }, label(r))));
        await loadReport();
    }

    async function loadReport() {
        report = null;
        compare = null;
        try {
            if (reportName) report = await api(`/api/mob/report?name=${encodeURIComponent(reportName)}`);
            if (compareName && compareName !== reportName) compare = await api(`/api/mob/report?name=${encodeURIComponent(compareName)}`);
        } catch (error) {
            toast(error.message, 'error');
        }
        draw();
    }

    // ------------------------------------------------------------------ the chart

    const xOf = (i, n, width) => CHART.padLeft + (n > 1 ? (i / (n - 1)) : 0.5) * (width - CHART.padLeft - CHART.padRight);
    const yOf = (score) => CHART.padTop + (1 - score / 100) * (CHART.height - CHART.padTop - CHART.padBottom);

    /** The chart, the legend, the summary and the table. */
    function draw() {
        drawChart();
        if (!report) {
            legend.replaceChildren();
            summary.replaceChildren();
            table.replaceChildren();
            return;
        }
        const target = targetCurve(report.levels, curve);
        renderLegend();
        renderSummary(report.levels, target);
        renderTable(report.levels, target);
    }

    /** Just the chart (the mouse moving over it, or the table). */
    function drawChart() {
        const width = Math.max(300, canvas.clientWidth || 800);
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = CHART.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, CHART.height);
        if (!report) {
            ctx.fillStyle = '#9aa2d6';
            ctx.font = '14px system-ui';
            ctx.fillText('No report yet: Grade all levels makes one.', CHART.padLeft, 60);
            return;
        }
        const levels = report.levels;
        const n = levels.length;
        const target = targetCurve(levels, curve);
        const step = n > 1 ? (width - CHART.padLeft - CHART.padRight) / (n - 1) : 0;
        // The areas, as bands behind it.
        let from = 0;
        levels.forEach((level, i) => {
            if (i < n - 1 && levels[i + 1].zone === level.zone) return;
            const x0 = xOf(from, n, width) - step / 2;
            const x1 = xOf(i, n, width) + step / 2;
            ctx.fillStyle = (levels.slice(0, from).filter((l, j) => j === 0 || l.zone !== levels[j - 1].zone).length % 2) ? 'rgba(255,255,255,0.035)' : 'rgba(79,140,255,0.07)';
            ctx.fillRect(x0, CHART.padTop, x1 - x0, CHART.height - CHART.padTop - CHART.padBottom);
            ctx.fillStyle = '#9aa2d6';
            ctx.font = '11px system-ui';
            ctx.fillText(level.zoneName ?? level.zone, x0 + 4, CHART.padTop - 8);
            from = i + 1;
        });
        // The grid.
        ctx.strokeStyle = '#2a3060';
        ctx.lineWidth = 1;
        ctx.font = '10px system-ui';
        for (let g = 0; g <= 100; g += 20) {
            ctx.beginPath();
            ctx.moveTo(CHART.padLeft, yOf(g));
            ctx.lineTo(width - CHART.padRight, yOf(g));
            ctx.stroke();
            ctx.fillStyle = '#7d85b8';
            ctx.fillText(String(g), 10, yOf(g) + 3);
        }
        levels.forEach((level, i) => {
            if (n > 20 && i % 2 && i !== n - 1) return;
            ctx.fillStyle = '#7d85b8';
            ctx.fillText(String(i + 1), xOf(i, n, width) - 4, CHART.height - CHART.padBottom + 14);
        });
        // The band to aim for, and its line.
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.beginPath();
        target.forEach((t, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, xOf(i, n, width), yOf(Math.min(100, t + curve.tolerance))));
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(xOf(i, n, width), yOf(Math.max(0, target[i] - curve.tolerance)));
        ctx.closePath();
        ctx.fill();
        line(target.map((t, i) => [xOf(i, n, width), yOf(t)]), '#ffffff', 2, [6, 5]);
        // The report compared with, faint.
        if (compare) {
            const byId = new Map(compare.levels.map((l) => [l.id, l]));
            line(levels.map((l, i) => (byId.get(l.id)?.score ?? null) === null ? null : [xOf(i, n, width), yOf(byId.get(l.id).score)]), 'rgba(200,180,255,0.45)', 2, [2, 3]);
        }
        // Each profile shown.
        for (const id of shown) {
            line(levels.map((l, i) => (l.profiles?.[id]?.score ?? null) === null ? null : [xOf(i, n, width), yOf(l.profiles[id].score)]), PROFILE_COLOURS[id] ?? '#ccc', 1.5, []);
        }
        // The grade: its line and a dot each (hollow grey: out of date).
        line(levels.map((l, i) => (l.score === null ? null : [xOf(i, n, width), yOf(l.score)])), 'rgba(255,255,255,0.85)', 2.5, []);
        levels.forEach((level, i) => {
            if (level.score === null) return;
            const x = xOf(i, n, width);
            const y = yOf(level.score);
            ctx.beginPath();
            ctx.arc(x, y, i === hover ? 7 : 5, 0, Math.PI * 2);
            if (level.stale) {
                ctx.strokeStyle = '#a9afc6';
                ctx.lineWidth = 2;
                ctx.stroke();
            } else {
                ctx.fillStyle = gradeColour(level.score);
                ctx.fill();
                ctx.strokeStyle = '#14172a';
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        });
        // The level under the mouse.
        if (hover >= 0 && levels[hover]) {
            const level = levels[hover];
            const text = `${hover + 1}. ${level.name} · ${level.score ?? '–'} (aim ${Math.round(target[hover])})${level.stale ? ' · out of date' : ''}`;
            ctx.font = '12px system-ui';
            const w = ctx.measureText(text).width + 12;
            const x = Math.min(width - w - 4, Math.max(4, xOf(hover, n, width) - w / 2));
            ctx.fillStyle = 'rgba(20,23,42,0.92)';
            ctx.fillRect(x, CHART.height - 26, w, 20);
            ctx.fillStyle = '#e8ebff';
            ctx.fillText(text, x + 6, CHART.height - 12);
        }
        table.querySelectorAll('.curve-row[data-i]').forEach((row) => row.classList.toggle('on', Number(row.dataset.i) === hover));
    }

    function line(points, colour, width, dash) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        let drawing = false;
        for (const point of points) {
            if (!point) {
                drawing = false;
                continue;
            }
            if (drawing) ctx.lineTo(point[0], point[1]);
            else ctx.moveTo(point[0], point[1]);
            drawing = true;
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function renderLegend() {
        const profiles = report.profiles ?? [];
        legend.replaceChildren(
            el('span', {}, el('span', { class: 'swatch', style: { background: '#fff' } }), ' the grade'),
            el('span', {}, el('span', { class: 'swatch dashed' }), ' the curve to aim for (± tolerance shaded)'),
            compare ? el('span', {}, el('span', { class: 'swatch', style: { background: 'rgba(200,180,255,0.6)' } }), ' compared report') : null,
            ...profiles.map((p) => {
                const box = el('input', { type: 'checkbox', checked: shown.has(p.id) });
                box.addEventListener('change', () => {
                    if (box.checked) shown.add(p.id);
                    else shown.delete(p.id);
                    draw();
                });
                return el('label', { title: `${p.name} (counts ${Math.round(p.weight * 100)}% of the grade)` }, box, el('span', { class: 'swatch', style: { background: PROFILE_COLOURS[p.id] ?? '#ccc' } }), ` ${p.name}`);
            }));
    }

    function renderSummary(levels, target) {
        const graded = levels.filter((l) => l.score !== null);
        const off = levels.map((l, i) => (l.score === null ? 0 : l.score - target[i]));
        const easy = off.filter((d) => d < -curve.tolerance).length;
        const hard = off.filter((d) => d > curve.tolerance).length;
        const jumps = levels.filter((l, i) => i > 0 && l.score !== null && levels[i - 1].score !== null && Math.abs(l.score - levels[i - 1].score) > 15).length;
        const stale = levels.filter((l) => l.stale).length;
        const mean = graded.length ? Math.round(graded.reduce((s, l) => s + l.score, 0) / graded.length) : 0;
        const aim = target.length ? Math.round(target.reduce((s, t) => s + t, 0) / target.length) : 0;
        summary.replaceChildren(
            el('span', {}, `Graded ${graded.length}/${levels.length}`),
            el('span', {}, `Average ${mean} (aim ${aim})`),
            el('span', { style: { color: '#7fd1ff' } }, `${easy} too easy`),
            el('span', { style: { color: '#ff9b9b' } }, `${hard} too hard`),
            el('span', { style: { color: '#ffcf4a' } }, `${jumps} jumps over 15 between neighbours`),
            stale ? el('span', { style: { color: '#a9afc6' } }, `${stale} out of date (grade again)`) : null,
            el('span', { class: 'hint' }, `Report from ${new Date(report.at).toLocaleString()}`));
    }

    /** A level's suggestion: how far off the curve, and a rough red rate / hits change to get there. */
    function suggestion(level, aim) {
        if (level.score === null) return { text: 'not graded', factor: 1 };
        const delta = level.score - aim;
        if (Math.abs(delta) <= curve.tolerance) return { text: 'on the curve', factor: 1 };
        // Points to move it by (to the curve itself), as a share of its reds and buildings' hits.
        const percent = Math.max(-50, Math.min(80, -delta / POINTS_PER_PERCENT));
        const factor = 1 + percent / 100;
        const word = delta < 0 ? 'Too easy' : 'Too hard';
        const rate = `red rate ${round(level.redRate)}→${round(level.redRate * factor)}`;
        return { text: `${word} by ${Math.round(Math.abs(delta))}: ${rate}, hits ×${factor.toFixed(2)}`, factor };
    }
    const round = (v) => Math.round(v * 100) / 100;

    function renderTable(levels, target) {
        const rows = levels.map((level, i) => {
            const aim = target[i];
            const { text, factor } = suggestion(level, aim);
            const delta = level.score === null ? null : Math.round(level.score - aim);
            const jump = i > 0 && level.score !== null && levels[i - 1].score !== null ? level.score - levels[i - 1].score : 0;
            const canApply = factor !== 1 && state.levels.has(level.id);
            const row = el('div', { class: `curve-row${i === hover ? ' on' : ''}`, onmouseenter: () => { hover = i; drawChart(); } },
                el('span', {}, String(i + 1)),
                el('span', { class: 'name', title: level.id }, level.name, el('small', {}, ` ${level.zoneName ?? level.zone}`)),
                el('span', { class: `grade${level.stale ? ' stale' : ''}`, style: level.score === null || level.stale ? {} : { background: gradeColour(level.score) } }, level.score === null ? '–' : String(level.score)),
                el('span', { class: 'hint', style: { margin: 0 } }, String(Math.round(aim))),
                el('span', { style: { color: delta === null ? '' : delta < -curve.tolerance ? '#7fd1ff' : delta > curve.tolerance ? '#ff9b9b' : '#9cff8a' } }, delta === null ? '' : `${delta > 0 ? '+' : ''}${delta}`),
                el('span', { class: 'hint', style: { margin: 0, color: Math.abs(jump) > 15 ? '#ffcf4a' : '' }, title: 'Jump from the level before' }, jump ? `${jump > 0 ? '↑' : '↓'}${Math.abs(Math.round(jump))}` : ''),
                el('span', { class: 'why' }, text),
                el('span', {},
                    canApply ? el('button', { title: 'Scale its red rates and its buildings\' hits by this (unsaved: save the level, then grade it again)', onclick: () => apply(level.id, factor) }, 'Apply') : null,
                    state.levels.has(level.id) ? el('button', { title: 'Open it in the Levels tab', onclick: () => openLevel(level.id) }, '✎') : null));
            row.dataset.i = String(i);
            return row;
        });
        table.replaceChildren(el('div', { class: 'curve-row head' },
            el('span', {}, '#'), el('span', {}, 'level'), el('span', {}, 'grade'), el('span', {}, 'aim'), el('span', {}, 'off'), el('span', {}, 'jump'), el('span', {}, 'suggestion (a rough first guess: grade it again after)'), el('span', {})), ...rows);
    }

    /** Scales a level's reds and buildings' hits by `factor` (in the editor: unsaved). */
    function apply(id, factor) {
        const data = state.levels.get(id);
        if (!data) return;
        const r2 = (v) => Math.round(v * 100) / 100;
        data.redRate = r2(data.redRate * factor);
        data.redRateEnd = r2(data.redRateEnd * factor);
        if (data.targets?.length) data.targets.forEach((target) => { target.hp = Math.max(1, Math.round(target.hp * factor)); });
        else data.baseHp = Math.max(1, Math.round(data.baseHp * factor));
        onLevelChanged(id);
        toast(`${data.name}: reds and hits ×${factor.toFixed(2)} (not saved: save it in the Levels tab, then grade it again)`, 'ok');
        draw();
    }

    canvas.addEventListener('mousemove', (event) => {
        if (!report) return;
        const n = report.levels.length;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width;
        let best = -1;
        let bestDistance = Infinity;
        for (let i = 0; i < n; i++) {
            const d = Math.abs(xOf(i, n, width) - (event.clientX - rect.left));
            if (d < bestDistance) {
                bestDistance = d;
                best = i;
            }
        }
        if (best !== hover) {
            hover = best;
            drawChart();
        }
    });
    canvas.addEventListener('click', () => {
        const level = report?.levels[hover];
        if (level && state.levels.has(level.id)) openLevel(level.id);
    });
    new ResizeObserver(() => { if (!panel.hidden) drawChart(); }).observe(canvas);
    renderSliders();

    return { show };
}
