/**
 * Swallows every input while the PLATFORM has the game paused (YouTube Playables' ytgame.system.onPause, Poki, the
 * dev "Pause Game" toggle — anything dispatched through PlatformHandler.onPause). Game.ts stops the ticker on that
 * pause, but PIXI's event system still answers pointers, so a tap on a menu button would still act behind the
 * platform's pause. A game's own in-game pause menu never goes through PlatformHandler.onPause, so it's unaffected.
 *
 * Two layers: a transparent full-screen DOM cover on top of everything (stops the hit), and window capture-phase
 * listeners that stop the events before any canvas/PIXI/DOM handler sees them (catches keys and anything that slips
 * past the cover). The dev GUI (dat.gui, `.dg`) is let through so its pause toggle can resume.
 */
const BLOCKED_EVENTS = [
    'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
    'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu', 'wheel',
    'touchstart', 'touchmove', 'touchend', 'touchcancel',
    'keydown', 'keyup', 'keypress',
] as const;

export class PauseBlocker {
    private blocking = false;
    private cover: HTMLDivElement | null = null;
    private installed = false;

    private readonly swallow = (event: Event): void => {
        if (!this.blocking) return;
        const target = event.target as Element | null;
        if (target?.closest?.('.dg')) return;
        event.stopImmediatePropagation();
        if (event.cancelable) event.preventDefault();
    };

    /** Starts listening (idempotent). Nothing is blocked until block(). */
    public install(): void {
        if (this.installed || typeof window === 'undefined') return;
        this.installed = true;
        for (const type of BLOCKED_EVENTS) {
            window.addEventListener(type, this.swallow, { capture: true, passive: false });
        }
    }

    public get isBlocking(): boolean {
        return this.blocking;
    }

    public block(): void {
        if (this.blocking) return;
        this.blocking = true;
        if (typeof document === 'undefined') return;
        const cover = document.createElement('div');
        cover.setAttribute('data-platform-pause', '');
        Object.assign(cover.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483646',
            background: 'transparent',
            touchAction: 'none',
            userSelect: 'none',
        } as Partial<CSSStyleDeclaration>);
        document.body.appendChild(cover);
        this.cover = cover;
    }

    public unblock(): void {
        if (!this.blocking) return;
        this.blocking = false;
        this.cover?.remove();
        this.cover = null;
    }
}
