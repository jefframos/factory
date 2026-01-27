import * as PIXI from "pixi.js";
import { BaseNotificationView } from "./BaseNotificationView";
import { NotificationRegistry } from "./NotificationRegistry";
import { LevelUpInterstitialData, resolveTexture } from "./NotificationTypes";

export class LevelUpInterstitialView extends BaseNotificationView<LevelUpInterstitialData> {
    private container: PIXI.Container = new PIXI.Container();

    public constructor(registry: NotificationRegistry, w: number, h: number) {
        super({ kind: "levelup_interstitial", registry, width: w, height: h });

        // Interstitial content container (centered)
        this.addChild(this.container);
    }

    public setData(data: LevelUpInterstitialData): void {
        const icon = resolveTexture(data.iconTexture);

        if (!this.titleText || !this.subtitleText) {
            // Build inside container (not directly on root)
            const skin = this.registry.getSkin(this.kind);

            const pad = skin.padding ?? 18;
            const iconSize = skin.iconSize ?? 120;
            const iconGap = skin.iconMarginRight ?? 14;

            const resolvedIcon = icon || resolveTexture(skin.defaultIconTexture);

            if (resolvedIcon) {
                this.icon = new PIXI.Sprite(resolvedIcon);
                this.icon.width = iconSize;
                this.icon.height = iconSize;
                this.container.addChild(this.icon);
            }

            const titleStyle = new PIXI.TextStyle({
                fontFamily: "Arial",
                fontSize: 38,
                fill: 0xffffff,
                ...skin.titleStyle
            });

            const subtitleStyle = new PIXI.TextStyle({
                fontFamily: "Arial",
                fontSize: 26,
                fill: 0xffffff,
                ...skin.subtitleStyle
            });

            this.titleText = new PIXI.Text("", titleStyle);
            this.titleText.resolution = 2;
            this.container.addChild(this.titleText);

            this.subtitleText = new PIXI.Text("", subtitleStyle);
            this.subtitleText.resolution = 2;
            this.container.addChild(this.subtitleText);

            // Layout (center)
            const contentW = Math.min(this.viewW * 0.9, 560);

            const bgW = contentW;
            const bgH = 260;

            // if you provided a bg in registry, it already exists at root.
            // So we’ll position it and scale to "panel size" if it’s a sprite/nineslice.
            if (this.bg) {
                (this.bg as any).width = bgW;
                (this.bg as any).height = bgH;
                this.bg.x = Math.floor((this.viewW - bgW) * 0.5);
                this.bg.y = Math.floor((this.viewH - bgH) * 0.5);
            }

            if (this.shiny) {
                this.shiny.width = (this.bg as any)?.width ?? bgW;
                this.shiny.height = (this.bg as any)?.height ?? bgH;
                this.shiny.x = this.bg?.x ?? Math.floor((this.viewW - bgW) * 0.5);
                this.shiny.y = this.bg?.y ?? Math.floor((this.viewH - bgH) * 0.5);
            }

            // Center container on panel
            this.container.x = this.bg ? this.bg.x : Math.floor((this.viewW - bgW) * 0.5);
            this.container.y = this.bg ? this.bg.y : Math.floor((this.viewH - bgH) * 0.5);

            const iconX = pad;
            const iconY = Math.floor((bgH - iconSize) * 0.5);

            if (this.icon) {
                this.icon.x = iconX;
                this.icon.y = iconY;
            }

            const textX = pad + (this.icon ? iconSize + iconGap : 0);
            this.titleText.x = textX;
            this.titleText.y = pad;

            this.subtitleText.x = textX;
            this.subtitleText.y = this.titleText.y + this.titleText.height + 6;
        }

        this.titleText!.text = data.title ?? "Level Up!";
        this.subtitleText!.text = data.subtitle ?? "";
    }
}
