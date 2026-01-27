import { NumberConverter } from "@core/utils/NumberConverter";
import ViewUtils from "@core/utils/ViewUtils";
import { gsap } from "gsap";
import * as PIXI from "pixi.js";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";

export interface ICurrencyBoxConfig {
    iconId: string;
    fontName: string;
    fontSize?: number;
    bgId?: string;
    width?: number;
}

export class CurrencyBox extends PIXI.Container {
    private label: PIXI.BitmapText;
    private icon: PIXI.Sprite;
    private background?: PIXI.NineSlicePlane;

    private currentValue: number = 0;
    private readonly boxHeight: number = 40;
    private readonly padding: number = 10;  // Inner distance from left edge
    private readonly spacing: number = 2;  // Gap between icon and text

    constructor(private type: CurrencyType, config: ICurrencyBoxConfig) {
        super();

        // 1. Optional Background
        if (config.bgId) {
            const texture = PIXI.Texture.from(config.bgId);
            this.background = new PIXI.NineSlicePlane(texture, 15, 15, 15, 15);
            this.background.width = config.width || 180;
            this.background.height = this.boxHeight;
            this.background.pivot.set(0, 0);
            this.addChild(this.background);
        }

        // 2. Icon Setup
        this.icon = PIXI.Sprite.from(config.iconId);
        this.icon.anchor.set(0.5);

        // Scale the icon relative to the box height (80% of height)
        const targetIconSize = this.boxHeight * 1.2;
        this.icon.scale.set(ViewUtils.elementScaler(this.icon, targetIconSize));

        // Position: Padding + Half width (because of 0.5 anchor)
        this.icon.x = this.padding;
        this.icon.y = this.boxHeight / 2;
        this.addChild(this.icon);

        // 3. Label Setup
        this.label = new PIXI.BitmapText("0", {
            fontName: config.fontName,
            fontSize: config.fontSize || 24,
            align: "left"
        });
        this.label.anchor.set(0, 0.5);

        // Position: End of icon + spacing
        this.label.x = this.icon.x + (this.icon.width / 2) + this.spacing;
        this.label.y = this.boxHeight / 2 - 5;
        this.addChild(this.label);

        // 4. Hook Economy Signal
        InGameEconomy.instance.onCurrencyChanged.add(this.onCurrencyUpdate, this);

        // 5. Set Initial State
        this.currentValue = InGameEconomy.instance.getAmount(this.type);
        this.label.text = NumberConverter.format(this.currentValue);
    }

    /**
     * Listener for the Economy Signal
     */
    private onCurrencyUpdate(type: CurrencyType, newValue: number): void {
        if (type !== this.type) return;
        this.animateValue(newValue);
    }

    /**
     * Internal animation logic for "Juice"
     */
    private animateValue(targetValue: number): void {
        // Prevent overlapping animations
        gsap.killTweensOf(this.label);
        gsap.killTweensOf(this.icon.scale);

        const tweenObj = { val: this.currentValue };

        // Number ticker animation
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

        // Icon "Punch" scale effect
        // We recalculate the base scale to ensure the "punch" is relative to current size
        const targetIconSize = this.boxHeight * 1.2;
        let baseScale = (ViewUtils.elementScaler(this.icon, targetIconSize));

        gsap.fromTo(this.icon.scale,
            { x: baseScale * 1.3, y: baseScale * 1.3 },
            { x: baseScale, y: baseScale, duration: 0.4, ease: "back.out(2)" }
        );
    }

    /**
     * Returns the global position of the icon for fly-to effects
     */
    public getIconGlobalPosition(): PIXI.Point {
        return this.icon.getGlobalPosition();
    }

    /**
     * Proper cleanup
     */
    public destroy(options?: any): void {
        InGameEconomy.instance.onCurrencyChanged.remove(this.onCurrencyUpdate, this);
        gsap.killTweensOf(this.label);
        gsap.killTweensOf(this.icon.scale);
        super.destroy(options);
    }
}