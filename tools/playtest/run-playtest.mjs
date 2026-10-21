// run-playtest.mjs
//
// Runs one pizza bot playtest in a browser and saves its report — no copy/paste:
//
//   npm run playtest                        headless, own dev server, 5x, fresh save
//   npm run playtest:watch                  same in a visible window (window stays open after)
//   npm run playtest -- --minutes 20 --speed 5 --style casual
//   npm run playtest -- --url http://localhost:9001   use a dev server you already run
//
// Options:
//   --headed            visible window (real GPU) instead of headless (software WebGL)
//   --speed N           game speed (default 5 — what manual runs use; at 10x headless the frame
//                       rate drops and per-unit transfers (paying, depositing) get frame-bound, which
//                       skews the numbers — compare runs at the same speed)
//   --minutes N         game-minute limit (default 40; the run also ends at the demo end / a stall)
//   --style S           'efficient' (default) or 'casual'
//   --keep-save         don't wipe the save first (headless always starts from an empty profile anyway)
//   --url U             base URL of a running dev server; default: start one on a free port (no live
//                       reload, no browser tab — your own server WILL reload the run if a file changes)
//   --timeout N         real minutes before the run is cut and reported anyway (default 30)
//   --shots N           screenshot every N real seconds (default 60; 0 = only level-ups + the end)
//   --label L           added to the output folder name
//   --keep-open         keep the window open after the report (default with --headed)
//
// Output: games/pizza/reports/playtests/<stamp>[-label]/
//   report.md     the in-game text report (PlaytestReport.buildPlaytestReportText) + a Runner section
//   data.json     raw PlaytestData
//   console.log   every browser console error / page error / failed request, boot included
//   *.png         screenshots (periodic, every store level-up, the end)
// and games/pizza/reports/playtests/latest.md (a copy of the newest report.md).
//
// Talks to the game through window.__pizzaPlaytest (games/pizza/game/playtest/PlaytestSession.ts):
// state() polled every 2 s, result() once it has ended, report() to cut a run that timed out.
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
const POLL_MS = 2000;
const PROGRESS_EVERY_MS = 15000;
const BOOT_TIMEOUT_MS = 120000;
const VITE_READY_TIMEOUT_MS = 60000;
/**
 * Console errors that are never the game's: Chrome's own favicon.ico 404 (invisible to Playwright's
 * request events — a real 404 still shows as its own "[http 404] <url>" line) and the COOP header
 * warning plain-http localhost always gets.
 */
const CONSOLE_NOISE = [
    /^Failed to load resource: the server responded with a status of 404/,
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

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(OUT_ROOT, `${stamp}${args.label ? `-${String(args.label).replace(/[^\w-]/g, '_')}` : ''}`);
fs.mkdirSync(outDir, { recursive: true });

const consoleLines = [];
const logConsole = line => consoleLines.push(`${new Date().toISOString().slice(11, 19)} ${line}`);

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
    const query = new URLSearchParams({ bot: style === 'casual' ? 'casual' : '', speed: String(speed), minutes: String(minutes) });
    let url = `${base}/?${query.toString().replace('bot=&', 'bot&')}`;
    if (args['keep-save'] !== true) {
        url += '&fresh';
    }
    console.log(`[playtest] ${headed ? 'headed' : 'headless'} · ${style} · ${speed}x · ${minutes} game min → ${path.relative(ROOT, outDir)}`);
    console.log(`[playtest] ${url}`);

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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('console', msg => {
        if (msg.type() === 'error' && !CONSOLE_NOISE.some(noise => noise.test(msg.text()))) {
            logConsole(`[console.error] ${msg.text()}`);
        }
    });
    page.on('pageerror', error => logConsole(`[pageerror] ${error.stack ?? error.message}`));
    page.on('requestfailed', request => logConsole(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`));
    page.on('response', response => {
        if (response.status() >= 400) {
            logConsole(`[http ${response.status()}] ${response.url()}`);
        }
    });

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
    while (!(state?.ended && (await page.evaluate(() => !!window.__pizzaPlaytest?.result())))) {
        if (Date.now() - startMs > timeoutMs) {
            timedOut = true;
            console.log(`[playtest] real-time limit reached — cutting the run`);
            await page.evaluate(() => window.__pizzaPlaytest?.report());
            await page.waitForTimeout(1500);
            break;
        }
        await page.waitForTimeout(POLL_MS);
        state = await getState(page);
        if (!state) {
            continue;
        }
        // Game time went back = the page reloaded (a dev server with live reload saw a file change)
        // and the run restarted from scratch — the report only covers the last stretch.
        if (state.gameTimeSec + 5 < lastGameSec) {
            reloads++;
            console.log(`[playtest] WARNING: the page reloaded at game ${clock(lastGameSec)} — the run restarted (live reload on --url servers? use the runner's own server)`);
        }
        lastGameSec = state.gameTimeSec;
        if (Date.now() - lastProgress > PROGRESS_EVERY_MS) {
            lastProgress = Date.now();
            console.log(`[playtest] ${clock((Date.now() - startMs) / 1000)} real · game ${clock(state.gameTimeSec)} · ${levelKey(state)} · $${Math.round(state.money)} · ${state.doing}`);
        }
        const key = levelKey(state);
        if (key !== lastLevelKey) {
            lastLevelKey = key;
            await shot(page, state, 'levelup');
        } else if (shotEveryMs > 0 && Date.now() - lastShot > shotEveryMs) {
            lastShot = Date.now();
            await shot(page, state);
        }
    }

    const result = await page.evaluate(() => window.__pizzaPlaytest?.result());
    state = await getState(page);
    await shot(page, state, 'end');
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
    fs.writeFileSync(path.join(outDir, 'report.md'), report);
    fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(result.data));
    fs.writeFileSync(path.join(outDir, 'console.log'), consoleLines.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT_ROOT, 'latest.md'), report);

    console.log(`[playtest] done — ${result.data.endReason} after ${clock(result.data.durationSec)} game time (${clock(realSec)} real)`);
    console.log(`[playtest] report: ${path.relative(ROOT, path.join(outDir, 'report.md'))} (also ${path.relative(ROOT, path.join(OUT_ROOT, 'latest.md'))})`);

    if (keepOpen) {
        console.log('[playtest] window left open — close it (or Ctrl+C) to finish');
        await page.waitForEvent('close', { timeout: 0 }).catch(() => undefined);
    }
} catch (error) {
    fs.writeFileSync(path.join(outDir, 'console.log'), consoleLines.join('\n') + '\n');
    console.error(`[playtest] FAILED: ${error.message}`);
    console.error(`[playtest] browser console: ${path.relative(ROOT, path.join(outDir, 'console.log'))}`);
    process.exitCode = 1;
} finally {
    await browser?.close().catch(() => undefined);
    cleanup();
}

// ---- Steps

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

async function shot(page, state, tag) {
    const name = `${clock(state?.gameTimeSec ?? 0).replace(':', 'm')}s-${levelKey(state).replace(/\W+/g, '')}${tag ? `-${tag}` : ''}.png`;
    await page.screenshot({ path: path.join(outDir, name) }).catch(() => undefined);
}

// ---- Helpers

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

function parseArgs(list) {
    const out = {};
    for (let i = 0; i < list.length; i++) {
        const arg = list[i];
        if (!arg.startsWith('--')) {
            continue;
        }
        const key = arg.slice(2);
        const next = list[i + 1];
        if (next === undefined || next.startsWith('--')) {
            out[key] = true;
        } else {
            out[key] = next;
            i++;
        }
    }
    return out;
}
