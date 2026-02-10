import { Game } from "@core/Game";
import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import HexAssets from "../HexAssets";
import { WorldMapViewStyle } from "./WorldMapView";

export class WorldHUD extends PIXI.Container {
    private readonly titleText: PIXI.Text;
    private readonly backBtn: BaseButton;

    constructor(style: WorldMapViewStyle, onBack: () => void) {
        super();

        this.titleText = new PIXI.Text("", new PIXI.TextStyle({ ...HexAssets.MainFontTitle }));
        this.titleText.anchor.set(0.5, 0);
        this.addChild(this.titleText);

        this.backBtn = new BaseButton({
            standard: {
                width: style.levelButtonSize,
                height: style.levelButtonSize,
                texture: PIXI.Texture.EMPTY,
                iconTexture: PIXI.Texture.from(style.backIconTexture),
                centerIconHorizontally: true,
                centerIconVertically: true
            },
            click: { callback: onBack }
        });
        this.addChild(this.backBtn);
    }

    public setTitle(text: string): void {
        this.titleText.text = text;
    }

    public layout(): void {
        // Back Button: Top Left with 20px padding
        this.backBtn.position.set(20, 20);

        // Title: Top Center
        this.titleText.x = Game.DESIGN_WIDTH / 2;
        this.titleText.y = 20;
    }
}