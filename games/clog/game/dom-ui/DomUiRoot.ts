import './buttons.css';

export interface DomUiRootOptions {
    /**
     * Virtual resolution used to author the DOM UI.
     *
     * All mounted elements should be positioned and sized as though the
     * browser were always this size.
     */
    designWidth?: number;
    designHeight?: number;

    /**
     * Prevent the UI from becoming larger than its authored size.
     *
     * Set to Number.POSITIVE_INFINITY to allow unlimited upscaling.
     */
    maxScale?: number;

    /**
     * Optional lower scale limit.
     *
     * Usually keep this at 0 so the complete interface always remains visible.
     */
    minScale?: number;
}

/**
 * Root mount point for production, player-facing DOM/CSS UI.
 *
 * The DOM UI is authored against a fixed virtual resolution, then the entire
 * root is uniformly scaled to fit inside the real viewport. This behaves like
 * a Pixi container using a "contain" resize strategy.
 *
 * DOM structure:
 *
 * viewportRoot
 * └── scaledRoot
 *     └── mounted UI elements
 */
export class DomUiRoot {
    private static _instance: DomUiRoot | null = null;

    public static get instance(): DomUiRoot {
        if (!DomUiRoot._instance) {
            DomUiRoot._instance = new DomUiRoot();
        }

        return DomUiRoot._instance;
    }

    private readonly designWidth = 1500;
    private readonly designHeight = 1024;

    /**
     * Keeps the UI at its authored size on large desktop displays.
     *
     * Change this to Number.POSITIVE_INFINITY if the UI should also upscale.
     */
    private readonly maxScale = 1;

    private readonly minScale = 0;

    /**
     * Full real-viewport container.
     */
    private viewportRoot: HTMLDivElement | null = null;

    /**
     * Fixed-resolution virtual UI container.
     *
     * All player-facing UI is mounted into this element.
     */
    private scaledRoot: HTMLDivElement | null = null;

    private currentScale = 1;

    private constructor() {
        this.handleResize = this.handleResize.bind(this);
    }

    /**
     * Current scale applied to the virtual UI root.
     */
    public get scale(): number {
        return this.currentScale;
    }

    /**
     * Virtual resolution width.
     */
    public get width(): number {
        return this.designWidth;
    }

    /**
     * Virtual resolution height.
     */
    public get height(): number {
        return this.designHeight;
    }

    /**
     * Mount an element into the fixed-resolution, uniformly scaled UI root.
     */
    public mount(el: HTMLElement): void {
        this.ensureRoot().appendChild(el);
    }

    public unmount(el: HTMLElement): void {
        el.remove();
    }

    /**
     * Forces the root scale to be recalculated.
     *
     * Normally this happens automatically on resize and orientation changes.
     */
    public resize(): void {
        this.handleResize();
    }

    /**
     * Converts real browser coordinates into virtual UI coordinates.
     *
     * Useful when handling pointer positions outside normal DOM event targets.
     */
    public screenToUi(
        screenX: number,
        screenY: number,
    ): { x: number; y: number } {
        const scaledRoot = this.ensureRoot();
        const bounds = scaledRoot.getBoundingClientRect();

        return {
            x: (screenX - bounds.left) / this.currentScale,
            y: (screenY - bounds.top) / this.currentScale,
        };
    }

    /**
     * Converts virtual UI coordinates into real browser coordinates.
     */
    public uiToScreen(
        uiX: number,
        uiY: number,
    ): { x: number; y: number } {
        const scaledRoot = this.ensureRoot();
        const bounds = scaledRoot.getBoundingClientRect();

        return {
            x: bounds.left + uiX * this.currentScale,
            y: bounds.top + uiY * this.currentScale,
        };
    }

    /**
     * Removes the DOM roots and registered browser listeners.
     *
     * This is mainly useful for tests or full engine teardown.
     */
    public destroy(): void {
        window.removeEventListener('resize', this.handleResize);
        window.removeEventListener('orientationchange', this.handleResize);
        window.visualViewport?.removeEventListener(
            'resize',
            this.handleResize,
        );

        this.viewportRoot?.remove();

        this.viewportRoot = null;
        this.scaledRoot = null;
        this.currentScale = 1;

        DomUiRoot._instance = null;
    }

    private ensureRoot(): HTMLDivElement {
        if (this.scaledRoot) {
            return this.scaledRoot;
        }

        this.ensureDocumentStyles();

        this.viewportRoot = document.createElement('div');
        this.viewportRoot.dataset.domUiViewport = '';

        Object.assign(this.viewportRoot.style, {
            position: 'fixed',
            inset: '0',
            overflow: 'hidden',

            // The root itself does not block the game canvas. Individual
            // interactive panels/buttons opt back in with pointer-events:auto.
            pointerEvents: 'none',

            // Above the Pixi canvas, below development/debug tools.
            zIndex: '9000',

            fontFamily: 'LEMONMILK-Regular, sans-serif',
        });

        this.scaledRoot = document.createElement('div');
        this.scaledRoot.dataset.domUiRoot = '';

        Object.assign(this.scaledRoot.style, {
            position: 'absolute',

            // Center the virtual resolution inside the browser viewport.
            left: '50%',
            top: '50%',

            width: `${this.designWidth}px`,
            height: `${this.designHeight}px`,

            transformOrigin: 'center center',
            pointerEvents: 'none',

            // Prevent the browser from treating child dimensions as responsive
            // viewport dimensions. Children are laid out against this fixed
            // virtual canvas instead.
            boxSizing: 'border-box',
        });

        this.viewportRoot.appendChild(this.scaledRoot);
        document.body.appendChild(this.viewportRoot);

        window.addEventListener('resize', this.handleResize);
        window.addEventListener('orientationchange', this.handleResize);

        // Particularly useful on mobile when browser chrome or the virtual
        // keyboard changes the actually visible viewport.
        window.visualViewport?.addEventListener(
            'resize',
            this.handleResize,
        );

        this.handleResize();

        return this.scaledRoot;
    }

    private handleResize(): void {
        if (!this.scaledRoot) {
            return;
        }


        return
        const viewportWidth =
            window.visualViewport?.width ??
            document.documentElement.clientWidth ??
            window.innerWidth;

        const viewportHeight =
            window.visualViewport?.height ??
            document.documentElement.clientHeight ??
            window.innerHeight;

        const scaleX = viewportWidth / this.designWidth;
        const scaleY = viewportHeight / this.designHeight;

        // Equivalent to Pixi's contain behaviour: preserve aspect ratio and
        // guarantee the complete virtual UI remains visible.
        const containedScale = Math.min(scaleX, scaleY);

        this.currentScale = Math.min(
            this.maxScale,
            Math.max(this.minScale, containedScale),
        );

        this.scaledRoot.style.transform = [
            'translate(-50%, -50%)',
            `scale(${this.currentScale})`,
        ].join(' ');
    }

    private ensureDocumentStyles(): void {
        document.documentElement.style.width = '100%';
        document.documentElement.style.height = '100%';

        Object.assign(document.body.style, {
            width: '100%',
            height: '100%',
            margin: '0',
            overflow: 'hidden',
        });
    }
}