import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import HexAssets from "../HexAssets";

export interface ItemBeltButtonConfig {
    icon: string;
    amount: number;
    isLocked: boolean;
    blockAds: boolean;
    onUse: () => void;
    onWatchAd: () => void;
}

export class ItemBeltButton extends PIXI.Container {
    private button: BaseButton;
    private pill: PIXI.NineSlicePlane;
    private amountLabel: PIXI.BitmapText;
    private lockIcon?: PIXI.Sprite;
    private amount: number;

    constructor(private config: ItemBeltButtonConfig) {
        super();
        this.amount = config.amount;

        // 1. Base Button Setup
        this.button = new BaseButton({
            standard: {
                width: 90,
                height: 90,
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Blue),
                iconTexture: PIXI.Texture.from(config.icon),
                iconSize: { width: 60, height: 60 },
                centerIconHorizontally: true,
                centerIconVertically: true,
            },
            disabled: {
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Grey),
            },
            click: { callback: () => this.handlePress() }
        });
        this.addChild(this.button);

        // 2. Amount Pill (Nine-slice)
        const pillTexture = PIXI.Texture.from(HexAssets.Textures.UI.BarBg);
        this.pill = new PIXI.NineSlicePlane(pillTexture, 10, 10, 10, 10);
        this.pill.width = 40;
        this.pill.height = 25;
        this.pill.position.set(45, 60); // Bottom Right-ish

        this.amountLabel = new PIXI.BitmapText(this.amount.toString(), {
            fontName: HexAssets.MainFont.fontFamily,
            fontSize: 16
        });
        this.amountLabel.anchor.set(0.5);
        this.amountLabel.position.set(this.pill.width / 2, this.pill.height / 2);
        this.pill.addChild(this.amountLabel);
        if (!config.blockAds) {
            this.addChild(this.pill);
        }

        this.setLocked(config.isLocked);
        this.refreshAmount(this.amount);
    }

    private handlePress(): void {
        if (this.config.isLocked) return;

        if (this.amount > 0 || this.config.blockAds) {
            this.config.onUse();
        } else {
            this.config.onWatchAd();
        }
    }

    public setLocked(locked: boolean): void {
        this.config.isLocked = locked;
        if (locked) {
            this.button.alpha = 0.85;
            this.button.disable();
            //this.button.tint = 0x888888;
            if (!this.lockIcon) {
                this.lockIcon = PIXI.Sprite.from(HexAssets.Textures.Icons.Lock);
                this.lockIcon.anchor.set(0.5);
                this.lockIcon.position.set(0, 0); // Center
                this.addChild(this.lockIcon);
            }
            this.pill.visible = false;
        } else {
            this.button.alpha = 1;
            this.button.enable();
            //this.button.tint = 0xffffff;
            if (this.lockIcon) this.lockIcon.visible = false;
            this.pill.visible = true;
        }
    }

    public refreshAmount(val: number): void {
        this.amount = val;
        this.amountLabel.text = val > 0 ? val.toString() : "+";
        // Optionally change pill color if 0 (waiting for ad)
    }
}