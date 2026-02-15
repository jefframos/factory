import BaseButton, { ButtonState } from "@core/ui/BaseButton";
import SoundToggleLargeButton from "@core/ui/SoundToggleLargeButton";
import * as PIXI from "pixi.js";
import { EconomyStorage } from "../../data/EconomyStorage";
import { GameplayProgressStorage } from "../../data/GameplayProgressStorage";
import HexAssets from "../../HexAssets";
import { BasePanel } from "./BasePanel";

export class SettingsPanel extends BasePanel {
    private readonly BUTTON_WIDTH = 350;
    private readonly BUTTON_HEIGHT = 80;
    private readonly SPACING = 20;

    constructor() {
        // Size the panel appropriately for a vertical list
        super(500, 650);
        this.buildSettingsList();
    }

    private buildSettingsList(): void {
        const container = new PIXI.Container();
        this.content.addChild(container);

        // Common text style for settings buttons
        const buttonTextStyle = new PIXI.TextStyle({ ...HexAssets.MainFont });

        // 1. Define the buttons configuration
        const configs = [
            // { text: "Account Settings", icon: "Icon_MapPoint", callback: () => console.log("Account clicked") },
            // { text: "Notifications", icon: "PictoIcon_Home_1", callback: () => console.log("Notifications clicked") },
            // { text: "Privacy Policy", icon: "Icon_Skip", callback: () => console.log("Privacy clicked") },
        ];

        const soundBtn = new SoundToggleLargeButton(this.BUTTON_WIDTH, this.BUTTON_HEIGHT, PIXI.Texture.from(HexAssets.Textures.Icons.SoundOn), PIXI.Texture.from(HexAssets.Textures.Icons.SoundOff));
        soundBtn.y = 0; // First position
        container.addChild(soundBtn);
        soundBtn.overrider(ButtonState.STANDARD, { texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Blue), fontStyle: buttonTextStyle })
        // 2. Create Mock Buttons
        configs.forEach((cfg, i) => {
            const btn = new BaseButton({
                standard: {
                    width: this.BUTTON_WIDTH,
                    height: this.BUTTON_HEIGHT,
                    texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Blue), // Using shop blue texture
                    fontStyle: buttonTextStyle,
                    text: cfg.text,
                    iconTexture: PIXI.Texture.from(cfg.icon),
                    iconSize: { height: 45, width: 45 },
                    centerIconVertically: true,
                    textOffset: new PIXI.Point(40, 0),
                    iconOffset: new PIXI.Point(20, 0),
                },
                click: { callback: cfg.callback }
            });

            btn.y = (i + 1) * (this.BUTTON_HEIGHT + this.SPACING);
            container.addChild(btn);
        });

        // 3. Add Clear Cache Button at the bottom
        const clearCacheBtn = new BaseButton({
            standard: {
                width: this.BUTTON_WIDTH,
                height: this.BUTTON_HEIGHT,
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Red), // Use dark texture for "danger" action
                fontStyle: buttonTextStyle,
                text: "Clear Cache",
                iconTexture: PIXI.Texture.from(HexAssets.Textures.Icons.Close),
                iconSize: { height: 40, width: 40 },
                centerIconVertically: true,
                textOffset: new PIXI.Point(40, 0),
                iconOffset: new PIXI.Point(20, 0),
            },
            click: {
                callback: () => {
                    EconomyStorage.clearEconomy();
                    GameplayProgressStorage.clearData();
                    window.location.reload();
                }
            }
        });

        clearCacheBtn.setLabel('Clear Cache')
        // Position it with a larger gap at the bottom
        clearCacheBtn.y = configs.length * (this.BUTTON_HEIGHT + this.SPACING) + 40 + this.BUTTON_HEIGHT;
        container.addChild(clearCacheBtn);

        // Center the whole container inside the panel content
        container.pivot.set(container.width / 2, container.height / 2);
    }
}