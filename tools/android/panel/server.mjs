#!/usr/bin/env node
// server.mjs — `npm run android`: a page (http://localhost:9310) for the phone app of the game in .env: whether this computer
// has all a build needs, the app's package (name, id, version), its ads / purchases / analytics, the phones plugged in, and
// buttons to run it on one or build an APK (the log comes in as it goes). The builds are android.mjs, as on the command line.
//
// Only on this computer (127.0.0.1). Run it from PowerShell at the repo root (vite's build fails from Git Bash here).

import { spawn, execFile } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { findTools, listDevices, listEmulators, readApp, runChecks, toolEnv } from '../env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const GAME = dotenv.config().parsed?.GAME ?? process.env.GAME;
const START_PORT = Number(process.env.ANDROID_PANEL_PORT ?? 9310);
const LOG_LINES = 3000;

if (!GAME) {
    console.error('No GAME in .env.');
    process.exit(1);
}

// ---------------------------------------------------------------- the job (one at a time) and its log

const log = [];
const listeners = new Set();
let job = null;

function say(text, kind = 'out') {
    for (const line of String(text).replace(/\r/g, '').split('\n')) {
        if (!line && kind === 'out') continue;
        const entry = { line, kind, at: Date.now() };
        log.push(entry);
        if (log.length > LOG_LINES) log.shift();
        for (const res of listeners) res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
}

function tellJob() {
    for (const res of listeners) res.write(`event: job\ndata: ${JSON.stringify(jobState())}\n\n`);
}

const jobState = () => (job ? { running: true, action: job.action, startedAt: job.startedAt } : { running: false, last: lastJob });
let lastJob = null;

function startJob(action, command, args, cwd = root) {
    if (job) throw new Error('Something is already running.');
    const startedAt = Date.now();
    say(`\n▶ ${action}: ${[command, ...args].join(' ')}`, 'cmd');
    const child = spawn(command, args, { cwd, env: toolEnv(findTools()), shell: false, windowsHide: true });
    job = { action, child, startedAt };
    child.stdout.on('data', (data) => say(data));
    child.stderr.on('data', (data) => say(data, 'err'));
    child.on('error', (error) => say(error.message, 'err'));
    child.on('close', (code) => {
        const seconds = Math.round((Date.now() - startedAt) / 1000);
        lastJob = { action, ok: code === 0, code, seconds };
        say(code === 0 ? `✔ ${action} done (${seconds} s)` : `✖ ${action} failed (exit ${code}, ${seconds} s)`, code === 0 ? 'ok' : 'err');
        job = null;
        tellJob();
    });
    tellJob();
}

function stopJob() {
    if (!job) return;
    say('■ stopping…', 'cmd');
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], () => {});
    else job.child.kill('SIGTERM');
}

/** The build steps (android.mjs), by what the page asked for. */
function runAction(action, target) {
    const script = resolve(here, '..', 'android.mjs');
    const node = process.execPath;
    const app = readApp(root, GAME);
    const tools = findTools();
    if (target && !/^[\w.:-]+$/.test(target)) throw new Error('Not a device.');
    switch (action) {
        case 'run': return startJob('Run on device', node, [script, '--run', ...(target ? ['--target', target] : [])]);
        case 'apk': return startJob('Build APK', node, [script, '--apk']);
        case 'sync': return startJob('Build and sync', node, [script]);
        case 'open': return startJob('Open in Android Studio', node, [script, '--open']);
        case 'install':
            if (!app.apk) throw new Error('No APK yet: build one first.');
            if (!tools.adb) throw new Error('No adb: install the SDK platform tools.');
            if (!target) throw new Error('Pick a device.');
            return startJob('Install APK', tools.adb, ['-s', target, 'install', '-r', app.apk.path]);
        default: throw new Error(`Unknown action: ${action}`);
    }
}

// ---------------------------------------------------------------- what the page shows and saves

function state() {
    const tools = findTools();
    const app = readApp(root, GAME);
    const android = app.android ?? {};
    return {
        game: GAME,
        checks: runChecks(root, GAME, tools, app),
        devices: listDevices(tools),
        emulators: listEmulators(tools),
        app: {
            dir: `native/${GAME}`,
            appName: app.appName,
            appId: app.applicationId ?? app.appId,
            versionCode: app.versionCode,
            versionName: app.versionName,
            compileSdk: app.compileSdk,
            plugins: app.plugins,
            apk: app.apk && { path: app.apk.path, at: app.apk.at, size: app.apk.size },
            hasIcon: fs.existsSync(iconPath()),
        },
        money: {
            enableAds: android.enableAds !== false,
            admob: { appId: '', interstitial: '', rewarded: '', test: true, ...(android.admob ?? {}) },
            iap: Array.isArray(android.iap) ? android.iap : [],
            analytics: android.analytics ?? null,
            hasEntry: !!app.android,
        },
        job: jobState(),
    };
}

const iconPath = () => resolve(root, 'native', GAME, 'store', 'icon-512.png');
const xmlText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '\\"');

function rewrite(path, change) {
    const text = fs.readFileSync(path, 'utf8');
    const next = change(text);
    if (next !== text) fs.writeFileSync(path, next);
}

/** The app's name, id and version: into capacitor.config.json, build.gradle, strings.xml and platforms.config.json. */
function savePackage({ appName, appId, versionCode, versionName }) {
    appName = String(appName ?? '').trim();
    appId = String(appId ?? '').trim();
    versionName = String(versionName ?? '').trim();
    versionCode = Number(versionCode);
    if (!appName || appName.length > 50) throw new Error('The name: 1 to 50 characters.');
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(appId)) throw new Error('The id: like com.studio.game (letters, digits, _; at least one dot).');
    if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('The version code: a whole number, 1 or more (each store upload needs a higher one).');
    if (!/^[\w.\-]{1,30}$/.test(versionName)) throw new Error('The version name: like 1.0.2.');
    const dir = resolve(root, 'native', GAME);
    const configPath = resolve(dir, 'capacitor.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.appId = appId;
    config.appName = appName;
    writeJson(configPath, config);
    rewrite(resolve(dir, 'android/app/build.gradle'), (t) => t
        .replace(/applicationId\s+"[^"]+"/, `applicationId "${appId}"`)
        .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
        .replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`));
    rewrite(resolve(dir, 'android/app/src/main/res/values/strings.xml'), (t) => t
        .replace(/(<string name="app_name">)[^<]*(<\/string>)/, `$1${xmlText(appName)}$2`)
        .replace(/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${xmlText(appName)}$2`)
        .replace(/(<string name="package_name">)[^<]*(<\/string>)/, `$1${appId}$2`)
        .replace(/(<string name="custom_url_scheme">)[^<]*(<\/string>)/, `$1${appId}$2`));
    savePlatform((android) => { android.gameId = appId; });
    say(`✔ package saved: ${appName} · ${appId} · ${versionName} (${versionCode})`, 'ok');
}

/** AdMob's ids and whether there are ads at all: into platforms.config.json (`android`). */
function saveAds({ enableAds, appId, interstitial, rewarded, test }) {
    const clean = (v) => String(v ?? '').trim();
    appId = clean(appId);
    interstitial = clean(interstitial);
    rewarded = clean(rewarded);
    if (appId && !/^ca-app-pub-\d+~\d+$/.test(appId)) throw new Error('The AdMob app id looks like ca-app-pub-1234567890123456~1234567890.');
    for (const [name, unit] of [['interstitial', interstitial], ['rewarded', rewarded]]) {
        if (unit && !/^ca-app-pub-\d+\/\d+$/.test(unit)) throw new Error(`The ${name} ad unit looks like ca-app-pub-1234567890123456/1234567890.`);
    }
    if ((interstitial || rewarded) && !appId) throw new Error('Real ad units need the AdMob app id too.');
    savePlatform((android) => {
        android.enableAds = !!enableAds;
        android.admob = { appId, interstitial, rewarded, test: !!test };
    });
    say(`✔ ads saved: ${!enableAds ? 'no ads' : interstitial || rewarded ? `real ${[interstitial && 'interstitial', rewarded && 'rewarded'].filter(Boolean).join(' + ')}${test ? ' (test ads)' : ''}` : 'mocked'}`, 'ok');
}

function savePlatform(change) {
    const path = resolve(root, 'games', GAME, 'platforms.config.json');
    const all = JSON.parse(fs.readFileSync(path, 'utf8'));
    all.android ??= { className: 'CapacitorPlatform', importPath: 'core/platforms/CapacitorPlatform', gameId: '', enableAds: true, folderPath: GAME };
    change(all.android);
    writeJson(path, all);
}

/** Writes JSON in the file's own line endings (and only when it changed). */
function writeJson(path, data) {
    const old = fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
    const text = `${JSON.stringify(data, null, 4)}\n`;
    const next = old.includes('\r\n') ? text.replace(/\n/g, '\r\n') : text;
    if (next !== old) fs.writeFileSync(path, next);
}

function reveal(path) {
    if (process.platform === 'win32') execFile('explorer', [`/select,${path}`], () => {});
    else if (process.platform === 'darwin') execFile('open', ['-R', path], () => {});
    else execFile('xdg-open', [dirname(path)], () => {});
}

// ---------------------------------------------------------------- the server

function body(req) {
    return new Promise((resolveBody, reject) => {
        let text = '';
        req.on('data', (chunk) => {
            text += chunk;
            if (text.length > 100000) reject(new Error('Too big.'));
        });
        req.on('end', () => {
            try {
                resolveBody(text ? JSON.parse(text) : {});
            } catch (error) {
                reject(error);
            }
        });
    });
}

function send(res, status, data, type = 'application/json') {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
            return send(res, 200, fs.readFileSync(resolve(here, 'index.html')), 'text/html; charset=utf-8');
        }
        if (req.method === 'GET' && url.pathname === '/icon.png') {
            const path = fs.existsSync(iconPath()) ? iconPath() : resolve(root, 'games', GAME, 'icon', 'icon.png');
            if (!fs.existsSync(path)) return send(res, 404, { error: 'no icon' });
            return send(res, 200, fs.readFileSync(path), 'image/png');
        }
        if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, state());
        if (req.method === 'GET' && url.pathname === '/api/devices') {
            const tools = findTools();
            return send(res, 200, { devices: listDevices(tools), emulators: listEmulators(tools) });
        }
        if (req.method === 'GET' && url.pathname === '/api/log') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
            for (const entry of log) res.write(`data: ${JSON.stringify(entry)}\n\n`);
            res.write(`event: job\ndata: ${JSON.stringify(jobState())}\n\n`);
            listeners.add(res);
            req.on('close', () => listeners.delete(res));
            return;
        }
        if (req.method === 'POST') {
            const data = await body(req);
            if (url.pathname === '/api/action') {
                runAction(data.action, data.target || null);
                return send(res, 200, { ok: true });
            }
            if (url.pathname === '/api/stop') {
                stopJob();
                return send(res, 200, { ok: true });
            }
            if (url.pathname === '/api/package') {
                if (job) throw new Error('Wait for the build to finish.');
                savePackage(data);
                return send(res, 200, { ok: true });
            }
            if (url.pathname === '/api/ads') {
                if (job) throw new Error('Wait for the build to finish.');
                saveAds(data);
                return send(res, 200, { ok: true });
            }
            if (url.pathname === '/api/reveal') {
                const app = readApp(root, GAME);
                if (app.apk) reveal(app.apk.path);
                return send(res, 200, { ok: true });
            }
        }
        send(res, 404, { error: 'Not found' });
    } catch (error) {
        send(res, 400, { error: error.message });
    }
});

function listen(port) {
    server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && port < START_PORT + 20) listen(port + 1);
        else throw error;
    });
    server.listen(port, '127.0.0.1', () => {
        const url = `http://localhost:${port}/`;
        console.log(`\n📱 Android panel for ${GAME}: ${url}\n   (Ctrl+C to stop)\n`);
        if (!process.argv.includes('--no-open')) {
            if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], () => {});
            else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => {});
        }
    });
}

listen(START_PORT);
process.on('SIGINT', () => {
    stopJob();
    process.exit(0);
});
