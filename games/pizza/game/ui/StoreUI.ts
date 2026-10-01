// StoreUI.ts
//
// Top-center HUD for the store the player is standing in — no background
// panel, just StoreBadgeProgress.ts (the level badge with the store icon, and
// the store name over a progress bar toward the next level). All of its look
// is tweaked in STORE_BADGE_PROGRESS_CONFIG there.
//
// Holds no store logic of its own — PizzaScene decides which store (if any)
// the player is inside every frame and calls setState() with that store's
// numbers, or undefined when the player is in none. The HUD fades in/out on
// that change and just swaps content when moving straight from one store to
// another, so any number of stores can share this one.
//
// Origin is the HUD's TOP-CENTER — UIService.positionStoreUi() pins that to
// the top-center of the screen.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import StoreBadgeProgress, { STORE_BADGE_PROGRESS_CONFIG, StoreBadgeProgressState } from './StoreBadgeProgress';

const FADE_SEC = 0.25;

/** The store's own icon — on the HUD badge, and on the "STORE LEVEL UP!" notification (see Store.recordSale()). */
export const STORE_ICON = STORE_BADGE_PROGRESS_CONFIG.icon;

export type StoreUIState = StoreBadgeProgressState;

export default class StoreUI extends PIXI.Container {
    private readonly progress = new StoreBadgeProgress();
    /** JSON of the last state drawn — redraws only when it changes. */
    private currentKey = '';
    /** Whether the HUD is showing (or fading in) — set by setState(), not by the tween. */
    private shown = false;

    public constructor() {
        super();
        this.addChild(this.progress);
        this.alpha = 0;
        this.visible = false;
    }

    /** The store the player is in right now, or undefined for none — fades the HUD in/out on that change. */
    public setState(state: StoreUIState | undefined): void {
        if (state) {
            const key = JSON.stringify(state);
            if (key !== this.currentKey) {
                this.currentKey = key;
                this.progress.setState(state);
            }
        }
        const show = state !== undefined;
        if (show === this.shown) {
            return;
        }
        this.shown = show;
        gsap.killTweensOf(this);
        if (show) {
            this.visible = true;
            gsap.to(this, { alpha: 1, duration: FADE_SEC });
        } else {
            gsap.to(this, { alpha: 0, duration: FADE_SEC, onComplete: () => { this.visible = false; } });
        }
    }
}
