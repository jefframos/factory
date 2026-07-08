/**
 * Generic full-screen dim backdrop + centered content box. The building
 * block for any "big blocking screen" UI (menu, death/respawn choice, shop,
 * rename) — as opposed to CollapsiblePanel, which is for small corner-
 * anchored HUD widgets. Content-agnostic: callers push in whatever screen
 * should show right now via setContent, and swap it again to navigate
 * between sub-screens (see PlayerFlowController).
 */
export class ModalOverlay {
    readonly element: HTMLDivElement;
    private readonly boxEl: HTMLDivElement;
    private readonly fullEl: HTMLDivElement;
    private visible = false;

    constructor() {
        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            position: 'fixed',
            inset: '0',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            // No dimming — the world (and the player, centered in it) stays
            // fully visible behind the menu/death screen.
            pointerEvents: 'none', // only the box/full layer should catch clicks, not the full-viewport backdrop
        });

        this.boxEl = document.createElement('div');
        Object.assign(this.boxEl.style, {
            display: 'none',
            background: 'rgba(24, 24, 32, 0.96)',
            color: '#fff',
            borderRadius: '12px',
            padding: '24px 28px',
            minWidth: '280px',
            maxWidth: '90vw',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
            fontFamily: 'inherit',
            marginTop: '12vh', // sits a little below dead-center so it doesn't cover the player
            pointerEvents: 'auto', // opts back in over both the backdrop and DomUiRoot's pointer-events:none
        });

        // Mount point for screens that pin elements straight to viewport
        // corners/edges (e.g. the boot menu's shop/boost/CTA layout) via
        // `position: fixed`, rather than stacking in a centered box.
        this.fullEl = document.createElement('div');
        Object.assign(this.fullEl.style, {
            display: 'none',
            color: '#fff',
            fontFamily: 'inherit',
            pointerEvents: 'none', // individual rows/children opt back in
        });

        this.element.appendChild(this.boxEl);
        this.element.appendChild(this.fullEl);
    }

    /** Replaces the centered box's content right now. */
    setContent(build: (container: HTMLElement) => void): void {
        this.setDimmed(false);
        this.fullEl.style.display = 'none';
        this.fullEl.innerHTML = '';
        this.boxEl.innerHTML = '';
        this.boxEl.style.display = 'block';
        build(this.boxEl);
    }

    /**
     * Replaces the full-viewport, edge-anchored layer's content right now.
     * Children are expected to position themselves (`position: fixed`)
     * relative to the real viewport, so this layer imposes no layout of
     * its own — it's just a mount point.
     */
    setFullContent(build: (container: HTMLElement) => void): void {
        this.setDimmed(false);
        this.boxEl.style.display = 'none';
        this.boxEl.innerHTML = '';
        this.fullEl.innerHTML = '';
        this.fullEl.style.display = 'block';
        build(this.fullEl);
    }

    /**
     * Dims the world behind the overlay (e.g. the End Game screen) instead
     * of the default "world stays fully visible" look most screens use.
     * Also makes the backdrop itself catch clicks while dimmed, so a true
     * blocking screen doesn't leak input through to the game underneath —
     * undimmed screens intentionally let clicks pass through everywhere
     * except their own box/full content.
     */
    setDimmed(dimmed: boolean): void {
        this.element.style.background = dimmed ? 'rgba(0, 0, 0, 0.55)' : 'transparent';
        this.element.style.pointerEvents = dimmed ? 'auto' : 'none';
    }

    show(): void {
        this.visible = true;
        this.element.style.display = 'flex';
    }

    hide(): void {
        this.visible = false;
        this.element.style.display = 'none';
    }

    get isVisible(): boolean {
        return this.visible;
    }

    destroy(): void {
        this.element.remove();
    }
}
