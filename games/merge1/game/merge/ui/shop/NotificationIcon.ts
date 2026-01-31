import { Game } from "@core/Game";
import * as PIXI from "pixi.js";
import MergeAssets from "../../MergeAssets";

export class NotificationIcon extends PIXI.Container {
    private sprite: PIXI.Sprite = PIXI.Sprite.from(MergeAssets.Textures.UI.Exclamation);
    private _elapsedTime: number = 0;
    private _checkCondition: () => boolean;

    /**
     * @param checkCondition A function that returns true if the icon should show
     * @param changeSignal (Optional) An event/signal to listen to for immediate updates
     */
    constructor(checkCondition: () => boolean, changeSignal?: { add: (cb: (val: boolean) => void) => void }) {
        super();
        this._checkCondition = checkCondition;

        this.sprite.anchor.set(0.5);
        this.addChild(this.sprite);

        // Initial state
        this.refreshVisibility();

        // If a signal is provided, bind it
        if (changeSignal) {
            changeSignal.add((isAvailable: boolean) => {
                this.visible = isAvailable;
                if (isAvailable) this._elapsedTime = 0;
            });
        }
    }

    public refreshVisibility(): void {
        const shouldBeVisible = this._checkCondition();
        if (shouldBeVisible && !this.visible) {
            this._elapsedTime = 0; // Reset animation on pop-in
        }
        this.visible = shouldBeVisible;
    }

    override updateTransform(): void {
        super.updateTransform();

        if (!this.visible) return;

        this._elapsedTime += Game.deltaTime;

        const speed = 5;
        const amplitude = 5;
        const scalePulse = 0.1;

        // Sine now goes -1 to 1, providing a full up/down range
        const wave = Math.sin(this._elapsedTime * speed);

        // Movement and "Juice"
        this.sprite.y = wave * amplitude;
        this.sprite.scale.set(1 + (wave * scalePulse));
    }
}