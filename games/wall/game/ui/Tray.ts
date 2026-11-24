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
import { BoostDef, CREW, CrewDef, SHOWS, punchCost, punchMult, short, toolAt } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { flag, frame, sprite, text, write } from './parts';

/** (As many as fit, and the next one peeking in.) */
const CARD = { size: 124, height: 164, gap: 11, side: 14, margin: 32, icon: 80 };
const BADGE = { width: 222, height: 104, gap: 11, shown: 3, icon: 62 };
/** Between the cards and the row above; on a wide screen the cards are this much bigger. */
const ROW_GAP = 22;
const WIDE_SCALE = 1;
/** The buttons that say there's more (round, an arrow in them), and the slider under the cards. */
const ARROW = { size: 60, icon: 32, inset: 40, nudge: 6 };
const BAR = { height: 14, thumb: 8, below: 13 };
/** PUNCH HARDER's card, on its own: bigger than the others. The panel the others are in: round them, and off it. */
const PUNCH = { scale: 1.17, gap: 26, down: 20 };
/** What's spent flies from its bar to what's bought, and what's won to its bar: how many, how big, how long (seconds), and how many at most at once. */
const FLY = { spent: 4, won: 7, size: 50, seconds: 0.42, every: 0.045, most: 30 };
const MONEY = 'ItemIcon_Money_Bill';
const BRICK = 'Wall_brick';
const PANEL = { pad: 11, top: 13, foot: 26, color: 0x15162a, alpha: 0.55 };
const PILL = { height: 42, cash: 246, bricks: 124, gap: 34, y: 44 };
/** A boost's price: a brick and how many, in a pill that fills with those there are. */
const BRICKS = { width: 118, height: 34, y: 28 };
const PILL_COLOR = 0x1c1d33;
/** The strip that fills up with the money there is. */
const STRIP = { width: CARD.size - 22, height: 36, y: 55 };
/** A picture that can be had wriggles now and then. */
const WRIGGLE = { every: 1.7, seconds: 0.5, turn: 0.13, grow: 0.07 };
const HOLD = { after: 0.35, every: 0.11 };
const DRAG = 14;
type Frame = 'Blue' | 'Green' | 'Purple' | 'Yellow' | 'Navy' | 'Gray';

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
    locked?: boolean;
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
    private readonly lock = sprite('Icon_Lock01_s', 42);
    private readonly corner = frame('BasicFrame_Round12', [12, 12, 12, 12], 56, 32, 0.8);
    private readonly count = text('', 23, 0xffffff);
    private readonly effect = text('', 25, 0xffec82, 0x100e18, 6);
    private readonly strip = frame('BasicFrame_Round12', [12, 12, 12, 12], STRIP.width, STRIP.height);
    private readonly fill = frame('BasicFrame_Round12', [12, 12, 12, 12], STRIP.width, STRIP.height);
    private readonly price = text('', 29, 0xffffff, 0x100e18, 7);
    private readonly tailText = text('', 21, 0xffffff);
    private readonly tail = flag(this.tailText, 88);
    private shown = '';
    public locked = false;
    private can = false;
    private clock = Math.random() * WRIGGLE.every;

    public constructor() {
        super();
        this.glow.alpha = 0.42;
        this.glow.y = -18;
        this.icon.anchor.set(0.5);
        this.metal.anchor.set(0.5);
        this.picture.y = PICTURE_Y;
        this.picture.addChild(this.icon, this.metal);
        this.lock.y = PICTURE_Y;
        this.corner.tint = 0x0a1446;
        this.corner.alpha = 0.38;
        this.corner.position.set(-CARD.size / 2 + 7, -CARD.height / 2 + 9);
        this.count.position.set(-CARD.size / 2 + 35, -CARD.height / 2 + 24);
        this.effect.y = 20;
        this.strip.tint = 0x081032;
        this.strip.alpha = 0.6;
        this.strip.y += STRIP.y;
        this.fill.y += STRIP.y;
        this.tail.y = -CARD.height / 2;
        this.addChild(this.focus, this.back, this.glow, this.picture, this.lock, this.corner, this.count, this.effect, this.strip, this.fill, this.price, this.tail);
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
        this.metal.visible = !!look.tint;
        if (look.tint) {
            this.metal.texture = PIXI.Texture.from(`${look.icon}_metal`);
            this.metal.scale.copyFrom(this.icon.scale);
            this.metal.tint = PIXI.utils.string2hex(look.tint);
        }
        this.icon.tint = look.locked ? 0x0e1020 : 0xffffff;
        this.icon.alpha = look.locked ? 0.75 : 1;
        this.locked = !!look.locked;
        this.lock.visible = this.locked;
        this.corner.visible = this.count.visible = !!look.count;
        write(this.count, look.count, 48);
        write(this.effect, look.effect, CARD.size - 20);
        // (Full, it's the button.)
        this.strip.visible = !look.locked;
        this.fill.visible = !look.locked && look.share > 0.01;
        this.fill.width = Math.max(26, STRIP.width * look.share);
        this.fill.tint = look.can ? 0xffc21f : 0xf08a2a;
        this.fill.alpha = look.can ? 1 : 0.85;
        write(this.price, look.price, CARD.size - 28);
        this.price.y = look.locked ? STRIP.y - 8 : STRIP.y - 2;
        // (Under the flag, if it has one.)
        this.corner.y = -CARD.height / 2 + (look.tail ? 20 : 9);
        this.count.y = -CARD.height / 2 + (look.tail ? 35 : 24);
        this.tail.visible = !!look.tail;
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
    private readonly pill = frame('BasicFrame_Round12', [12, 12, 12, 12], BRICKS.width, BRICKS.height);
    private readonly fill = frame('BasicFrame_Round12', [12, 12, 12, 12], BRICKS.width, BRICKS.height);
    private readonly brick = sprite('Wall_brick', 34);
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
        this.what.position.set(left, -30);
        this.value.position.set(left, -5);
        this.pill.x = this.fill.x = left - 4;
        this.pill.y += BRICKS.y;
        this.fill.y += BRICKS.y;
        this.pill.tint = 0x081032;
        this.pill.alpha = 0.65;
        this.brick.position.set(left + 20, BRICKS.y - 1);
        this.price.position.set(left + 46, BRICKS.y - 2);
        this.addChild(this.focus, this.back, this.glow, this.icon, this.what, this.value, this.pill, this.fill, this.brick, this.price);
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
        const share = Math.min(1, WallProgress.bricks / boost.bricks);
        this.fill.visible = share > 0.01;
        this.fill.width = Math.max(26, BRICKS.width * share);
        this.fill.tint = this.can ? 0x35c24a : 0xd0603a;
        this.fill.alpha = this.can ? 1 : 0.8;
        this.focus.visible = this.can;
    }

    public update(delta: number): void {
        this.clock += delta;
        const { turn, grow } = this.can ? wriggle(this.clock) : { turn: 0, grow: 1 };
        this.icon.rotation = turn;
        this.icon.scale.set((BADGE.icon * grow) / Math.max(this.icon.texture.width, this.icon.texture.height, 1));
        this.focus.alpha = 0.65 + 0.35 * Math.sin(this.clock * 5);
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
        this.cards.addChild(this.panel, this.listMask, this.list, this.punchBox, this.scrollBar, ...this.arrows, this.hand);
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
            card.bought();
            this.spent(MONEY, before - WallProgress.cash, card);
        } else {
            card.refuse();
            if (!card.locked) this.lacking(this.cash);
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
        gsap.to(label, { alpha: 0, duration: 0.3, delay: 0.5, onComplete: () => label.destroy() });
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
                frame: can ? (newTool ? 'Purple' : 'Green') : 'Blue',
                icon: `Wall_${newTool ? next.base : tool.base}`,
                tint: newTool ? next.tint : tool.tint,
                count: level > 0 ? `LV${level}` : '',
                effect: `x${punchMult(level)} HIT`,
                price: gift ? 'FREE!' : `$${short(punchCost(level))}`,
                can,
                share: gift ? 1 : WallProgress.cash / punchCost(level),
                tail: gift ? 'FREE!' : newTool ? 'NEW!' : 'PUNCH',
            });
        }
        this.refreshCrew();
        this.refreshBadges();
        this.arrange();
        // A hand for the first purchases.
        const chick = CREW[0];
        const point = gift ? this.punch : there && WallProgress.best >= chick.wall && WallProgress.owned(chick.id) === 0 && WallProgress.rewinds === 0 && WallProgress.cash >= chick.cost ? this.crew[0] : undefined;
        this.hand.visible = !!point;
        if (point) {
            const box = point === this.punch ? this.punchBox : this.list;
            this.hand.position.set(box.x + point.x + 26, box.y + point.y + 10);
        }
    }

    private refreshCrew(): void {
        CREW.forEach((def, i) => {
            const card = this.crew[i];
            const open = WallProgress.best >= def.wall;
            const next = !open && (i === 0 || WallProgress.best >= CREW[i - 1].wall);
            // (The first one's teased once there's something to buy at all.)
            card.visible = open || (next && this.punch.visible);
            if (!card.visible) return;
            if (!open) {
                card.set({ frame: 'Navy', icon: `Wall_${def.id}`, count: '', effect: '', price: `WALL ${def.wall}`, can: false, share: 0, locked: true });
                return;
            }
            const owned = WallProgress.owned(def.id);
            const cost = WallProgress.costOf(def);
            const can = WallProgress.cash >= cost;
            card.set({
                frame: can ? 'Green' : 'Blue',
                icon: `Wall_${def.id}`,
                count: owned ? `x${owned}` : '',
                effect: `+${short(WallProgress.dpsEach(def))}/s`,
                price: `$${short(cost)}`,
                can,
                share: WallProgress.cash / cost,
                tail: owned ? undefined : 'NEW!',
            });
        });
    }

    private refreshBadges(): void {
        const there = WallProgress.boostsThere;
        this.badges.forEach((badge, i) => {
            const boost = there[i];
            badge.visible = !!boost;
            if (boost) badge.set(boost);
            else badge.boost = undefined;
        });
    }

    /** The cards in order: the newest of the crew first, the one to come last. */
    private arrange(): void {
        const open = this.crew.filter((card, i) => card.visible && WallProgress.best >= CREW[i].wall).reverse();
        const coming = this.crew.filter((card, i) => card.visible && WallProgress.best < CREW[i].wall);
        const order = [...open, ...coming];
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

    /** Upright: the cards in the middle if they all fit; if not, from the left side off the screen's right one. */
    private placeRow(): void {
        const screen = Game.overlayScreenData;
        if (this.wide || !screen) return;
        const { topLeft, width, height, center } = screen;
        const bottom = topLeft.y + height - CARD.margin;
        const step = CARD.size + CARD.gap;
        const own = CARD.size * PUNCH.scale + PUNCH.gap;
        const cards = this.order.length * step - CARD.gap;
        const room = width - CARD.side * 2;
        const fits = own + cards <= room;
        const start = fits ? center.x - (own + cards) / 2 : topLeft.x + CARD.side;
        this.punchBox.position.set(start + (CARD.size * PUNCH.scale) / 2, bottom + PUNCH.down - (CARD.height * PUNCH.scale) / 2);
        this.left = start + own;
        this.listWidth = (fits ? own + cards : room) - own;
        this.listY = bottom - CARD.height / 2;
        this.list.y = this.listY;
        // Their panel: round them, or off the screen's side; they're cut off where it starts.
        const edge = this.left - PANEL.pad;
        const end = fits ? this.left + cards + PANEL.pad : topLeft.x + width + 40;
        const top = this.listY - CARD.height / 2 - PANEL.top;
        this.panel.visible = this.order.length > 0;
        this.panel.position.set(edge, top);
        this.panel.width = Math.max(40, end - edge) / 1.4;
        this.panel.height = (CARD.height + PANEL.top + PANEL.foot) / 1.4;
        this.listMask.clear().beginFill(0xffffff).drawRect(edge, top - 60, end - edge, CARD.height + 140).endFill();
        this.arrows.forEach((arrow) => (arrow.y = this.listY));
        this.scrollBar.position.set(this.left, bottom + BAR.below);
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
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, width, height, center } = screen;
        const bottom = topLeft.y + height - CARD.margin;
        const right = topLeft.x + width;
        this.wide = width > height * 1.15;
        this.screenRight = right;
        this.listMask.clear();
        this.cards.scale.set(this.wide ? WIDE_SCALE : 1);
        this.cards.position.set(0, 0);
        if (this.wide) {
            const columns = CARD.size * 2 + CARD.gap + 6;
            this.cards.position.set(right - columns * WIDE_SCALE - 24, topLeft.y + 128);
            this.left = 0;
            this.listWidth = columns;
            this.punchBox.position.set(CARD.size / 2, CARD.height / 2);
            this.punchBox.scale.set(1);
            this.panel.visible = false;
            this.listY = CARD.height / 2;
            this.listMask.beginFill(0xffffff).drawRect(-14, -60, columns + 28, 1400).endFill();
            const side = topLeft.x + 24;
            this.cash.position.set(side + PILL.cash / 2, topLeft.y + PILL.y + 4);
            this.bricks.position.set(side + PILL.bricks / 2, topLeft.y + PILL.y + 4 + PILL.height + 24);
            this.badges.forEach((badge, i) => badge.position.set(side + BADGE.width / 2, topLeft.y + 220 + i * (BADGE.height + BADGE.gap)));
        } else {
            this.punchBox.scale.set(PUNCH.scale);
            this.placeRow();
            const row = bottom - CARD.height - PANEL.top - ROW_GAP - BADGE.height / 2;
            this.badges.forEach((badge, i) => badge.position.set(center.x - 360 + CARD.side + 2 + BADGE.width / 2 + i * (BADGE.width + BADGE.gap), row));
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
