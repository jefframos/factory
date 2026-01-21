import * as PIXI from 'pixi.js';

export interface AsyncProgressBarOptions {
    width: number;
    height: number;
    bgPath: string;
    barPath: string;
    slices: [number, number, number, number];
    /** Pixels of space between the background edge and the fill */
    padding?: number;
    bgColor?: number;
    barColor?: number;
}

export class NineSliceProgressBarAsync extends PIXI.Container {
    private bg?: PIXI.NineSlicePlane;
    private bar?: PIXI.NineSlicePlane;
    private placeholder?: PIXI.Graphics;

    private opts: Required<AsyncProgressBarOptions>;
    private currentPercent: number = 0;
    private minVisualWidth: number;

    constructor(opts: AsyncProgressBarOptions) {
        super();
        // Apply defaults
        this.opts = {
            padding: 0,
            bgColor: 0xffffff,
            barColor: 0xffffff,
            ...opts
        };

        this.minVisualWidth = opts.slices[0] + opts.slices[2];

        this.placeholder = new PIXI.Graphics();
        this.placeholder.beginFill(0x000000, 0.1);
        this.placeholder.drawRect(0, 0, opts.width, opts.height);
        this.addChild(this.placeholder);

        this.pivot.set(opts.width / 2, opts.height / 2);
        this.init();
    }

    private async init() {
        try {
            const [bgTex, barTex] = await Promise.all([
                PIXI.Assets.load<PIXI.Texture>(this.opts.bgPath),
                PIXI.Assets.load<PIXI.Texture>(this.opts.barPath)
            ]);

            if (this.placeholder) {
                this.placeholder.destroy();
                this.placeholder = undefined;
            }

            const [l, t, r, b] = this.opts.slices;

            // 1. Background
            this.bg = new PIXI.NineSlicePlane(bgTex, l, t, r, b);
            this.bg.width = this.opts.width;
            this.bg.height = this.opts.height;
            this.bg.tint = this.opts.bgColor;

            // 2. Bar Fill
            this.bar = new PIXI.NineSlicePlane(barTex, l, t, r, b);
            // Height is total height minus padding on top and bottom
            this.bar.height = this.opts.height - (this.opts.padding * 2);
            // Position bar offset by padding
            this.bar.position.set(this.opts.padding, this.opts.padding);
            this.bar.tint = this.opts.barColor;

            this.addChild(this.bg);
            this.addChild(this.bar);

            this.update(this.currentPercent);
        } catch (e) {
            console.error("Failed to load Progress Bar textures:", e);
        }
    }

    public update(percent: number): void {
        this.currentPercent = Math.max(0, Math.min(1, percent));

        if (!this.bar) return;

        // Calculate available width for the fill (total width minus left/right padding)
        const availableWidth = this.opts.width - (this.opts.padding * 2);
        const targetWidth = this.currentPercent * availableWidth;

        if (targetWidth < this.minVisualWidth) {
            this.bar.visible = targetWidth > 0;
            this.bar.width = this.minVisualWidth;
            // Scale fill to handle the tiny gap between 0 and minVisualWidth
            this.bar.scale.x = targetWidth / this.minVisualWidth;
        } else {
            this.bar.visible = true;
            this.bar.scale.x = 1;
            this.bar.width = targetWidth;
        }
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        this.placeholder?.destroy();
        this.bg?.destroy();
        this.bar?.destroy();
        super.destroy(options);
    }
}