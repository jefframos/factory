import * as PIXI from 'pixi.js';

export interface NineSliceProgressBarOptions {
    width: number;
    height: number;
    /** Asset key or Texture for the background frame */
    bgTexture: PIXI.Texture;
    /** Asset key or Texture for the moving fill */
    barTexture: PIXI.Texture;
    /** The size of the corners [left, top, right, bottom] */
    leftWidth: number;
    topHeight: number;
    rightWidth: number;
    bottomHeight: number;
    /** Optional Tints */
    bgColor?: number;
    barColor?: number;
}

export class NineSliceProgressBar extends PIXI.Container {
    private bg: PIXI.NineSlicePlane;
    private bar: PIXI.NineSlicePlane;
    private opts: NineSliceProgressBarOptions;

    // The minimum width to prevent 9-slice artifacts (left + right slices)
    private minVisualWidth: number;

    constructor(opts: NineSliceProgressBarOptions) {
        super();
        this.opts = opts;
        this.minVisualWidth = opts.leftWidth + opts.rightWidth;

        // 1. Setup Background
        this.bg = new PIXI.NineSlicePlane(
            opts.bgTexture,
            opts.leftWidth, opts.topHeight, opts.rightWidth, opts.bottomHeight
        );
        this.bg.width = opts.width;
        this.bg.height = opts.height;
        if (opts.bgColor !== undefined) this.bg.tint = opts.bgColor;

        // 2. Setup Bar Fill
        this.bar = new PIXI.NineSlicePlane(
            opts.barTexture,
            opts.leftWidth, opts.topHeight, opts.rightWidth, opts.bottomHeight
        );
        this.bar.height = opts.height;
        if (opts.barColor !== undefined) this.bar.tint = opts.barColor;

        this.addChild(this.bg, this.bar);

        // Center pivot like the original class
        this.pivot.set(opts.width / 2, opts.height / 2);

        this.update(0);
    }

    /**
     * Updates the progress bar
     * @param percent value between 0 and 1
     */
    public update(percent: number): void {
        const clampedPercent = Math.max(0, Math.min(1, percent));

        // Calculate target width based on total width
        const targetWidth = clampedPercent * this.opts.width;

        // Logic: If the width is less than the corners, we hide it or 
        // cap it to the minVisualWidth to prevent texture folding.
        if (targetWidth < this.minVisualWidth) {
            // If progress is very low, it's often better to scale the 
            // whole slice down or just hide it to avoid visual glitches
            this.bar.visible = targetWidth > 0;
            this.bar.width = this.minVisualWidth;
            // Scale the x-axis specifically for tiny values to "squeeze" it in
            this.bar.scale.x = targetWidth / this.minVisualWidth;
        } else {
            this.bar.visible = true;
            this.bar.scale.x = 1;
            this.bar.width = targetWidth;
        }
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        this.bg.destroy();
        this.bar.destroy();
        super.destroy(options);
    }
}