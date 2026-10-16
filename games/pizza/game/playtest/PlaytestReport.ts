// PlaytestReport.ts
//
// The playtest as one self-contained HTML page (no external requests): headline numbers, the
// findings ranked by severity, then the charts behind them — money, store traffic, stock vs demand
// per item (small multiples), where the player's time went — and the tables (levels, tutorial,
// items, issues, activity log). Charts are plain SVG built here; a small inline script adds the
// hover crosshair + tooltip. Colors: the dataviz reference palette's first three categorical slots
// (validated all-pairs) and its status colors for severities, light + dark.

import type { PlaytestData } from './PlaytestRecorder';
import { Analysis, clock, Finding, forSaleWaits } from './PlaytestAnalysis';

const CHART_W = 760;
const CHART_H = 180;
const SMALL_W = 360;
const SMALL_H = 120;
const PAD = { left: 40, right: 12, top: 10, bottom: 22 };

interface Series {
    name: string;
    /** Categorical slot 1..3. */
    slot: 1 | 2 | 3;
    points: [number, number][];
}

interface Marker {
    t: number;
    label: string;
}

export function buildPlaytestReportHtml(data: PlaytestData, analysis: Analysis): string {
    const s = analysis.summary;
    const levelMarkers: Marker[] = analysis.levels.map(l => ({ t: l.t, label: `Lv ${l.level}` }));
    const charts: string[] = [];
    let chartId = 0;
    const nextId = (): string => `c${chartId++}`;

    charts.push(section('Money in the wallet', 'Coins on hand over game time; dashed lines are store level-ups.',
        lineChart(nextId(), [{ name: 'Wallet', slot: 1, points: data.samples.map(p => [p.t, p.money]) }], levelMarkers, CHART_W, CHART_H)));

    const storeIds = [...new Set(data.samples.flatMap(p => Object.keys(p.stores)))];
    for (const id of storeIds) {
        const at = (p: PlaytestData['samples'][number]) => p.stores[id];
        const traffic: Series[] = [
            { name: 'Clients in store', slot: 1, points: data.samples.filter(at).map(p => [p.t, at(p).clients]) },
            { name: 'Waiting at empty cashier', slot: 2, points: data.samples.filter(at).map(p => [p.t, at(p).readyToPayUnattended]) },
            { name: 'Garbage on floor', slot: 3, points: data.samples.filter(at).map(p => [p.t, at(p).garbage]) },
        ];
        charts.push(section(`${id} — traffic`, 'Counts at each moment: people in the store, people at the register with nobody serving, garbage pieces.',
            lineChart(nextId(), traffic, levelMarkers, CHART_W, CHART_H)));

        const types = [...new Set(data.samples.flatMap(p => (at(p) ? [...Object.keys(at(p).stock), ...Object.keys(at(p).demand)] : [])))];
        if (types.length > 0) {
            const multiples = types.map(type => {
                const rows = data.samples.filter(p => at(p) && ((at(p).stock as Record<string, number>)[type] !== undefined || (at(p).demand as Record<string, number>)[type] !== undefined));
                const series: Series[] = [
                    { name: 'On shelf', slot: 1, points: rows.map(p => [p.t, (at(p).stock as Record<string, number>)[type] ?? 0]) },
                    { name: 'Wanted', slot: 2, points: rows.map(p => [p.t, (at(p).demand as Record<string, number>)[type] ?? 0]) },
                ];
                return `<figure class="multiple"><figcaption>${esc(type)}</figcaption>${lineChart(nextId(), series, [], SMALL_W, SMALL_H, false)}</figure>`;
            }).join('');
            charts.push(section(`${id} — stock vs demand per item`, 'Units on the shelves vs units clients inside still want. "Wanted" above "On shelf" for long = a bottleneck.',
                `${legend([{ name: 'On shelf', slot: 1, points: [] }, { name: 'Wanted', slot: 2, points: [] }])}<div class="multiples">${multiples}</div>`));
        }
    }

    if (analysis.activity.length > 0) {
        charts.push(section('Where the player\'s time went', data.mode === 'bot' ? 'Share of game time per bot activity.' : 'Recorded human session — no activity breakdown.', barChart(analysis.activity)));
    }

    const findings = analysis.findings.length > 0
        ? analysis.findings.map(findingCard).join('')
        : '<p class="muted">No problems detected in this run.</p>';

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pizza Playtest Report</title>
<style>${STYLE}</style></head>
<body><main class="viz-root">
<header>
  <h1>Pizza playtest report</h1>
  <p class="muted">${esc(data.mode === 'bot' ? `Bot (${data.botStyle}) at ${data.speed}x` : 'Human session')} · started ${esc(new Date(data.startedAtIso).toLocaleString())} · ${clock(s.durationSec)} of game time · ended: ${esc(s.endReason)}</p>
</header>
<section class="tiles">
  ${tile('Store level', Object.entries(s.finalLevels).map(([id, lv]) => `${lv}`).join(' / ') || '—', Object.keys(s.finalLevels).join(', '))}
  ${tile('Clients paid', `${s.paid}`, `of ${s.paid + s.lost} finished`)}
  ${tile('Walked out', `${s.lost}`, Object.entries(s.lostByReason).map(([r, n]) => `${n} ${r}`).join(', ') || 'none')}
  ${tile('Income', `${Math.round(s.income)}`, `${s.incomePerMin.toFixed(1)} per game minute`)}
  ${tile('Bought / hired', `${s.purchases} / ${s.hires}`, `${s.notifications} notifications`)}
</section>
<h2>Findings</h2>
<div class="findings">${findings}</div>
<h2>Charts</h2>
${charts.join('\n')}
<h2>Tables</h2>
${table('Store levels', ['Store', 'Level', 'Reached at', 'Took'], analysis.levels.map(l => [l.storeId, `${l.level}`, clock(l.t), clock(l.tookSec)]))}
${table('Tutorial steps', ['Step', 'Started', 'Took'], analysis.tutorial.map(t => [t.step, clock(t.t), clock(t.tookSec)]))}
${table('Items', ['Item', 'Clients wanting it', 'Units wanted', 'Walk-outs blamed', 'Client-sec on empty shelf', 'Empty w/ waiters'], analysis.products.map(p => [p.type, `${p.wantedBy}`, `${p.unitsWanted}`, `${p.lostOver}`, `${Math.round(p.waitOnEmptySec)}`, `${p.emptyWithWaitersPct.toFixed(0)}%`]))}
${table('For sale & what blocked it', ['Item', 'First for sale', 'Waited', 'Bought', 'Short of (most of the time)'], forSaleWaits(data).map(w => [w.label, clock(w.firstSeen), clock(w.waitedSec), w.bought ? 'yes' : 'no', w.blocker || '—']))}
${table('Clients paid by mood', ['Mood', 'Clients'], Object.entries(s.paidByMood).map(([m, n]) => [m, `${n}`]))}
${table('Idle stretches (45 s+)', ['From', 'Length', 'Why'], analysis.idleSpans.map(i => [clock(i.start), clock(i.end - i.start), i.reason]))}
${table('Issues the bot ran into', ['At', 'Kind', 'Detail'], data.issues.map(i => [clock(i.t), i.kind, i.detail]))}
${table('Purchases, hires & levels', ['At', 'Event', 'Details'], data.events.filter(e => ['storageBought', 'farmBought', 'built', 'workerHired', 'workerUpgraded', 'storeLevelReached', 'tutorialComplete', 'demoEnded'].includes(e.name)).map(e => [clock(e.t), e.name, e.args.join(' ')]))}
<details><summary>Activity log (${data.activities.length})</summary>
${table('', ['Start', 'Length', 'Activity', 'Detail', 'Outcome'], data.activities.map(a => [clock(a.start), clock((a.end ?? s.durationSec) - a.start), a.kind, a.detail, a.outcome ?? '']))}
</details>
</main>
<div id="tip" class="tip" hidden></div>
<script>${HOVER_SCRIPT}</script>
</body></html>`;
}

// ---- Pieces

function section(title: string, note: string, body: string): string {
    return `<section class="chart"><h3>${esc(title)}</h3><p class="muted small">${esc(note)}</p>${body}</section>`;
}

function tile(label: string, value: string, sub: string): string {
    return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div><div class="muted small">${esc(sub)}</div></div>`;
}

const SEVERITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };

function findingCard(finding: Finding): string {
    return `<article class="finding sev-${finding.severity}">
<div class="finding-head"><span class="badge"><span class="dot"></span>${SEVERITY_LABEL[finding.severity]}</span><span class="area">${esc(finding.area)}</span>${finding.t !== undefined ? `<span class="muted small">at ${clock(finding.t)}</span>` : ''}</div>
<h4>${esc(finding.title)}</h4><p>${esc(finding.detail)}</p></article>`;
}

function legend(series: Series[]): string {
    return `<div class="legend">${series.map(s => `<span><i class="swatch" style="background:var(--series-${s.slot})"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

function table(title: string, head: string[], rows: string[][]): string {
    if (rows.length === 0) {
        return '';
    }
    return `${title ? `<h3>${esc(title)}</h3>` : ''}<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function barChart(rows: { kind: string; sec: number; pct: number }[]): string {
    const max = Math.max(...rows.map(r => r.pct), 1);
    return `<div class="bars">${rows.map(r => `<div class="bar-row" data-tip="${esc(`${r.kind}: ${clock(r.sec)} (${r.pct.toFixed(1)}%)`)}">
<span class="bar-label">${esc(r.kind)}</span><span class="bar-track"><span class="bar" style="width:${(r.pct / max) * 100}%"></span></span><span class="bar-value">${r.pct.toFixed(1)}%</span></div>`).join('')}</div>`;
}

/** A line chart on one y-axis, x = game minutes. Data for the hover layer rides along as JSON. */
function lineChart(id: string, series: Series[], markers: Marker[], width: number, height: number, showLegend = true): string {
    const all = series.flatMap(s => s.points);
    if (all.length === 0) {
        return '<p class="muted small">No data.</p>';
    }
    const tMax = Math.max(...all.map(p => p[0]), 1);
    const yMax = niceMax(Math.max(...all.map(p => p[1]), 1));
    const w = width - PAD.left - PAD.right;
    const h = height - PAD.top - PAD.bottom;
    const x = (t: number): number => PAD.left + (t / tMax) * w;
    const y = (v: number): number => PAD.top + h - (v / yMax) * h;

    const grid = [0, 0.5, 1].map(f => {
        const v = yMax * f;
        return `<line class="grid" x1="${PAD.left}" x2="${PAD.left + w}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${PAD.left - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    }).join('');
    const minuteStep = niceStep(tMax / 60);
    const ticks: string[] = [];
    for (let m = 0; m * 60 <= tMax; m += minuteStep) {
        ticks.push(`<text class="axis" x="${x(m * 60)}" y="${height - 6}" text-anchor="middle">${m}m</text>`);
    }
    const marks = markers.map(m => `<line class="marker" x1="${x(m.t)}" x2="${x(m.t)}" y1="${PAD.top}" y2="${PAD.top + h}"/><text class="marker-label" x="${x(m.t) + 3}" y="${PAD.top + 9}">${esc(m.label)}</text>`).join('');
    const lines = series.map(s => {
        const pts = decimate(s.points, w);
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
        return `<path class="line" d="${d}" style="stroke:var(--series-${s.slot})"/>`;
    }).join('');
    const payload = JSON.stringify({
        tMax, yMax, pad: PAD, w, h,
        series: series.map(s => ({ name: s.name, slot: s.slot, points: decimate(s.points, w) })),
    });
    return `${showLegend && series.length > 1 ? legend(series) : ''}<div class="chart-box"><svg id="${id}" class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))} over game time">
${grid}${marks}${lines}<line class="axis-line" x1="${PAD.left}" x2="${PAD.left + w}" y1="${PAD.top + h}" y2="${PAD.top + h}"/>${ticks.join('')}
<line class="cross" x1="0" x2="0" y1="${PAD.top}" y2="${PAD.top + h}" visibility="hidden"/>
<rect class="hit" x="${PAD.left}" y="${PAD.top}" width="${w}" height="${h}" fill="transparent"/>
</svg><script type="application/json" data-for="${id}">${payload.replace(/</g, '\\u003c')}</script></div>`;
}

/** Keeps at most ~1 point per pixel column (max per column, so spikes survive). */
function decimate(points: [number, number][], width: number): [number, number][] {
    if (points.length <= width) {
        return points;
    }
    const step = points.length / width;
    const out: [number, number][] = [];
    for (let i = 0; i < points.length; i += step) {
        const chunk = points.slice(Math.floor(i), Math.floor(i + step));
        out.push(chunk.reduce((best, p) => (p[1] > best[1] ? p : best)));
    }
    return out;
}

function niceMax(v: number): number {
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / exp;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}

function niceStep(minutes: number): number {
    const target = minutes / 8;
    return [1, 2, 5, 10, 15, 30, 60].find(s => s >= target) ?? 60;
}

function fmt(v: number): string {
    return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${Math.round(v * 10) / 10}`;
}

function esc(text: string): string {
    return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

const STYLE = `
.viz-root, body {
  color-scheme: light;
  --surface-0: #f4f3f0; --surface-1: #fcfcfb; --border: #e2e0da;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #7a7974;
  --grid: #ebe9e4;
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a;
  --status-critical: #d03b3b; --status-serious: #ec835a; --status-warning: #fab219; --status-info: #2a78d6;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) body, :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --surface-0: #111110; --surface-1: #1a1a19; --border: #2e2e2c;
    --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #8f8e88;
    --grid: #2a2a28;
    --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
    --status-critical: #d03b3b; --status-serious: #ec835a; --status-warning: #fab219; --status-info: #3987e5;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-0); color: var(--text-primary); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 12px; } h3 { font-size: 15px; margin: 20px 0 4px; } h4 { margin: 6px 0 4px; font-size: 15px; }
.muted { color: var(--text-secondary); } .small { font-size: 12px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 16px; }
.tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
.tile-label { font-size: 12px; color: var(--text-secondary); } .tile-value { font-size: 26px; font-weight: 650; font-variant-numeric: tabular-nums; }
.findings { display: grid; gap: 10px; }
.finding { background: var(--surface-1); border: 1px solid var(--border); border-left: 4px solid var(--sev); border-radius: 8px; padding: 10px 14px; }
.finding p { margin: 0; color: var(--text-secondary); }
.finding-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sev); }
.area { font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .04em; }
.sev-high { --sev: var(--status-critical); } .sev-medium { --sev: var(--status-serious); } .sev-low { --sev: var(--status-warning); } .sev-info { --sev: var(--status-info); }
.chart { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 4px 14px 12px; margin-bottom: 12px; }
.chart-box { position: relative; }
.line-chart { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); stroke-width: 1; } .axis-line { stroke: var(--border); }
.axis { fill: var(--text-muted); font-size: 10px; font-variant-numeric: tabular-nums; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.marker { stroke: var(--text-muted); stroke-dasharray: 3 3; stroke-width: 1; opacity: .6; }
.marker-label { fill: var(--text-muted); font-size: 9px; }
.cross { stroke: var(--text-secondary); stroke-width: 1; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-secondary); margin: 4px 0; }
.swatch { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.multiples { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 8px; }
.multiple { margin: 0; } .multiple figcaption { font-size: 12px; font-weight: 600; }
.bars { display: grid; gap: 6px; padding: 6px 0; }
.bar-row { display: grid; grid-template-columns: 130px 1fr 56px; gap: 8px; align-items: center; font-size: 12px; }
.bar-track { height: 14px; } .bar { display: block; height: 100%; background: var(--series-1); border-radius: 0 4px 4px 0; min-width: 2px; }
.bar-value { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border); vertical-align: top; } th { color: var(--text-secondary); font-weight: 600; }
details { margin-top: 20px; } summary { cursor: pointer; font-weight: 600; }
.tip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.15); z-index: 10; }
.tip i { display: inline-block; width: 10px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
`;

const HOVER_SCRIPT = `
(function () {
  var tip = document.getElementById('tip');
  function clock(s) { var m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
  function show(html, ev) { tip.innerHTML = html; tip.hidden = false; var x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + tip.offsetWidth > innerWidth - 8) x = ev.clientX - tip.offsetWidth - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
  function hide() { tip.hidden = true; }
  document.querySelectorAll('script[data-for]').forEach(function (node) {
    var svg = document.getElementById(node.getAttribute('data-for'));
    var d = JSON.parse(node.textContent);
    var cross = svg.querySelector('.cross'), hit = svg.querySelector('.hit');
    hit.addEventListener('mousemove', function (ev) {
      var box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
      var px = (ev.clientX - box.left) * vb.width / box.width;
      var t = Math.max(0, Math.min(d.tMax, (px - d.pad.left) / d.w * d.tMax));
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      var rows = d.series.map(function (s) {
        var best = null; s.points.forEach(function (p) { if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p; });
        return best ? '<div><i style="background:var(--series-' + s.slot + ')"></i>' + s.name + ': <b>' + Math.round(best[1] * 10) / 10 + '</b></div>' : '';
      }).join('');
      show('<div class="small">' + clock(t) + '</div>' + rows, ev);
    });
    hit.addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); hide(); });
  });
  document.querySelectorAll('[data-tip]').forEach(function (el) {
    el.addEventListener('mousemove', function (ev) { show(el.getAttribute('data-tip'), ev); });
    el.addEventListener('mouseleave', hide);
  });
})();
`;
