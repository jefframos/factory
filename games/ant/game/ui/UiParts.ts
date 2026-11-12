// UiParts.ts
//
// The UI's building blocks, on the Layer Lab pack's sprites (the ui{tps} atlas, see tools/ui-kit/README.md): text,
// sprites, stretched frames, glossy buttons. Taken from the UFO game's (games/ufo/game/ui/UiParts.ts), trimmed to what
// Ant uses. Sizes are in the 720 x 1080 design (Game.DESIGN_WIDTH / HEIGHT).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { AntAudio, Sfx } from '../audio/AntAudio';
import { POPUP_LOOK, Pattern } from './Pattern';

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
    Button_Round02_White_Bg: [23, 23, 23, 26],
    Button_Round02_White_Light: [18, 0, 18, 0],
};

/** The game's cozy colours (the floor's peach and the tray's cream, not the UI pack's blues). */
export const COZY = {
    cream: 0xf8e9d2, peach: 0xeccba0, tan: 0xd9a877, brown: 0x9a6440, deepBrown: 0x6b4430, coral: 0xef7f5a,
    orange: 0xf3a35f, orangeLight: 0xffd9a8,
    /** A power-up's round button (its full-colour icon on it). */
    powerFace: 0xfff1dc, green: 0x4cb860, greenLight: 0xb8efb0, ink: 0x5a3a22, dim: 0x2a1810,
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
    // (The pack's blue round button: its big white rounded one (Button_Round06_White, 94 x 96: only ever shrunk, so it
    // stays sharp) in the game's warm orange, at its own proportions. A plain sprite: the packer may turn it on its side.)
    if (frame === 'Button_Round02_Blue') {
        const body = PIXI.Sprite.from('Button_Round06_White');
        body.anchor.set(0.5);
        body.width = size;
        body.height = size * (96 / 94);
        body.tint = COZY.orange;
        body.name = 'body';
        holder.addChild(body);
    } else {
        const back = framePlane(frame, size, size, size / 110);
        back.position.set(-size / 2, -size / 2);
        holder.addChild(back);
    }
    const picture = iconSprite(icon, iconSize);
    picture.y = -size * 0.04;
    picture.name = 'icon';
    holder.addChild(picture);
    return holder;
}

/**
 * A round button: the UI pack's circle (BorderFrame_Circle75_Bg: a white face with its dark outline and lip, tinted
 * `colour`) with its shine across the top (BorderFrame_Circle75_Light), and `icon` on it (none: ''). Its face is named
 * 'face' (retint it: setCircleColour).
 */
export function circleButton(icon: string, size: number, colour: number = COZY.orange, iconSize = size * 0.58): PIXI.Container {
    const holder = new PIXI.Container();
    const face = PIXI.Sprite.from('BorderFrame_Circle75_Bg');
    face.anchor.set(0.5);
    face.width = size;
    face.height = size * (75 / 72);
    face.tint = colour;
    face.name = 'face';
    const shine = PIXI.Sprite.from('BorderFrame_Circle75_Light');
    shine.anchor.set(0.5, 0);
    shine.width = size * (64 / 72);
    shine.height = size * (40 / 72);
    shine.y = -face.height / 2 + size * 0.05;
    shine.alpha = 0.9;
    holder.addChild(face, shine);
    if (icon) {
        const picture = iconSprite(icon, iconSize);
        picture.y = -size * 0.03;
        picture.name = 'icon';
        holder.addChild(picture);
    }
    return holder;
}

/** A circleButton's face in another colour. */
export function setCircleColour(button: PIXI.Container, colour: number): void {
    const face = button.getChildByName('face') as PIXI.Sprite | null;
    if (face) face.tint = colour;
}

/** Mob's popups' close: the pack's red round button with the cross on it, `size` across (place it on a corner). */
export function closeButton(size = 64): PIXI.Container {
    const button = new PIXI.Container();
    button.addChild(iconSprite('Button_Round06_Red', size), iconSprite('Icon_Close02', size * 0.5));
    return button;
}

/** A popup's box, as Mob's: a warm brown frame, the moving cozy pattern inside it, `width` x `height`, centred. */
export function popupBox(width: number, height: number): PIXI.Container {
    const holder = new PIXI.Container();
    const frame = framePlane('BorderFrame_Round24', width, height, 1);
    frame.tint = COZY.brown;
    frame.position.set(-width / 2, -height / 2);
    const inset = 9;
    const pattern = new Pattern(POPUP_LOOK);
    pattern.place(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2);
    const mask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-width / 2 + inset, -height / 2 + inset, width - inset * 2, height - inset * 2, 20).endFill();
    pattern.mask = mask;
    holder.addChild(frame, pattern, mask);
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
