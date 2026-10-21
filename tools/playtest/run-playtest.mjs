// run-playtest.mjs
//
// Runs pizza bot playtests in a browser and saves the reports — no copy/paste:
//
//   npm run playtest                        one headless run (own dev server, 5x, fresh save, ~6 min)
//   npm run playtest:watch                  same in a visible window (window stays open after)
//   npm run playtest -- --minutes 20 --speed 10 --style casual
//   npm run playtest -- --set animalStalls.cowStall.produceIntervalSec=30
//   npm run playtest -- --compare base "cow30:animalStalls.cowStall.produceIntervalSec=30" \
//                                  "butter2:mixStations.butterStation.outputAmount=2" --repeat 2
//
// Options:
//   --headed            visible window (real GPU) instead of headless (software WebGL)
//   --speed N           game speed (default 5). 10x is NOT comparable yet: four full runs gave
//                       39-51% walk-outs (and one 6%) vs 8-17% at 5x — runs at high speed swing
//                       much more. For quicker answers run variants side by side (--compare).
//   --minutes N         game-minute limit (default 40; a run also ends at the demo end / a stall)
//   --style S           'efficient' (default) or 'casual'
//   --set P=V           config override for the run (repeatable) — <editor tab>.<id>.<path>=<JSON
//                       value>, see games/pizza/game/playtest/PlaytestTuning.ts
//   --compare V...      run several variants side by side, in parallel: each is a name, optionally
//                       followed by ":" and overrides joined with "," — "base" = no overrides.
//                       Writes compare.md (a table of the key numbers per run).
//   --repeat N          run every variant N times (bot runs vary — averages in compare.md)
//   --parallel N        most runs at once (default: all, up to 4) — each is a browser tab
//   --keep-save         don't wipe the save first (a headless profile starts empty anyway)
//   --url U             use a running dev server; default: start one on a free port (no live
//                       reload, no browser tab — your own server WILL reload a run if a file changes)
//   --timeout N         real minutes before a run is cut and reported anyway (default 30)
//   --shots N           screenshot every N real seconds (default 60; 0 = only level-ups + the end)
//   --render N          draw every Nth frame (default 10 headless, 1 headed) — logic runs every frame
//   --scenario NAME     start from a saved snapshot: games/pizza/playtest-scenarios/NAME.json
//                       (made with --snapshot-at, or the panel's Save state button)
//   --snapshot-at E[:ID] save a scenario when analytics event E (first arg ID) fires — e.g.
//                       storageBought:burgerStation, built:storeRoom3, farmBought:farm6
//   --snapshot-name N   its file name (default snapshot); --snapshot-stop ends the run right after
//   --no-demo-end       keep playing past the demo end
//   --label L           added to the output folder name
//   --keep-open         keep the window open after the report (default with --headed)
//
// Output: games/pizza/reports/playtests/<stamp>[-label]/ (gitignored)
//   one run:   report.md, data.json, console.log, screenshots
//   --compare: compare.md + one such folder per run (<variant>[-rN]/)
// and games/pizza/reports/playtests/latest.md = the newest report.md / compare.md.
//
// Talks to the game through window.__pizzaPlaytest (games/pizza/game/playtest/PlaytestSession.ts):
// state() polled every 2 s, result() once it has ended, report() to cut a run that timed out,
// setRenderEvery() around screenshots.
//
// Browser: playwright-core drives an installed Chromium — $PLAYTEST_CHROME if set, else the one
// matching playwright-core, else the newest in the Playwright cache (~/.cache/ms-playwright or
// %LOCALAPPDATA%/ms-playwright). None? `npx playwright install chromium`.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_ROOT = path.join(ROOT, 'games', 'pizza', 'reports', 'playtests');
const SCENARIO_DIR = path.join(ROOT, 'games', 'pizza', 'playtest-scenarios');
const POLL_MS = 2000;
const PROGRESS_EVERY_MS = 15000;
const BOOT_TIMEOUT_MS = 120000;
const VITE_READY_TIMEOUT_MS = 60000;
const RENDER_EVERY_HEADLESS = 10;
const MAX_PARALLEL_DEFAULT = 4;
/** Real ms of full drawing before a screenshot. */
const SHOT_SETTLE_MS = 300;
/**
 * Console errors that are never the game's: Chrome's URL-less "Failed to load resource" lines (a
 * failed request to the dev server is logged anyway, with its URL, by the request/response
 * listeners — the rest are the favicon and the ad SDK's beacons) and the COOP header warning
 * plain-http localhost always gets. Failed requests to other hosts (ad networks) are skipped too.
 */
const CONSOLE_NOISE = [
    /^Failed to load resource:/,
    /Cross-Origin-Opener-Policy header has been ignored/,
];

const args = parseArgs(process.argv.slice(2));
const headed = args.headed === true;
const keepOpen = args['keep-open'] === true || (headed && args['keep-open'] !== false);
const speed = Number(args.speed ?? 5);
const minutes = Number(args.minutes ?? 40);
const style = args.style === 'casual' ? 'casual' : 'efficient';
const timeoutMs = Number(args.timeout ?? 30) * 60000;
const shotEveryMs = Number(args.shots ?? 60) * 1000;
// Headless draws every RENDER_EVERY_HEADLESS-th frame (nobody watches; drawing is most of a frame); headed draws every frame.
const renderEvery = Math.max(1, Math.floor(Number(args.render ?? (headed ? 1 : RENDER_EVERY_HEADLESS))));
const repeat = Math.max(1, Math.floor(Number(args.repeat ?? 1)));
// --snapshot-at event[:firstArg] -> [name, arg] for __pizzaPlaytest.eventSeen().
const snapshotAt = args['snapshot-at'] ? (() => { const [name, ...rest] = String(args['snapshot-at']).split(':'); return [name, rest.length > 0 ? rest.join(':') : undefined]; })() : undefined;

const comparing = args.compare !== undefined;
const variants = comparing ? args.compare.map(parseVariant) : [{ name: args.label ? String(args.label) : 'run', sets: args.set ?? [] }];
const runs = variants.flatMap(variant => Array.from({ length: repeat }, (_, i) => ({ ...variant, rep: repeat > 1 ? i + 1 : undefined })));
const parallel = Math.max(1, Math.floor(Number(args.parallel ?? Math.min(runs.length, MAX_PARALLEL_DEFAULT))));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const label = args.label ? `-${safe(args.label)}` : '';
const outDir = path.join(OUT_ROOT, `${stamp}${comparing ? '-compare' : ''}${label}`);
fs.mkdirSync(outDir, { recursive: true });

let vite;
let browser;
const cleanup = () => {
    vite?.kill();
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
});

try {
    const base = args.url ? String(args.url).replace(/\/$/, '') : await startVite();
    console.log(`[playtest] ${headed ? 'headed' : 'headless'} · ${style} · ${speed}x · ${minutes} game min · ${runs.length} run(s), ${Math.min(parallel, runs.length)} at once → ${path.relative(ROOT, outDir)}`);
    browser = await chromium.launch({
        executablePath: findChrome(),
        headless: !headed,
        args: [
            '--mute-audio',
            '--autoplay-policy=no-user-gesture-required',
            // Keep full speed when the window is in the background / covered.
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            // Headless has no GPU — software WebGL.
            ...(headed ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']),
        ],
    });

    const results = await runPool(runs, parallel, run => runOne(base, run));
    const finished = results.filter(Boolean);
    if (finished.length === 0) {
        throw new Error('no run produced a report');
    }

    if (comparing || runs.length > 1) {
        const compare = buildCompare(finished);
        fs.writeFileSync(path.join(outDir, 'compare.md'), compare);
        fs.writeFileSync(path.join(OUT_ROOT, 'latest.md'), compare);
        console.log(`\n${compare}`);
        console.log(`[playtest] compare: ${path.relative(ROOT, path.join(outDir, 'compare.md'))} (also latest.md)`);
    } else {
        fs.writeFileSync(path.join(OUT_ROOT, 'latest.md'), finished[0].report);
        console.log(`[playtest] report: ${path.relative(ROOT, finished[0].reportPath)} (also ${path.relative(ROOT, path.join(OUT_ROOT, 'latest.md'))})`);
    }
    if (finished.length < runs.length) {
        process.exitCode = 1;
    }

    if (keepOpen) {
        console.log('[playtest] window left open — close it (or Ctrl+C) to finish');
        await Promise.all(browser.contexts().flatMap(context => context.pages()).map(page => page.waitForEvent('close', { timeout: 0 }).catch(() => undefined)));
    }
} catch (error) {
    console.error(`[playtest] FAILED: ${error.message}`);
    process.exitCode = 1;
} finally {
    await browser?.close().catch(() => undefined);
    cleanup();
}

// ---- One run

/** One bot run in its own tab — saves its folder, returns what the comparison needs (undefined if it failed). */
async function runOne(base, run) {
    const name = `${run.name}${run.rep ? `-r${run.rep}` : ''}`;
    const tag = runs.length > 1 ? `[${name}] ` : '';
    const dir = comparing || runs.length > 1 ? path.join(outDir, safe(name)) : outDir;
    fs.mkdirSync(dir, { recursive: true });
    const consoleLines = [];
    const logConsole = line => consoleLines.push(`${new Date().toISOString().slice(11, 19)} ${line}`);

    const query = new URLSearchParams({ bot: style === 'casual' ? 'casual' : '', speed: String(speed), minutes: String(minutes), render: String(renderEvery) });
    for (const set of run.sets) {
        query.append('set', set);
    }
    if (args.scenario) {
        query.set('scenario', String(args.scenario));
    }
    if (args['no-demo-end'] === true) {
        query.set('nodemoend', '');
    }
    let url = `${base}/?${query.toString().replace(/^bot=&/, 'bot&').replace(/nodemoend=(&|$)/, 'nodemoend$1')}`;
    // A scenario replaces the whole save itself; otherwise start from an empty one.
    if (args['keep-save'] !== true && !args.scenario) {
        url += '&fresh';
    }
    console.log(`[playtest] ${tag}${url}`);

    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on('console', msg => {
        if (msg.type() === 'error' && !CONSOLE_NOISE.some(noise => noise.test(msg.text()))) {
            logConsole(`[console.error] ${msg.text()}`);
        }
    });
    page.on('pageerror', error => logConsole(`[pageerror] ${error.stack ?? error.message}`));
    // Only requests to the dev server count — other hosts are the ad SDK's networks (see CONSOLE_NOISE).
    const ours = url => url.startsWith(base);
    page.on('requestfailed', request => {
        if (ours(request.url())) {
            logConsole(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
        }
    });
    page.on('response', response => {
        if (response.status() >= 400 && ours(response.url())) {
            logConsole(`[http ${response.status()}] ${response.url()}`);
        }
    });

    try {
        const startMs = Date.now();
        await page.goto(url);
        await waitForSession(page);

        let state = await getState(page);
        let lastProgress = 0;
        let lastShot = Date.now();
        let lastLevelKey = levelKey(state);
        let timedOut = false;
        let reloads = 0;
        let lastGameSec = state?.gameTimeSec ?? 0;
        let snapshotted = false;
        while (!(state?.ended && (await page.evaluate(() => !!window.__pizzaPlaytest?.result())))) {
            if (Date.now() - startMs > timeoutMs) {
                timedOut = true;
                console.log(`[playtest] ${tag}real-time limit reached — cutting the run`);
                await page.evaluate(() => window.__pizzaPlaytest?.report());
                await page.waitForTimeout(1500);
                break;
            }
            await page.waitForTimeout(POLL_MS);
            state = await getState(page);
            if (!state) {
                continue;
            }
            // Game time went back = the page reloaded (a dev server with live reload saw a file
            // change) and the run restarted from scratch — the report only covers the last stretch.
            if (state.gameTimeSec + 5 < lastGameSec) {
                reloads++;
                console.log(`[playtest] ${tag}WARNING: the page reloaded at game ${clock(lastGameSec)} — the run restarted (live reload on --url servers? use the runner's own server)`);
            }
            lastGameSec = state.gameTimeSec;
            // --snapshot-at: save a scenario the moment the event first fires.
            if (snapshotAt && !snapshotted && await page.evaluate(([name, arg]) => window.__pizzaPlaytest?.eventSeen(name, arg), snapshotAt).catch(() => false)) {
                snapshotted = true;
                const note = `${snapshotAt.filter(Boolean).join(':')} — ${levelKey(state)} at game ${clock(state.gameTimeSec)}`;
                const snapshot = await page.evaluate(n => window.__pizzaPlaytest?.saveState(n), note);
                fs.mkdirSync(SCENARIO_DIR, { recursive: true });
                const file = path.join(SCENARIO_DIR, `${safe(args['snapshot-name'] ?? 'snapshot')}.json`);
                fs.writeFileSync(file, JSON.stringify(snapshot, null, 1));
                console.log(`[playtest] ${tag}scenario saved: ${path.relative(ROOT, file)} (${note})`);
                if (args['snapshot-stop'] === true) {
                    await page.evaluate(() => window.__pizzaPlaytest?.report());
                }
            }
            if (Date.now() - lastProgress > PROGRESS_EVERY_MS) {
                lastProgress = Date.now();
                console.log(`[playtest] ${tag}${clock((Date.now() - startMs) / 1000)} real · game ${clock(state.gameTimeSec)} · ${levelKey(state)} · $${Math.round(state.money)} · ${state.doing}`);
            }
            const key = levelKey(state);
            if (key !== lastLevelKey) {
                lastLevelKey = key;
                await shot(page, dir, state, 'levelup');
            } else if (shotEveryMs > 0 && Date.now() - lastShot > shotEveryMs) {
                lastShot = Date.now();
                await shot(page, dir, state);
            }
        }

        const result = await page.evaluate(() => window.__pizzaPlaytest?.result());
        state = await getState(page);
        await shot(page, dir, state, 'end');
        const realSec = (Date.now() - startMs) / 1000;
        if (!result) {
            throw new Error('the run ended but the game returned no report');
        }

        const runner = [
            '## Runner',
            `- ${headed ? 'headed' : 'headless'} · ${url}`,
            `- real time ${clock(realSec)} · game time ${clock(result.data.durationSec)} · achieved ${(result.data.durationSec / Math.max(1, realSec)).toFixed(1)}x (asked ${speed}x)${timedOut ? ' · CUT by the real-time limit' : ''}`,
            ...(reloads > 0 ? [`- WARNING: the page reloaded ${reloads}x mid-run — this report only covers the run after the last reload`] : []),
            `- browser console errors (boot included): ${consoleLines.length === 0 ? 'none' : `${consoleLines.length} — see console.log`}`,
            ...summarizeConsole(consoleLines),
        ].join('\n');
        const report = `${result.text}\n\n${runner}\n`;
        const reportPath = path.join(dir, 'report.md');
        fs.writeFileSync(reportPath, report);
        fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(result.data));
        fs.writeFileSync(path.join(dir, 'console.log'), consoleLines.join('\n') + '\n');
        console.log(`[playtest] ${tag}done — ${result.data.endReason} after ${clock(result.data.durationSec)} game time (${clock(realSec)} real)`);

        if (!keepOpen) {
            await context.close();
        }
        return { name, variant: run.name, result, report, reportPath, realSec, consoleCount: consoleLines.length, reloads, timedOut };
    } catch (error) {
        fs.writeFileSync(path.join(dir, 'console.log'), consoleLines.join('\n') + '\n');
        console.error(`[playtest] ${tag}FAILED: ${error.message} — browser console: ${path.relative(ROOT, path.join(dir, 'console.log'))}`);
        await context.close().catch(() => undefined);
        return undefined;
    }
}

// ---- Comparison

/** compare.md — one row per run, plus a mean row per variant when repeated. */
function buildCompare(results) {
    const cols = ['Run', 'End', 'Game time', 'Walk-outs', 'Paid', 'Income/min', 'Lv5 at', 'Lv9 at', 'Kitchen batches', 'Errors'];
    const rowOf = r => {
        const s = r.result.summary;
        const finished = s.paid + s.lost;
        const levelAt = level => r.result.levels.find(step => step.level === level)?.t;
        const kitchen = lastKitchen(r.result.data);
        return {
            cells: [
                r.name,
                shortEnd(r.result.data.endReason) + (r.reloads ? ' ⚠reload' : '') + (r.timedOut ? ' ⚠cut' : ''),
                clock(r.result.data.durationSec),
                `${finished > 0 ? Math.round(s.lost / finished * 100) : 0}% (${s.lost})`,
                `${s.paid}`,
                s.incomePerMin.toFixed(0),
                fmtClock(levelAt(5)),
                fmtClock(levelAt(9)),
                kitchen || '—',
                `${r.consoleCount + (r.result.data.errors?.length ?? 0)}`,
            ],
            nums: { walk: finished > 0 ? s.lost / finished * 100 : 0, income: s.incomePerMin, time: r.result.data.durationSec, lv5: levelAt(5), lv9: levelAt(9) },
        };
    };
    const rows = results.map(rowOf);
    const lines = [
        `# Pizza playtest comparison — ${style} bot at ${speed}x`,
        `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${results.length} run(s)`,
        '',
        ...variants.map(v => `- **${v.name}**: ${v.sets.length > 0 ? v.sets.join(' · ') : 'no overrides'}`),
        '',
        `| ${cols.join(' | ')} |`,
        `|${cols.map(() => '---').join('|')}|`,
        ...rows.map(row => `| ${row.cells.join(' | ')} |`),
    ];
    if (repeat > 1) {
        lines.push('', '## Means per variant', '| Variant | Runs | Walk-outs | Income/min | Game time | Lv5 at | Lv9 at |', '|---|---|---|---|---|---|---|');
        for (const variant of variants) {
            const mine = rows.filter((_, i) => results[i].variant === variant.name).map(row => row.nums);
            if (mine.length === 0) {
                continue;
            }
            const mean = key => {
                const values = mine.map(n => n[key]).filter(v => v !== undefined);
                return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
            };
            lines.push(`| ${variant.name} | ${mine.length} | ${mean('walk')?.toFixed(0)}% | ${mean('income')?.toFixed(0)} | ${fmtClock(mean('time'))} | ${fmtClock(mean('lv5'))} | ${fmtClock(mean('lv9'))} |`);
        }
    }
    lines.push('', 'Per-run reports: each run\'s folder (report.md) — findings, items, kitchen, timeline.');
    return lines.join('\n') + '\n';
}

/** "butter 18 · bread 6" — batches per station at the end of the run. */
function lastKitchen(data) {
    for (let i = data.samples.length - 1; i >= 0; i--) {
        const stations = Object.values(data.samples[i].stores).flatMap(store => store.kitchen?.stations ?? []);
        if (stations.length > 0) {
            return stations.map(station => `${station.product} ${station.made}`).join(' · ');
        }
    }
    return '';
}

function shortEnd(reason) {
    if (/demo/i.test(reason)) {
        return 'demo end';
    }
    if (/time limit/i.test(reason)) {
        return 'time limit';
    }
    if (/stuck/i.test(reason)) {
        return 'STUCK';
    }
    return reason;
}

// ---- Steps

/** Runs `worker` over `items`, at most `limit` at a time; results in item order. */
async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index]);
        }
    });
    await Promise.all(lanes);
    return results;
}

/** Starts `vite` on a free port (the repo's own config — GAME from .env) and resolves its base URL once it's serving. */
async function startVite() {
    const port = await freePort(9100);
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    // PLAYTEST_SERVER: no browser tab, no live reload (see vite.config.ts) — editing files mid-run is safe.
    vite = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PLAYTEST_SERVER: '1' },
    });
    let output = '';
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`vite didn't start within ${VITE_READY_TIMEOUT_MS / 1000}s:\n${output.slice(-2000)}`)), VITE_READY_TIMEOUT_MS);
        const onData = chunk => {
            output += chunk.toString();
            // eslint-disable-next-line no-control-regex
            if (/Local:/.test(output.replace(/\x1b\[[0-9;]*m/g, ''))) {
                clearTimeout(timer);
                console.log(`[playtest] dev server on :${port}`);
                resolve(`http://localhost:${port}`);
            }
        };
        vite.stdout.on('data', onData);
        vite.stderr.on('data', onData);
        vite.on('exit', code => {
            clearTimeout(timer);
            reject(new Error(`vite exited (${code}):\n${output.slice(-2000)}`));
        });
    });
}

/** Waits for PlaytestSession to publish window.__pizzaPlaytest (the scene has built). */
async function waitForSession(page) {
    try {
        await page.waitForFunction(() => typeof window.__pizzaPlaytest?.state === 'function', undefined, { timeout: BOOT_TIMEOUT_MS, polling: 1000 });
    } catch {
        throw new Error(`the game didn't start a playtest within ${BOOT_TIMEOUT_MS / 1000}s (stuck loading? see console.log)`);
    }
}

async function getState(page) {
    return page.evaluate(() => window.__pizzaPlaytest?.state()).catch(() => undefined);
}

async function shot(page, dir, state, tag) {
    const name = `${clock(state?.gameTimeSec ?? 0).replace(':', 'm')}s-${levelKey(state).replace(/\W+/g, '')}${tag ? `-${tag}` : ''}.png`;
    // Draw every frame for a moment so the shot is current, then back to skipping.
    const previous = await page.evaluate(() => window.__pizzaPlaytest?.setRenderEvery(1)).catch(() => undefined);
    await page.waitForTimeout(SHOT_SETTLE_MS);
    await page.screenshot({ path: path.join(dir, name) }).catch(() => undefined);
    if (previous !== undefined) {
        await page.evaluate(n => window.__pizzaPlaytest?.setRenderEvery(n), previous).catch(() => undefined);
    }
}

// ---- Helpers

/** "name" or "name:path=value,path=value" — "base" (or any name without ":") = no overrides. */
function parseVariant(spec) {
    const colon = String(spec).indexOf(':');
    if (colon < 0) {
        return { name: safe(spec), sets: [] };
    }
    return {
        name: safe(spec.slice(0, colon)),
        sets: spec.slice(colon + 1).split(',').map(set => set.trim()).filter(Boolean),
    };
}

function findChrome() {
    if (process.env.PLAYTEST_CHROME) {
        return process.env.PLAYTEST_CHROME;
    }
    try {
        const own = chromium.executablePath();
        if (own && fs.existsSync(own)) {
            return own;
        }
    } catch {
        // playwright-core's own revision isn't installed — look in the cache below.
    }
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
        ?? (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
            : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
                : path.join(os.homedir(), '.cache', 'ms-playwright'));
    const relative = process.platform === 'win32' ? ['chrome-win64', 'chrome.exe']
        : process.platform === 'darwin' ? ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']
            : ['chrome-linux', 'chrome'];
    const candidates = fs.existsSync(cache)
        ? fs.readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
        : [];
    for (const name of candidates) {
        const exe = path.join(cache, name, ...relative);
        if (fs.existsSync(exe)) {
            return exe;
        }
    }
    throw new Error(`no Chromium found (looked in ${cache}) — run \`npx playwright install chromium\` or set PLAYTEST_CHROME`);
}

function freePort(from) {
    return new Promise((resolve, reject) => {
        const tryPort = port => {
            const server = net.createServer();
            server.once('error', () => (port < from + 100 ? tryPort(port + 1) : reject(new Error('no free port'))));
            server.once('listening', () => server.close(() => resolve(port)));
            server.listen(port, '127.0.0.1');
        };
        tryPort(from);
    });
}

/** The distinct console errors (first 10), each with how often it happened — the full list is in console.log. */
function summarizeConsole(lines) {
    const counts = new Map();
    for (const line of lines) {
        const message = line.slice(9).split('\n')[0].slice(0, 300);
        counts.set(message, (counts.get(message) ?? 0) + 1);
    }
    return [...counts].slice(0, 10).map(([message, count]) => `  - ${count > 1 ? `(x${count}) ` : ''}${message}`);
}

function levelKey(state) {
    return Object.entries(state?.levels ?? {}).map(([id, level]) => `${id} Lv${level}`).join(', ') || 'Lv?';
}

function clock(sec) {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtClock(sec) {
    return sec === undefined ? '—' : clock(sec);
}

function safe(text) {
    return String(text).replace(/[^\w-]/g, '_');
}

/** --flag value / --flag (true); --set repeats into a list; --compare takes every value up to the next --flag. */
function parseArgs(list) {
    const out = {};
    for (let i = 0; i < list.length; i++) {
        const arg = list[i];
        if (!arg.startsWith('--')) {
            continue;
        }
        const key = arg.slice(2);
        if (key === 'compare') {
            const values = [];
            while (list[i + 1] !== undefined && !list[i + 1].startsWith('--')) {
                values.push(list[++i]);
            }
            out.compare = values.length > 0 ? values : ['base'];
            continue;
        }
        const next = list[i + 1];
        const value = next === undefined || next.startsWith('--') ? true : (i++, next);
        if (key === 'set') {
            (out.set ??= []).push(String(value));
        } else {
            out[key] = value;
        }
    }
    return out;
}
