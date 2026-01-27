import * as PIXI from "pixi.js";

export type NotificationKind =
    | "prize_toast"
    | "achievement_toast"
    | "shop_item_toast"
    | "levelup_interstitial";

export type TextureLike = PIXI.Texture | string;

export interface NineSliceDef {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface NotificationStackDynamicLayout {
    // Normalized inside overlay rect (0..1)
    anchorX: number; // 0 = left, 0.5 = center, 1 = right
    anchorY: number; // 0 = top,  0.5 = middle, 1 = bottom

    // Pixel offsets from the anchor point (in screen px)
    offsetX: number;
    offsetY: number;

    width: number;
    height: number;

    spacing: number;
    direction: "down" | "up";

    // If true, clamp stack start point to overlay bounds
    clampToOverlay?: boolean;
    clampPadding?: number;
}



export interface NotificationStackLayout {
    x: number;
    y: number;
    width: number;
    height: number;
    spacing: number;
    direction: "down" | "up";
}

export interface ToastOptions {
    durationSeconds?: number; // default from registry
}

export interface InterstitialOptions {
    // reserved for later (e.g. allowTapToClose, etc)
}

export interface PrizeToastData {
    title?: string;              // e.g. "Prize!"
    subtitle?: string;           // e.g. "+100 Coins"
    iconTexture?: TextureLike;   // optional override
}

export interface AchievementToastData {
    title: string;               // e.g. "Achievement Unlocked!"
    subtitle?: string;           // e.g. "Hatched 10 eggs"
    iconTexture?: TextureLike;   // optional override
}

export interface ShopItemToastData {
    title?: string;              // e.g. "New Shop Item"
    subtitle?: string;           // e.g. "Unlocked: Fancy Egg"
    iconTexture: TextureLike;    // usually item icon
}

export interface LevelUpInterstitialData {
    title?: string;              // e.g. "Level Up!"
    subtitle?: string;           // e.g. "You reached Level 5"
    iconTexture?: TextureLike;   // optional override
}

export function resolveTexture(tex?: TextureLike): PIXI.Texture | null {
    if (!tex) return null;

    if (typeof tex === "string") {
        return PIXI.Texture.from(tex);
    }

    return tex;
}
