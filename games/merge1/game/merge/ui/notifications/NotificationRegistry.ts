import * as PIXI from "pixi.js";
import { NineSliceDef, NotificationKind, TextureLike, resolveTexture } from "./NotificationTypes";

export interface NotificationSkin {
    // If bgTexture + nineSlice provided => NineSlicePlane.
    // If bgTexture provided but no nineSlice => Sprite stretched.
    // If no bgTexture => transparent (no background).
    bgTexture?: TextureLike;
    bgNineSlice?: NineSliceDef;

    // Optional shiny overlay (sprite on top of bg)
    shinyTexture?: TextureLike;
    shinyAlpha?: number;

    // Default icon if notification data doesn't provide one
    defaultIconTexture?: TextureLike;

    // Layout
    padding?: number;
    iconSize?: number;
    iconMarginRight?: number;

    // Text
    titleStyle?: Partial<PIXI.ITextStyle>;
    subtitleStyle?: Partial<PIXI.ITextStyle>;

    // Toast defaults
    defaultDurationSeconds?: number;

    // Interstitial
    blackoutAlpha?: number;
}

export class NotificationRegistry {
    private skins: Map<NotificationKind, NotificationSkin> = new Map();

    public setSkin(kind: NotificationKind, skin: NotificationSkin): void {
        this.skins.set(kind, skin);
    }

    public getSkin(kind: NotificationKind): NotificationSkin {
        return this.skins.get(kind) || {};
    }

    public createBg(kind: NotificationKind, w: number, h: number): PIXI.DisplayObject | null {
        const skin = this.getSkin(kind);
        const tex = resolveTexture(skin.bgTexture);

        if (!tex) {
            return null;
        }

        if (skin.bgNineSlice) {
            const ns = skin.bgNineSlice;
            const plane = new PIXI.NineSlicePlane(tex, ns.left, ns.top, ns.right, ns.bottom);
            plane.width = w;
            plane.height = h;
            return plane;
        }

        const s = new PIXI.Sprite(tex);
        s.width = w;
        s.height = h;
        return s;
    }

    public createShiny(kind: NotificationKind, w: number, h: number): PIXI.Sprite | null {
        const skin = this.getSkin(kind);
        const tex = resolveTexture(skin.shinyTexture);

        if (!tex) {
            return null;
        }

        const s = new PIXI.Sprite(tex);
        s.width = w;
        s.height = h;
        s.alpha = skin.shinyAlpha ?? 0.35;
        return s;
    }

    public getDefaultDuration(kind: NotificationKind): number {
        const skin = this.getSkin(kind);
        return skin.defaultDurationSeconds ?? 2.5;
    }
}
