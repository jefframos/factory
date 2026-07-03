export type DebugPanelCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNER_STYLE: Record<DebugPanelCorner, Partial<CSSStyleDeclaration>> = {
    'top-left': { top: '8px', left: '8px' },
    'top-right': { top: '8px', right: '8px' },
    'bottom-left': { bottom: '8px', left: '8px' },
    'bottom-right': { bottom: '8px', right: '8px' },
};

/**
 * Lightweight DOM-based debug overlay — a plain-HTML/CSS alternative to
 * dat.GUI (DevGuiManager) for displaying data that reads better as a list or
 * table (scores, entity dumps) than as sliders/buttons. Same singleton +
 * isDev-gate shape as DevGuiManager so the two feel consistent side by side.
 */
export class DebugHtmlManager {
    private static _instance: DebugHtmlManager;
    public static get instance(): DebugHtmlManager {
        if (!DebugHtmlManager._instance) {
            DebugHtmlManager._instance = new DebugHtmlManager();
        }
        return DebugHtmlManager._instance;
    }

    private root: HTMLDivElement | null = null;
    private panels: Map<string, HTMLDivElement> = new Map();
    private initialized = false;
    private isDev = false;

    private constructor() { }

    public initialize(isDev: boolean): void {
        if (!isDev || this.initialized) return;
        this.isDev = isDev;

        this.root = document.createElement('div');
        Object.assign(this.root.style, {
            position: 'fixed',
            inset: '0',
            pointerEvents: 'none', // panels are read-only overlays, never block game input
            zIndex: '9999',        // below DevGuiManager's dat.GUI (10000/10001)
        });
        document.body.appendChild(this.root);
        this.initialized = true;
    }

    /** Creates an empty panel anchored to a screen corner. No-ops if it already exists. */
    public createPanel(id: string, opts?: { corner?: DebugPanelCorner; title?: string }): void {
        if (!this.isDev || !this.root || this.panels.has(id)) return;

        const corner = opts?.corner ?? 'bottom-right';
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            position: 'fixed',
            ...CORNER_STYLE[corner],
            minWidth: '160px',
            maxWidth: '320px',
            maxHeight: '50vh',
            overflowY: 'auto',
            background: 'rgba(0, 0, 0, 0.7)',
            color: '#fff',
            fontFamily: 'monospace',
            fontSize: '12px',
            lineHeight: '1.5',
            padding: '8px 10px',
            borderRadius: '6px',
            whiteSpace: 'pre',
        });
        panel.dataset.title = opts?.title ?? '';
        this.root.appendChild(panel);
        this.panels.set(id, panel);
    }

    /** Replaces a panel's content with `title` (bold header, if set on creation or passed here) followed by one row per line. */
    public setLines(id: string, lines: string[], title?: string): void {
        if (!this.isDev) return;
        const panel = this.panels.get(id);
        if (!panel) return;

        const heading = title ?? panel.dataset.title;
        panel.innerHTML = '';
        if (heading) {
            const h = document.createElement('div');
            h.textContent = heading;
            h.style.fontWeight = 'bold';
            h.style.marginBottom = '4px';
            panel.appendChild(h);
        }
        for (const line of lines) {
            const row = document.createElement('div');
            row.textContent = line;
            panel.appendChild(row);
        }
    }

    public removePanel(id: string): void {
        const panel = this.panels.get(id);
        if (!panel) return;
        panel.remove();
        this.panels.delete(id);
    }

    /** Tears down every panel and the overlay root (optional — mirrors DevGuiManager.clear()). */
    public clear(): void {
        if (!this.isDev || !this.root) return;
        this.root.remove();
        this.root = null;
        this.panels.clear();
        this.initialized = false;
    }
}
