import * as PIXI from 'pixi.js';

export interface ProgressBarOptions {
    /** Total width of the bar in pixels */
    width: number;
    /** Total height of the bar in pixels */
    height: number;
    /** X position (defaults to centering in resize) */
    x?: number;
    /** Y position (defaults to centering in resize) */
    y?: number;
    /** Background color */
    bgColor?: number;
    /** Fill color */
    barColor?: number;
}

/**
 * A simple progress bar with fixed dimensions.
 */
export class ProgressBar extends PIXI.Container {
    private bg: PIXI.Graphics;
    private bar: PIXI.Graphics;
    private opts: Required<ProgressBarOptions>;

    constructor(opts: ProgressBarOptions) {
        super();

        // apply defaults for optional colors
        this.opts = {
            bgColor: opts.bgColor ?? 0x222222,
            barColor: opts.barColor ?? 0xffffff,
            width: opts.width,
            height: opts.height,
            x: opts.x ?? 0,
            y: opts.y ?? 0,
        };

        this.bg = new PIXI.Graphics();
        this.bar = new PIXI.Graphics();
        this.addChild(this.bg, this.bar);

        // initial draw
        this.drawBackground();
        this.drawBar(0);

        this.pivot.x = this.opts.width / 2
        this.pivot.y = this.opts.height / 2
    }

    /** Redraws the background rectangle */
    private drawBackground(): void {
        this.bg.clear();
        this.bg.beginFill(this.opts.bgColor);
        this.bg.drawRect(this.opts.x, this.opts.y, this.opts.width, this.opts.height);
        this.bg.endFill();
    }

    /** Redraws the fill at [percent] (0–1) */
    private drawBar(percent: number): void {
        const w = Math.max(0, Math.min(1, percent)) * this.opts.width;
        this.bar.clear();
        this.bar.beginFill(this.opts.barColor);
        this.bar.drawRect(this.opts.x, this.opts.y, w, this.opts.height);
        this.bar.endFill();
    }



    /**
     * Update the fill based on [percent] (0–1).
     */
    public update(percent: number): void {
        this.drawBar(percent);
    }

    /**
     * Clean up resources.
     */
    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        this.bg.destroy();
        this.bar.destroy();
        super.destroy(options);
    }
}
