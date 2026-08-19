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

    /** Call once at boot (see UIService's constructor) — safe to call more than once, same "no-ops after the first" convention as PopupManager.init(). */
    public init(game: Game): void {
        if (this.layer) {
            return;
        }
        this.layer = new PIXI.Container();
        game.overlayContainer.addChild(this.layer);
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

        // Re-adding an EXISTING child moves it to the end of its parent's own children list
        // (PIXI's addChild() is also how you reorder) rather than adding a duplicate — this is
        // what actually keeps this notification layer drawing on top of EVERYTHING else in
        // game.overlayContainer, no matter what got added there since init() ran. Without this,
        // any UI added to overlayContainer AFTER init() (a zone's own ScreenAnchorComponent
        // nameplate — QueueZone/CraftZone/... — or PopupManager's root, itself added by
        // SettingsUIService before this manager's own init() call in UIService's constructor)
        // would draw OVER this layer simply for having been added later, since PIXI renders a
        // container's children in list order. Bringing this to the front right before every
        // notification plays means the actual add-order of everything else never matters.
        this.layer.parent?.addChild(this.layer);
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
