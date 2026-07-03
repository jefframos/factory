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
            pointerEvents: 'none', // only the box itself should catch clicks, not the full-viewport backdrop
        });

        this.boxEl = document.createElement('div');
        Object.assign(this.boxEl.style, {
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

        this.element.appendChild(this.boxEl);
    }

    /** Replaces the centered box's content right now. */
    setContent(build: (container: HTMLElement) => void): void {
        this.boxEl.innerHTML = '';
        build(this.boxEl);
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
