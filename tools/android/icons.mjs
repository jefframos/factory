// icons.mjs — the phone app's icon and splash from the game's own icon (games/<GAME>/icon/icon.png), in every Android size,
// over Capacitor's defaults. Run by android.mjs before each sync; on its own: node tools/android/icons.mjs
//
// - Launcher: square with rounded corners (ic_launcher), round (ic_launcher_round), and the adaptive icon of Android 8+: the
//   art on its foreground layer, a little bigger than the part every launcher shape shows (so no edge peeks out), over the
//   colour of the art's border (ic_launcher_background).
// - Splash: the icon in the middle of that colour.
// - Google Play's listing icon: native/<GAME>/store/icon-512.png.

import dotenv from 'dotenv';
import fs from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** dp: the legacy icon, the adaptive layers, and how much of the adaptive layer the art covers (every shape shows 72 of 108). */
const SIZE = { icon: 48, layer: 108, art: 76 };
/** The rounded square's corner, of its side; the splash icon's side, of the screen's shorter side. */
const CORNER = 0.18;
const SPLASH_ICON = 0.36;
/** The splash sizes (Capacitor's template): portrait, and landscape the other way round. */
const SPLASH = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };

export async function makeIcons(root, game) {
    const source = resolve(root, 'games', game, 'icon', 'icon.png');
    const res = resolve(root, 'native', game, 'android', 'app', 'src', 'main', 'res');
    if (!fs.existsSync(source)) {
        console.log(`[icons] no games/${game}/icon/icon.png: Capacitor's icon stays`);
        return;
    }
    if (!fs.existsSync(res)) throw new Error(`no Android project at native/${game}/android`);
    const art = sharp(source).removeAlpha();
    const background = await borderColor(source);

    const mask = (side, round) => Buffer.from(
        `<svg width="${side}" height="${side}">${round
            ? `<circle cx="${side / 2}" cy="${side / 2}" r="${side / 2}"/>`
            : `<rect width="${side}" height="${side}" rx="${side * CORNER}" ry="${side * CORNER}"/>`}</svg>`);
    const shaped = async (side, round) => art.clone().resize(side, side).ensureAlpha()
        .composite([{ input: mask(side, round), blend: 'dest-in' }]).png().toBuffer();

    for (const [density, scale] of Object.entries(DENSITIES)) {
        const dir = resolve(res, `mipmap-${density}`);
        fs.mkdirSync(dir, { recursive: true });
        const side = Math.round(SIZE.icon * scale);
        fs.writeFileSync(resolve(dir, 'ic_launcher.png'), await shaped(side, false));
        fs.writeFileSync(resolve(dir, 'ic_launcher_round.png'), await shaped(side, true));
        const layer = Math.round(SIZE.layer * scale);
        const inner = Math.round(SIZE.art * scale);
        const foreground = await sharp({ create: { width: layer, height: layer, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: await art.clone().resize(inner, inner).png().toBuffer(), gravity: 'center' }]).png().toBuffer();
        fs.writeFileSync(resolve(dir, 'ic_launcher_foreground.png'), foreground);
    }
    fs.writeFileSync(resolve(res, 'values', 'ic_launcher_background.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background.hex}</color>\n</resources>\n`);

    const splash = async (width, height) => {
        const side = Math.round(Math.min(width, height) * SPLASH_ICON);
        return sharp({ create: { width, height, channels: 3, background: background.rgb } })
            .composite([{ input: await shaped(side, false), gravity: 'center' }]).png().toBuffer();
    };
    for (const [density, [w, h]] of Object.entries(SPLASH)) {
        for (const [folder, width, height] of [[`drawable-port-${density}`, w, h], [`drawable-land-${density}`, h, w]]) {
            const dir = resolve(res, folder);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(resolve(dir, 'splash.png'), await splash(width, height));
        }
    }
    fs.writeFileSync(resolve(res, 'drawable', 'splash.png'), await splash(480, 320));

    const store = resolve(root, 'native', game, 'store');
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(resolve(store, 'icon-512.png'), await art.clone().resize(512, 512).png().toBuffer());
    console.log(`[icons] from games/${game}/icon/icon.png: launcher, adaptive (on ${background.hex}), splash, store icon`);
}

/** The average colour of the art's outer edge: what's behind the adaptive icon and the splash. */
async function borderColor(source) {
    const side = 64;
    const { data } = await sharp(source).removeAlpha().resize(side, side).raw().toBuffer({ resolveWithObject: true });
    const sum = [0, 0, 0];
    let count = 0;
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            if (x > 1 && y > 1 && x < side - 2 && y < side - 2) continue;
            const i = (y * side + x) * 3;
            for (let c = 0; c < 3; c++) sum[c] += data[i + c];
            count++;
        }
    }
    const [r, g, b] = sum.map((v) => Math.round(v / count));
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    return { hex, rgb: { r, g, b } };
}

// (Run on its own.)
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1'))) {
    const game = dotenv.config().parsed?.GAME ?? process.env.GAME;
    await makeIcons(process.cwd(), game);
}
