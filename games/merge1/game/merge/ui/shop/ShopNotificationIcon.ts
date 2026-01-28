import { Game } from "@core/Game";
import * as PIXI from "pixi.js";
import { ShopManager } from "../../data/ShopManager";
import MergeAssets from "../../MergeAssets";

export class ShopNotificationIcon extends PIXI.Container {
    private sprite: PIXI.Sprite = PIXI.Sprite.from(MergeAssets.Textures.UI.Exclamation);
    private _elapsedTime: number = 0;

    constructor() {
        super();
        this.visible = ShopManager.instance.hasAffordableItems();

        this.sprite.anchor.set(0.5);
        this.addChild(this.sprite);

        ShopManager.instance.onAvailabilityChanged.add((isAvailable: boolean) => {
            this.visible = isAvailable;
            if (isAvailable) {
                // Reset time when it becomes visible so the animation starts fresh
                this._elapsedTime = 0;
            }
        });
    }

    /**
     * Overriding updateTransform is a common way in PIXI to handle 
     * per-frame logic without a separate ticker.
     */
    override updateTransform(): void {
        super.updateTransform();

        if (!this.visible) return;

        // Increment time using seconds
        this._elapsedTime += Game.deltaTime;

        // Configuration for the bounce
        const speed = 5;      // How fast it bounces
        const amplitude = 5; // How many pixels it moves up/down
        const scalePulse = 0.1; // How much it grows/shrinks (0.1 = 10%)

        // Calculate bounce offset using Sine
        // Math.sin returns a value between -1 and 1
        const bounce = Math.sin(this._elapsedTime * speed);

        // Apply to Y position (relative to container origin)
        this.sprite.y = bounce * amplitude;

        // Apply to Scale for extra "juice" (pulsing effect)
        const currentScale = 1 + (bounce * scalePulse);
        this.sprite.scale.set(currentScale);
    }
}