import * as PIXI from "pixi.js";
import { ShopManager } from "../../data/ShopManager";
import MergeAssets from "../../MergeAssets";

export class ShopNotificationIcon extends PIXI.Container {
    private sprite: PIXI.Sprite = PIXI.Sprite.from(MergeAssets.Textures.UI.Exclamation)
    constructor() {
        super();
        this.visible = ShopManager.instance.hasAffordableItems();
        this.addChild(this.sprite)
        this.sprite.anchor.set(0.5)
        ShopManager.instance.onAvailabilityChanged.add((isAvailable: boolean) => {
            this.visible = isAvailable;
            if (isAvailable) {
                // this.playBounceAnimation(); // Optional: juice it up!
            }
        });
    }
}