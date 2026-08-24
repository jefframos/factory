// UpgradeNotificationManager.ts
//
// Queue + placement for UpgradeNotificationView (see that file's own doc for
// what it actually looks like and how it animates) — this file only knows
// WHERE a notification sits (center, near the top of the screen) and THAT
// multiple calls to show() should queue rather than interrupt one another,
// never what it's built from or how it moves. Deliberately NOT a Popup (see
// Popup.ts/PopupManager.ts): it's non-blocking (no backdrop, doesn't steal
// input) and self-timed (the view times its own show/hold/hide and tears
// itself down — nothing here calls back into it to close it). Queueing
// instead of replacing matters because this is meant to announce a BURST of
// events (upgrade a tool, then walk into a building level-up) without any of
// them getting cut off unseen.
//
// Only the tool-upgrade call site exists today (see ShopZone.ts and
// PizzaScene's "Upgrade <shop>" dev-GUI button) — building-upgrade/gate-
// unlock call sites are follow-up work, not built yet.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import UpgradeNotificationView, { UpgradeNotificationOptions } from './UpgradeNotificationView';

export type { UpgradeNotificationOptions };

const TOP_MARGIN = 140;

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
    /** FIFO — see this file's own doc for why calls queue instead of interrupting. */
    private readonly queue: UpgradeNotificationOptions[] = [];
    private playing = false;

    /**
     * Call once at boot (see UIService's constructor) — safe to call more than once, same
     * "no-ops after the first" convention as PopupManager.init(). Parents `layer` under
     * `game.notificationLayer` — a dedicated tier that's always drawn over `game.uiLayer` (the
     * HUD, zone nameplates, everything else) and always under `game.popupLayer` (see
     * core/Game.ts's own doc), regardless of add-order — so unlike before this tiering
     * existed, playNext() no longer needs to manually re-add `layer` to bring it to the front
     * of whatever else happened to exist in a single flat overlay container.
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
        this.playNext();
    }

    private playNext(): void {
        if (this.playing || !this.layer) {
            return;
        }

        const options = this.queue.shift();
        if (!options) {
            return;
        }
        this.playing = true;

        const view = new UpgradeNotificationView(options);
        this.layer.addChild(view);

        const screen = Game.overlayScreenData;
        const restPosition = new PIXI.Point(screen.center.x, screen.topLeft.y + TOP_MARGIN);

        void view.play(restPosition).then(() => {
            this.playing = false;
            this.playNext();
        });
    }
}
