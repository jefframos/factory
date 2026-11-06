// UiParts.ts
//
// The UI's building blocks, on the Layer Lab pack's sprites (the ui{tps} atlas, see tools/ui-kit/README.md): text,
// sprites, stretched frames, glossy buttons. Taken from the UFO game's (games/ufo/game/ui/UiParts.ts), trimmed to what
// Ant uses. Sizes are in the 720 x 1080 design (Game.DESIGN_WIDTH / HEIGHT).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { AntAudio, Sfx } from '../audio/AntAudio';

export const FONT = 'Baloo2-ExtraBold, Arial Rounded MT Bold, sans-serif';
export const DARK = 0x10123a;

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

/** Fitted to `size` (its longer side). */
export function fitSprite(sprite: PIXI.Sprite, size: number): void {
    sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
}

/** The nine-slice borders [left, top, right, bottom] of the pack's stretchable frames (tools/ui-kit/README.md). */
const SLICES: Record<string, [number, number, number, number]> = {
    Menu_BottomBtn_Bg: [0, 6, 0, 1],
    Menu_BottomBtn_TabFocus: [25, 25, 25, 0],
    Menu_BottomBtn_TabFocus_Light: [20, 29, 20, 0],
    Title_Ribbon04_Red: [150, 0, 150, 0],
    BasicFrame_Round20: [20, 20, 20, 20],
    Button_Round02_Blue: [23, 29, 23, 26],
    Button_Round03_Dark: [20, 19, 20, 21],
    Popup04_Topber_Single: [45, 51, 46, 82],
    ResourceBar_Single_Bg: [11, 11, 11, 11],
    PanelFrame03_Bg: [0, 8, 0, 4],
    CardFrame03_n_Bg: [30, 29, 30, 33],
    CardFrame03_n_InnerBg: [18, 18, 18, 18],
    BorderFrame_Round24: [29, 29, 29, 29],
};

/** A frame stretched to `width` x `height` (in the parent's units), its borders drawn at `scale`, top left at its position. */
export function framePlane(frame: string, width: number, height: number, scale = 1): PIXI.NineSlicePlane {
    const [left, top, right, bottom] = SLICES[frame];
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), left, top, right, bottom);
    plane.scale.set(scale);
    plane.width = width / scale;
    plane.height = height / scale;
    return plane;
}

/** The coins at the top of the screen (home, the shops, a finished level), as in UFO. */
export const COIN_BAR = { width: 170, height: 44, icon: 52, color: 0x1c1d33, textX: 42, textSize: 28, left: 16, top: 48 };

/** Puts the bar, the coin and `amount` in `holder`, whose position is the coin's middle. */
export function fillCoinBar(holder: PIXI.Container, amount: PIXI.Text): void {
    const bar = framePlane('ResourceBar_Single_Bg', COIN_BAR.width, COIN_BAR.height);
    bar.tint = COIN_BAR.color;
    bar.position.set(0, -COIN_BAR.height / 2);
    const coin = iconSprite('ResourceBar_Single_Icon_Coin', COIN_BAR.icon);
    amount.anchor.set(0, 0.5);
    amount.position.set(COIN_BAR.textX, -1);
    holder.addChild(bar, coin, amount);
}

/** The Button01_l sprites (80x142): the borders that don't stretch, the most they're drawn at, and the height of those at scale 1. */
const BUTTON_SLICE = { side: 38, top: 42, bottom: 70, scale: 0.5, capHeight: 112 };

/** A glossy button's back and words, centred. */
export function buttonParts(width: number, height: number, text: string, frame: string): PIXI.Container[] {
    const { side, top, bottom, capHeight } = BUTTON_SLICE;
    const scale = Math.min(BUTTON_SLICE.scale, height / capHeight);
    const back = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), side, top, side, bottom);
    back.scale.set(scale);
    back.width = width / scale;
    back.height = height / scale;
    back.position.set(-width / 2, -height / 2);
    const words = label(Math.round(height * 0.42));
    words.text = text;
    words.y = -3;
    return [back, words];
}

/** A round button (a pack frame, `size` across) with an icon on it. */
export function roundButton(frame: string, icon: string, size: number, iconSize = size * 0.62): PIXI.Container {
    const holder = new PIXI.Container();
    const back = framePlane(frame, size, size, size / 110);
    back.position.set(-size / 2, -size / 2);
    const picture = iconSprite(icon, iconSize);
    picture.y = -size * 0.04;
    holder.addChild(back, picture);
    return holder;
}

/** Tappable, with a little squash and a sound (`sound`, null for none) when tapped; the tap doesn't reach the board under it. */
export function tappable(button: PIXI.Container, onTap: () => void, sound: Sfx | null = 'click'): void {
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        gsap.fromTo(button.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        if (sound) AntAudio.play(sound);
        onTap();
    });
}

/** A screen-wide dim behind a popup that eats taps. */
export function dimmer(): PIXI.Graphics {
    const dim = new PIXI.Graphics();
    dim.eventMode = 'static';
    dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    dim.on('pointertap', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    return dim;
}
