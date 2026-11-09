// UiParts.ts
//
// The UI's building blocks, on the Layer Lab pack's sprites (the ui{tps} atlas, picked from library3d/2d; see
// tools/ui-kit/README.md for the pack's rules): text, sprites, stretched frames, glossy buttons. The same parts as Ant's
// and UFO's (games/ant/game/ui/UiParts.ts), with Mob's sounds. Sizes are in the 720 x 1080 design (Game.DESIGN_WIDTH /
// HEIGHT); the pack is drawn for a 1080-wide screen, so its sprites go at about 0.65.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { MobAudio, Sfx } from '../audio/MobAudio';

export const FONT = 'Baloo2-ExtraBold, Arial Rounded MT Bold, sans-serif';
export const DARK = 0x10123a;

/** White words with a dark outline, centred. */
export const label = (size: number, fill: string | number = 0xffffff, stroke: number = DARK): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, stroke, strokeThickness: Math.round(size / 5), align: 'center', lineJoin: 'round' });
    text.anchor.set(0.5);
    return text;
};

/** Words with no outline, centred (on a light panel, or the PLAY button's dark words). */
export const plainLabel = (size: number, fill: string | number): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, align: 'center' });
    text.anchor.set(0.5);
    return text;
};

/** A pack sprite, centred, fitted to `size` (its longer side). */
export function iconSprite(frame: string, size: number): PIXI.Sprite {
    const sprite = PIXI.Sprite.from(frame);
    sprite.anchor.set(0.5);
    sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
    return sprite;
}

/** The nine-slice borders [left, top, right, bottom] of the pack's stretchable frames (tools/ui-kit/sprites.json). */
const SLICES: Record<string, [number, number, number, number]> = {
    ResourceBar_Single_Bg: [11, 11, 11, 11],
    Slider_Play01_Bg: [7, 7, 7, 7],
    Slider_Play01_FillMask: [4, 4, 4, 4],
    BorderFrame_Round24: [29, 29, 29, 29],
    Title_Ribbon02_White1: [82, 0, 82, 0],
    Title_Line01_Divider_Left: [3, 0, 41, 0],
    Title_Line01_Divider_Right: [42, 0, 3, 0],
    // The main screen's (tools/ui-kit/README.md recipes, as Ant's and UFO's).
    Menu_BottomBtn_Bg: [0, 6, 0, 1],
    Menu_BottomBtn_TabFocus: [25, 25, 25, 0],
    Menu_BottomBtn_TabFocus_Light: [20, 29, 20, 0],
    Title_Ribbon04_Red: [150, 0, 150, 0],
    PanelFrame03_Bg: [0, 8, 0, 4],
    CardFrame03_n_Bg: [30, 29, 30, 33],
    CardFrame03_n_InnerBg: [18, 18, 18, 18],
    Button_Round02_Blue: [23, 29, 23, 26],
    Button_Round03_Dark: [20, 19, 20, 21],
    Button_Round02_White_Bg: [23, 23, 23, 26],
    Button_Round02_White_Light: [18, 0, 18, 0],
    CardFrame03_n_Light: [25, 25, 25, 26],
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

/** The coins at the top of the screen, as in UFO and Ant. */
export const COIN_BAR = { width: 170, height: 44, icon: 52, color: 0x1c1d33, textX: 42, textSize: 28 };

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

/** A glossy button: its back (a Button01_l frame) and words, centred; `setFrame` swaps the back (e.g. Gray when it can't be used). */
export interface GlossyButton extends PIXI.Container {
    words: PIXI.Text;
    setFrame(frame: string): void;
}

export function glossyButton(width: number, height: number, text: string, frame: string): GlossyButton {
    const { side, top, bottom, capHeight } = BUTTON_SLICE;
    const scale = Math.min(BUTTON_SLICE.scale, height / capHeight);
    const holder = new PIXI.Container() as GlossyButton;
    const back = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), side, top, side, bottom);
    back.scale.set(scale);
    back.width = width / scale;
    back.height = height / scale;
    back.position.set(-width / 2, -height / 2);
    const words = label(Math.round(height * 0.4));
    words.text = text;
    words.y = -3;
    holder.addChild(back, words);
    holder.words = words;
    holder.setFrame = (next: string) => {
        back.texture = PIXI.Texture.from(next);
    };
    return holder;
}

/** A round blue button with an icon on it (the main screen's level arrows, as Ant's). */
export function roundButton(frame: string, icon: string, size: number, iconSize = size * 0.62): PIXI.Container {
    const holder = new PIXI.Container();
    const back = framePlane(frame, size, size, size / 110);
    back.position.set(-size / 2, -size / 2);
    const picture = iconSprite(icon, iconSize);
    picture.y = -size * 0.04;
    holder.addChild(back, picture);
    return holder;
}

/** A glossy button with an icon instead of words (the end card's HOME: a white house on red). */
export function iconButton(width: number, height: number, frame: string, icon: string, iconSize = height * 0.5): GlossyButton {
    const button = glossyButton(width, height, '', frame);
    const picture = iconSprite(icon, iconSize);
    picture.y = -4;
    button.addChild(picture);
    return button;
}

/** Tappable, with a little squash and a sound (`sound`, null for none) when tapped; the tap doesn't reach the field under it. */
export function tappable(button: PIXI.Container, onTap: () => void, sound: Sfx | null = 'click'): void {
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        gsap.fromTo(button.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        if (sound) MobAudio.play(sound);
        onTap();
    });
}
