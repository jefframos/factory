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
import os from 'os';

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
        case 'aab':
            if (!app.signing?.set || !app.signing.storeExists) throw new Error('Set or create the upload key first (Keys).');
            return startJob('Build AAB', node, [script, '--aab']);
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
            aab: app.aab && { path: app.aab.path, at: app.aab.at, size: app.aab.size },
            signing: app.signing,
            suggestedKey: resolve(os.homedir(), `${GAME}-upload.jks`),
            hasIcon: fs.existsSync(iconPath()),
        },
        money: {
            enableAds: android.enableAds !== false,
            admob: { appId: '', interstitial: '', rewarded: '', test: true, ...(android.admob ?? {}) },
            iap: Array.isArray(android.iap) ? android.iap : [],
            revenuecat: android.iap?.revenuecat ?? '',
            revenuecatTest: android.iap?.revenuecatTest ?? '',
            analytics: android.analytics ?? null,
            hasEntry: !!app.android,
        },
        keys: keysOf(app, android),
        job: jobState(),
    };
}

/** Every key the app needs, whether it's set, and where to get it. */
function keysOf(app, android) {
    const admob = android.admob ?? {};
    const unit = (id) => /^ca-app-pub-\d+\/\d+$/.test(id ?? '');
    return [
        { id: 'admobApp', label: 'AdMob app id', ok: /^ca-app-pub-\d+~\d+$/.test(admob.appId ?? ''), where: 'AdMob › Apps › your app › App settings (ca-app-pub-…~…)', link: 'https://admob.google.com/', field: 'ads' },
        { id: 'interstitial', label: 'AdMob interstitial ad unit', ok: unit(admob.interstitial), where: 'AdMob › Apps › your app › Ad units › Interstitial (ca-app-pub-…/…)', link: 'https://support.google.com/admob/answer/7356092', field: 'ads' },
        { id: 'rewarded', label: 'AdMob rewarded ad unit', ok: unit(admob.rewarded), where: 'AdMob › Apps › your app › Ad units › Rewarded (ca-app-pub-…/…)', link: 'https://support.google.com/admob/answer/7356092', field: 'ads' },
        { id: 'upload', label: 'Upload key (signs the AAB)', ok: !!app.signing?.set && app.signing.storeExists && app.signing.passwords, where: 'Made here once (Create a key below); back the .jks file and its password up', link: 'https://developer.android.com/studio/publish/app-signing#generate-key', field: 'signing' },
        { id: 'revenuecat', label: 'RevenueCat key (real purchases)', ok: !!android.iap?.revenuecat, where: 'RevenueCat › your project › API keys › Google Play public key (goog_…); empty: purchases mocked', link: 'https://app.revenuecat.com/', field: 'revenuecat' },
        { id: 'revenuecatTest', label: 'RevenueCat Test Store key (debug builds)', ok: !!android.iap?.revenuecatTest, where: 'RevenueCat › your project › Apps & providers › Test Store › its API key (test_…); simulated purchases in run / APK builds, never in the AAB', link: 'https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store', field: 'revenuecat' },
        { id: 'play', label: 'Google Play Console account', ok: null, where: 'To upload the AAB ($25 once); not a key, checked by you', link: 'https://play.google.com/console/signup' },
    ];
}

/** keystore.properties: a Java properties file (its backslashes, colons and equals escaped). */
function writeSigning({ storeFile, storePassword, keyAlias, keyPassword }) {
    // (Java reads a properties file as Latin-1: anything past plain ASCII, an accent in a password, goes as \\uXXXX, or it's
    // read wrong and the key won't open. Backslashes, colons and equals escaped too.)
    const escape = (value) => String(value)
        .replace(/\\/g, '\\\\')
        .replace(/([:=#!])/g, '\\$1')
        .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const path = resolve(root, 'native', GAME, 'android', 'keystore.properties');
    const lines = [
        '# The upload key for Google Play (written by the Android panel). Kept out of git: never commit it.',
        `storeFile=${escape(storeFile.replace(/\\/g, '/'))}`,
        `storePassword=${escape(storePassword)}`,
        `keyAlias=${escape(keyAlias)}`,
        `keyPassword=${escape(keyPassword)}`,
    ];
    fs.writeFileSync(path, `${lines.join('\n')}\n`);
}

/** Java's keytool, as Android Studio brings it. */
function keytool() {
    const tools = findTools();
    if (!tools.java) throw new Error('No Java: install Android Studio first.');
    return resolve(tools.java, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
}

/** The key opens with this password and has this alias (keytool -list): a wrong one's said here, not at the end of a build. */
function checkKey(storeFile, storePassword, keyAlias) {
    return new Promise((done, failed) => execFile(keytool(), ['-list', '-keystore', storeFile, '-storepass', storePassword, '-alias', keyAlias], { windowsHide: true }, (error, stdout, stderr) => {
        if (!error) return done();
        const said = `${stdout}\n${stderr}`;
        if (/password was incorrect|tampered|padded/i.test(said)) failed(new Error('That password doesn\'t open this key file.'));
        else if (/does not exist|not found/i.test(said)) failed(new Error(`There's no key "${keyAlias}" in that file (keytool -list shows its aliases).`));
        else failed(new Error(`keytool: ${said.trim().split('\n').pop()}`));
    }));
}

/** An existing upload key: its file, alias and passwords (checked first). */
async function saveSigning({ storeFile, storePassword, keyAlias, keyPassword }) {
    storeFile = String(storeFile ?? '').trim();
    keyAlias = String(keyAlias ?? '').trim() || 'upload';
    if (!storeFile || !fs.existsSync(storeFile)) throw new Error(`No key file at ${storeFile || '(empty)'}.`);
    if (!storePassword || !keyPassword) throw new Error('Both passwords, please (often the same).');
    await checkKey(storeFile, storePassword, keyAlias);
    writeSigning({ storeFile, storePassword, keyAlias, keyPassword });
    say(`✔ upload key set and checked: ${storeFile} (${keyAlias})`, 'ok');
}

/** A new upload key, made with Java's keytool, then set. */
async function createKey({ storeFile, password, name }) {
    storeFile = String(storeFile ?? '').trim();
    name = String(name ?? '').trim();
    if (!storeFile.toLowerCase().endsWith('.jks')) throw new Error('The key file should end in .jks.');
    if (fs.existsSync(storeFile)) throw new Error('There is a file there already: pick another name, or use "Set existing".');
    if (!password || String(password).length < 6) throw new Error('A password of 6 characters or more.');
    if (!name) throw new Error('Your name (or studio name) for the key.');
    const tools = findTools();
    if (!tools.java) throw new Error('No Java: install Android Studio first.');
    fs.mkdirSync(dirname(storeFile), { recursive: true });
    const keytool = resolve(tools.java, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
    const dname = `CN=${name.replace(/[,=]/g, ' ')}`;
    await new Promise((done, failed) => execFile(keytool, ['-genkeypair', '-v', '-keystore', storeFile, '-alias', 'upload', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-storepass', password, '-keypass', password, '-dname', dname], { windowsHide: true }, (error, stdout, stderr) => {
        if (error) failed(new Error(`keytool failed: ${(stderr || error.message).trim().split('\n').pop()}`));
        else done();
    }));
    await checkKey(storeFile, password, 'upload');
    writeSigning({ storeFile, storePassword: password, keyAlias: 'upload', keyPassword: password });
    say(`✔ upload key made: ${storeFile} (alias upload). Back this file and its password up somewhere safe.`, 'ok');
}

/**
 * The system's own picker, on this computer: a folder (`folder`) or a key file. The chosen path, or '' if it was closed.
 * Windows: PowerShell's dialogs; macOS: osascript. Elsewhere: none (the path's typed).
 */
function pick(kind) {
    return new Promise((done, failed) => {
        if (process.platform === 'win32') {
            const script = kind === 'folder'
                ? "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Where to keep the upload key (outside the repo)'; $f.ShowNewFolderButton = $true; $w = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}; if ($f.ShowDialog($w) -eq 'OK') { $f.SelectedPath }"
                : "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.OpenFileDialog; $f.Title = 'The upload key'; $f.Filter = 'Key stores (*.jks;*.keystore)|*.jks;*.keystore|All files (*.*)|*.*'; $w = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}; if ($f.ShowDialog($w) -eq 'OK') { $f.FileName }";
            execFile('powershell', ['-NoProfile', '-STA', '-Command', script], { windowsHide: false }, (error, stdout) => (error ? failed(new Error('The picker could not open: type the path.')) : done(stdout.trim())));
        } else if (process.platform === 'darwin') {
            const script = kind === 'folder' ? 'POSIX path of (choose folder with prompt "Where to keep the upload key")' : 'POSIX path of (choose file with prompt "The upload key")';
            execFile('osascript', ['-e', script], (error, stdout) => done(error ? '' : stdout.trim()));
        } else failed(new Error('No picker here: type the path.'));
    });
}

/** RevenueCat's public key for Google Play: into platforms.config.json (`android.iap`). */
function saveRevenueCat({ revenuecat, revenuecatTest }) {
    const key = String(revenuecat ?? '').trim();
    const test = String(revenuecatTest ?? '').trim();
    if (key && !/^goog_[A-Za-z0-9]+$/.test(key)) throw new Error('RevenueCat\'s Google Play key starts with goog_.');
    if (test && !/^test_[A-Za-z0-9]+$/.test(test)) throw new Error('RevenueCat\'s Test Store key starts with test_.');
    savePlatform((android) => {
        android.iap = { ...(android.iap && !Array.isArray(android.iap) ? android.iap : {}), revenuecat: key, revenuecatTest: test };
    });
    say(`✔ RevenueCat keys saved: debug builds ${test ? 'Test Store' : 'mocked'}, AAB ${key ? 'Google Play' : 'mocked'}`, 'ok');
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
                const file = data.what === 'aab' ? app.aab : app.apk;
                if (file) reveal(file.path);
                return send(res, 200, { ok: true });
            }
            if (url.pathname === '/api/signing') {
                if (job) throw new Error('Wait for the build to finish.');
                await saveSigning(data);
                return send(res, 200, { ok: true });
            }
            if (url.pathname === '/api/createKey') {
                if (job) throw new Error('Wait for the build to finish.');
                await createKey(data);
                return send(res, 200, { ok: true });
            }
            if (url.pathname === '/api/pick') {
                return send(res, 200, { path: await pick(data.kind === 'folder' ? 'folder' : 'file') });
            }
            if (url.pathname === '/api/revenuecat') {
                if (job) throw new Error('Wait for the build to finish.');
                saveRevenueCat(data);
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
