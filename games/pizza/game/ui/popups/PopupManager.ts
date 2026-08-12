// PopupManager.ts
//
// Generic show/hide host for Popup instances — the ONE place that knows
// where a popup sits on screen (centered, via Popup's own pivot — see
// Popup.ts's own doc) and whether it darkens the background, so a concrete
// popup (SettingsPopup, future ones) only ever describes its own content.
// HOW a popup animates in/out is deliberately NOT here — that's
// PopupTransitions.ts's job, so retuning/replacing the transition never
// touches this file. Singleton, same "one shared instance pizza already
// leans on elsewhere" convention as e.g. ShopUpgradeStorage.
//
// init() must run once (see SettingsUIService's own call) before show()
// works — deferred rather than done in the constructor since a singleton's
// constructor has no natural place to receive `game.overlayContainer`.
// Safe to call more than once (no-ops after the first) so every caller can
// call it defensively without coordinating a single "who calls init()" owner.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import type Popup from './Popup';
import { ACTIVE_POPUP_TRANSITION } from './PopupTransitions';

const DARKEN_ALPHA = 0.55;

interface OpenPopup {
    popup: Popup;
    layer: PIXI.Container;
    backdrop?: PIXI.Graphics;
}

export class PopupManager {
    private static _instance: PopupManager;
    public static get instance(): PopupManager {
        if (!PopupManager._instance) {
            PopupManager._instance = new PopupManager();
        }
        return PopupManager._instance;
    }

    private constructor() { }

    private root?: PIXI.Container;
    /** One popup open at a time — every popup in this game is a standalone dialog, not a drill-down flow that needs to return to a parent screen, so there's no stack to manage, just "whatever's open gets replaced." */
    private current?: OpenPopup;
    /** Set by close() while ACTIVE_POPUP_TRANSITION's exit animation is still running — tracked separately from `current` (which close() already clears immediately) so a show() that arrives before this finishes closing can still find and kill it — see closeImmediate(). */
    private closing?: { layer: PIXI.Container; timeline: gsap.core.Timeline };

    public init(game: Game): void {
        if (this.root) {
            return;
        }
        this.root = new PIXI.Container();
        game.overlayContainer.addChild(this.root);
    }

    /** Shows `popup`, closing (with no transition — see closeImmediate()) whatever's currently open first. */
    public show(popup: Popup): void {
        if (!this.root) {
            throw new Error('PopupManager.show() called before init()');
        }
        this.closeImmediate();

        const layer = new PIXI.Container();
        this.root.addChild(layer);

        let backdrop: PIXI.Graphics | undefined;
        if (popup.darkenBackground) {
            backdrop = new PIXI.Graphics();
            backdrop.beginFill(0x000000, DARKEN_ALPHA).drawRect(-4000, -4000, 8000, 8000).endFill();
            backdrop.interactive = true;
            backdrop.cursor = 'pointer';
            backdrop.alpha = 0;
            backdrop.on('pointertap', () => this.close(popup));
            layer.addChild(backdrop);
        }

        layer.addChild(popup.root);

        // The popup's own resting spot — PopupTransitions.playIn() reads this position back
        // out to compute where to start from (see that file's own doc), so it must already be
        // set to the FINAL position before playIn() runs, not wherever it ends up mid-animation.
        const screen = Game.overlayScreenData;
        popup.root.position.set(screen.center.x, screen.center.y);

        popup.bindClose(() => this.close(popup));
        this.current = { popup, layer, backdrop };

        ACTIVE_POPUP_TRANSITION.playIn({ root: popup.root, backdrop });
    }

    /** Animates `popup` out via ACTIVE_POPUP_TRANSITION, then tears it down — no-ops if `popup` isn't the one currently open (e.g. a stale close callback firing after it's already been replaced by a newer popup). */
    public close(popup: Popup): void {
        if (!this.current || this.current.popup !== popup) {
            return;
        }
        const { layer, backdrop } = this.current;
        this.current = undefined;

        const timeline = ACTIVE_POPUP_TRANSITION.playOut({ root: popup.root, backdrop }, () => {
            layer.destroy({ children: true });
            this.closing = undefined;
        });
        this.closing = { layer, timeline };
    }

    /** Tears down whatever's open OR mid-close with NO transition — used right before show() opens a new one, so an old entrance/exit animation can't still be running (and then destroy a layer out from under) a brand new popup. */
    private closeImmediate(): void {
        if (this.closing) {
            this.closing.timeline.kill();
            this.closing.layer.destroy({ children: true });
            this.closing = undefined;
        }

        if (!this.current) {
            return;
        }
        const { popup, layer, backdrop } = this.current;
        gsap.killTweensOf(popup.root);
        gsap.killTweensOf(popup.root.scale);
        if (backdrop) {
            gsap.killTweensOf(backdrop);
        }
        layer.destroy({ children: true });
        this.current = undefined;
    }
}
