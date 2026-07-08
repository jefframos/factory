import './buttons.css';

/**
 * Root mount point for production, player-facing DOM/CSS UI — the
 * always-on sibling of DevGuiManager/DebugHtmlManager (both dev-only). A
 * single fixed full-viewport div that individual UI components (Leaderboard,
 * future Menu/Shop/etc.) mount their own elements into, so every game only
 * ever touches one DOM root regardless of how many panels it builds.
 */
export class DomUiRoot {
    private static _instance: DomUiRoot;
    public static get instance(): DomUiRoot {
        if (!DomUiRoot._instance) {
            DomUiRoot._instance = new DomUiRoot();
        }
        return DomUiRoot._instance;
    }

    private root: HTMLDivElement | null = null;

    private constructor() { }

    private ensureRoot(): HTMLDivElement {
        if (this.root) return this.root;

        this.root = document.createElement('div');
        Object.assign(this.root.style, {
            position: 'fixed',
            inset: '0',
            pointerEvents: 'none', // mounted panels opt back in individually (see CollapsiblePanel)
            zIndex: '9000',        // above the game canvas (Pixi sits at 8 — see DevGuiManager), below dev tools (DebugHtmlManager 9999 / DevGuiManager 10000+)
            fontFamily: 'LEMONMILK-Regular, sans-serif',
        });
        document.body.appendChild(this.root);
        return this.root;
    }

    mount(el: HTMLElement): void {
        this.ensureRoot().appendChild(el);
    }

    unmount(el: HTMLElement): void {
        el.remove();
    }
}
