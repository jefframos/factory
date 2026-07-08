import { DomUiRoot } from '../dom-ui/DomUiRoot';
import { Localization } from '../i18n/Localization';
import * as PIXI from 'pixi.js';

const HIDE_DELAY = 600; // ms after the first move before the hint fades out — lets the player see it actually worked
const FADE_DURATION = 400; // ms, must match the opacity transition below

function startText(): string {
    return Localization.getString(PIXI.isMobile.any ? 'tapToStartHint' : 'clickToStartHint');
}

function moveText(): string {
    return Localization.getString(PIXI.isMobile.any ? 'moveHintTouch' : 'moveHintMouse');
}

/**
 * One-time onboarding hint shown the moment the player joins — fades out
 * shortly after they first move (see registerMove), same "shown once on
 * initial join, not on every death/respawn" convention as LeaderboardPanel.
 * Two states: START_TEXT until the player's first move, then MOVE_TEXT
 * (swapped in registerMove) confirms the control scheme for a moment
 * before the hint fades.
 *
 * Structure is a plain fixed+centered wrapper (`element`) holding the actual
 * label (`label`) — kept separate because the label's pulse animation drives
 * its own `transform: scale(...)`, which would otherwise clobber the
 * wrapper's `translateX(-50%)` centering (both can't animate the same
 * `transform` property independently).
 */
export class MovementHint {
    readonly element: HTMLDivElement;
    private readonly label: HTMLDivElement;
    private hideTimer: number | null = null;
    /** Which text the label should show right now — flipped by registerMove(), re-applied on a locale change (see refreshText). */
    private moved = false;

    constructor() {
        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            position: 'fixed',
            left: '50%',
            bottom: '140px',
            transform: 'translateX(-50%)',
            display: 'none',
            opacity: '0',
            transition: `opacity ${FADE_DURATION}ms ease`,
            pointerEvents: 'none',
        });

        this.label = document.createElement('div');
        this.label.className = 'pulse-scale';
        Object.assign(this.label.style, {
            background: 'rgba(10, 14, 22, 0.65)',
            borderRadius: '999px',
            padding: '10px 24px',
            fontSize: '15px',
            fontWeight: 'bold',
            color: '#fff',
            textShadow: '0 1px 3px rgba(0,0,0,0.5)',
        });
        this.label.textContent = startText();
        this.element.appendChild(this.label);

        DomUiRoot.instance.mount(this.element);
        Localization.onLocaleChange.add(this.refreshText, this);
    }

    private refreshText(): void {
        this.label.textContent = this.moved ? moveText() : startText();
    }

    show(): void {
        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.moved = false;
        this.label.textContent = startText();
        this.element.style.display = 'inline-flex';
        // Force a paint with opacity still 0 before animating it to 1, so the
        // transition actually plays instead of jumping straight to visible.
        requestAnimationFrame(() => { this.element.style.opacity = '1'; });
    }

    /** Call on every move-input event; only the first call after a show() swaps in the "how to move" text and starts the fade-out countdown. */
    registerMove(): void {
        if (this.hideTimer !== null || this.element.style.display === 'none') return;
        this.moved = true;
        this.label.textContent = moveText();
        this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY);
    }

    /** Dismisses right away instead of waiting out HIDE_DELAY — for cases where the hint shouldn't linger regardless of whether the player ever moved: dying, or landing back on the boot menu. */
    forceHide(): void {
        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.hide();
    }

    private hide(): void {
        this.element.style.opacity = '0';
        window.setTimeout(() => { this.element.style.display = 'none'; }, FADE_DURATION);
    }

    destroy(): void {
        if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
        Localization.onLocaleChange.remove(this.refreshText, this);
        DomUiRoot.instance.unmount(this.element);
    }
}
