// Tray.ts
//
// What's bought, as the Layer Lab pack's item cards: small squares, their picture big on a glow, the price over its foot.
// PUNCH HARDER's and the crew's (the newest first, and the next one to come as a silhouette; they slide sideways when there's
// no room), the boosts there are (the row above, for bricks: what each makes better and how much), the cash and the bricks.
// Upright: along the bottom, the money at the top. On a wide screen: two columns on the right, everything in sight.
//
// A card that can be had shines and its picture wriggles; one that can't fills up with the money there is. It buys as it's
// let go; held, it goes on buying.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { BoostDef, CREW, CrewDef, NUDGE, SHOWS, punchCost, punchMult, short, toolAt, toolRarity } from '../data/WallConfig';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { BUY_MODES, BuyMode, WallProgress } from '../data/WallProgress';
import { WallAudio } from '../audio/WallAudio';
import { HIT_PILL } from './HitPill';
import { FillButton, button, flag, frame, plainText, sprite, text, write } from './parts';

/** (As many as fit, and the next one peeking in.) */
const CARD = { size: 134, height: 164, gap: 11, side: 14, margin: 32, icon: 80 };
const BADGE = { width: 222, height: 104, gap: 11, shown: 3, upright: 2, icon: 62 };
/** What a hit does (HitPill): this far over PUNCH HARDER's card. */
const HIT_GAP = 26;
/** Between the cards and the row above; on a wide screen the cards are this much bigger. */
const ROW_GAP = 22;
const WIDE_SCALE = 1;
/** The buttons that say there's more (round, an arrow in them), and the slider under the cards. */
const ARROW = { size: 60, icon: 32, inset: 40, nudge: 6 };
const BAR = { height: 14, thumb: 8, below: 13 };
/** PUNCH HARDER's card, on its own: bigger than the others. The panel the others are in: round them, and off it. */
const PUNCH = { scale: 1.17, gap: 26, down: 20 };
/** What's spent flies from its bar to what's bought, and what's won to its bar: how many, how big, how long (seconds), and how many at most at once. */
const FLY = { spent: 4, won: 7, free: 10, size: 50, seconds: 0.42, every: 0.045, most: 30 };
const MONEY = 'ItemIcon_Money_Bill';
const BRICK = 'Wall_brick';
const PANEL = { pad: 11, top: 13, foot: 26, color: 0x15162a, alpha: 0.55 };
const PILL = { height: 42, cash: 246, bricks: 124, gap: 34, y: 44 };
/** A boost's price: a brick and how many, in a pill that fills with those there are. */
/** A boost's price bar: kept off the badge's bottom edge (its frame's border). */
const BRICKS = { width: 118, height: 30, y: 25 };
const PILL_COLOR = 0x1c1d33;
/** The strip that fills up with the money there is. */
const STRIP = { width: CARD.size - 22, height: 36, y: 55 };
/** A picture that can be had wriggles now and then. */
const WRIGGLE = { every: 1.7, seconds: 0.5, turn: 0.13, grow: 0.07 };
const HOLD = { after: 0.35, every: 0.11 };
const DRAG = 14;
/** The mark on what can be bought: its size, how far in from its card's corner, how high it hops. */
const ALERT = { size: 30, in: 14, down: 12, hop: 6 };
type Frame = 'Blue' | 'Green' | 'Purple' | 'Yellow' | 'Navy' | 'Gray' | 'Red' | 'Hologram1';

export interface TrayActions {
    punch(): boolean;
    hire(def: CrewDef): boolean;
    boost(boost: BoostDef): boolean;
}

/** Upright, how far up the screen the cards and the boosts over them come (the HUD's units). */
export const TRAY_TOP = CARD.margin + CARD.height + PANEL.top + ROW_GAP + BADGE.height;

interface Look {
    /** Its colour. */
    frame: Frame;
    icon: string;
    /** Its metal's colour (a tool). */
    tint?: string;
    /** In its corner: how many. */
    count: string;
    effect: string;
    price: string;
    can: boolean;
    /** How much of the price there is (0 to 1). */
    share: number;
    /** A flag on its top edge. */
    tail?: string;
    /** An exclamation mark on its corner: it can be bought. */
    alert?: boolean;
    /** Not there yet (the next of the crew): its picture dark, its wall where the price goes. */
    locked?: boolean;
}

/** Each animal's card colour, by how good it is (CREW's order): green, blue, purple, gold, red. */
const CREW_GRADES: Frame[] = ['Green', 'Green', 'Blue', 'Blue', 'Purple', 'Purple', 'Yellow', 'Yellow', 'Red', 'Red'];

/**
 * The buy mode's menu: its round button (☰), and the tabs that slide out of it to the right (x1, x10, MAX), each `tab` wide,
 * `gap` apart, `height` high; how long the slide takes. `row`: the room it takes between the boosts and the crew (upright).
 */
const MENU = { size: 42, tab: { width: 82, height: 42 }, gap: 6, slide: 0.25 };
/** The tabs' whole width, out. */
const TABS_WIDTH = 3 * (MENU.tab.width + MENU.gap) + MENU.gap;
const BUY_WORDS: Record<BuyMode, string> = { 1: 'x1', 10: 'x10', 0: 'MAX' };

/** A small round button with three bars (☰): opens and closes the buy mode's tabs. */
function burgerButton(toggle: () => void): PIXI.Container {
    const made = new PIXI.Container();
    const back = sprite('Button_Circle122', MENU.size);
    back.tint = 0x3a3f6e;
    const bars = new PIXI.Graphics();
    for (const y of [-7, 0, 7]) bars.beginFill(0xffffff).drawRoundedRect(-9, y - 1.75, 18, 3.5, 1.75).endFill();
    made.addChild(back, bars);
    made.eventMode = 'static';
    made.cursor = 'pointer';
    made.hitArea = new PIXI.Circle(0, 0, MENU.size / 2 + 8);
    made.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        toggle();
        gsap.fromTo(made.scale, { x: 0.8, y: 0.8 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
    });
    return made;
}

/**
 * The buy mode's tabs: x1, x10, MAX side by side, the one picked a lit button, the others dark; tapped, that one's picked.
 * They slide out to the right of where they're put (the menu's button's right edge) and back in under a mask.
 */
class ModeTabs extends PIXI.Container {
    private readonly strip = new PIXI.Container();
    private readonly cover = new PIXI.Graphics();
    private readonly tabs = BUY_MODES.map((mode) => {
        const tab = new PIXI.Container();
        const back = button('DarkGray', MENU.tab.width, MENU.tab.height);
        const words = text(BUY_WORDS[mode], 24, 0xffffff, 0x100e18, 6);
        words.y = -3;
        tab.addChild(back, words);
        tab.eventMode = 'static';
        tab.cursor = 'pointer';
        tab.hitArea = new PIXI.Rectangle(-MENU.tab.width / 2, -MENU.tab.height / 2 - 4, MENU.tab.width, MENU.tab.height + 8);
        tab.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            if (!this.open || WallProgress.buyMode === mode) return;
            WallProgress.setBuyMode(mode);
            WallAudio.play('claim', 0.5, 1.3);
            gsap.fromTo(tab.scale, { x: 0.88, y: 0.88 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        });
        return { mode, tab, back };
    });
    private readonly width_ = BUY_MODES.length * (MENU.tab.width + MENU.gap) + MENU.gap;
    public open = false;
    private shown?: BuyMode;

    public constructor() {
        super();
        this.tabs.forEach(({ tab }, i) => (tab.x = MENU.gap + MENU.tab.width / 2 + i * (MENU.tab.width + MENU.gap)));
        this.cover.beginFill(0xffffff).drawRect(0, -MENU.tab.height / 2 - 8, this.width_, MENU.tab.height + 16).endFill();
        this.strip.addChild(...this.tabs.map(({ tab }) => tab));
        this.strip.mask = this.cover;
        this.strip.x = -this.width_;
        this.addChild(this.strip, this.cover);
        this.refresh();
    }

    /** Out (slid to the right) or in (back under the button). */
    public setOpen(open: boolean): void {
        this.open = open;
        gsap.killTweensOf(this.strip);
        gsap.to(this.strip, { x: open ? 0 : -this.width_, duration: MENU.slide, ease: open ? 'back.out(1.4)' : 'power2.in' });
    }

    public refresh(): void {
        const mode = WallProgress.buyMode;
        if (mode === this.shown) return;
        this.shown = mode;
        for (const { mode: one, back } of this.tabs) back.texture = PIXI.Texture.from(`Button01_s_${one === mode ? 'Yellow' : 'DarkGray'}`);
    }
}

const itemFrame = (color: Frame, width: number, height: number) => frame(`ItemFrame02_Single_${color}`, [25, 28, 25, 27], width, height);

/** A shake of the head. */
function refuse(what: PIXI.Container): void {
    gsap.killTweensOf(what.pivot);
    gsap.fromTo(what.pivot, { x: 9 }, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.2)' });
}

/** What's on a picture now: a wriggle every so often. */
function wriggle(clock: number): { turn: number; grow: number } {
    const t = (clock % WRIGGLE.every) / WRIGGLE.seconds;
    if (t > 1) return { turn: 0, grow: 1 };
    const fade = Math.sin(t * Math.PI);
    return { turn: Math.sin(t * Math.PI * 5) * WRIGGLE.turn * fade, grow: 1 + WRIGGLE.grow * fade };
}

/** A card's picture, off its middle. */
const PICTURE_Y = -24;

class Card extends PIXI.Container {
    private readonly focus = frame('ItemFrame_FocusLine', [36, 35, 36, 35], CARD.size + 14, CARD.height + 14);
    private readonly back = itemFrame('Blue', CARD.size, CARD.height);
    private readonly glow = sprite('ItemFrame_BgGlow', CARD.size - 14);
    private readonly picture = new PIXI.Container();
    private readonly icon = new PIXI.Sprite();
    private readonly metal = new PIXI.Sprite();
    private readonly corner = frame('BasicFrame_Round12', [12, 12, 12, 12], 56, 32, 0.8);
    private readonly count = text('', 23, 0xffffff);
    private readonly effect = plainText('', 19, 0xffec82);
    /** The price: a button that fills as the cash comes (full: press it). */
    private readonly bar = new FillButton(STRIP.width, STRIP.height, 'Yellow');
    private readonly price = text('', 29, 0xffffff, 0x100e18, 7);
    private readonly tailText = text('', 21, 0xffffff);
    private readonly tail = flag(this.tailText, 88);
    private readonly alert = sprite('Icon_Exclamation', ALERT.size);
    private shown = '';
    private can = false;
    private clock = Math.random() * WRIGGLE.every;
    /** Shown locked last time (the next of the crew). */
    public locked = false;

    public constructor() {
        super();
        this.glow.alpha = 0.42;
        this.glow.y = -18;
        this.icon.anchor.set(0.5);
        this.metal.anchor.set(0.5);
        this.picture.y = PICTURE_Y;
        this.picture.addChild(this.icon, this.metal);
        this.price.y = STRIP.y - 2;
        this.corner.tint = 0x0a1446;
        this.corner.alpha = 0.38;
        this.corner.position.set(-CARD.size / 2 + 7, -CARD.height / 2 + 9);
        this.count.position.set(-CARD.size / 2 + 35, -CARD.height / 2 + 24);
        this.effect.y = 20;
        this.bar.y = STRIP.y;
        this.tail.y = -CARD.height / 2;
        this.addChild(this.focus, this.back, this.glow, this.picture, this.corner, this.count, this.effect, this.bar, this.price, this.tail, this.alert);
    }

    public set(look: Look): void {
        // (In steps a pixel wide.)
        look.share = Math.round(Math.max(0, Math.min(1, look.share)) * STRIP.width) / STRIP.width;
        const key = JSON.stringify(look);
        if (key === this.shown) return;
        this.shown = key;
        this.back.texture = PIXI.Texture.from(`ItemFrame02_Single_${look.frame}`);
        this.icon.texture = PIXI.Texture.from(look.icon);
        this.icon.scale.set(CARD.icon / Math.max(this.icon.texture.width, this.icon.texture.height, 1));
        // (Locked: a silhouette, and no glow behind it.)
        this.locked = !!look.locked;
        this.icon.tint = look.locked ? 0x000000 : 0xffffff;
        this.icon.alpha = look.locked ? 0.55 : 1;
        this.glow.visible = !look.locked;
        this.metal.visible = !!look.tint;
        if (look.tint) {
            this.metal.texture = PIXI.Texture.from(`${look.icon}_metal`);
            this.metal.scale.copyFrom(this.icon.scale);
            this.metal.tint = PIXI.utils.string2hex(look.tint);
        }
        this.corner.visible = this.count.visible = !!look.count;
        write(this.count, look.count, 48);
        write(this.effect, look.effect, CARD.size - 16);
        // (Full, it's the whole button.)
        this.bar.set(look.can ? 1 : look.share);
        write(this.price, look.price, CARD.size - 28);
        // (Under the flag, if it has one.)
        this.corner.y = -CARD.height / 2 + (look.tail ? 20 : 9);
        this.count.y = -CARD.height / 2 + (look.tail ? 35 : 24);
        this.tail.visible = !!look.tail;
        this.alert.visible = !!look.alert;
        if (look.tail) write(this.tailText, look.tail, 72);
        this.focus.visible = look.can;
        if (look.can !== this.can) {
            this.can = look.can;
            if (look.can) this.bump(1.12);
        }
    }

    public update(delta: number): void {
        this.clock += delta;
        const { turn, grow } = this.can ? wriggle(this.clock) : { turn: 0, grow: 1 };
        this.picture.rotation = turn;
        this.picture.scale.set(grow);
        if (this.can) this.focus.alpha = 0.65 + 0.35 * Math.sin(this.clock * 5);
        if (this.alert.visible) this.alert.position.set(CARD.size / 2 - ALERT.in, -CARD.height / 2 + ALERT.down - Math.abs(Math.sin(this.clock * 5)) * ALERT.hop);
        if (this.tail.visible) this.tail.y = -CARD.height / 2 + Math.sin(this.clock * 4) * 2;
    }

    public bump(to = 1.16): void {
        gsap.killTweensOf(this.scale);
        this.scale.set(to);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
    }

    /** Bought: a jump, its picture thrown up. */
    public bought(): void {
        this.bump();
        gsap.killTweensOf(this.picture);
        gsap.fromTo(this.picture, { y: PICTURE_Y - 28 }, { y: PICTURE_Y, duration: 0.45, ease: 'bounce.out' });
    }

    public refuse(): void {
        refuse(this);
    }
}

class Badge extends PIXI.Container {
    private readonly focus = frame('ItemFrame_FocusLine', [36, 35, 36, 35], BADGE.width + 14, BADGE.height + 14);
    private readonly back = itemFrame('Yellow', BADGE.width, BADGE.height);
    private readonly glow = sprite('ItemFrame_BgGlow', BADGE.height);
    private readonly icon = new PIXI.Sprite();
    private readonly what = text('', 23, 0xffffff, 0x100e18, 6);
    private readonly value = text('', 23, 0xffec82, 0x100e18, 6);
    private readonly price = text('', 25, 0xffffff, 0x100e18, 6);
    /** The price in bricks: a button that fills as they come (full: press it). */
    private readonly bar = new FillButton(BRICKS.width, BRICKS.height, 'Green');
    private readonly brick = sprite('Wall_brick', 31);
    private clock = Math.random() * WRIGGLE.every;
    private can = false;
    public boost?: BoostDef;

    public constructor() {
        super();
        this.glow.alpha = 0.5;
        this.icon.anchor.set(0.5);
        this.icon.x = this.glow.x = -BADGE.width / 2 + 48;
        const left = -BADGE.width / 2 + 92;
        [this.what, this.value, this.price].forEach((label) => label.anchor.set(0, 0.5));
        this.what.position.set(left, -32);
        this.value.position.set(left, -7);
        this.bar.position.set(left - 4 + BRICKS.width / 2, BRICKS.y);
        this.brick.position.set(left + 20, BRICKS.y - 1);
        this.price.position.set(left + 46, BRICKS.y - 2);
        this.addChild(this.focus, this.back, this.glow, this.icon, this.what, this.value, this.bar, this.brick, this.price);
    }

    public set(boost: BoostDef): void {
        if (boost !== this.boost) {
            this.boost = boost;
            this.icon.texture = PIXI.Texture.from(boost.icon);
            write(this.what, boost.what, BADGE.width - 106);
            write(this.value, boost.value, BADGE.width - 106);
            this.price.text = String(boost.bricks);
            gsap.killTweensOf(this.scale);
            this.scale.set(0.2);
            gsap.to(this.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.2)' });
        }
        this.can = WallProgress.bricks >= boost.bricks;
        this.back.texture = PIXI.Texture.from(`ItemFrame02_Single_${this.can ? 'Yellow' : 'Navy'}`);
        this.bar.set(Math.min(1, WallProgress.bricks / boost.bricks));
        this.focus.visible = this.can;
    }

    public update(delta: number): void {
        this.clock += delta;
        const { turn, grow } = this.can ? wriggle(this.clock) : { turn: 0, grow: 1 };
        this.icon.rotation = turn;
        this.icon.scale.set((BADGE.icon * grow) / Math.max(this.icon.texture.width, this.icon.texture.height, 1));
        this.focus.alpha = 0.65 + 0.35 * Math.sin(this.clock * 5);
    }

    public bump(to: number): void {
        gsap.killTweensOf(this.scale);
        this.scale.set(to);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
    }

    public refuse(): void {
        refuse(this);
    }
}

/** A round button with an arrow, pointing right (1) or left (-1). */
function arrowButton(way: number): PIXI.Container {
    const made = new PIXI.Container();
    const back = sprite('BorderFrame_Circle78', ARROW.size);
    back.tint = 0x2f8bff;
    const icon = sprite('Icon_Arrow_Next1', ARROW.icon);
    icon.scale.x *= way;
    icon.position.set(way * 3, -1);
    made.addChild(back, icon);
    return made;
}

/** A resource bar, its icon over its end. */
function pill(width: number, icon: string): PIXI.Container {
    const made = new PIXI.Container();
    const back = frame('ResourceBar_Single_Bg', [11, 11, 11, 11], width, PILL.height);
    back.tint = PILL_COLOR;
    const picture = sprite(icon, 58);
    picture.position.set(-width / 2 + 12, -2);
    made.addChild(back, picture);
    made.eventMode = 'none';
    return made;
}

export class Tray extends PIXI.Container {
    private readonly cash = pill(PILL.cash, 'ItemIcon_Money_Bill');
    private readonly cashText = text('0', 29, 0xffffff, 0x100e18, 6);
    private readonly rateText = text('', 20, 0xbaff8c, 0x100e18, 5);
    private readonly bricks = pill(PILL.bricks, 'Wall_brick');
    private readonly bricksText = text('0', 29, 0xffffff, 0x100e18, 6);
    private readonly punch = new Card();
    private readonly list = new PIXI.Container();
    private readonly listMask = new PIXI.Graphics();
    private readonly crew = CREW.map(() => new Card());
    private readonly badges = Array.from({ length: BADGE.shown }, () => new Badge());
    private readonly hand = PIXI.Sprite.from('handHud');
    /** x1 / x10 / MAX: how many of the crew a tap hires. */
    private readonly mode = new ModeTabs();
    private modeOn = false;
    /** The buy mode's toggle shown (the menu's button opens and closes it). */
    private modeOpen = false;
    /** Upright: the boosts' row (its y), where they start from at the left at the most (past the menu), and how far they've slid
     * aside for the tabs (0 to 1). */
    private badgeRow = 0;
    private badgeLeft = 0;
    private readonly badgeSlide = { t: 0 };
    private readonly menu = burgerButton(() => {
        this.modeOpen = !this.modeOpen;
        WallAudio.play('claim', 0.5, this.modeOpen ? 1.2 : 1);
        this.mode.setOpen(this.modeOpen);
        // (Upright, the boosts make way for the tabs, and come back as they go.)
        gsap.killTweensOf(this.badgeSlide);
        gsap.to(this.badgeSlide, { t: this.modeOpen ? 1 : 0, duration: MENU.slide, ease: this.modeOpen ? 'power2.out' : 'power2.in' });
    });
    /** The cards and what goes with them (smaller on a wide screen). */
    private readonly cards = new PIXI.Container();
    private readonly arrows = [1, -1].map((way) => arrowButton(way));
    private readonly scrollBar = new PIXI.Container();
    private readonly track = frame('BasicFrame_Round12', [12, 12, 12, 12], 60, BAR.height, 0.5);
    private readonly thumb = frame('BasicFrame_Round12', [12, 12, 12, 12], 60, BAR.thumb, 0.32);
    private readonly panel = frame('BasicFrame_Round12', [12, 12, 12, 12], 60, 60, 1.4);
    private readonly punchBox = new PIXI.Container();
    private screenRight = 0;
    /** Bills and bricks in the air. */
    private flying = 0;
    private clock = 0;
    private listWidth = 0;
    private shownCash = 0;
    private shownBricks = 0;
    private order: Card[] = [];
    private wide = false;
    private left = 0;
    private listY = 0;
    private scroll = 0;
    private scrollMax = 0;
    private held?: { card: Card; buy: () => boolean; x: number; y: number; scroll: number; time: number; bought: boolean; dragged: boolean };
    private readonly stopListening: () => void;
    private dirty = true;
    /** How long something's been there to buy, left. */
    private left_ = 0;
    /** What the hand points at, if it's the nudge. */
    private nudged?: Card | Badge;
    private pulse = 0;

    public constructor(private readonly actions: TrayActions) {
        super();
        this.cashText.anchor.set(0, 0.5);
        this.cashText.position.set(-PILL.cash / 2 + 50, -1);
        this.rateText.anchor.set(1, 0.5);
        this.rateText.position.set(PILL.cash / 2 - 14, 0);
        this.cash.addChild(this.cashText, this.rateText);
        this.bricksText.anchor.set(0, 0.5);
        this.bricksText.position.set(-PILL.bricks / 2 + 52, -1);
        this.bricks.addChild(this.bricksText);
        this.list.mask = this.listMask;
        this.list.addChild(...this.crew);
        this.hand.width = this.hand.height = 84;
        this.hand.visible = false;
        this.mode.visible = false;
        this.menu.visible = false;
        this.hand.eventMode = 'none';
        gsap.to(this.hand.pivot, { y: -60, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.track.tint = 0x100e18;
        this.panel.tint = PANEL.color;
        this.panel.alpha = PANEL.alpha;
        this.panel.eventMode = 'none';
        this.punchBox.addChild(this.punch);
        this.punchBox.scale.set(PUNCH.scale);
        this.thumb.tint = 0x3fa9ff;
        this.scrollBar.addChild(this.track, this.thumb);
        this.scrollBar.eventMode = 'none';
        this.cards.addChild(this.panel, this.listMask, this.list, this.punchBox, this.scrollBar, ...this.arrows, this.mode, this.menu, this.hand);
        this.addChild(this.cash, this.bricks, ...this.badges, this.cards);
        this.cards.eventMode = 'passive';
        this.arrows.forEach((arrow, i) => {
            arrow.eventMode = 'static';
            arrow.cursor = 'pointer';
            // (Easy to hit: bigger than it looks.)
            arrow.hitArea = new PIXI.Circle(0, 0, ARROW.size * 0.72);
            arrow.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                const to = this.scroll + (i === 0 ? 1 : -1) * (CARD.size + CARD.gap) * 2;
                const from = { scroll: this.scroll };
                gsap.to(from, { scroll: to, duration: 0.3, ease: 'power2.out', onUpdate: () => this.setScroll(from.scroll) });
            });
        });
        this.holdable(this.punch, () => this.actions.punch());
        CREW.forEach((def, i) => this.holdable(this.crew[i], () => this.actions.hire(def)));
        for (const badge of this.badges) {
            badge.visible = false;
            badge.eventMode = 'static';
            badge.cursor = 'pointer';
            badge.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                const { boost } = badge;
                if (!boost) return;
                if (this.actions.boost(boost)) {
                    this.tell(badge);
                    this.spent(BRICK, boost.bricks, badge);
                } else {
                    badge.refuse();
                    this.lacking(this.bricks);
                }
            });
        }
        this.eventMode = 'passive';
        this.shownCash = WallProgress.cash;
        this.shownBricks = WallProgress.bricks;
        this.stopListening = WallProgress.onChange(() => (this.dirty = true));
    }

    // ---------------------------------------------------------------- buying

    private holdable(card: Card, buy: () => boolean): void {
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            // (Not a punch too.)
            event.stopPropagation();
            const at = this.toLocal(event.global);
            this.held = { card, buy, x: at.x, y: at.y, scroll: this.scroll, time: 0, bought: false, dragged: false };
        });
        card.on('globalpointermove', (event: PIXI.FederatedPointerEvent) => {
            const held = this.held;
            if (held?.card !== card || card === this.punch) return;
            const moved = this.toLocal(event.global).x - held.x;
            if (Math.abs(moved) > DRAG && this.scrollMax > 0 && !held.bought) held.dragged = true;
            if (held.dragged) this.setScroll(held.scroll - moved);
        });
        card.on('pointerup', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            const held = this.held;
            this.held = undefined;
            if (held?.card === card && !held.dragged && !held.bought) this.buy(card, buy);
        });
        card.on('pointerupoutside', () => (this.held = undefined));
    }

    private buy(card: Card, buy: () => boolean): boolean {
        const before = WallProgress.cash;
        const done = buy();
        if (done) {
            this.tell(card);
            card.bought();
            this.spent(MONEY, before - WallProgress.cash, card);
        } else {
            card.refuse();
            this.lacking(this.cash);
        }
        return done;
    }

    // ---------------------------------------------------------------- where it goes, where it comes from

    /** Paid: out of its bar, to what's bought. */
    private spent(icon: string, amount: number, on: PIXI.Container): void {
        if (amount <= 0) return;
        const money = icon === MONEY;
        const bar = money ? this.cash : this.bricks;
        const start = new PIXI.Point(bar.x - (money ? PILL.cash : PILL.bricks) / 2 + 12, bar.y);
        this.fly(icon, FLY.spent, () => start, this.toLocal(new PIXI.Point(0, 0), on), 0);
        this.jolt(bar, 1.14);
        const label = text(money ? `-$${short(amount)}` : `-${amount}`, 34, 0xff6a5a, 0x3a0a08, 7);
        label.eventMode = 'none';
        label.position.set(bar.x + 14, bar.y + 34);
        this.addChild(label);
        gsap.to(label, { y: label.y + 26, duration: 0.8, ease: 'power1.out' });
        gsap.to(label, { alpha: 0, duration: 0.3, delay: 0.5, onComplete: () => {
            gsap.killTweensOf(label);
            label.destroy();
        } });
    }

    /** Where PUNCH HARDER's card is, and one of the crew's (the HUD's units). */
    public get punchAt(): PIXI.Point {
        return this.toLocal(new PIXI.Point(0, 0), this.punch);
    }
    public crewAt(kind: number): PIXI.Point {
        return this.toLocal(new PIXI.Point(0, 0), this.crew[kind]);
    }

    /** Where what a hit does goes: over PUNCH HARDER's card. */
    public get hitSpot(): PIXI.Point {
        const { x, y } = this.cards;
        const scale = this.wide ? this.cards.scale.x : 1;
        return new PIXI.Point(x + this.punchBox.x * scale, y + (this.punchBox.y - (CARD.height * this.punchBox.scale.y) / 2) * scale - HIT_GAP - HIT_PILL.height / 2);
    }

    /** Upright, how far up the screen it comes now (the HUD's units): nothing to buy yet, the cards, the boosts over them. */
    public get topNow(): number {
        if (!this.punch.visible) return 0;
        return WallProgress.best < SHOWS.boosts ? CARD.margin + CARD.height + PANEL.top : TRAY_TOP;
    }

    /** Won: from around (x, y) to the bars. */
    public won(from: PIXI.Point): void {
        const apart = () => new PIXI.Point(from.x + (Math.random() - 0.5) * 300, from.y + (Math.random() - 0.5) * 260);
        this.fly(MONEY, FLY.won, apart, new PIXI.Point(this.cash.x - PILL.cash / 2 + 12, this.cash.y), 0.25, () => this.jolt(this.cash, 1.1));
        this.fly(BRICK, Math.round(FLY.won * 0.6), apart, new PIXI.Point(this.bricks.x - PILL.bricks / 2 + 12, this.bricks.y), 0.35, () => this.jolt(this.bricks, 1.1));
    }

    /** Free cash: a burst of bills from (x, y) to its bar. */
    public gotCash(from: PIXI.Point): void {
        const apart = () => new PIXI.Point(from.x + (Math.random() - 0.5) * 120, from.y + (Math.random() - 0.5) * 90);
        this.fly(MONEY, FLY.free, apart, new PIXI.Point(this.cash.x - PILL.cash / 2 + 12, this.cash.y), 0.05, () => this.jolt(this.cash, 1.12));
    }

    /** Not enough of it: its bar shakes, red. */
    private lacking(bar: PIXI.Container): void {
        gsap.killTweensOf(bar.pivot);
        gsap.fromTo(bar.pivot, { x: 12 }, { x: 0, duration: 0.4, ease: 'elastic.out(1, 0.2)' });
        const back = bar.children[0] as PIXI.NineSlicePlane;
        back.tint = 0xc22f2f;
        gsap.delayedCall(0.35, () => {
            if (!back.destroyed) back.tint = PILL_COLOR;
        });
    }

    private jolt(bar: PIXI.Container, to: number): void {
        gsap.killTweensOf(bar.scale);
        bar.scale.set(to);
        gsap.to(bar.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.5)' });
    }

    private fly(icon: string, count: number, from: () => PIXI.Point, to: PIXI.Point, wait: number, landed?: () => void): void {
        for (let i = 0; i < count && this.flying < FLY.most; i++) {
            const made = sprite(icon, FLY.size);
            const size = made.scale.x;
            const start = from();
            const bow = { x: (start.x + to.x) / 2 + (Math.random() - 0.5) * 160, y: (start.y + to.y) / 2 + (Math.random() - 0.5) * 80 };
            made.eventMode = 'none';
            made.visible = false;
            this.addChild(made);
            this.flying++;
            const state = { t: 0 };
            gsap.to(state, { t: 1, duration: FLY.seconds, delay: wait + i * FLY.every, ease: 'power1.in', onStart: () => {
                made.visible = true;
            }, onUpdate: () => {
                const { t } = state;
                const u = 1 - t;
                made.position.set(u * u * start.x + 2 * u * t * bow.x + t * t * to.x, u * u * start.y + 2 * u * t * bow.y + t * t * to.y);
                made.rotation = (1 - t) * 0.7 * (i % 2 ? 1 : -1);
                made.scale.set(size * Math.min(1, t * 6 + 0.3) * (1 - 0.25 * t));
            }, onComplete: () => {
                this.flying--;
                made.destroy();
                landed?.();
            } });
        }
    }

    /** The first three cards by key (1, 2, 3). */
    public buyNumber(n: number): void {
        if (n === 0) {
            if (this.punch.visible) this.buy(this.punch, () => this.actions.punch());
            return;
        }
        const place = this.crew.indexOf(this.order[n - 1]);
        if (place >= 0) this.buy(this.crew[place], () => this.actions.hire(CREW[place]));
    }

    // ---------------------------------------------------------------- what's shown

    private refresh(): void {
        this.dirty = false;
        const level = WallProgress.punchLevel;
        const gift = WallProgress.giftWaiting;
        // Nothing to buy before the first wall's down.
        const there = level > 0 || gift;
        if (there && !this.punch.visible) this.punch.bump(0.4);
        this.punch.visible = there;
        if (there) {
            const tool = toolAt(level);
            const next = toolAt(level + 1);
            const can = WallProgress.canPunchHarder;
            const newTool = next.id !== tool.id;
            this.punch.set({
                // (The frame: the rarity of what's in hand, as far as it's been made better; buying shows on the focus line.)
                frame: toolRarity(level).frame,
                icon: `Wall_${newTool ? next.base : tool.base}`,
                tint: newTool ? next.tint : tool.tint,
                count: level > 0 ? `LV${level}` : '',
                effect: `x${punchMult(level)} HIT`,
                price: gift ? 'FREE!' : `$${short(punchCost(level))}`,
                can,
                share: gift ? 1 : WallProgress.cash / punchCost(level),
                tail: gift ? 'FREE!' : newTool ? 'NEW!' : 'PUNCH',
                alert: can,
            });
        }
        this.refreshCrew();
        this.refreshBadges();
        this.arrange();
        // A hand for the first things to buy (the very first are given).
        const chick = CREW[0];
        const first = WallProgress.rewinds === 0;
        const point = first && level === 1 && WallProgress.canPunchHarder ? this.punch
            : first && WallProgress.owned(chick.id) === 1 && WallProgress.cash >= WallProgress.costOf(chick) ? this.crew[0] : undefined;
        // (The nudge has it.)
        if (this.nudged) return;
        this.hand.visible = !!point;
        if (point) {
            const box = point === this.punch ? this.punchBox : this.list;
            this.hand.position.set(box.x + point.x + 26, box.y + point.y + 10);
        }
    }

    private kindOf(card: Card | Badge): string {
        return card instanceof Badge ? 'boost' : card === this.punch ? 'punch' : 'crew';
    }

    /** Bought: was it what the hand points at? And that kind's learnt: no hand for it again. */
    private tell(card: Card | Badge): void {
        this.left_ = 0;
        if (this.nudged === card) WallAnalytics.nudge(this.kindOf(card), 'bought');
        WallProgress.markStep(this.learnt(card));
    }

    /** The step that says a kind's been bought by the player once (a boost: any of them; the crew: each animal). */
    private learnt(card: Card | Badge): string {
        const place = card instanceof Card ? this.crew.indexOf(card) : -1;
        return `learnt-${place >= 0 ? `crew-${CREW[place].id}` : this.kindOf(card)}`;
    }

    /**
     * Left unbought long enough: the hand at the best of it (a boost, PUNCH HARDER, the newest of the crew), only while that
     * kind's new to the player: once they've bought one themselves (tell), it's never pointed at again.
     */
    private nudge(delta: number): void {
        const fresh = (card: Card | Badge) => !WallProgress.stepDone(this.learnt(card));
        const badge = this.badges.find((one) => one.visible && one.boost && WallProgress.bricks >= one.boost.bricks && fresh(one));
        const crew = CREW.map((def, i) => ({ def, card: this.crew[i] })).reverse().find(({ def, card }) => card.visible && WallProgress.crewOpen(def) && WallProgress.cash >= WallProgress.costOfMany(def, WallProgress.buyCount(def)) && fresh(card));
        const punch = this.punch.visible && WallProgress.canPunchHarder && fresh(this.punch) ? this.punch : undefined;
        const best = badge ?? punch ?? crew?.card;
        this.left_ = best && WallProgress.best >= NUDGE.wall ? this.left_ + delta : 0;
        const on = this.left_ > NUDGE.after ? best : undefined;
        if (on !== this.nudged) {
            this.nudged = on;
            this.hand.visible = !!on;
            this.pulse = 0;
            if (on) WallAnalytics.nudge(this.kindOf(on), 'visible');
            this.dirty = true;
            // (In sight.)
            if (on === crew?.card && crew) this.setScroll(this.order.indexOf(crew.card) * (CARD.size + CARD.gap) - CARD.gap);
        }
        if (!on) return;
        const at = this.cards.toLocal(new PIXI.Point(0, 0), on);
        this.hand.position.set(at.x + 26, at.y + 10);
        this.pulse -= delta;
        if (this.pulse > 0) return;
        this.pulse = 1.6;
        on.bump(1.1);
    }

    private refreshCrew(): void {
        // (The next kind to come shows locked with its wall, once there's one of the crew to hire: each a step to wait for.)
        const next = CREW.some((def) => WallProgress.crewOpen(def)) ? WallProgress.nextCrew : undefined;
        CREW.forEach((def, i) => {
            const card = this.crew[i];
            const open = WallProgress.crewOpen(def);
            card.visible = open || def === next;
            if (!open) {
                if (def === next) {
                    card.set({
                        frame: 'Gray',
                        icon: `Wall_${def.id}`,
                        count: '',
                        effect: `+${short(WallProgress.dpsEach(def))}/s`,
                        price: `WALL ${def.wall}`,
                        can: false,
                        share: 0,
                        tail: 'NEXT',
                        locked: true,
                    });
                }
                return;
            }
            // (Just come: a jump, from locked to there.)
            if (card.locked) {
                card.locked = false;
                card.bought();
            }
            const owned = WallProgress.owned(def.id);
            // (As many as the buy mode says: x1, x10, MAX; their price together, and what they add.)
            const many = WallProgress.buyCount(def);
            const cost = WallProgress.costOfMany(def, many);
            const can = WallProgress.cash >= cost;
            const adds = WallProgress.dpsEach(def) * many;
            card.set({
                // (Its grade's colour, as good as it is: the chick always green, the giraffe red. That it can be bought shows
                // in its focus line, its "!" and its full price button.)
                frame: CREW_GRADES[Math.min(i, CREW_GRADES.length - 1)],
                icon: `Wall_${def.id}`,
                count: owned ? `LV${owned}` : '',
                // (What they all do now, and what the buy adds.)
                effect: owned ? `${short(WallProgress.dpsEach(def) * owned)}/s (+${short(adds)})` : `+${short(adds)}/s`,
                price: many > 1 ? `x${many} $${short(cost)}` : `$${short(cost)}`,
                can,
                share: WallProgress.cash / cost,
                tail: owned ? undefined : 'NEW!',
                alert: can,
            });
        });
    }

    private refreshBadges(): void {
        const there = WallProgress.boostsThere;
        this.badges.forEach((badge, i) => {
            const boost = there[i];
            badge.visible = !!boost && (this.wide || i < BADGE.upright);
            if (boost) badge.set(boost);
            else badge.boost = undefined;
        });
    }

    /** The cards in order: the newest of the crew first. */
    private arrange(): void {
        const order = this.crew.filter((card) => card.visible).reverse();
        const same = order.length === this.order.length && order.every((card, i) => card === this.order[i]);
        if (same) return;
        const added = order.filter((card) => !this.order.includes(card));
        this.order = order;
        this.placeRow();
        this.placeCards(added);
        this.setScroll(0);
    }

    private placeCards(added: Card[] = []): void {
        const step = CARD.size + CARD.gap;
        this.order.forEach((card, i) => {
            // (Wide: two columns, PUNCH HARDER first; room for the flags between the rows.)
            const x = this.wide ? ((i + 1) % 2) * (step + 6) : i * step;
            const y = this.wide ? Math.floor((i + 1) / 2) * (CARD.height + 20) : 0;
            gsap.killTweensOf(card.position);
            if (added.includes(card)) {
                card.position.set(x, y + 60);
                card.bump(0.5);
            }
            gsap.to(card.position, { x, y, duration: 0.25, ease: 'power2.out' });
        });
    }

    private setScroll(to: number): void {
        const total = this.order.length * (CARD.size + CARD.gap) - CARD.gap;
        this.scrollMax = this.wide ? 0 : Math.max(0, total - this.listWidth);
        this.scroll = Math.max(0, Math.min(this.scrollMax, to));
        this.list.x = this.left + CARD.size / 2 - this.scroll;
        this.arrows[0].visible = this.scroll < this.scrollMax - 2;
        this.arrows[1].visible = this.scroll > 2;
        this.scrollBar.visible = this.scrollMax > 0;
        if (this.scrollMax <= 0) return;
        // From the first card in sight to the last.
        const bar = this.listWidth;
        const inside = bar - (BAR.height - BAR.thumb);
        const size = Math.max(60, (inside * this.listWidth) / total);
        this.track.width = bar / 0.5;
        this.track.x = 0;
        this.thumb.width = size / 0.32;
        this.thumb.x = (BAR.height - BAR.thumb) / 2 + (inside - size) * (this.scroll / this.scrollMax);
    }

    /** Upright: from the left side (the weapon always there), off the screen's right one if they don't all fit. */
    private placeRow(): void {
        const screen = Game.safeScreenData ?? Game.overlayScreenData;
        if (this.wide || !screen) return;
        const { topLeft, width, height, center } = screen;
        const bottom = topLeft.y + height - CARD.margin;
        const step = CARD.size + CARD.gap;
        const own = CARD.size * PUNCH.scale + PUNCH.gap;
        // (The buy mode's slot, first in the panel, when it's there.)
        const slot = 0;
        const cards = this.order.length * step - CARD.gap;
        const room = width - CARD.side * 2;
        const fits = own + slot + cards <= room;
        // (Always from the left: the weapon's card never moves as the others come.)
        const start = topLeft.x + CARD.side;
        this.punchBox.position.set(start + (CARD.size * PUNCH.scale) / 2, bottom + PUNCH.down - (CARD.height * PUNCH.scale) / 2);
        this.left = start + own + slot;
        this.listWidth = (fits ? own + slot + cards : room) - own - slot;
        this.listY = bottom - CARD.height / 2;
        this.list.y = this.listY;
        // Their panel: round them, or off the screen's side; they're cut off where it starts.
        const edge = start + own - PANEL.pad;
        const end = fits ? this.left + cards + PANEL.pad : topLeft.x + width + 40;
        const top = this.listY - CARD.height / 2 - PANEL.top;
        this.panel.visible = this.order.length > 0;
        // (The buy mode's button at the left of the boosts' row, over the panel's corner; its tabs slide out of it to the right,
        // the boosts, at the row's right, making way: placeBadges.)
        const row = bottom - CARD.height - PANEL.top - ROW_GAP - BADGE.height / 2;
        this.menu.position.set(edge + MENU.size / 2, row);
        this.mode.position.set(edge + MENU.size + 4, row);
        this.badgeRow = row;
        this.badgeLeft = edge + MENU.size + 12;
        this.panel.position.set(edge, top);
        this.panel.width = Math.max(40, end - edge) / 1.4;
        this.panel.height = (CARD.height + PANEL.top + PANEL.foot) / 1.4;
        // (The cards go under nothing as they scroll: cut off where they start, after the slot.)
        const cut = edge;
        this.listMask.clear().beginFill(0xffffff).drawRect(cut, top - 60, end - cut, CARD.height + 140).endFill();
        this.arrows.forEach((arrow) => (arrow.y = this.listY));
        this.scrollBar.position.set(this.left, bottom + BAR.below);
        this.placeBadges();
    }

    /**
     * Upright: the boosts there are at the right of their row (but never over the menu's button); with the tabs out, slid right
     * as far as they'd be over them (off the screen's side, some), back as they go in.
     */
    private placeBadges(): void {
        if (this.wide) return;
        const shown = this.badges.filter((badge) => badge.visible);
        const width = shown.length * (BADGE.width + BADGE.gap) - BADGE.gap;
        const from = Math.max(this.badgeLeft, this.screenRight - CARD.side - width);
        const tabsEnd = this.mode.x + TABS_WIDTH + BADGE.gap;
        const aside = this.modeOn ? Math.max(0, tabsEnd - from) * this.badgeSlide.t : 0;
        shown.forEach((badge, i) => badge.position.set(from + aside + BADGE.width / 2 + i * (BADGE.width + BADGE.gap), this.badgeRow));
    }

    // ---------------------------------------------------------------- frame

    public update(delta: number): void {
        const held = this.held;
        if (held && !held.dragged) {
            held.time += delta;
            if (held.time > HOLD.after + HOLD.every) {
                held.time = HOLD.after;
                held.bought = true;
                if (!this.buy(held.card, held.buy)) this.held = undefined;
            }
        }
        if (this.dirty) this.refresh();
        // (The toggle once there's more than one kind to hire, from the beaver's wall, and the boosts' row is there (it's in it):
        // before, one at a time is all there is.)
        const modeOn = this.order.length > 0 && WallProgress.best >= Math.max(CREW[1].wall, SHOWS.boosts);
        if (modeOn !== this.modeOn) {
            this.modeOn = modeOn;
            this.mode.visible = modeOn;
            this.menu.visible = modeOn;
            this.reposition();
        }
        this.mode.refresh();
        this.placeBadges();
        this.nudge(delta);
        this.punch.update(delta);
        this.order.forEach((card) => card.update(delta));
        this.badges.forEach((badge) => badge.visible && badge.update(delta));
        // The arrows nudge the way there's more.
        this.clock += delta;
        const nudge = (0.5 + 0.5 * Math.sin(this.clock * 6)) * ARROW.nudge;
        this.arrows[0].x = this.screenRight - ARROW.inset + nudge;
        this.arrows[1].x = this.left + 6 - nudge;
        const follow = 1 - Math.exp(-delta * 18);
        this.shownCash += (WallProgress.cash - this.shownCash) * follow;
        if (Math.abs(WallProgress.cash - this.shownCash) < 0.5) this.shownCash = WallProgress.cash;
        write(this.cashText, short(Math.round(this.shownCash)), PILL.cash - 150);
        this.shownBricks += (WallProgress.bricks - this.shownBricks) * follow;
        if (Math.abs(WallProgress.bricks - this.shownBricks) < 0.5) this.shownBricks = WallProgress.bricks;
        write(this.bricksText, short(Math.round(this.shownBricks)), PILL.bricks - 62);
        const rate = WallProgress.crewDps;
        write(this.rateText, rate > 0 ? `+${short(rate)}/s` : '', 92);
        this.bricks.visible = WallProgress.best > 1;
    }

    public reposition(): void {
        const screen = Game.safeScreenData ?? Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, width, height, center } = screen;
        const right = topLeft.x + width;
        this.wide = width > height * 1.15;
        this.screenRight = right;
        this.listMask.clear();
        this.cards.scale.set(this.wide ? WIDE_SCALE : 1);
        this.cards.position.set(0, 0);
        if (this.wide) {
            const columns = CARD.size * 2 + CARD.gap + 6;
            this.cards.position.set(right - columns * WIDE_SCALE - 24, topLeft.y + 156);
            this.left = 0;
            this.listWidth = columns;
            this.punchBox.position.set(CARD.size / 2, CARD.height / 2);
            this.punchBox.scale.set(1);
            this.panel.visible = false;
            this.listY = CARD.height / 2;
            this.listMask.beginFill(0xffffff).drawRect(-14, -60, columns + 28, 1400).endFill();
            this.menu.position.set(MENU.size / 2, -44);
            this.mode.position.set(MENU.size + 4, -44);
            const side = topLeft.x + 24;
            this.cash.position.set(side + PILL.cash / 2, topLeft.y + PILL.y + 4);
            this.bricks.position.set(side + PILL.bricks / 2, topLeft.y + PILL.y + 4 + PILL.height + 24);
            this.badges.forEach((badge, i) => badge.position.set(side + BADGE.width / 2, topLeft.y + 220 + i * (BADGE.height + BADGE.gap)));
        } else {
            this.punchBox.scale.set(PUNCH.scale);
            this.placeRow();
            // The money at the top, between the sound and the wardrobe.
            const bars = PILL.cash + PILL.gap + PILL.bricks;
            this.cash.position.set(center.x - 8 - bars / 2 + PILL.cash / 2, topLeft.y + PILL.y);
            this.bricks.position.set(center.x - 8 + bars / 2 - PILL.bricks / 2, topLeft.y + PILL.y);
        }
        this.arrows.forEach((arrow) => (arrow.y = this.listY));
        this.list.y = this.listY;
        this.placeCards();
        this.setScroll(this.scroll);
        this.dirty = true;
    }

    public stop(): void {
        this.stopListening();
    }
}
