import { Game } from "@core/Game";
import SoundToggleButton from "@core/ui/SoundToggleButton";
import * as PIXI from "pixi.js";
import MergeAssets from "../MergeAssets";
import { createDefaultLevelSelectTheme } from "../themes/MainTheme";

export default class MergeHUD extends PIXI.Container {
    private soundToggleButton: SoundToggleButton;

    constructor() {
        super();
        const theme = createDefaultLevelSelectTheme();

        this.soundToggleButton = new SoundToggleButton(
            MergeAssets.Textures.Icons.SoundOn,
            MergeAssets.Textures.Icons.SoundOff
        );

        this.addChild(this.soundToggleButton);
    }

    public updateLayout(): void {
        // Position HUD container at top-left
        this.x = Game.overlayScreenData.topLeft.x;
        this.y = Game.overlayScreenData.topLeft.y;

        // Position button relative to HUD container (Top Right)
        this.soundToggleButton.x = Game.overlayScreenData.topRight.x - this.x - this.soundToggleButton.width / 2 - 30;
        this.soundToggleButton.y = 30;
    }
}