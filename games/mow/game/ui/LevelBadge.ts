// LevelBadge.ts
//
// The farm test's player level on the HUD: a gold disc with the level, and a bar beside it filling with the XP toward
// the next one. A level up pops the disc and flashes the bar.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';

const RADIUS = 28;
const BAR = { width: 150, height: 18, gap: 8 };
const COLORS = { disc: 0xffc83d, rim: 0x1d140e, bar: 0x2c3a5c, fill: 0x7ad957 };

export class LevelBadge extends PIXI.Container {
    private readonly disc = new PIXI.Graphics();
    private readonly number: PIXI.Text;
    private readonly fill = new PIXI.Graphics();
    private readonly caption: PIXI.Text;
    private shown = -1;
    private share = 0;

    public constructor() {
        super();
        const style = (size: number, fill = 0xffffff) => new PIXI.TextStyle({
            fontFamily: UiKit.fontFamily('primary'), fontSize: size, fill, stroke: COLORS.rim, strokeThickness: 5, lineJoin: 'round',
        });
        const bar = new PIXI.Graphics()
            .beginFill(COLORS.rim).drawRoundedRect(RADIUS - 6, -BAR.height / 2 - 3, BAR.width + BAR.gap + 9, BAR.height + 6, (BAR.height + 6) / 2).endFill()
            .beginFill(COLORS.bar).drawRoundedRect(RADIUS + BAR.gap, -BAR.height / 2, BAR.width, BAR.height, BAR.height / 2).endFill();
        this.addChild(bar, this.fill);
        this.disc.beginFill(COLORS.rim).drawCircle(0, 0, RADIUS + 4).endFill()
            .beginFill(COLORS.disc).drawCircle(0, 0, RADIUS).endFill()
            .beginFill(0xffffff, 0.35).drawEllipse(-6, -11, RADIUS * 0.55, RADIUS * 0.3).endFill();
        this.addChild(this.disc);
        this.number = new PIXI.Text('1', style(30));
        this.number.anchor.set(0.5);
        this.number.y = 2;
        this.disc.addChild(this.number);
        this.caption = new PIXI.Text('LEVEL', style(16));
        this.caption.anchor.set(0, 0.5);
        this.caption.position.set(RADIUS + BAR.gap + 8, -BAR.height / 2 - 12);
        this.addChild(this.caption);
    }

    /** The level and the XP into it (`into` of `need`). */
    public set(level: number, into: number, need: number): void {
        const share = Math.max(0, Math.min(1, into / Math.max(1, need)));
        if (level !== this.shown) {
            const up = this.shown > 0 && level > this.shown;
            this.shown = level;
            this.number.text = String(level);
            if (up) {
                gsap.killTweensOf(this.disc.scale);
                this.disc.scale.set(1.5);
                gsap.to(this.disc.scale, { x: 1, y: 1, duration: 0.6, ease: 'elastic.out(1, 0.5)' });
            }
        }
        if (Math.abs(share - this.share) < 0.001 && this.fill.geometry.graphicsData.length) return;
        this.share = share;
        this.fill.clear();
        if (share <= 0) return;
        const width = Math.max(BAR.height, BAR.width * share);
        this.fill.beginFill(COLORS.fill).drawRoundedRect(RADIUS + BAR.gap, -BAR.height / 2, width, BAR.height, BAR.height / 2).endFill()
            .beginFill(0xffffff, 0.3).drawRoundedRect(RADIUS + BAR.gap + 4, -BAR.height / 2 + 3, Math.max(0, width - 8), BAR.height / 3, BAR.height / 6).endFill();
    }

    public override destroy(): void {
        gsap.killTweensOf(this.disc.scale);
        super.destroy({ children: true });
    }
}
