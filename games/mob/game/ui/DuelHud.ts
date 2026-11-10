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

const BAR = { width: 250, height: 40, inset: 3, pad: 3, back: 0x1b1e3a, blue: 0x3d8cff, blueTrack: 0x1b2a5a, red: 0xff3d4f, redTrack: 0x4a1a26, gap: 120 };
const CLOCK = { width: 150, height: 64, back: 0x1b1e3a, hurry: 10 };
const CARD = { width: 560, height: 520, back: 0x1b1e3a };
const BUTTONS = { height: 92, home: 112, rematch: 300, gap: 18 };
/** The bars over the buildings: a tower's, and an open cannon's (bigger, gold-edged, TARGET over it, pulsing). */
const TOWER_BAR = { width: 110, height: 22, cannon: 150, cannonHeight: 28, back: 0x10123a, blue: 0x3d8cff, red: 0xff3d4f, gold: 0xffd23f, text: 18, pulse: 6 };
/** The baked bar textures (Bar_Trough, Bar_Segment: white, 48 px tall, tinted; the cards' charge bars use them too). */
const BAKED = { texture: 48, troughSlice: 16, fillSlice: 12, inset: 3 };

/** A baked nine-slice drawn at (x, y), `width` x `height`: its corners scaled to the height, so they stay round. */
function place(plane: PIXI.NineSlicePlane, x: number, y: number, width: number, height: number): void {
    const scale = height / BAKED.texture;
    plane.scale.set(scale);
    plane.width = width / scale;
    plane.height = BAKED.texture;
    plane.position.set(x, y);
}

/** One side's life bar: the baked trough (a white edge round a dark one) and fill, the number on it, the caption under it. */
class LifeBar extends PIXI.Container {
    private readonly fill = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Segment'), BAKED.fillSlice, BAKED.fillSlice, BAKED.fillSlice, BAKED.fillSlice);
    private readonly number = label(26);
    public readonly caption = label(20);
    private shown = 1;
    private target = 1;

    public constructor(colour: number, track: number, private readonly fromRight: boolean) {
        super();
        const edge = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Trough'), BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice);
        place(edge, 0, 0, BAR.width, BAR.height);
        edge.tint = BAR.back;
        const trough = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Trough'), BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice);
        place(trough, BAR.inset, BAR.inset, BAR.width - BAR.inset * 2, BAR.height - BAR.inset * 2);
        trough.tint = track;
        this.fill.tint = colour;
        this.number.position.set(BAR.width / 2, BAR.height / 2 - 1);
        this.caption.position.set(BAR.width / 2, BAR.height + 16);
        this.addChild(edge, trough, this.fill, this.number, this.caption);
        this.draw();
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
        const inner = BAR.width - BAR.inset * 2 - BAR.pad * 2;
        const height = BAR.height - BAR.inset * 2 - BAR.pad * 2;
        const width = Math.max(height * 0.6, inner * this.shown);
        this.fill.visible = this.shown > 0.001;
        // The opponent's empties towards the middle too (from its right end).
        const x = BAR.inset + BAR.pad + (this.fromRight ? inner - width : 0);
        place(this.fill, x, BAR.inset + BAR.pad, width, height);
    }
}

export interface DuelEnd {
    result: 'won' | 'lost' | 'draw';
    own: number;
    theirs: number;
    /** Crowns earned (the competition: Ranking.ts). */
    crowns: number;
    /** The rating before and after (null: not counted, the editor's test). */
    rating: { before: number; after: number; tier: string } | null;
}

/** One building's bar (a screen point over it). */
export interface BuildingBar { x: number; y: number; hp: number; max: number; blue: boolean; cannon: boolean }

export class DuelHud extends PIXI.Container {
    private readonly top = new PIXI.Container();
    private readonly bars = new PIXI.Container();
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

    public constructor(onRematch: () => void, onHome: () => void) {
        super();
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
        this.addChild(this.bars, this.top, this.card);
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
    }

    /** Each building's life, over it (screen points, CSS px): a bar (the baked trough and fill: crisp at any size) and its
     *  number; a cannon only once it's open, and then plainly the target (bigger, gold, TARGET over it). */
    public setBuildingBars(entries: readonly BuildingBar[]): void {
        while (this.bars.children.length < entries.length) {
            const holder = new PIXI.Container();
            const edge = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Trough'), BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice);
            const trough = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Trough'), BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice, BAKED.troughSlice);
            trough.tint = TOWER_BAR.back;
            const fill = new PIXI.NineSlicePlane(PIXI.Texture.from('Bar_Segment'), BAKED.fillSlice, BAKED.fillSlice, BAKED.fillSlice, BAKED.fillSlice);
            const tag = label(TOWER_BAR.text + 4, 0xffe066);
            tag.text = 'TARGET';
            const text = label(TOWER_BAR.text);
            holder.addChild(edge, trough, fill, tag, text);
            this.bars.addChild(holder);
        }
        this.bars.children.forEach((child, i) => {
            const holder = child as PIXI.Container;
            const entry = entries[i];
            holder.visible = !!entry;
            if (!entry) return;
            holder.position.copyFrom(this.toLocal(new PIXI.Point(entry.x, entry.y)));
            const [edge, trough, fill, tag, text] = holder.children as [PIXI.NineSlicePlane, PIXI.NineSlicePlane, PIXI.NineSlicePlane, PIXI.Text, PIXI.Text];
            const width = entry.cannon ? TOWER_BAR.cannon : TOWER_BAR.width;
            const height = entry.cannon ? TOWER_BAR.cannonHeight : TOWER_BAR.height;
            const border = entry.cannon ? 3 : 2;
            const share = Math.max(0, Math.min(1, entry.hp / Math.max(1, entry.max)));
            // The edge (white, gold for an open cannon), the dark trough in it, the fill in that.
            place(edge, -width / 2 - border, -height / 2 - border, width + border * 2, height + border * 2);
            edge.tint = entry.cannon ? TOWER_BAR.gold : 0xffffff;
            place(trough, -width / 2, -height / 2, width, height);
            const inner = height - BAKED.inset * 2;
            const fillWidth = Math.max(0, (width - BAKED.inset * 2) * share);
            fill.visible = fillWidth >= inner * 0.6;
            place(fill, -width / 2 + BAKED.inset, -height / 2 + BAKED.inset, Math.max(inner * 0.6, fillWidth), inner);
            fill.tint = entry.blue ? TOWER_BAR.blue : TOWER_BAR.red;
            text.text = `${Math.ceil(entry.hp)}`;
            text.y = -1;
            tag.visible = entry.cannon;
            tag.y = -height / 2 - 18;
            holder.scale.set(entry.cannon ? 1 + 0.08 * Math.sin(this.time * TOWER_BAR.pulse) : 1);
        });
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
        this.ratingText.text = r
            ? `${change >= 0 ? '+' : ''}${change} TROPHIES (${r.after}) · ${r.tier.toUpperCase()}${end.crowns ? `
+${end.crowns} CROWN${end.crowns === 1 ? '' : 'S'}` : ''}`
            : 'TEST MATCH (not counted)';
        this.top.visible = false;
        this.bars.visible = false;
        this.card.visible = true;
        this.card.alpha = 0;
        gsap.to(this.card, { alpha: 1, duration: 0.3 });
        gsap.fromTo(this.title.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.2)' });
    }

    /** The countdown's number, big in the middle, popping in and fading. */
    public showCount(text: string): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        const word = label(150, 0xffe066);
        word.text = text;
        word.position.set(screen.center.x, screen.center.y - 60);
        this.addChild(word);
        gsap.fromTo(word.scale, { x: 2.2, y: 2.2 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
        gsap.to(word, { alpha: 0, duration: 0.3, delay: 0.6, onComplete: () => word.destroy() });
    }

    public hideEnd(): void {
        this.card.visible = false;
    }
}
