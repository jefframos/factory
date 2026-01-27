import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import { NotificationRegistry } from "./NotificationRegistry";
import { NotificationKind, resolveTexture } from "./NotificationTypes";

export interface BaseNotificationViewConfig {
    kind: NotificationKind;
    registry: NotificationRegistry;
    width: number;
    height: number;
}

export abstract class BaseNotificationView<TData> extends PIXI.Container {
    public readonly kind: NotificationKind;

    protected readonly registry: NotificationRegistry;

    protected readonly viewW: number;
    protected readonly viewH: number;

    protected bg?: PIXI.DisplayObject;
    protected shiny?: PIXI.Sprite;

    protected icon?: PIXI.Sprite;
    protected titleText?: PIXI.Text;
    protected subtitleText?: PIXI.Text;

    public constructor(cfg: BaseNotificationViewConfig) {
        super();

        this.kind = cfg.kind;
        this.registry = cfg.registry;
        this.viewW = cfg.width;
        this.viewH = cfg.height;

        this.buildChrome();
    }

    private buildChrome(): void {
        const bg = this.registry.createBg(this.kind, this.viewW, this.viewH);
        if (bg) {
            this.bg = bg;
            this.addChild(bg);
        }

        const shiny = this.registry.createShiny(this.kind, this.viewW, this.viewH);
        if (shiny) {
            this.shiny = shiny;
            this.shiny.scale.set(ViewUtils.elementScaler(this.shiny, this.viewW, this.viewH))
            this.addChild(shiny);
        }
    }

    protected buildCommonTextAndIcon(iconOverride?: PIXI.Texture | null): void {
        const skin = this.registry.getSkin(this.kind);

        const pad = skin.padding ?? 12;
        const iconSize = skin.iconSize ?? Math.floor(this.viewH * 0.72);
        const iconGap = skin.iconMarginRight ?? 12;

        const resolvedIcon =
            iconOverride ||
            resolveTexture(skin.defaultIconTexture) ||
            null;

        if (resolvedIcon) {
            this.icon = new PIXI.Sprite(resolvedIcon);
            this.icon.scale.set(ViewUtils.elementScaler(this.icon, iconSize))
            this.icon.x = pad;
            this.icon.anchor.y = 0.5
            this.icon.y = Math.floor((this.viewH) * 0.5);
            this.addChild(this.icon);
        }

        const textX = pad + (this.icon ? iconSize + iconGap : 0);

        const titleStyle = new PIXI.TextStyle({
            fontSize: 26,
            fill: 0xffffff,
            ...skin.titleStyle
        });

        const subtitleStyle = new PIXI.TextStyle({
            fontSize: 18,
            fill: 0xffffff,
            ...skin.subtitleStyle
        });

        this.titleText = new PIXI.Text("", titleStyle);
        this.titleText.x = textX;
        this.titleText.y = pad;
        this.titleText.resolution = 2;
        this.addChild(this.titleText);

        this.subtitleText = new PIXI.Text("", subtitleStyle);
        this.subtitleText.x = textX;
        this.subtitleText.y = this.titleText.y + this.titleText.height;
        this.subtitleText.resolution = 2;
        this.addChild(this.subtitleText);
    }

    public abstract setData(data: TData): void;
}
