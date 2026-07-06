import { DomUiRoot } from '@core/dom-ui/DomUiRoot';

const HIDE_DELAY = 600; // ms after the first move before the hint fades out — lets the player see it actually worked
const FADE_DURATION = 400; // ms, must match the opacity transition below

/**
 * One-time onboarding hint shown the moment the player joins — fades out
 * shortly after they first move (see registerMove), same "shown once on
 * initial join, not on every death/respawn" convention as LeaderboardPanel.
 */
export class MovementHint {
    readonly element: HTMLDivElement;
    private hideTimer: number | null = null;

    constructor() {
        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            position: 'fixed',
            right: '24px',
            bottom: '24px',
            padding: '10px 18px',
            borderRadius: '999px',
            background: '#5ecf5e',
            color: '#fff',
            fontWeight: 'bold',
            fontSize: '15px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'none',
            opacity: '0',
            transition: `opacity ${FADE_DURATION}ms ease`,
            pointerEvents: 'none',
        });
        this.element.textContent = 'Use mouse to move';

        DomUiRoot.instance.mount(this.element);
    }

    show(): void {
        if (this.hideTimer !== null) {
            window.clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        this.element.style.display = 'block';
        // Force a paint with opacity still 0 before animating it to 1, so the
        // transition actually plays instead of jumping straight to visible.
        requestAnimationFrame(() => { this.element.style.opacity = '1'; });
    }

    /** Call on every move-input event; only the first call after a show() starts the fade-out countdown. */
    registerMove(): void {
        if (this.hideTimer !== null || this.element.style.display === 'none') return;
        this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY);
    }

    private hide(): void {
        this.element.style.opacity = '0';
        window.setTimeout(() => { this.element.style.display = 'none'; }, FADE_DURATION);
    }

    destroy(): void {
        if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
        DomUiRoot.instance.unmount(this.element);
    }
}
