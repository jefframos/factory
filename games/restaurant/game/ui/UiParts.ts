// UiParts.ts
//
// The UI's building blocks, on the Layer Lab pack's sprites (the ui{tps} atlas): text, sprites, stretched frames,
// glossy buttons, the coin bar. As Ant's (games/ant/game/ui/UiParts.ts), trimmed. Sizes are in the 720 x 1080 design.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';

export const FONT = 'Baloo2-ExtraBold, Arial Rounded MT Bold, sans-serif';
export const DARK = 0x3a1e10;

/** The game's warm colours. */
export const WARM = { cream: 0xfff4e4, peach: 0xf3d2a8, tan: 0xd9a877, brown: 0x8a5530, tomato: 0xf2674e, green: 0x4cb860, ink: 0x5a3a22 };

/** White words with a dark outline, centred. */
export const label = (size: number, fill: string | number = 0xffffff, stroke: number = DARK): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, stroke, strokeThickness: Math.round(size / 5), align: 'center', lineJoin: 'round' });
    text.anchor.set(0.5);
    return text;
};

/** Words with no outline, for on light frames. */
export const plainLabel = (size: number, fill: string | number): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, align: 'center' });
    text.anchor.set(0.5);
    return text;
};

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
export function glossyButton(width: number, height: number, text: string, frame: string): PIXI.Container & { words: PIXI.Text } {
    const { side, top, bottom, capHeight } = BUTTON_SLICE;
    const scale = Math.min(BUTTON_SLICE.scale, height / capHeight);
    const holder = new PIXI.Container() as PIXI.Container & { words: PIXI.Text };
    const back = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), side, top, side, bottom);
    back.scale.set(scale);
    back.width = width / scale;
    back.height = height / scale;
    back.position.set(-width / 2, -height / 2);
    const words = label(Math.round(height * 0.42));
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
    const bar = framePlane('ResourceBar_Single_Bg', COIN_BAR.width, COIN_BAR.height);
    bar.tint = COIN_BAR.color;
    bar.position.set(0, -COIN_BAR.height / 2);
    const coin = iconSprite('ResourceBar_Single_Icon_Coin', COIN_BAR.icon);
    amount.anchor.set(0, 0.5);
    amount.position.set(COIN_BAR.textX, -1);
    holder.addChild(bar, coin, amount);
}
