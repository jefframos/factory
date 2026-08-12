// PopupTransitions.ts
//
// Defines HOW a popup enters/exits the screen — kept entirely separate from
// PopupManager's own job (backdrop, layering, centering) and from Popup's
// own job (content/chrome), so this is the ONE place to look to change what
// every popup's transition looks like. Repoint ACTIVE_POPUP_TRANSITION at a
// different PopupTransition object (or just retune springTopCurtainTransition's
// own constants below) and every popup shown through PopupManager picks it
// up automatically — nothing in PopupManager/Popup/any individual popup
// needs to change.

import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';

export interface PopupTransitionContext {
    /** The popup's own root container — already pivoted to its own visual center (see Popup.ts's own doc) and positioned at its final on-screen spot before playIn()/playOut() is called. */
    root: PIXI.Container;
    /** The full-screen backdrop, if the popup asked for one (see Popup.darkenBackground) — undefined otherwise. */
    backdrop?: PIXI.Graphics;
}

export interface PopupTransition {
    /** Animates `root`/`backdrop` INTO their already-set final position — called immediately after PopupManager parents+positions them. */
    playIn(ctx: PopupTransitionContext): void;
    /**
     * Animates `root`/`backdrop` OUT, then calls `onComplete` — PopupManager tears the popup
     * down there rather than on a fixed delay, so teardown always matches exactly how long THIS
     * transition took to finish. Returns the driving gsap.core.Timeline so PopupManager can
     * `.kill()` it outright if a new popup needs to show before this one finished closing.
     */
    playOut(ctx: PopupTransitionContext, onComplete: () => void): gsap.core.Timeline;
}

const ENTRY_DURATION_SEC = 0.55;
/** How far above its resting spot the popup starts — see playIn(). */
const ENTRY_DROP_DISTANCE = 220;
const ENTRY_ROTATION_RAD = -0.12;

/** The initial dip-and-stretch beat before the popup whips away — see playOut(). */
const EXIT_DIP_DISTANCE = 26;
const EXIT_DIP_DURATION_SEC = 0.12;
const EXIT_FLY_DURATION_SEC = 0.38;
const EXIT_FADE_DURATION_SEC = 0.16;
/** Extra clearance past the top of the screen the popup flies before it's torn down — guarantees it's fully off-screen (not just past its own resting Y) regardless of viewport height. */
const EXIT_FLY_CLEARANCE = 200;

/**
 * Entry: springs down from above the popup's own resting spot with a bit of
 * rotation, settling with an overshoot ('back.out') rather than easing
 * straight in — reads as the popup DROPPING into place, not fading up.
 *
 * Exit: a "curtain" pull — dips down and stretches taller/narrower for a
 * beat (as if getting pulled taut), THEN rockets straight up past the top
 * of the screen while squashing back down, fading out right at the tail end
 * of that flight.
 */
export const springTopCurtainTransition: PopupTransition = {
    playIn({ root, backdrop }) {
        const restY = root.position.y;

        root.position.y = restY - ENTRY_DROP_DISTANCE;
        root.rotation = ENTRY_ROTATION_RAD;
        root.alpha = 0;
        root.scale.set(1);

        gsap.to(root, { y: restY, duration: ENTRY_DURATION_SEC, ease: 'back.out(1.6)' });
        gsap.to(root, { rotation: 0, duration: ENTRY_DURATION_SEC, ease: 'elastic.out(1, 0.65)' });
        gsap.to(root, { alpha: 1, duration: ENTRY_DURATION_SEC * 0.4, ease: 'sine.out' });

        if (backdrop) {
            gsap.to(backdrop, { alpha: 1, duration: ENTRY_DURATION_SEC * 0.5 });
        }
    },

    playOut({ root, backdrop }, onComplete) {
        const restY = root.position.y;
        const flyDistance = (Game.overlayScreenData?.height ?? 1200) + EXIT_FLY_CLEARANCE;

        const timeline = gsap.timeline({ onComplete });

        // Dip + stretch — the panel getting pulled taut before it whips away.
        timeline.to(root, { y: restY + EXIT_DIP_DISTANCE, duration: EXIT_DIP_DURATION_SEC, ease: 'sine.in' });
        timeline.to(root.scale, { x: 0.92, y: 1.18, duration: EXIT_DIP_DURATION_SEC, ease: 'sine.out' }, '<');

        // Whip straight up off the top of the screen, squashing back down as it goes, fading
        // out right at the tail end of the flight (not the whole way — it should read as
        // FLYING away, not fading in place).
        timeline.to(root, { y: restY - flyDistance, duration: EXIT_FLY_DURATION_SEC, ease: 'power2.in' });
        timeline.to(root.scale, { x: 0.8, y: 0.55, duration: EXIT_FLY_DURATION_SEC, ease: 'power2.in' }, '<');
        timeline.to(root, { alpha: 0, duration: EXIT_FADE_DURATION_SEC, ease: 'sine.in' }, `-=${EXIT_FADE_DURATION_SEC}`);

        if (backdrop) {
            gsap.to(backdrop, { alpha: 0, duration: EXIT_DIP_DURATION_SEC + EXIT_FLY_DURATION_SEC });
        }

        return timeline;
    },
};

/**
 * The transition every popup shown through PopupManager actually uses — see
 * this file's own doc. Change THIS to change every popup's transition at once.
 */
export const ACTIVE_POPUP_TRANSITION: PopupTransition = springTopCurtainTransition;
