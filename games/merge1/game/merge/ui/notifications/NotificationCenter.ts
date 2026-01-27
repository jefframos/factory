import { Game } from "@core/Game";
import * as PIXI from "pixi.js";
import { LevelUpInterstitialView } from "./LevelUpInterstitialView";
import { NotificationRegistry } from "./NotificationRegistry";
import {
    AchievementToastData,
    InterstitialOptions,
    LevelUpInterstitialData,
    NotificationKind,
    PrizeToastData,
    ShopItemToastData,
    ToastOptions
} from "./NotificationTypes";
import { AchievementToastView, PrizeToastView, ShopItemToastView } from "./ToastViews";

type OverlayData = {
    topLeft: PIXI.IPointData;
    topRight: PIXI.IPointData;
    bottomRight: PIXI.IPointData;
};

type StackAnchor =
    | "topLeft"
    | "topRight"
    | "bottomLeft"
    | "bottomRight"
    | "topCenter"
    | "bottomCenter";

interface StackConfig {
    anchor: StackAnchor;
    marginX: number;
    marginY: number;
    offsetX?: number;
    offsetY?: number;
    width: number;
    height: number;
    spacing: number;
    direction: "down" | "up";
}

interface ToastEntry {
    view: PIXI.Container;
    kind: NotificationKind;
    duration: number;
    age: number;
    state: "in" | "live" | "out";
    t: number;
}

interface InterstitialEntry {
    blackout: PIXI.Graphics;
    view: PIXI.Container;
    state: "in" | "live" | "out";
    t: number;
}

export class NotificationCenter extends PIXI.Container {
    private readonly registry: NotificationRegistry;

    private readonly stackLayer: PIXI.Container = new PIXI.Container();
    private readonly interstitialLayer: PIXI.Container = new PIXI.Container();

    private maxToasts: number = 5;
    private toasts: ToastEntry[] = [];

    private interstitial: InterstitialEntry | null = null;

    private overlay: OverlayData | null = null;

    // Default: dynamic layout is ON
    private stack: StackConfig = {
        anchor: "topRight",
        marginX: 20,
        marginY: 140,
        width: 520,
        height: 92,
        spacing: 10,
        direction: "down"
    };

    private stackDirty: boolean = true;

    public constructor(registry: NotificationRegistry) {
        super();

        this.registry = registry;

        this.addChild(this.stackLayer);
        this.addChild(this.interstitialLayer);

        this.interstitialLayer.eventMode = "static";
        this.interstitialLayer.hitArea = new PIXI.Rectangle(0, 0, 1, 1);
        this.interstitialLayer.visible = false;
    }

    // -------------------------
    // Setup (easy)
    // -------------------------
    public setMaxToasts(max: number): void {
        this.maxToasts = Math.max(1, Math.floor(max));
        this.enforceLimit();
    }

    public setStack(cfg: Partial<StackConfig>): void {
        this.stack = { ...this.stack, ...cfg };
        this.stackDirty = true;
        this.reflow();
    }

    /** Call this whenever resolution/safe-area changes. */
    public onOverlayChanged(overlay: OverlayData): void {
        this.overlay = overlay;

        const { topLeft, topRight, bottomRight } = overlay;
        const w = bottomRight.x - topLeft.x;
        const h = bottomRight.y - topLeft.y;

        this.interstitialLayer.hitArea = new PIXI.Rectangle(topLeft.x, topLeft.y, w, h);

        if (this.interstitial) {
            this.interstitial.blackout.clear();
            this.interstitial.blackout.beginFill(0x000000, this.registry.getSkin("levelup_interstitial").blackoutAlpha ?? 0.65);
            this.interstitial.blackout.drawRect(topLeft.x, topLeft.y, w, h);
            this.interstitial.blackout.endFill();

            this.interstitial.view.x = topLeft.x;
            this.interstitial.view.y = topLeft.y;

            // If your LevelUpInterstitialView needs explicit sizing, add a resize method there.
            (this.interstitial.view as any).width = w;
            (this.interstitial.view as any).height = h;
        }

        this.stackDirty = true;
        this.reflow();
    }

    // -------------------------
    // Public API (toasts)
    // -------------------------
    public toastPrize(data: PrizeToastData, opts?: ToastOptions): void {
        const v = new PrizeToastView(this.registry, this.stack.width, this.stack.height);
        v.setData(data);
        this.pushToast("prize_toast", v, opts);
    }

    public toastAchievement(data: AchievementToastData, opts?: ToastOptions): void {
        const v = new AchievementToastView(this.registry, this.stack.width, this.stack.height);
        v.setData(data);
        this.pushToast("achievement_toast", v, opts);
    }

    public toastShopItem(data: ShopItemToastData, opts?: ToastOptions): void {
        const v = new ShopItemToastView(this.registry, this.stack.width, this.stack.height);
        v.setData(data);
        this.pushToast("shop_item_toast", v, opts);
    }

    // -------------------------
    // Public API (interstitial)
    // -------------------------
    public showLevelUp(data: LevelUpInterstitialData, _opts?: InterstitialOptions): void {
        this.clearInterstitial();

        const overlay = this.overlay;
        const topLeft = overlay?.topLeft ?? { x: 0, y: 0 };
        const w = overlay ? overlay.bottomRight.x - overlay.topLeft.x : (this.parent as any)?.width ?? 720;
        const h = overlay ? overlay.bottomRight.y - overlay.topLeft.y : (this.parent as any)?.height ?? 1280;

        const blackout = new PIXI.Graphics();
        blackout.beginFill(0x000000, this.registry.getSkin("levelup_interstitial").blackoutAlpha ?? 0.65);
        blackout.drawRect(topLeft.x, topLeft.y, w, h);
        blackout.endFill();
        blackout.alpha = 0;

        const view = new LevelUpInterstitialView(this.registry, w, h);
        view.setData(data);
        view.x = topLeft.x;
        view.y = topLeft.y;
        view.alpha = 0;
        view.scale.set(0.98);

        this.interstitialLayer.visible = true;
        this.interstitialLayer.addChild(blackout);
        this.interstitialLayer.addChild(view);

        this.interstitial = { blackout, view, state: "in", t: 0 };
    }

    public closeInterstitial(): void {
        if (!this.interstitial) return;
        if (this.interstitial.state === "out") return;

        this.interstitial.state = "out";
        this.interstitial.t = 0;
    }

    // -------------------------
    // Update
    // -------------------------
    public update(dt: number): void {
        // Toasts
        for (let i = this.toasts.length - 1; i >= 0; i--) {
            const e = this.toasts[i];

            if (e.state === "in") {
                e.t += dt / 0.16;
                const k = Math.min(1, e.t);
                e.view.alpha = k;
                e.view.scale.set(0.98 + 0.02 * k);

                if (k >= 1) {
                    e.state = "live";
                    e.t = 0;
                }
            } else if (e.state === "live") {
                e.age += dt;
                if (e.age >= e.duration) {
                    e.state = "out";
                    e.t = 0;
                }
            } else {
                e.t += dt / 0.14;
                const k = Math.min(1, e.t);
                e.view.alpha = 1 - k;
                e.view.scale.set(1 - 0.02 * k);

                if (k >= 1) {
                    this.stackLayer.removeChild(e.view);
                    this.toasts.splice(i, 1);
                    this.stackDirty = true;
                }
            }
        }

        if (this.stackDirty) {
            this.reflow();
        }

        // Interstitial
        if (this.interstitial) {
            const it = this.interstitial;

            if (it.state === "in") {
                it.t += dt / 0.2;
                const k = Math.min(1, it.t);
                it.blackout.alpha = k;
                it.view.alpha = k;
                it.view.scale.set(0.98 + 0.02 * k);

                if (k >= 1) {
                    it.state = "live";
                    it.t = 0;
                }
            } else if (it.state === "out") {
                it.t += dt / 0.18;
                const k = Math.min(1, it.t);
                it.blackout.alpha = 1 - k;
                it.view.alpha = 1 - k;
                it.view.scale.set(1 - 0.02 * k);

                if (k >= 1) {
                    this.clearInterstitial();
                }
            }
        }
    }

    // -------------------------
    // Internals
    // -------------------------
    private pushToast(kind: NotificationKind, view: PIXI.Container, opts?: ToastOptions): void {
        this.enforceLimit(1);

        const duration = opts?.durationSeconds ?? this.registry.getDefaultDuration(kind);

        view.alpha = 0;
        view.scale.set(0.98);

        this.stackLayer.addChild(view);
        this.toasts.push({ view, kind, duration, age: 0, state: "in", t: 0 });

        this.stackDirty = true;
        this.reflow();
    }

    private enforceLimit(incoming: number = 0): void {
        const allowed = this.maxToasts - incoming;

        while (this.toasts.length > allowed) {
            // Evict oldest not already leaving
            const idx = this.toasts.findIndex(t => t.state !== "out");
            if (idx === -1) {
                const old = this.toasts.shift();
                if (old) this.stackLayer.removeChild(old.view);
                continue;
            }

            const t = this.toasts[idx];
            t.state = "out";
            t.t = 0;
            t.age = t.duration;
        }

        this.stackDirty = true;
    }

    private reflow(): void {
        this.stackDirty = false;

        const base = this.computeStackTopLeft();
        let y = 160;

        //console.log(this.parent.parent.x)

        for (let i = 0; i < this.toasts.length; i++) {
            const v = this.toasts[i].view;
            v.x = base.x + (this.stack.offsetX || 0) - this.stack.width - this.parent.parent.x;
            v.y = y;

            const h = (v as any).height ?? this.stack.height;
            y += (this.stack.direction === "down" ? 1 : -1) * (h + this.stack.spacing);
        }
    }

    private computeStackTopLeft(): PIXI.Point {
        const { topLeft, bottomRight, topRight } = Game.overlayScreenData;
        return topRight;
    }

    private clearInterstitial(): void {
        if (!this.interstitial) return;

        this.interstitialLayer.removeChildren();
        this.interstitialLayer.visible = false;
        this.interstitial = null;
    }
}
