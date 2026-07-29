import { ColorGradient } from 'core/vfx/ColorGradient';
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
    padding?: number;
    gradient?: ColorGradient;
    /**
     * When true, the fill never has its width/scale touched — it's drawn
     * at full size and a rectangular mask is grown/shrunk over it instead.
     * Avoids the 9-slice corner squish `minVisualWidth` otherwise works
     * around at very low percentages, at the cost of one extra Graphics
     * object. Off by default (existing width-driven behavior unchanged).
     */
    useMask?: boolean;
}

export class NineSliceProgressBar extends PIXI.Container {
    private bg: PIXI.NineSlicePlane;
    private bar: PIXI.NineSlicePlane;
    private opts: NineSliceProgressBarOptions;

    // The minimum width to prevent 9-slice artifacts (left + right slices)
    private minVisualWidth: number;

    /** Only built when opts.useMask is true — see update(). */
    private fillMask?: PIXI.Graphics;

    constructor(opts: NineSliceProgressBarOptions) {
        super();
        this.opts = opts;

        this.opts = {
            padding: 0,
            bgColor: 0xffffff,
            barColor: 0xffffff,
            ...opts
        };

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

        this.bar.height = this.opts.height - ((this.opts.padding || 0) * 2);
        // Position bar offset by padding
        this.bar.position.set(this.opts.padding, this.opts.padding);

        if (opts.barColor !== undefined) this.bar.tint = opts.barColor;

        this.addChild(this.bg, this.bar);

        if (this.opts.useMask) {
            // Bar drawn at full, undistorted size — the mask (not the bar's
            // own width/scale) is what actually reveals/hides it, so the
            // 9-slice corners never squish at low percentages the way the
            // width-driven path's minVisualWidth clamp otherwise works
            // around.
            this.bar.width = opts.width;
            this.bar.scale.x = 1;

            this.fillMask = new PIXI.Graphics();
            this.fillMask.position.copyFrom(this.bar.position);
            this.addChild(this.fillMask);
            this.bar.mask = this.fillMask;
        }

        // Center pivot like the original class
        this.pivot.set(opts.width / 2, opts.height / 2);

        this.update(0);
    }
    public setTintColor(color: number) {
        this.bar.tint = color
    }
    /**
     * Updates the progress bar
     * param percent value between 0 and 1
     */
    public update(percent: number): void {
        const clampedPercent = Math.max(0, Math.min(1, percent));

        const available = this.opts.width - ((this.opts.padding || 0) * 2);

        // Calculate target width based on total width
        const targetWidth = clampedPercent * available;

        // --- Evaluation Logic ---
        if (this.opts.gradient) {
            this.bar.tint = this.opts.gradient.evaluate(clampedPercent);
        } else if (this.opts.barColor !== undefined) {
            this.bar.tint = this.opts.barColor;
        }

        if (this.fillMask) {
            this.bar.visible = targetWidth > 0;
            this.fillMask.clear();
            this.fillMask.beginFill(0xffffff);
            this.fillMask.drawRect(0, 0, targetWidth, this.bar.height);
            this.fillMask.endFill();
            return;
        }

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
        this.fillMask?.destroy();
        super.destroy(options);
    }
}