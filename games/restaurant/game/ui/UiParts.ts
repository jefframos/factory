// UiParts.ts
//
// The UI's building blocks, on the Layer Lab pack's sprites (the ui{tps} atlas): text, sprites, stretched frames,
// glossy buttons, the coin bar. As Ant's (games/ant/game/ui/UiParts.ts), trimmed. Sizes are in the 720 x 1080 design.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import SoundToggleButton from 'core/ui/SoundToggleButton';

export const FONT = 'Baloo2-ExtraBold, Arial Rounded MT Bold, sans-serif';
/** Words' outline: black (the pack's look; the old brown read muddy). */
export const DARK = 0x0d0d14;

/** The game's warm colours. */
export const WARM = { cream: 0xfff4e4, peach: 0xf3d2a8, tan: 0xd9a877, brown: 0x8a5530, tomato: 0xf2674e, green: 0x4cb860, ink: 0x5a3a22 };

/**
 * Words are drawn at this many times the screen's pixel ratio: the UI's laid out at 720 x 1080 and scaled up to fit
 * (twice that on a big screen), so text drawn at only the renderer's resolution was blurry. Capped (memory).
 */
const TEXT_RESOLUTION = Math.min(4, Math.max(2, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) * 2));

/** White words with a dark outline, centred. */
export const label = (size: number, fill: string | number = 0xffffff, stroke: number = DARK): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, stroke, strokeThickness: Math.round(size / 5), align: 'center', lineJoin: 'round' });
    text.resolution = TEXT_RESOLUTION;
    text.anchor.set(0.5);
    return text;
};

/** Words with no outline, for on light frames. */
export const plainLabel = (size: number, fill: string | number): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, align: 'center' });
    text.resolution = TEXT_RESOLUTION;
    text.anchor.set(0.5);
    return text;
};

/**
 * A bar's background (the cooking timer, the upgrade bar, the coins pill): drawn, not a stretched sprite — the pack's is
 * 26px, soft once the UI's scaled up; this stays sharp at any size. Centred; a dark rounded body with a thin rim.
 */
export function barBack(width: number, height: number, color = 0x3a2416, rim = 0x1e120a): PIXI.Container {
    const holder = new PIXI.Container();
    const plane = pill(height + 4, color, { rim, rimWidth: 2, shine: true });
    sizePill(plane, width + 4);
    plane.position.set(-(width + 4) / 2, -(height + 4) / 2);
    holder.addChild(plane);
    return holder;
}

// ---------------------------------------------------------------- baked shapes
//
// Shapes for the HUD (bars, their fills, pips, panels, arrows) drawn once on a 2D canvas at BAKE times their size and
// used as textures (as the Mob game does): the canvas smooths their edges, where PIXI.Graphics drew them jagged (no
// antialiasing on its triangles), and once the UI's scaled up to a big screen they still look sharp.

/** How many times their size they're drawn at. */
const BAKE = 4;
const baked = new Map<string, PIXI.Texture>();
const css = (color: number, alpha = 1) => `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;

/** A texture `width` x `height` (UI units) drawn by `draw` (in UI units: it's scaled up), made once per `key`. */
function bake(key: string, width: number, height: number, draw: (c: CanvasRenderingContext2D) => void): PIXI.Texture {
    let texture = baked.get(key);
    if (!texture) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(width * BAKE));
        canvas.height = Math.max(1, Math.ceil(height * BAKE));
        const c = canvas.getContext('2d')!;
        c.scale(BAKE, BAKE);
        draw(c);
        texture = PIXI.Texture.from(canvas);
        baked.set(key, texture);
    }
    return texture;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const radius = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + radius, y);
    c.arcTo(x + w, y, x + w, y + h, radius);
    c.arcTo(x + w, y + h, x, y + h, radius);
    c.arcTo(x, y + h, x, y, radius);
    c.arcTo(x, y, x + w, y, radius);
    c.closePath();
}

/**
 * A pill (a bar's back, its fill) `height` tall, `color`, with a `rim` round it and a faint `shine` along its top: a
 * nine-slice (its round ends kept), its top left at its position; give it its width with sizePill.
 */
export function pill(height: number, color: number, look: { rim?: number; rimWidth?: number; shine?: boolean } = {}): PIXI.NineSlicePlane {
    const h = height;
    const w = h * 2;
    const rimWidth = look.rim !== undefined ? look.rimWidth ?? 2 : 0;
    const texture = bake(`pill:${h}:${color}:${look.rim ?? ''}:${rimWidth}:${look.shine ? 1 : 0}`, w, h, (c) => {
        if (look.rim !== undefined) {
            c.fillStyle = css(look.rim);
            roundRect(c, 0, 0, w, h, h / 2);
            c.fill();
        }
        c.fillStyle = css(color);
        roundRect(c, rimWidth, rimWidth, w - rimWidth * 2, h - rimWidth * 2, (h - rimWidth * 2) / 2);
        c.fill();
        if (look.shine) {
            c.fillStyle = 'rgba(255,255,255,0.1)';
            roundRect(c, rimWidth + 3, rimWidth + 2, w - rimWidth * 2 - 6, (h - rimWidth * 2) * 0.42, (h - rimWidth * 2) * 0.4);
            c.fill();
        }
    });
    const end = (h / 2) * BAKE;
    const plane = new PIXI.NineSlicePlane(texture, end, 0, end, 0);
    plane.scale.set(1 / BAKE);
    plane.height = h * BAKE;
    plane.width = w * BAKE;
    return plane;
}

/** A pill's width (UI units; never less than its height: its ends). */
export function sizePill(plane: PIXI.NineSlicePlane, width: number): void {
    const height = plane.height / BAKE;
    plane.width = Math.max(height, width) * BAKE;
}

/** A round dot (a pip), centred: `radius`, `fill`, an outline `stroke` wide in `strokeColor`. */
export function dot(radius: number, fill: number, strokeColor: number, stroke: number): PIXI.Sprite {
    const size = (radius + stroke) * 2 + 2;
    const texture = bake(`dot:${radius}:${fill}:${strokeColor}:${stroke}`, size, size, (c) => {
        c.beginPath();
        c.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
        c.fillStyle = css(fill);
        c.fill();
        if (stroke > 0) {
            c.lineWidth = stroke;
            c.strokeStyle = css(strokeColor);
            c.stroke();
        }
    });
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale.set(1 / BAKE);
    return sprite;
}

/** A filled polygon (an arrow, a bubble's tail) of `points` ([x, y, ...], UI units), outlined; its own origin kept. */
export function shape(key: string, points: readonly number[], fill: number, strokeColor = 0, stroke = 0): PIXI.Sprite {
    const xs = points.filter((_, i) => i % 2 === 0);
    const ys = points.filter((_, i) => i % 2 === 1);
    const pad = stroke + 2;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - minX + pad;
    const height = Math.max(...ys) - minY + pad;
    const texture = bake(`shape:${key}`, width, height, (c) => {
        c.beginPath();
        for (let i = 0; i < points.length; i += 2) {
            const x = points[i] - minX;
            const y = points[i + 1] - minY;
            if (i === 0) c.moveTo(x, y);
            else c.lineTo(x, y);
        }
        c.closePath();
        c.fillStyle = css(fill);
        c.fill();
        if (stroke > 0) {
            c.lineJoin = 'round';
            c.lineWidth = stroke;
            c.strokeStyle = css(strokeColor);
            c.stroke();
        }
    });
    const sprite = new PIXI.Sprite(texture);
    sprite.scale.set(1 / BAKE);
    sprite.position.set(minX, minY);
    return sprite;
}

/** A rounded panel `width` x `height` (corner `radius`), `color`: a nine-slice, its top left at its position. */
export function panel(width: number, height: number, radius: number, color: number, alpha = 1): PIXI.NineSlicePlane {
    const size = radius * 2 + 2;
    const texture = bake(`panel:${radius}:${color}:${alpha}`, size, size, (c) => {
        c.fillStyle = css(color, alpha);
        roundRect(c, 0, 0, size, size, radius);
        c.fill();
    });
    const corner = radius * BAKE;
    const plane = new PIXI.NineSlicePlane(texture, corner, corner, corner, corner);
    plane.scale.set(1 / BAKE);
    plane.width = width * BAKE;
    plane.height = height * BAKE;
    return plane;
}

/** A pack sprite, centred, fitted to `size` (its longer side). */
export function iconSprite(frame: string, size: number): PIXI.Sprite {
    const sprite = PIXI.Sprite.from(frame);
    sprite.anchor.set(0.5);
    fitSprite(sprite, size);
    return sprite;
}

export function fitSprite(sprite: PIXI.Sprite, size: number): void {
    sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
}

/** The nine-slice borders [left, top, right, bottom] of the pack's stretchable frames. */
const SLICES: Record<string, [number, number, number, number]> = {
    BasicFrame_Round20: [20, 20, 20, 20],
    BorderFrame_Round24: [29, 29, 29, 29],
    ResourceBar_Single_Bg: [11, 11, 11, 11],
    // The pack's bar (a dark track, a black outline) and its fills; the popup with a header band; the title ribbon; the
    // small dark round button (tools/ui-kit/README.md).
    Slider_Basic03_Bg_Single: [10, 23, 10, 14],
    Popup08_Topbar_Divided_Single: [45, 149, 46, 58],
    Title_Ribbon04_Red: [150, 0, 150, 0],
    Button_Round03_Dark: [20, 19, 20, 21],
};

export function framePlane(frame: string, width: number, height: number, scale = 1): PIXI.NineSlicePlane {
    const [left, top, right, bottom] = SLICES[frame];
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), left, top, right, bottom);
    plane.scale.set(scale);
    plane.width = width / scale;
    plane.height = height / scale;
    return plane;
}

/** The Button01_l sprites (80x142): the borders that don't stretch, the most they're drawn at, the cap's height. */
const BUTTON_SLICE = { side: 38, top: 42, bottom: 70, scale: 0.5, capHeight: 112 };

/** A glossy button, centred, its words to change later; tappable as a whole. */
/** Each button's words' outline: its own colour, darker (as the pack's buttons are written). */
const BUTTON_INK: Record<string, number> = {
    Button01_l_Green: 0x15722a, Button01_l_Gray: 0x4a4b55, Button01_l_Sky: 0x135f9c, Button01_l_Yellow: 0x9a5300,
};

export function glossyButton(width: number, height: number, text: string, frame: string): PIXI.Container & { words: PIXI.Text } {
    const { side, top, bottom, capHeight } = BUTTON_SLICE;
    const scale = Math.min(BUTTON_SLICE.scale, height / capHeight);
    const holder = new PIXI.Container() as PIXI.Container & { words: PIXI.Text };
    const back = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), side, top, side, bottom);
    back.scale.set(scale);
    back.width = width / scale;
    back.height = height / scale;
    back.position.set(-width / 2, -height / 2);
    const words = label(Math.round(height * 0.42), 0xffffff, BUTTON_INK[frame] ?? DARK);
    words.text = text;
    words.y = -3;
    holder.addChild(back, words);
    holder.words = words;
    holder.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
    return holder;
}

/** Set while a HUD button is being pressed: the scene's own taps (on the 3D bench) ignore that press. */
export const uiPress = { taken: false };

/** Tappable, with a little squash; its press isn't also a tap on the bench under it. */
export function tappable(button: PIXI.Container, onTap: () => void): void {
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        uiPress.taken = true;
    });
    button.on('pointertap', () => {
        gsap.fromTo(button.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        onTap();
    });
}

/** The coins at the top of the screen. */
export const COIN_BAR = { width: 170, height: 44, icon: 52, color: 0x3a2416, textX: 42, textSize: 28 };

/** The bar, the coin and `amount` in `holder`, whose position is the coin's middle. */
export function fillCoinBar(holder: PIXI.Container, amount: PIXI.Text): void {
    const bar = new TexBar(COIN_BAR.width, COIN_BAR.height);
    bar.x = COIN_BAR.width / 2;
    const coin = iconSprite('ItemIcon_Money_Bill', COIN_BAR.icon);
    amount.anchor.set(0, 0.5);
    amount.position.set(COIN_BAR.textX, -1);
    holder.addChild(bar, coin, amount);
}

// ---------------------------------------------------------------- the pack's bar, panel, ribbon, confetti, mute

/** The bar's art: the pack's navy track's height (px); how far in the fill sits (x the bar's height); the fills' colours. */
const BAR_ART = { height: 48, inset: 0.16, colors: { Yellow: 0xffc93c, Green: 0x55d66a, Blue: 0x4aa8ff } };

/**
 * A bar as the pack draws it (the upgrade bar, the oven's timer, the coins' pill — all the same): a dark track with a
 * black outline and a glossy fill, centred; set how full with setShare.
 */
export class TexBar extends PIXI.Container {
    private readonly fill: PIXI.NineSlicePlane;
    private readonly fillScale: number;
    private readonly inner: number;
    private readonly fillHeight: number;

    public constructor(width: number, height: number, fill: 'Yellow' | 'Green' | 'Blue' = 'Yellow') {
        super();
        // The pack's navy track (its black outline built in); the fill a glossy pill of our own (baked: sharp), inside it.
        const back = framePlane('Slider_Basic03_Bg_Single', width, height, Math.min(1, (height / BAR_ART.height) * 1.3));
        back.position.set(-width / 2, -height / 2);
        const inset = Math.max(3, Math.round(height * BAR_ART.inset));
        this.fillHeight = height - inset * 2;
        this.fillScale = 1;
        this.inner = width - inset * 2;
        this.fill = pill(this.fillHeight, BAR_ART.colors[fill], { shine: true });
        this.fill.position.set(-width / 2 + inset, -height / 2 + inset);
        this.addChild(back, this.fill);
        this.setShare(0);
    }

    /** How full (0..1). */
    public setShare(share: number): void {
        const s = Math.max(0, Math.min(1, share));
        this.fill.visible = s > 0;
        sizePill(this.fill, this.inner * s);
    }
}

/** The popup panel's art scale, and its header band's height at that scale. */
export const PANEL = { scale: 0.7, header: 149 * 0.7 };

/** A popup panel (the pack's, with its header band): `width` x `height`, centred; `title` written in the band. */
export function popupPanel(width: number, height: number, title = ''): PIXI.Container {
    const holder = new PIXI.Container();
    const back = framePlane('Popup08_Topbar_Divided_Single', width, height, PANEL.scale);
    back.position.set(-width / 2, -height / 2);
    holder.addChild(back);
    if (title) {
        const words = label(46);
        words.text = title;
        words.y = -height / 2 + PANEL.header * 0.45;
        words.scale.set(Math.min(1, (width - 60) / Math.max(1, words.width)));
        holder.addChild(words);
    }
    return holder;
}

/** A title on the pack's red ribbon (its ends kept, its middle stretched to fit the words), centred. */
export function ribbonTitle(text: string, size = 46): PIXI.Container & { words: PIXI.Text } {
    const holder = new PIXI.Container() as PIXI.Container & { words: PIXI.Text };
    const words = label(size);
    words.text = text;
    const scale = 0.6;
    const height = 143 * scale;
    const width = Math.max(300 * scale + 40, words.width + 200);
    const ribbon = framePlane('Title_Ribbon04_Red', width, height, scale);
    ribbon.position.set(-width / 2, -height / 2);
    words.y = -height * 0.08;
    holder.addChild(ribbon, words);
    holder.words = words;
    return holder;
}

const CONFETTI = [0xff5a5a, 0xffd23f, 0x4cd06a, 0x4aa8ff, 0xc77dff, 0xff9f43];

/** Turns `object` round and round, forever — till it's destroyed (then its tween stops too: none left on a gone object). */
export function spinForever(object: PIXI.DisplayObject, seconds: number): void {
    const tween = gsap.to(object, { rotation: Math.PI * 2, duration: seconds, repeat: -1, ease: 'none' });
    object.once('destroyed', () => tween.kill());
}

/** Confetti over `parent`: falling from above a `width` x `height` area round (x, y), till it's gone. */
export function throwConfetti(parent: PIXI.Container, x: number, y: number, width: number, height: number, count = 90): void {
    for (let i = 0; i < count; i++) {
        const piece = new PIXI.Sprite(PIXI.Texture.WHITE);
        piece.anchor.set(0.5);
        piece.width = 7 + Math.random() * 9;
        piece.height = 5 + Math.random() * 6;
        piece.tint = CONFETTI[i % CONFETTI.length];
        piece.position.set(x + (Math.random() - 0.5) * width, y - height / 2 - 20 - Math.random() * height * 0.4);
        piece.rotation = Math.random() * Math.PI;
        parent.addChild(piece);
        const tween = gsap.to(piece, {
            y: y + height / 2 + 40, x: piece.x + (Math.random() - 0.5) * 160, rotation: piece.rotation + 4 + Math.random() * 8,
            duration: 1.8 + Math.random() * 1.6, ease: 'power1.in', delay: Math.random() * 0.5,
            onComplete: () => piece.destroy(),
        });
        // (The screen it's on can go first: the tween stops with it, not on a destroyed piece.)
        piece.once('destroyed', () => tween.kill());
    }
}

/** The mute button (the pack's small dark round one, the sound icon on it): tap to mute / unmute everything. */
export function muteButton(size = 72): PIXI.Container {
    const holder = new PIXI.Container();
    const back = framePlane('Button_Round03_Dark', size, size, Math.min(1, size / 122));
    back.position.set(-size / 2, -size / 2);
    const icons = new SoundToggleButton('PictoIcon_Sound', 'PictoIcon_Sound_Off');
    icons.scale.set((size * 0.55) / 128);
    holder.addChild(back, icons);
    holder.eventMode = 'static';
    holder.cursor = 'pointer';
    holder.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);
    holder.on('pointerdown', () => (uiPress.taken = true));
    holder.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
        // (A tap on the icon itself is the icon's own; on the rest of the button, pass it on.)
        if (event.target !== icons) icons.emit('pointertap', event);
    });
    return holder;
}
