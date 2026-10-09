// UpgradeNotificationManager.ts
//
// Queue + placement for UpgradeNotificationView (see that file's own doc for
// what it actually looks like and how it animates) — this file only knows
// WHERE a notification sits (center, near the top of the screen) and THAT
// multiple calls to show() should queue rather than interrupt one another,
// never what it's built from or how it moves. Deliberately NOT a Popup (see
// Popup.ts/PopupManager.ts). Queueing instead of replacing matters because
// this is meant to announce a BURST of events (upgrade a tool, then walk into
// a building level-up) without any of them getting cut off unseen.
//
// Tap to continue (TAP_TO_CONTINUE): a notification is a beat the player has
// to acknowledge. The first one opens a SESSION: the world pauses
// (GameClock.pause() — movement, clients, workers, animations, camera trips
// all freeze), gameplay is reported stopped (GameplayTracker — Poki
// gameplayStop) and a dimmed backdrop swallows taps. Each notification holds
// until the player taps (after MIN_SHOW_SEC, so a tap that was already
// happening doesn't skip it). Once the queue is empty the backdrop fades and,
// with COMMERCIAL_BREAK_AFTER, the platform gets a natural ad break
// (GameplayTracker.commercialBreak() — Poki decides whether an ad actually
// plays and how often); then the world resumes and gameplay restarts. A
// notification arriving during that break joins the same session.
// TAP_TO_CONTINUE false = the old non-blocking, self-timed callout.
//
// Call sites: ShopZone.ts (tool upgrades), CraftZone.ts (a crafted tool),
// FarmZone.ts (a farm plot bought), StoragePurchaseZone.ts (storage / stall /
// station built), Store.ts (store opened / level up), PizzaScene.ts.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import UpgradeNotificationView, { UpgradeNotificationOptions } from './UpgradeNotificationView';
import { GameClock } from '../../utils/GameClock';
import { GameplayTracker } from '../../platform/GameplayTracker';

export type { UpgradeNotificationOptions };

const TOP_MARGIN = 140;

/** Notifications pause the game and wait for a tap — see this file's own doc. */
export const TAP_TO_CONTINUE = true;
/** Offer the platform an ad break once the player has tapped through every queued notification. */
export const COMMERCIAL_BREAK_AFTER = true;
/** Taps are ignored for this long after a notification appears. */
const MIN_SHOW_SEC = 0.8;
const BACKDROP_ALPHA = 0.45;
const BACKDROP_FADE_SEC = 0.25;
/** GameClock / GameplayTracker reason for this session. */
const PAUSE_REASON = 'notification';

export class UpgradeNotificationManager {
    private static _instance: UpgradeNotificationManager;
    public static get instance(): UpgradeNotificationManager {
        if (!UpgradeNotificationManager._instance) {
            UpgradeNotificationManager._instance = new UpgradeNotificationManager();
        }
        return UpgradeNotificationManager._instance;
    }

    private constructor() { }

    private layer?: PIXI.Container;
    /** Dims the paused world and catches the continue tap — under the notifications. */
    private backdrop?: PIXI.Graphics;
    /** FIFO — see this file's own doc for why calls queue instead of interrupting. */
    private readonly queue: UpgradeNotificationOptions[] = [];
    private playing = false;
    /** A tap-to-continue session is open (world paused) — see this file's own doc. */
    private inSession = false;
    /** The session is closing (backdrop fading / ad break) — a new notification waits for it, then reopens. */
    private closing = false;
    /** Resolves the showing notification's hold — set while it waits for a tap. */
    private dismissCurrent?: () => void;
    private tapAllowedAtMs = 0;

    /**
     * Call once at boot (see UIService's constructor) — safe to call more than once, same
     * "no-ops after the first" convention as PopupManager.init(). Parents `layer` under
     * `game.notificationLayer` — a dedicated tier that's always drawn over `game.uiLayer` (the
     * HUD, zone nameplates, everything else) and always under `game.popupLayer` (see
     * core/Game.ts's own doc), regardless of add-order.
     */
    public init(game: Game): void {
        if (this.layer) {
            return;
        }
        this.layer = new PIXI.Container();
        game.notificationLayer.addChild(this.layer);
    }

    /** Queues `options` to show as a large center-upper callout — see this file's own doc. */
    public show(options: UpgradeNotificationOptions): void {
        this.queue.push(options);
        if (TAP_TO_CONTINUE && !this.inSession && !this.closing) {
            this.openSession();
        }
        this.playNext();
    }

    private openSession(): void {
        this.inSession = true;
        GameClock.pause(PAUSE_REASON);
        GameplayTracker.setBlocked(PAUSE_REASON, true);
        this.showBackdrop();
    }

    private async closeSession(): Promise<void> {
        this.inSession = false;
        this.closing = true;
        this.hideBackdrop();
        if (COMMERCIAL_BREAK_AFTER) {
            await GameplayTracker.commercialBreak();
        }
        this.closing = false;
        if (this.queue.length > 0) {
            // More arrived meanwhile — same session, still paused.
            this.inSession = true;
            this.showBackdrop();
            this.playNext();
            return;
        }
        GameClock.resume(PAUSE_REASON);
        GameplayTracker.setBlocked(PAUSE_REASON, false);
    }

    private playNext(): void {
        if (this.playing || this.closing || !this.layer) {
            return;
        }

        const options = this.queue.shift();
        if (!options) {
            if (this.inSession) {
                void this.closeSession();
            }
            return;
        }
        this.playing = true;

        const view = new UpgradeNotificationView(options);
        this.layer.addChild(view);

        const screen = Game.overlayScreenData;
        const restPosition = new PIXI.Point(screen.center.x, screen.topLeft.y + TOP_MARGIN);

        let dismissed: Promise<void> | undefined;
        if (this.inSession) {
            this.tapAllowedAtMs = performance.now() + MIN_SHOW_SEC * 1000;
            dismissed = new Promise(resolve => {
                this.dismissCurrent = resolve;
            });
        }
        void view.play(restPosition, dismissed).then(() => {
            this.playing = false;
            this.playNext();
        });
    }

    private readonly handleBackdropTap = (): void => {
        if (!this.dismissCurrent || performance.now() < this.tapAllowedAtMs) {
            return;
        }
        const dismiss = this.dismissCurrent;
        this.dismissCurrent = undefined;
        dismiss();
    };

    private showBackdrop(): void {
        if (!this.layer) {
            return;
        }
        if (!this.backdrop) {
            const backdrop = new PIXI.Graphics();
            backdrop.beginFill(0x000000, 1).drawRect(-4000, -4000, 8000, 8000).endFill();
            // Swallows the tap so it doesn't reach the world/HUD behind it.
            backdrop.interactive = true;
            backdrop.cursor = 'pointer';
            backdrop.on('pointertap', this.handleBackdropTap);
            this.backdrop = backdrop;
        }
        this.layer.addChildAt(this.backdrop, 0);
        gsap.killTweensOf(this.backdrop);
        this.backdrop.alpha = 0;
        this.backdrop.visible = true;
        gsap.to(this.backdrop, { alpha: BACKDROP_ALPHA, duration: BACKDROP_FADE_SEC });
    }

    private hideBackdrop(): void {
        const backdrop = this.backdrop;
        if (!backdrop) {
            return;
        }
        gsap.killTweensOf(backdrop);
        gsap.to(backdrop, {
            alpha: 0,
            duration: BACKDROP_FADE_SEC,
            onComplete: () => {
                backdrop.visible = false;
            },
        });
    }
}
