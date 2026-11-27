// android.mjs — the phone app of the game in .env (GAME), from its native/<GAME> Capacitor project (native/README.md).
// `npm run android` opens the panel (panel/server.mjs), which runs this; on the command line:
//
//   npm run android:sync     build the web part (VITE_PLATFORM=android) and copy it into the Android project
//   npm run android:open     ... then open the project in Android Studio (Run ▶ puts it on the phone)
//   npm run android:run      ... then install and start it on the phone plugged in (USB debugging on); --target <serial>
//   npm run android:apk      ... then build a debug APK to copy to a phone by hand
//   npm run android:aab      ... then build the signed App Bundle for Google Play (the upload key: keystore.properties)
//
// AdMob: the app id goes into the Android project from the game's platforms.config.json (`android.admob.appId`); with none
// set, Google's sample app id is used, so the app still starts (AdMob would close it without one) and every ad is mocked.
// Java and the SDK are found by env.mjs (Android Studio's own when nothing's set).
// Run it from PowerShell (vite's build fails from Git Bash here: the drive letter's case).

import { execSync } from 'child_process';
import dotenv from 'dotenv';
import fs from 'fs';
import { resolve } from 'path';
import { findTools, toolEnv } from './env.mjs';
import { makeIcons } from './icons.mjs';

/** Google's sample AdMob app id for Android: lets the app start with no AdMob account (no real ads come with it). */
const SAMPLE_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

const root = process.cwd();
const GAME = dotenv.config().parsed?.GAME ?? process.env.GAME;
const args = process.argv.slice(2);
const flags = new Set(args);
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;
const tools = findTools();
const env = toolEnv(tools);

function fail(message) {
    console.error(`\n[android] ${message}\n`);
    process.exit(1);
}

function run(command, cwd = root, withEnv = env) {
    console.log(`\n[android] ${command}`);
    execSync(command, { cwd, env: withEnv, stdio: 'inherit' });
}

if (!GAME) fail('No GAME in .env.');
if (target && !/^[\w.:-]+$/.test(target)) fail(`Not a device: ${target}`);
const app = resolve(root, 'native', GAME);
if (!fs.existsSync(resolve(app, 'capacitor.config.json'))) fail(`${GAME} has no phone app yet (native/${GAME}/capacitor.config.json). See native/README.md.`);
if (!fs.existsSync(resolve(app, 'android'))) fail(`native/${GAME}/android is missing: run "npx cap add android" in native/${GAME} first.`);

// 1. The web part, built for the app.
run('npx vite build', root, { ...env, VITE_PLATFORM: 'android' });

// 2. AdMob's app id into the Android project.
const config = JSON.parse(fs.readFileSync(resolve(root, 'games', GAME, 'platforms.config.json'), 'utf8'));
const admob = config.android?.admob ?? {};
const appId = admob.appId || SAMPLE_APP_ID;
const strings = resolve(app, 'android/app/src/main/res/values/strings.xml');
let xml = fs.readFileSync(strings, 'utf8');
const line = `<string name="admob_app_id">${appId}</string>`;
xml = /<string name="admob_app_id">[^<]*<\/string>/.test(xml)
    ? xml.replace(/<string name="admob_app_id">[^<]*<\/string>/, line)
    : xml.replace('</resources>', `    ${line}\n</resources>`);
fs.writeFileSync(strings, xml);
const units = ['interstitial', 'rewarded'].filter((kind) => admob[kind]);
console.log(`\n[android] AdMob: ${admob.appId ? 'app id set' : 'no app id (Google sample)'}; real ${units.length ? units.join(' + ') : 'none'}, the rest mocked${admob.test ? '; test ads' : ''}`);

// 3. The game's icon and splash (games/<GAME>/icon/icon.png) over Capacitor's.
await makeIcons(root, GAME);

// 4. Into the Android project (web files, plugins).
run('npx cap sync android', app);

// 5. What's next.
const needJava = () => {
    if (!tools.java) fail('No Java: install Android Studio (it brings one) or set JAVA_HOME.');
    if (!tools.sdk) fail('No Android SDK: open Android Studio once to install it, or set ANDROID_HOME.');
};
// (Gradle's own output, plain, so the build shows as it goes: `cap run` says nothing till it's done, minutes the first time.)
const gradle = (task) => {
    console.log('\n[android] Gradle build (the first one downloads Gradle, the Android libraries and AdMob: 5-15 minutes; later ones are quick)');
    run(`${process.platform === 'win32' ? 'gradlew.bat' : './gradlew'} ${task} --console=plain`, resolve(app, 'android'));
};
const apkPath = resolve(app, 'android/app/build/outputs/apk/debug/app-debug.apk');
if (flags.has('--open')) run('npx cap open android', app);
if (flags.has('--run')) {
    needJava();
    const plugged = target && tools.adb && execSync(`"${tools.adb}" devices`, { encoding: 'utf8', env }).split('\n').some((l) => l.startsWith(`${target}\t`) && l.includes('device'));
    if (plugged) {
        // A phone (or a running emulator): built, installed and started over adb.
        gradle('assembleDebug');
        const gradleFile = fs.readFileSync(resolve(app, 'android/app/build.gradle'), 'utf8');
        const applicationId = gradleFile.match(/applicationId\s+"([^"]+)"/)?.[1];
        const namespace = gradleFile.match(/namespace\s*=?\s*"([^"]+)"/)?.[1] ?? applicationId;
        run(`"${tools.adb}" -s ${target} install -r "${apkPath}"`);
        run(`"${tools.adb}" -s ${target} shell am start -n ${applicationId}/${namespace}.MainActivity`);
    } else {
        // An emulator that isn't running yet (or no target): Capacitor starts it (quiet till its build is done).
        console.log('\n[android] npx cap run builds without showing progress: wait for it');
        run(`npx cap run android${target ? ` --target ${target}` : ''}`, app);
    }
}
if (flags.has('--apk')) {
    needJava();
    gradle('assembleDebug');
    console.log(`\n[android] APK: native/${GAME}/android/app/build/outputs/apk/debug/app-debug.apk`);
}
if (flags.has('--aab')) {
    // Google Play's: signed with the upload key (keystore.properties, from the panel's Keys).
    needJava();
    if (!fs.existsSync(resolve(app, 'android/keystore.properties'))) fail('No upload key: set or create one in the Android panel (npm run android > Keys), then build again.');
    if (admob.test) console.log('\n[android] note: AdMob test ads are on (fine for internal testing; turn them off for the real release)');
    gradle('bundleRelease');
    console.log(`\n[android] AAB: native/${GAME}/android/app/build/outputs/bundle/release/app-release.aab`);
}
console.log('\n[android] done');
