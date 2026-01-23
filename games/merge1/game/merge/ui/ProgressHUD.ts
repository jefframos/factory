import { gsap } from "gsap";
import * as PIXI from "pixi.js";

export class ProgressHUD extends PIXI.Container {
    private barWidth: number = 240;
    private barHeight: number = 24;
    private fill: PIXI.Graphics;
    private levelText: PIXI.Text;
    private xpText: PIXI.Text;

    constructor() {
        super();

        // 1. Background
        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.5);
        bg.drawRoundedRect(0, 0, this.barWidth, this.barHeight, 8);
        this.addChild(bg);

        // 2. XP Fill
        this.fill = new PIXI.Graphics();
        this.fill.beginFill(0x3cf060);
        this.fill.drawRect(0, 0, this.barWidth, this.barHeight);
        this.fill.width = 0;
        this.addChild(this.fill);

        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff);
        mask.drawRoundedRect(0, 0, this.barWidth, this.barHeight, 8);
        this.fill.mask = mask;
        this.addChild(mask);

        // 3. Texts
        this.levelText = new PIXI.Text(`LV. 1`, { fill: 0xffffff, fontSize: 18, fontWeight: 'bold' });
        this.levelText.position.set(-70, 0);
        this.addChild(this.levelText);

        this.xpText = new PIXI.Text(`0 / 0`, { fill: 0xffffff, fontSize: 12 });
        this.xpText.anchor.set(0.5);
        this.xpText.position.set(this.barWidth / 2, this.barHeight / 2);
        this.addChild(this.xpText);
    }

    /**
     * Now called by MergeHUD
     */
    public updateValues(level: number, current: number, required: number): void {
        const ratio = Math.min(current / required, 1);

        gsap.to(this.fill, { width: this.barWidth * ratio, duration: 0.4, ease: "power2.out" });
        this.levelText.text = `LV. ${level}`;
        this.xpText.text = `${Math.floor(current)} / ${Math.floor(required)}`;
    }

    public playLevelUpEffect(newLevel: number): void {
        this.levelText.text = `LV. ${newLevel}`;
        gsap.fromTo(this.levelText.scale, { x: 1.5, y: 1.5 }, { x: 1, y: 1, duration: 0.6, ease: "back.out" });
    }
}