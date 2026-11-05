// UiParts.ts
//
// The HUD's building blocks, on the UI library's sprites (the ui{tps} atlas): text, sprites, buttons, player avatars and
// leaderboard rows.

import * as PIXI from 'pixi.js';

export const FONT = 'Baloo2-ExtraBold, sans-serif';
export const DARK = 0x10123a;

export const label = (size: number, fill: string | number = 0xffffff): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill, stroke: DARK, strokeThickness: Math.round(size / 5), align: 'center' });
    text.anchor.set(0.5);
    return text;
};

/** A library sprite, centred, fitted to `size` (its longer side). */
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
    ResourceBar_Single_Bg: [11, 11, 11, 11],
    Title_Ribbon04_Red: [150, 0, 150, 0],
    PanelFrame03_Bg: [0, 8, 0, 4],
    PanelFrame03_Oblique: [30, 0, 0, 0],
    CardFrame03_n_Bg: [30, 29, 30, 33],
    CardFrame03_n_InnerBg: [18, 18, 18, 18],
    BorderFrame_Round20_Single_Dark: [20, 20, 20, 22],
    BorderFrame_Round24: [29, 29, 29, 29],
    BasicFrame_Round20: [20, 20, 20, 20],
    Button_Round02_Blue: [23, 29, 23, 26],
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

/** The coins at the top of the screen, on the home screen and the end screen. */
export const COIN_BAR = { width: 190, height: 44, icon: 52, color: 0x1c1d33, textX: 42, textSize: 28, left: 16, top: 48 };

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

/** Words with no outline, for on light frames. */
export const plainLabel = (size: number, fill: string | number): PIXI.Text => {
    const text = new PIXI.Text('', { fontFamily: FONT, fontSize: size, fill });
    text.anchor.set(0.5);
    return text;
};

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
    const words = label(Math.round(height * 0.4));
    words.text = text;
    words.y = -2;
    return [back, words];
}

export function tappable(button: PIXI.Container, onTap: () => void): void {
    button.eventMode = 'static';
    button.cursor = 'pointer';
    // Not a steer of the saucer.
    button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    button.on('pointertap', onTap);
}

/** A dark rounded pill behind a line of text, for depth over the busy world. */
export function pill(): PIXI.NineSlicePlane {
    const plane = framePlane('BorderFrame_Round20_Single_Dark', 44, 46);
    plane.alpha = 0.9;
    return plane;
}

/** An arrow with a dark stroke, pointing up, centred: the stroke's the holder (turn and place that), the fill's on top (tint that). */
export function strokedArrow(size: number): { stroke: PIXI.Sprite; fill: PIXI.Sprite } {
    const stroke = iconSprite('Arrow_Stroke', size);
    stroke.tint = DARK;
    const fill = PIXI.Sprite.from('Arrow_Fill');
    fill.anchor.set(0.5);
    stroke.addChild(fill);
    return { stroke, fill };
}

/** Fits a pill round a centred line of text. */
export function fitPill(plane: PIXI.NineSlicePlane, text: PIXI.Container, padX = 22, padY = 8): void {
    const width = Math.max(44, text.width + padX * 2);
    const height = Math.max(44, text.height + padY * 2);
    plane.width = width;
    plane.height = height;
    plane.position.set(text.x - width / 2, text.y - height / 2);
}

/** What a player looks like: a silly face on a coloured circle. */
export interface PlayerLook {
    name: string;
    face: string;
    color: number;
}

/** A player's face on its coloured circle, `size` across. */
export function makeAvatar(look: PlayerLook, size: number): PIXI.Container {
    const avatar = new PIXI.Container();
    const circle = iconSprite('BorderFrame_Circle60', size);
    circle.tint = look.color;
    avatar.addChild(circle, iconSprite(look.face, size * 0.68));
    return avatar;
}

export const ROW = { width: 232, height: 36 };
/** How the rows' sprite is cut and drawn. */
const ROW_SLICE = { corner: 28, scale: 0.42 };
const MEDALS = ['ItemIcon_Medal_Gold_1', 'ItemIcon_Medal_Silver_1', 'ItemIcon_Medal_Bronze_1'];
const YOU_TEXT = '#4a2a00';
/** The top three: each bigger than the next, first's yellow row deepened to gold, and silver and bronze rows. */
const PODIUM = { scales: [1.15, 1.08, 1.04], gold: 0xffb61e };
/** How big a place's row is drawn. */
export const placeScale = (place: number): number => PODIUM.scales[place - 1] ?? 1;

/**
 * One player on a leaderboard: place (a medal, for the top three), avatar, name and size. The top three's rows are gold,
 * silver and bronze, and bigger, whoever's in them; the player's own is yellow further down, and in the top three its name
 * stands out in white.
 */
export class PlayerRow extends PIXI.Container {
    private readonly back: PIXI.NineSlicePlane;
    private readonly backYou: PIXI.NineSlicePlane;
    private readonly backSilver: PIXI.NineSlicePlane;
    private readonly backBronze: PIXI.NineSlicePlane;
    private readonly medal = iconSprite(MEDALS[0], 32);
    private readonly placeText = label(17);
    private readonly nameText = label(16);
    private readonly sizeText = label(17);
    private avatar: PIXI.Container | null = null;
    private avatarFace = '';
    private place = -1;

    public constructor(width = ROW.width) {
        super();
        const { corner, scale } = ROW_SLICE;
        const plane = (frame: string) => {
            const back = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), corner, corner, corner, corner);
            back.scale.set(scale);
            back.width = width / scale;
            back.height = ROW.height / scale;
            back.position.set(-width / 2, -ROW.height / 2);
            return back;
        };
        this.back = plane('ListFrame04_Single_f_Blue');
        this.backYou = plane('ListFrame04_Single_f_Yellow');
        this.backSilver = plane('ListFrame04_Single_f_Silver');
        this.backBronze = plane('ListFrame04_Single_f_Bronze');
        const left = -width / 2;
        this.medal.x = left + 22;
        this.placeText.x = left + 22;
        this.nameText.anchor.set(0, 0.5);
        this.nameText.x = left + 70;
        this.sizeText.anchor.set(1, 0.5);
        this.sizeText.x = -left - 12;
        this.addChild(this.back, this.backYou, this.backSilver, this.backBronze, this.medal, this.placeText, this.nameText, this.sizeText);
    }

    /** Its size when it isn't bumping. */
    public get baseScale(): number {
        return placeScale(this.place);
    }

    public set(place: number, look: PlayerLook, size: number, you: boolean): void {
        const podium = place <= 3;
        this.back.visible = !you && !podium;
        this.backYou.visible = place === 1 || (you && !podium);
        this.backYou.tint = place === 1 ? PODIUM.gold : 0xffffff;
        this.backSilver.visible = place === 2;
        this.backBronze.visible = place === 3;
        if (place !== this.place) {
            this.place = place;
            this.scale.set(this.baseScale);
            const medal = MEDALS[place - 1];
            this.medal.visible = !!medal;
            this.placeText.visible = !medal;
            if (medal) {
                this.medal.texture = PIXI.Texture.from(medal);
                fitSprite(this.medal, 32);
            } else {
                this.placeText.text = String(place);
            }
        }
        if (look.face !== this.avatarFace) {
            this.avatarFace = look.face;
            this.avatar?.destroy({ children: true });
            this.avatar = makeAvatar(look, 28);
            this.avatar.x = this.medal.x + 28;
            this.addChildAt(this.avatar, 4);
        }
        if (this.nameText.text !== look.name) this.nameText.text = look.name;
        this.setSize(size);
        const darkText = you || podium;
        for (const text of [this.nameText, this.sizeText, this.placeText]) {
            text.style.fill = darkText ? YOU_TEXT : 0xffffff;
            text.style.strokeThickness = darkText ? 0 : 3;
        }
        if (you && podium) {
            this.nameText.style.fill = 0xffffff;
            this.nameText.style.strokeThickness = 3;
        }
    }

    public setSize(size: number): void {
        const text = size.toFixed(1);
        if (this.sizeText.text !== text) this.sizeText.text = text;
    }
}
