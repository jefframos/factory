import * as PIXI from "pixi.js";
import { WheelPrize } from "./SpinningWheel";

export default class WheelSlice extends PIXI.Container {
    private bg: PIXI.Graphics;
    private highlight: PIXI.Graphics;
    private icon: PIXI.Sprite;
    private divider: PIXI.Sprite;

    constructor() {
        super();
        this.bg = new PIXI.Graphics();
        this.highlight = new PIXI.Graphics();
        this.icon = new PIXI.Sprite();
        this.divider = new PIXI.Sprite();

        this.addChild(this.bg, this.highlight, this.divider, this.icon);
        this.highlight.visible = false;
        this.highlight.blendMode = PIXI.BLEND_MODES.ADD;
    }

    public setup(
        prize: WheelPrize,
        color: number,
        angleDeg: number,
        sliceAngle: number,
        radius: number,
        tex: PIXI.Texture,
        dividerTex: PIXI.Texture
    ): void {
        const startRad = (angleDeg) * (Math.PI / 180);
        const endRad = (angleDeg + sliceAngle) * (Math.PI / 180);
        const midRad = startRad + (endRad - startRad) / 2;

        // 1. Draw Background
        this.bg.clear().beginFill(color).moveTo(0, 0)
            .arc(0, 0, radius, startRad, endRad).lineTo(0, 0).endFill();

        // 2. Draw Highlight (identical shape, white/bright)
        this.highlight.clear().beginFill(0xFFFFFF, 0.4).moveTo(0, 0)
            .arc(0, 0, radius, startRad, endRad).lineTo(0, 0).endFill();

        // 3. Setup Divider
        this.divider.texture = dividerTex;
        this.divider.anchor.set(0.5, 1);
        this.divider.height = radius;
        this.divider.rotation = startRad + (Math.PI / 2);

        // 4. Setup Icon
        this.icon.texture = tex;
        this.icon.anchor.set(0.5);
        const dist = radius * 0.7;
        this.icon.x = Math.cos(midRad) * dist;
        this.icon.y = Math.sin(midRad) * dist;
        this.icon.rotation = midRad + (Math.PI / 2);
    }

    public setHighlight(active: boolean): void {
        this.highlight.visible = active;
    }
}