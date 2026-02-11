import { NumberConverter } from "@core/utils/NumberConverter";
import ViewUtils from "@core/utils/ViewUtils";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";

// We no longer need the InGameEconomy import here.
// Keeping CurrencyType only if you use it as a label/ID.

export interface ICurrencyBoxConfig {
    iconId: string;
    fontName: string;
    fontSize?: number;
    bgId?: string;
    width?: number;
    initialValue?: number;
}

export class StarBox extends PIXI.Container {
    private label: PIXI.BitmapText;
    private icon: PIXI.Sprite;
    private background?: PIXI.NineSlicePlane;

    private currentValue: number = 0;
    private readonly boxHeight: number = 40;
    private readonly padding: number = 10;
    private readonly spacing: number = 2;

    // Store the signal reference so we can unsubscribe later
    private updateSignal: any;

    constructor(config: ICurrencyBoxConfig, updateSignal: any) {
        super();

        this.updateSignal = updateSignal;
        this.currentValue = config.initialValue || 0;

        // 1. Optional Background
        if (config.bgId) {
            const texture = PIXI.Texture.from(config.bgId);
            this.background = new PIXI.NineSlicePlane(texture, 15, 15, 15, 15);
            this.background.width = config.width || 180;
            this.background.height = this.boxHeight;
            this.addChild(this.background);
        }

        // 2. Icon Setup
        this.icon = PIXI.Sprite.from(config.iconId);
        this.icon.anchor.set(0.5);
        const targetIconSize = this.boxHeight * 1.2;
        this.icon.scale.set(ViewUtils.elementScaler(this.icon, targetIconSize));
        this.icon.x = this.padding;
        this.icon.y = this.boxHeight / 2;
        this.addChild(this.icon);

        // 3. Label Setup
        this.label = new PIXI.BitmapText(NumberConverter.format(this.currentValue), {
            fontName: config.fontName,
            fontSize: config.fontSize || 24,
            align: "left"
        });
        this.label.anchor.set(0, 0.5);
        this.label.x = this.icon.x + (this.icon.width / 2) + this.spacing;
        this.label.y = this.boxHeight / 2 - 5;
        this.addChild(this.label);

        // 4. Hook External Signal
        // This assumes the signal sends the new value as the first argument
        this.updateSignal.add(this.onValueUpdate, this);
    }

    /**
     * Listener for the External Signal
     */
    private onValueUpdate(newValue: number): void {
        this.animateValue(newValue);
    }

    /**
     * Internal animation logic
     */
    private animateValue(targetValue: number): void {
        gsap.killTweensOf(this.label);
        gsap.killTweensOf(this.icon.scale);

        const tweenObj = { val: this.currentValue };

        gsap.to(tweenObj, {
            val: targetValue,
            duration: 0.5,
            ease: "power2.out",
            onUpdate: () => {
                this.label.text = NumberConverter.format(tweenObj.val);
            },
            onComplete: () => {
                this.currentValue = targetValue;
                this.label.text = NumberConverter.format(targetValue);
            }
        });

        const targetIconSize = this.boxHeight * 1.2;
        let baseScale = (ViewUtils.elementScaler(this.icon, targetIconSize));

        gsap.fromTo(this.icon.scale,
            { x: baseScale * 1.3, y: baseScale * 1.3 },
            { x: baseScale, y: baseScale, duration: 0.4, ease: "back.out(2)" }
        );
    }

    public getIconGlobalPosition(): PIXI.Point {
        return this.icon.getGlobalPosition();
    }

    public destroy(options?: any): void {
        // Unsubscribe from the external signal
        if (this.updateSignal) {
            this.updateSignal.remove(this.onValueUpdate, this);
        }

        gsap.killTweensOf(this.label);
        gsap.killTweensOf(this.icon.scale);
        super.destroy(options);
    }
}