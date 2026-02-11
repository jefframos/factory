// BasePanel.ts
import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";
import HexAssets from "../../HexAssets";
import { PanelManager } from "./PanelManager";

export class BasePanel extends PIXI.Container {
    protected bg: PIXI.NineSlicePlane;
    protected closeBtn: BaseButton;
    public content: PIXI.Container; // Public so Shop can access

    constructor(width: number, height: number) {
        super();

        // 1. Removed the extra dimmer here (Manager handles it)

        // 2. Panel Bg
        this.bg = new PIXI.NineSlicePlane(PIXI.Texture.from(HexAssets.Textures.UI.BarBg), 20, 20, 20, 20);
        this.bg.width = width;
        this.bg.height = height;
        this.bg.pivot.set(width / 2, height / 2);
        this.addChild(this.bg);

        // Center content inside the BG
        this.content = new PIXI.Container();
        this.content.position.set(width / 2, height / 2); // Center of the BG
        this.bg.addChild(this.content);

        // 3. Close Button - Call the Manager, DO NOT destroy
        this.closeBtn = new BaseButton({
            standard: { width: 50, height: 50, iconTexture: PIXI.Texture.from(HexAssets.Textures.Icons.Close) },
            click: { callback: () => PanelManager.instance.closePanel() }
        });

        // Position relative to the top-right corner of the BG
        this.closeBtn.position.set(width - 40, 40);
        this.bg.addChild(this.closeBtn);
    }
}