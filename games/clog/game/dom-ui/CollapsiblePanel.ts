export type UiCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNER_STYLE: Record<UiCorner, Partial<CSSStyleDeclaration>> = {
    'top-left': { top: '12px', left: '12px' },
    'top-right': { top: '12px', right: '12px' },
    'bottom-left': { bottom: '12px', left: '12px' },
    'bottom-right': { bottom: '12px', right: '12px' },
};

export interface CollapsiblePanelOptions {
    corner: UiCorner;
    title: string;
    /** Starting expand/collapse state. Defaults to false (minimized) — callers that need a "big by default" panel can override. */
    defaultExpanded?: boolean;
}

/**
 * Generic corner-anchored DOM panel with a header (title + expand/collapse
 * toggle) and a body. Purely presentational and content-agnostic — it only
 * owns the expanded/collapsed *state* and the toggle affordance; callers
 * decide what "collapsed" vs "expanded" content actually looks like (e.g.
 * LeaderboardPanel shows top-3 collapsed, the full roster expanded) via
 * setBodyContent, re-called from an onToggle listener.
 */
export class CollapsiblePanel {
    readonly element: HTMLDivElement;

    private readonly bodyEl: HTMLDivElement;
    private readonly toggleBtn: HTMLButtonElement;
    private expanded: boolean;
    private readonly toggleListeners: Array<(expanded: boolean) => void> = [];

    constructor(opts: CollapsiblePanelOptions) {
        this.expanded = opts.defaultExpanded ?? false;

        this.element = document.createElement('div');
        Object.assign(this.element.style, {
            position: 'fixed',
            ...CORNER_STYLE[opts.corner],
            minWidth: '180px',
            maxWidth: '280px',
            background: 'rgba(20, 20, 28, 0.85)',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: '13px',
            borderRadius: '8px',
            overflow: 'hidden',
            pointerEvents: 'auto', // opts back in over DomUiRoot's pointer-events:none so the toggle is clickable
            boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 10px',
            cursor: 'pointer',
            fontWeight: 'bold',
            background: 'rgba(255,255,255,0.06)',
            userSelect: 'none',
        });
        const titleEl = document.createElement('span');
        titleEl.textContent = opts.title;

        this.toggleBtn = document.createElement('button');
        Object.assign(this.toggleBtn.style, {
            background: 'none',
            border: 'none',
            color: '#fff',
            fontSize: '14px',
            cursor: 'pointer',
            padding: '0',
            lineHeight: '1',
        });

        header.appendChild(titleEl);
        header.appendChild(this.toggleBtn);
        header.addEventListener('click', () => this.setExpanded(!this.expanded));

        this.bodyEl = document.createElement('div');
        Object.assign(this.bodyEl.style, {
            padding: '6px 10px 10px',
            maxHeight: '50vh',
            overflowY: 'auto',
        });

        this.element.appendChild(header);
        this.element.appendChild(this.bodyEl);
        this.updateToggleIcon();
    }

    get isExpanded(): boolean {
        return this.expanded;
    }

    setExpanded(value: boolean): void {
        if (this.expanded === value) return;
        this.expanded = value;
        this.updateToggleIcon();
        for (const cb of this.toggleListeners) cb(this.expanded);
    }

    /** Called whenever the user clicks the header/toggle — re-render body content for the new state here (see LeaderboardPanel). */
    onToggle(cb: (expanded: boolean) => void): void {
        this.toggleListeners.push(cb);
    }

    /** Replaces the body's content right now — callers own what "right now" should look like. */
    setBodyContent(build: (container: HTMLElement) => void): void {
        this.bodyEl.innerHTML = '';
        build(this.bodyEl);
    }

    private updateToggleIcon(): void {
        this.toggleBtn.textContent = this.expanded ? '▾' : '▸';
    }

    destroy(): void {
        this.element.remove();
    }
}
