// env.mjs — what the Android build needs on this computer, found (Android Studio, its Java, the Android SDK, adb), and
// the game's app as it's set up (native/<GAME>, games/<GAME>/platforms.config.json). Used by the panel (panel/server.mjs)
// and the command line (android.mjs).

import { spawnSync } from 'child_process';
import fs from 'fs';
import { resolve } from 'path';

const isWindows = process.platform === 'win32';
const exe = (name) => (isWindows ? `${name}.exe` : name);

function firstThatExists(paths) {
    return paths.find((path) => path && fs.existsSync(path)) ?? null;
}

/** What a tool prints, on either stream (java -version answers on stderr); null when it can't run. */
function quiet(file, args, env) {
    const result = spawnSync(file, args, { encoding: 'utf8', timeout: 15000, env, windowsHide: true });
    if (result.error) return null;
    return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || null;
}

/** Where the tools are (null: not found). */
export function findTools() {
    const local = process.env.LOCALAPPDATA ?? '';
    const studio = firstThatExists([
        'C:/Program Files/Android/Android Studio',
        local && resolve(local, 'Programs/Android Studio'),
        '/Applications/Android Studio.app/Contents',
        '/opt/android-studio',
    ]);
    const java = firstThatExists([
        process.env.JAVA_HOME,
        studio && resolve(studio, 'jbr'),
        studio && resolve(studio, 'jre'),
    ]);
    const sdk = firstThatExists([
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        local && resolve(local, 'Android/Sdk'),
        process.env.HOME && resolve(process.env.HOME, 'Library/Android/sdk'),
        process.env.HOME && resolve(process.env.HOME, 'Android/Sdk'),
    ]);
    const adb = sdk && firstThatExists([resolve(sdk, 'platform-tools', exe('adb'))]);
    const emulator = sdk && firstThatExists([resolve(sdk, 'emulator', exe('emulator'))]);
    return { studio, java, sdk, adb, emulator };
}

/** The environment a build runs in: JAVA_HOME and ANDROID_HOME set from what was found, adb on the PATH. */
export function toolEnv(tools = findTools()) {
    const env = { ...process.env };
    if (tools.java) env.JAVA_HOME = tools.java;
    if (tools.sdk) {
        env.ANDROID_HOME = tools.sdk;
        env.ANDROID_SDK_ROOT = tools.sdk;
        const extra = [resolve(tools.sdk, 'platform-tools'), tools.java && resolve(tools.java, 'bin')].filter(Boolean);
        const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
        env[key] = [...extra, env[key]].join(isWindows ? ';' : ':');
    }
    return env;
}

/** The game's app: native/<game>, its ids and version, what it sells and shows. */
export function readApp(root, game) {
    const dir = resolve(root, 'native', game);
    const configPath = resolve(dir, 'capacitor.config.json');
    const gradlePath = resolve(dir, 'android/app/build.gradle');
    const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
    const gradle = fs.existsSync(gradlePath) ? fs.readFileSync(gradlePath, 'utf8') : '';
    const pick = (pattern) => gradle.match(pattern)?.[1] ?? null;
    const variables = resolve(dir, 'android/variables.gradle');
    const compileSdk = fs.existsSync(variables) ? Number(fs.readFileSync(variables, 'utf8').match(/compileSdkVersion\s*=\s*(\d+)/)?.[1]) : null;
    const platformsPath = resolve(root, 'games', game, 'platforms.config.json');
    const platforms = fs.existsSync(platformsPath) ? JSON.parse(fs.readFileSync(platformsPath, 'utf8')) : {};
    const nativePackage = resolve(dir, 'package.json');
    const plugins = fs.existsSync(nativePackage) ? Object.keys(JSON.parse(fs.readFileSync(nativePackage, 'utf8')).dependencies ?? {}) : [];
    const apk = resolve(dir, 'android/app/build/outputs/apk/debug/app-debug.apk');
    const aab = resolve(dir, 'android/app/build/outputs/bundle/release/app-release.aab');
    const signing = readSigning(resolve(dir, 'android/keystore.properties'));
    return {
        dir,
        exists: !!config,
        hasAndroid: fs.existsSync(resolve(dir, 'android')),
        appId: config?.appId ?? null,
        appName: config?.appName ?? null,
        applicationId: pick(/applicationId\s+"([^"]+)"/),
        versionCode: Number(pick(/versionCode\s+(\d+)/)) || null,
        versionName: pick(/versionName\s+"([^"]+)"/),
        compileSdk,
        android: platforms.android ?? null,
        plugins: plugins.map((name) => ({ name, version: installedVersion(root, name) })),
        apk: fs.existsSync(apk) ? { path: apk, at: fs.statSync(apk).mtimeMs, size: fs.statSync(apk).size } : null,
        aab: fs.existsSync(aab) ? { path: aab, at: fs.statSync(aab).mtimeMs, size: fs.statSync(aab).size } : null,
        signing,
    };
}

/** The upload key as keystore.properties says it (never its passwords): its file, alias, whether the file's there. */
export function readSigning(path) {
    if (!fs.existsSync(path)) return { set: false };
    const props = Object.fromEntries(fs.readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.includes('=') && !line.trim().startsWith('#')).map((line) => {
        const at = line.indexOf('=');
        const value = line.slice(at + 1).trim().replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        return [line.slice(0, at).trim(), value.replace(/\\(.)/g, '$1')];
    }));
    const storeFile = props.storeFile ?? '';
    return { set: !!storeFile, storeFile, keyAlias: props.keyAlias ?? '', storeExists: !!storeFile && fs.existsSync(storeFile), passwords: !!props.storePassword && !!props.keyPassword };
}

function installedVersion(root, name) {
    try {
        return JSON.parse(fs.readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    } catch {
        return null;
    }
}

/** Every check, each with what to do when it fails. */
export function runChecks(root, game, tools = findTools(), app = readApp(root, game)) {
    const javaVersion = tools.java ? quiet(resolve(tools.java, 'bin', exe('java')), ['-version'])?.split('\n')[0] ?? null : null;
    const platform = app.compileSdk && tools.sdk ? resolve(tools.sdk, 'platforms', `android-${app.compileSdk}`) : null;
    const buildTools = tools.sdk && fs.existsSync(resolve(tools.sdk, 'build-tools')) ? fs.readdirSync(resolve(tools.sdk, 'build-tools')).sort().reverse() : [];
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const missingPlugins = app.plugins.filter((p) => !p.version).map((p) => p.name);
    const studioLink = 'https://developer.android.com/studio';
    return [
        { id: 'node', label: 'Node 22 or newer', ok: nodeMajor >= 22, detail: `v${process.versions.node}`, fix: 'Install Node 22 LTS or newer.', link: 'https://nodejs.org/' },
        { id: 'studio', label: 'Android Studio', ok: !!tools.studio, detail: tools.studio ?? 'not found', fix: 'Install Android Studio (it brings Java and the SDK).', link: studioLink },
        { id: 'java', label: 'Java (JDK 21)', ok: !!tools.java && !!javaVersion, detail: javaVersion ? `${javaVersion} · ${tools.java}` : 'not found', fix: 'Comes with Android Studio (its jbr folder), or set JAVA_HOME.', link: studioLink },
        { id: 'sdk', label: 'Android SDK', ok: !!tools.sdk, detail: tools.sdk ?? 'not found', fix: 'Open Android Studio once: its setup installs the SDK. Or set ANDROID_HOME.', link: 'https://developer.android.com/studio/intro/update#sdk-manager' },
        { id: 'platform', label: `SDK platform: Android API ${app.compileSdk ?? '?'}`, ok: !!platform && fs.existsSync(platform), detail: platform && fs.existsSync(platform) ? platform : 'not installed', fix: `Android Studio > Tools > SDK Manager > SDK Platforms: tick Android API ${app.compileSdk} (or let the first build ask).`, link: 'https://developer.android.com/studio/intro/update#sdk-manager' },
        { id: 'buildtools', label: 'SDK build tools', ok: buildTools.length > 0, detail: buildTools[0] ?? 'not installed', fix: 'SDK Manager > SDK Tools: Android SDK Build-Tools.', link: 'https://developer.android.com/tools/releases/build-tools' },
        { id: 'adb', label: 'adb (platform tools)', ok: !!tools.adb, detail: tools.adb ?? 'not found', fix: 'SDK Manager > SDK Tools: Android SDK Platform-Tools.', link: 'https://developer.android.com/tools/releases/platform-tools' },
        { id: 'capacitor', label: 'Capacitor and plugins (npm)', ok: app.plugins.length > 0 && missingPlugins.length === 0, detail: missingPlugins.length ? `missing: ${missingPlugins.join(', ')}` : app.plugins.map((p) => `${p.name.replace('@capacitor/', '').replace('@capacitor-community/', '')} ${p.version}`).join(' · '), fix: 'Run npm install at the repo root.', link: 'https://capacitorjs.com/docs/android' },
        { id: 'project', label: `Android project: native/${game}`, ok: app.exists && app.hasAndroid, detail: app.exists ? (app.hasAndroid ? `${app.appName} · ${app.applicationId}` : 'no android folder') : 'no capacitor.config.json', fix: `See native/README.md: "A new game's app".`, link: null },
    ];
}

/** The phones (and running emulators) adb sees. */
export function listDevices(tools = findTools()) {
    if (!tools.adb) return [];
    const out = quiet(tools.adb, ['devices', '-l']) ?? '';
    return out.split('\n').slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
        const [serial, state, ...rest] = line.split(/\s+/);
        const info = Object.fromEntries(rest.map((part) => part.split(':')).filter((kv) => kv.length === 2));
        return { serial, state, model: (info.model ?? '').replace(/_/g, ' ') || serial, emulator: serial.startsWith('emulator-') };
    });
}

/** The emulators made in Android Studio's Device Manager (not running ones: those are in listDevices). */
export function listEmulators(tools = findTools()) {
    if (!tools.emulator) return [];
    return (quiet(tools.emulator, ['-list-avds']) ?? '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('INFO'));
}
