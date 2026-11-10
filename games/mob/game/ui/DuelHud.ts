// DuelHud.ts
//
// An arena match's HUD, over the battle's own (MobHud: its cards and energy stay; its top bar goes): the clock at the
// top, both sides' life (the player's blue on the left, the opponent's red on the right, the opponent's name and tier
// under it), and the result card at the end: VICTORY / DEFEAT / DRAW, the life left on each side, the rating it
// brought, REMATCH and HOME.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { GlossyButton, framePlane, glossyButton, iconButton, label, tappable } from './UiParts';

const BAR = { width: 250, height: 40, back: 0x1b1e3a, blue: 0x3d8cff, blueTrack: 0x1b2a5a, red: 0xff3d4f, redTrack: 0x4a1a26, gap: 120 };
const CLOCK = { width: 150, height: 64, back: 0x1b1e3a, hurry: 10 };
const CARD = { width: 560, height: 520, back: 0x1b1e3a };
const BUTTONS = { height: 92, home: 112, rematch: 300, gap: 18 };
/** The bars over the buildings: a tower's, and an open cannon's (bigger, gold-edged, TARGET over it, pulsing). */
const TOWER_BAR = { width: 96, height: 16, cannon: 140, cannonHeight: 22, back: 0x10123a, blue: 0x3d8cff, red: 0xff3d4f, gold: 0xffd23f, text: 18, pulse: 6 };
/** The comeback boost's button (right, over the cards), and how high over the bottom it sits. */
const BOOST = { width: 190, height: 78, right: 24, up: 300, text: 'SPEED' };

/** One side's life bar: its frame, track and fill, the number on it, the caption under it. */
class LifeBar extends PIXI.Container {
    private readonly fill: PIXI.NineSlicePlane;
    private readonly number = label(26);
    public readonly caption = label(20);
    private shown = 1;
    private target = 1;

    public constructor(colour: number, track: number, private readonly fromRight: boolean) {
        super();
        const back = framePlane('Slider_Play01_Bg', BAR.width, BAR.height, 1.2);
        back.tint = BAR.back;
        const trackPlane = framePlane('Slider_Play01_FillMask', BAR.width - 14, BAR.height - 14, 1.2);
        trackPlane.tint = track;
        trackPlane.position.set(7, 7);
        this.fill = framePlane('Slider_Play01_FillMask', BAR.width - 14, BAR.height - 14, 1.2);
        this.fill.tint = colour;
        this.fill.position.set(7, 7);
        this.number.position.set(BAR.width / 2, BAR.height / 2 - 1);
        this.caption.position.set(BAR.width / 2, BAR.height + 16);
        this.addChild(back, trackPlane, this.fill, this.number, this.caption);
    }

    public set(hp: number, max: number): void {
        this.target = max > 0 ? Math.max(0, hp / max) : 0;
        this.number.text = `${Math.ceil(hp)}`;
    }

    public reset(): void {
        this.shown = this.target;
        this.draw();
    }

    public update(dt: number): void {
        if (Math.abs(this.shown - this.target) < 0.0005) return;
        this.shown += (this.target - this.shown) * Math.min(1, dt * 10);
        this.draw();
    }

    private draw(): void {
        const inner = BAR.width - 14;
        const width = Math.max(24, inner * this.shown);
        this.fill.width = width / this.fill.scale.x;
        this.fill.visible = this.shown > 0.001;
        // The opponent's empties towards the middle too (from its right end).
        this.fill.x = this.fromRight ? 7 + inner - width : 7;
    }
}

export interface DuelEnd {
    result: 'won' | 'lost' | 'draw';
    own: number;
    theirs: number;
    /** The rating before and after (null: not counted, the editor's test). */
    rating: { before: number; after: number; tier: string } | null;
}

/** One building's bar (a screen point over it). */
export interface BuildingBar { x: number; y: number; hp: number; max: number; blue: boolean; cannon: boolean }

export class DuelHud extends PIXI.Container {
    private readonly top = new PIXI.Container();
    private readonly bars = new PIXI.Container();
    private readonly boostButton: GlossyButton;
    private boostShown = false;
    private time = 0;
    private readonly clock = new PIXI.Container();
    private readonly clockText = label(40);
    private readonly own = new LifeBar(BAR.blue, BAR.blueTrack, false);
    private readonly theirs = new LifeBar(BAR.red, BAR.redTrack, true);
    private readonly card = new PIXI.Container();
    private readonly dim = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private readonly title = label(72);
    private readonly score = label(44);
    private readonly ratingText = label(30, 0xffe066);
    private readonly rematch: GlossyButton;
    private readonly home: GlossyButton;
    private lastSecond = -1;

    public constructor(onRematch: () => void, onHome: () => void, onBoost: () => void = () => undefined) {
        super();
        this.boostButton = glossyButton(BOOST.width, BOOST.height, BOOST.text, 'Button01_l_Green');
        tappable(this.boostButton, onBoost);
        this.boostButton.visible = false;
        const clockBack = framePlane('Slider_Play01_Bg', CLOCK.width, CLOCK.height, 1.4);
        clockBack.tint = CLOCK.back;
        clockBack.position.set(-CLOCK.width / 2, 0);
        this.clockText.position.set(0, CLOCK.height / 2 - 2);
        this.clock.addChild(clockBack, this.clockText);
        this.own.position.set(-CLOCK.width / 2 - 14 - BAR.width, (CLOCK.height - BAR.height) / 2);
        this.theirs.position.set(CLOCK.width / 2 + 14, (CLOCK.height - BAR.height) / 2);
        this.own.caption.text = 'YOU';
        this.top.addChild(this.own, this.theirs, this.clock);

        this.dim.eventMode = 'static';
        const back = framePlane('BorderFrame_Round24', CARD.width, CARD.height, 1);
        back.tint = CARD.back;
        back.position.set(-CARD.width / 2, -CARD.height / 2);
        this.title.y = -170;
        this.score.y = -60;
        this.ratingText.y = 20;
        this.rematch = glossyButton(BUTTONS.rematch, BUTTONS.height, 'REMATCH', 'Button01_l_Sky');
        tappable(this.rematch, onRematch, null);
        this.home = iconButton(BUTTONS.home, BUTTONS.height, 'Button01_l_Red', 'PictoIcon_Home_1', 46);
        tappable(this.home, onHome);
        const row = BUTTONS.home + BUTTONS.gap + BUTTONS.rematch;
        this.home.x = -row / 2 + BUTTONS.home / 2;
        this.rematch.x = row / 2 - BUTTONS.rematch / 2;
        this.home.y = this.rematch.y = 150;
        this.panel.addChild(back, this.title, this.score, this.ratingText, this.home, this.rematch);
        this.card.addChild(this.dim, this.panel);
        this.card.visible = false;
        this.addChild(this.bars, this.top, this.boostButton, this.card);
        this.layout();
    }

    public layout(): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        const { topLeft, center, width, height } = screen;
        const full = CLOCK.width + 2 * (BAR.width + 14);
        this.top.scale.set(Math.min(1, (width - 30) / full));
        this.top.position.set(center.x, topLeft.y + 96);
        this.dim.clear().beginFill(0x0b1030, 0.72).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        this.panel.scale.set(Math.min(1, (width - 40) / CARD.width, (height - 40) / CARD.height));
        this.panel.position.set(center.x, center.y);
        this.boostButton.position.set(topLeft.x + width - BOOST.right - BOOST.width / 2, topLeft.y + height - BOOST.up);
    }

    /** Each building's life, over it (screen points, CSS px): a bar and its number; a cannon only once it's open, and
     *  then plainly the target (bigger, gold, TARGET over it). */
    public setBuildingBars(entries: readonly BuildingBar[]): void {
        while (this.bars.children.length < entries.length) {
            const holder = new PIXI.Container();
            const back = new PIXI.Graphics();
            const tag = label(TOWER_BAR.text + 4, 0xffe066);
            tag.text = 'TARGET';
            const text = label(TOWER_BAR.text);
            holder.addChild(back, tag, text);
            this.bars.addChild(holder);
        }
        this.bars.children.forEach((child, i) => {
            const holder = child as PIXI.Container;
            const entry = entries[i];
            holder.visible = !!entry;
            if (!entry) return;
            holder.position.copyFrom(this.toLocal(new PIXI.Point(entry.x, entry.y)));
            const [back, tag, text] = holder.children as [PIXI.Graphics, PIXI.Text, PIXI.Text];
            const width = entry.cannon ? TOWER_BAR.cannon : TOWER_BAR.width;
            const height = entry.cannon ? TOWER_BAR.cannonHeight : TOWER_BAR.height;
            const share = Math.max(0, Math.min(1, entry.hp / Math.max(1, entry.max)));
            const edge = entry.cannon ? TOWER_BAR.gold : 0xffffff;
            back.clear()
                .lineStyle(entry.cannon ? 4 : 2, edge).beginFill(TOWER_BAR.back).drawRoundedRect(-width / 2, -height / 2, width, height, height / 2).endFill()
                .lineStyle(0).beginFill(entry.blue ? TOWER_BAR.blue : TOWER_BAR.red).drawRoundedRect(-width / 2 + 3, -height / 2 + 3, Math.max(0, (width - 6) * share), height - 6, (height - 6) / 2).endFill();
            text.text = `${Math.ceil(entry.hp)}`;
            text.y = -1;
            tag.visible = entry.cannon;
            tag.y = -height / 2 - 16;
            holder.scale.set(entry.cannon ? 1 + 0.08 * Math.sin(this.time * TOWER_BAR.pulse) : 1);
        });
    }

    /** The comeback boost's button: shown while the player may use it, its seconds while it's on. */
    public setBoost(ready: boolean, left: number): void {
        const show = ready || left > 0;
        if (show && !this.boostShown) gsap.fromTo(this.boostButton.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        this.boostShown = show;
        this.boostButton.visible = show;
        this.boostButton.words.text = left > 0 ? `${BOOST.text} ${Math.ceil(left)}` : BOOST.text;
        this.boostButton.alpha = left > 0 ? 0.7 : 1;
        if (ready && !gsap.isTweening(this.boostButton.scale)) this.boostButton.scale.set(1 + 0.06 * Math.sin(this.time * 8));
    }

    /** Where the top block ends (screen pixels), for the camera to keep the field under it. */
    public topBottom(): number {
        return this.top.getBounds().bottom;
    }

    /** A fresh match: the opponent's caption (its name and tier), both bars full. */
    public reset(opponent: string, own: number, theirs: number): void {
        this.theirs.caption.text = opponent;
        this.own.set(own, own);
        this.theirs.set(theirs, theirs);
        this.own.reset();
        this.theirs.reset();
        this.card.visible = false;
        this.top.visible = true;
        this.bars.visible = true;
        this.lastSecond = -1;
    }

    public setLife(own: number, ownMax: number, theirs: number, theirsMax: number): void {
        this.own.set(own, ownMax);
        this.theirs.set(theirs, theirsMax);
    }

    /** The clock: m:ss; the last seconds red, each one a bump. */
    public setTime(seconds: number): void {
        const whole = Math.ceil(seconds);
        if (whole === this.lastSecond) return;
        this.lastSecond = whole;
        this.clockText.text = `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
        const hurry = whole <= CLOCK.hurry;
        this.clockText.tint = hurry ? 0xff6b7a : 0xffffff;
        if (hurry && whole > 0) gsap.fromTo(this.clock.scale, { x: 1.18, y: 1.18 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
    }

    public update(dt: number): void {
        this.time += dt;
        this.own.update(dt);
        this.theirs.update(dt);
    }

    public showEnd(end: DuelEnd): void {
        this.title.text = end.result === 'won' ? 'VICTORY' : end.result === 'lost' ? 'DEFEAT' : 'DRAW';
        this.title.tint = end.result === 'won' ? 0x9fd8ff : end.result === 'lost' ? 0xff8a96 : 0xffffff;
        this.score.text = `${Math.ceil(end.own)}  -  ${Math.ceil(end.theirs)}`;
        const r = end.rating;
        const change = r ? r.after - r.before : 0;
        this.ratingText.text = r ? `${change >= 0 ? '+' : ''}${change}  ★ ${r.after}  ${r.tier.toUpperCase()}` : 'TEST MATCH (not counted)';
        this.top.visible = false;
        this.bars.visible = false;
        this.boostButton.visible = false;
        this.card.visible = true;
        this.card.alpha = 0;
        gsap.to(this.card, { alpha: 1, duration: 0.3 });
        gsap.fromTo(this.title.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.2)' });
    }

    public hideEnd(): void {
        this.card.visible = false;
    }
}
