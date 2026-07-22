import { ColorGradient } from 'core/vfx/ColorGradient';
import * as PIXI from 'pixi.js';

export interface VerticalNineSliceProgressBarOptions {
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
    padding?: number;
    gradient?: ColorGradient;
}

/**
 * Vertical counterpart to NineSliceProgressBar — fills from the BOTTOM up
 * instead of left-to-right. The fill's HEIGHT grows with `percent`, same
 * as the horizontal bar grows WIDTH, but its position is recalculated each
 * update() so its bottom edge always lines up with the background's own
 * bottom edge — a plain top-anchored fill (what you'd get by just copying
 * the horizontal bar's approach onto the Y axis) would instead grow
 * downward from a fixed top, which reads backwards for a "filling up" bar.
 */
export class VerticalNineSliceProgressBar extends PIXI.Container {
    private bg: PIXI.NineSlicePlane;
    private bar: PIXI.NineSlicePlane;
    private opts: VerticalNineSliceProgressBarOptions;

    // The minimum height to prevent 9-slice artifacts (top + bottom slices)
    private minVisualHeight: number;

    constructor(opts: VerticalNineSliceProgressBarOptions) {
        super();
        this.opts = opts;

        this.opts = {
            padding: 0,
            bgColor: 0xffffff,
            barColor: 0xffffff,
            ...opts
        };

        this.minVisualHeight = opts.topHeight + opts.bottomHeight;

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
        this.bar.width = this.opts.width - ((this.opts.padding || 0) * 2);
        this.bar.position.x = this.opts.padding || 0;

        if (opts.barColor !== undefined) this.bar.tint = opts.barColor;

        this.addChild(this.bg, this.bar);

        // Center pivot like the original class
        this.pivot.set(opts.width / 2, opts.height / 2);

        this.update(0);
    }

    public setTintColor(color: number) {
        this.bar.tint = color
    }

    /**
     * Updates the progress bar
     * param percent value between 0 and 1 — 0 is empty, 1 is full to the top.
     */
    public update(percent: number): void {
        const clampedPercent = Math.max(0, Math.min(1, percent));
        const padding = this.opts.padding || 0;

        const available = this.opts.height - (padding * 2);

        // Calculate target height based on total height
        const targetHeight = clampedPercent * available;

        // --- Evaluation Logic ---
        if (this.opts.gradient) {
            this.bar.tint = this.opts.gradient.evaluate(clampedPercent);
        } else if (this.opts.barColor !== undefined) {
            this.bar.tint = this.opts.barColor;
        }

        // Logic: If the height is less than the corners, cap it to
        // minVisualHeight and scale the y-axis down to "squeeze" it in,
        // same trick the horizontal bar uses on its x-axis — prevents the
        // 9-slice's corner segments from folding over each other at tiny
        // progress values.
        if (targetHeight < this.minVisualHeight) {
            this.bar.visible = targetHeight > 0;
            this.bar.height = this.minVisualHeight;
            this.bar.scale.y = targetHeight / this.minVisualHeight;
        } else {
            this.bar.visible = true;
            this.bar.scale.y = 1;
            this.bar.height = targetHeight;
        }

        // Bottom-anchor: the bar's own top-left origin sits `targetHeight`
        // above the background's bottom edge (height - padding), so it
        // always grows upward from a fixed bottom instead of downward
        // from a fixed top.
        this.bar.position.y = this.opts.height - padding - targetHeight;
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        this.bg.destroy();
        this.bar.destroy();
        super.destroy(options);
    }
}
