// LevelBadge.ts
//
// The farm test's player level on the HUD (top centre): the kit's blue shield with the level on it, over the left end of
// the level's bar ("into / need" on it); the area's thinner bar goes under that, clear of the shield (MowHud's, lined up
// by barSpan). A level up pops the badge and flashes the bar.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { HudBar } from './HudBar';
import { UiKit } from './UiKit';

/** The shield's size; the bar's width (from the shield's middle), its height and what the shield covers of it. */
const BADGE = 72;
const BAR = { width: 300, height: 38, covered: 32 };
/** Where the area's bar goes: its left end (clear of the shield) and its middle line, under the level's. */
const AREA = { from: 36, y: 36 };
const STROKE = { number: 0x1f49a8, amount: 0x0c0c12 };

export class LevelBadge extends PIXI.Container {
    private readonly badge = new PIXI.Container();
    private readonly number: PIXI.Text;
    private readonly amount: PIXI.Text;
    private readonly bar = new HudBar(BAR.width, BAR.height);
    private readonly track = new PIXI.Container();
    private shown = -1;

    public constructor() {
        super();
        const style = (size: number, stroke: number) => new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'), fontSize: size, fill: 0xffffff, stroke, strokeThickness: 7, lineJoin: 'round',
        });
        this.bar.setFrom(BAR.covered);
        this.amount = new PIXI.Text('', style(25, STROKE.amount));
        this.amount.anchor.set(0.5);
        this.amount.position.set((BAR.covered + BAR.width) / 2, -2);
        this.track.addChild(this.bar, this.amount);

        const shield = PIXI.Sprite.from('Slider_Level02_Icon_Badge_Blue');
        shield.anchor.set(0.5);
        shield.scale.set(BADGE / Math.max(shield.texture.width, shield.texture.height, 1));
        this.number = new PIXI.Text('1', style(34, STROKE.number));
        this.number.anchor.set(0.5);
        this.number.y = -2;
        this.badge.addChild(shield, this.number);
        this.addChild(this.track, this.badge);
    }

    /** Its full width (the shield's left edge to the bar's right end) and the shield's half, for centring it (its origin is the shield's middle). */
    public static get width(): number {
        return BADGE / 2 + BAR.width;
    }

    public static get badgeHalf(): number {
        return BADGE / 2;
    }

    /** Where the area's bar goes, unscaled from its origin: its ends, its middle line, and what the shield covers of it. */
    public static get barSpan(): { from: number; to: number; y: number; covered: number } {
        return { from: AREA.from, to: BAR.width, y: AREA.y, covered: 0 };
    }

    /** The level and the XP into it (`into` of `need`). */
    public set(level: number, into: number, need: number): void {
        if (level !== this.shown) {
            const up = this.shown > 0 && level > this.shown;
            this.shown = level;
            this.number.text = String(level);
            UiKit.fit(this.number, BADGE * 0.7);
            if (up) {
                gsap.killTweensOf(this.badge.scale);
                this.badge.scale.set(1.5);
                gsap.to(this.badge.scale, { x: 1, y: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
                gsap.fromTo(this.track, { alpha: 0.4 }, { alpha: 1, duration: 0.5 });
            }
        }
        const amount = `${Math.floor(into)}/${Math.ceil(need)}`;
        if (this.amount.text !== amount) this.amount.text = amount;
        this.bar.setShare(into / Math.max(1, need));
    }

    public override destroy(): void {
        gsap.killTweensOf(this.badge.scale);
        gsap.killTweensOf(this.track);
        super.destroy({ children: true });
    }
}
