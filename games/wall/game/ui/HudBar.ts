// HudBar.ts
//
// The HUD's progress bars, from the Layer Lab kit (library3d/2d, Slider_Level02: a dark track with a thick black rim, a
// fill with a lit top, a darker bottom and a black edge where it ends), the same shape at any height (Mow's).
//
// The fills are the kit's Fill02 with its middle drawn out (Slider_Level02_FillWide_*): the kit's own are a few pixels of
// colour by a black edge, which smears along a bar when they're stretched.

import * as PIXI from 'pixi.js';

/** The track's source height, its rim (the fill sits inside it) and the fill's height. */
const SOURCE = { height: 70, rim: 5, fill: 60 };
const FRAMES = { track: 'Slider_Level02_Bg_Single', white: 'Slider_Level02_FillWide_White' };

/** A track with a fill along it, its left middle at the origin. */
export class HudBar extends PIXI.Container {
    private readonly fill: PIXI.NineSlicePlane;
    /** Drawn at this much of its source size. */
    private readonly artScale: number;
    private share = -1;
    private from = 0;

    /** `color`: the fill's. */
    public constructor(private readonly barWidth: number, height: number, color: number) {
        super();
        this.artScale = height / SOURCE.height;
        const track = new PIXI.NineSlicePlane(PIXI.Texture.from(FRAMES.track), 11, 24, 11, 15);
        track.scale.set(this.artScale);
        track.width = barWidth / this.artScale;
        track.height = SOURCE.height;
        track.y = -height / 2;
        this.fill = new PIXI.NineSlicePlane(PIXI.Texture.from(FRAMES.white), 8, 0, 6, 0);
        this.fill.scale.set(this.artScale);
        this.fill.height = SOURCE.fill;
        this.fill.position.set(SOURCE.rim * this.artScale, (-SOURCE.fill / 2) * this.artScale);
        this.fill.tint = color;
        this.addChild(track, this.fill);
        this.setShare(0);
    }

    /** The fill starts here (px from the left: what a badge over its end covers). */
    public setFrom(from: number): void {
        if (from === this.from) return;
        this.from = from;
        const share = this.share;
        this.share = -1;
        this.setShare(share);
    }

    public setShare(share: number): void {
        share = Math.max(0, Math.min(1, share));
        if (Math.abs(share - this.share) < 0.0005) return;
        this.share = share;
        this.fill.visible = share > 0;
        const inside = this.barWidth / this.artScale - SOURCE.rim * 2;
        const from = this.from / this.artScale;
        this.fill.width = Math.max(16, from + (inside - from) * share);
    }

    public setColor(color: number): void {
        this.fill.tint = color;
    }
}
