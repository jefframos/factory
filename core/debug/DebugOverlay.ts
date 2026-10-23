import { el, icon, ICONS, listeningControls } from './DebugControls';
import { DEBUG_OVERLAY_CSS } from './DebugOverlayStyles';
import { DebugPanel, type DebugPanelHost, type DebugPanelOptions } from './DebugPanel';
import { DebugSettingsStore, loadUiState, saveUiState, type DebugOverlayUiState, type DebugPanelUiState } from './DebugPersistence';
import { clamp } from './DebugValueUtils';
import { PerformanceMonitor } from '../runtime/performance/PerformanceMonitor';

const STYLE_ID = 'daybreak-debug-overlay-style';
const ROOT_ID = 'daybreak-debug-overlay';
const COMPACT_QUERY = '(max-width: 640px)';
const POLL_INTERVAL_MS = 100;

/** How often the launcher's FPS readout refreshes (ms) - slow enough to read. */
const FPS_INTERVAL_MS = 250;
const TOGGLE_KEY = '`';

/** Events that shouldn't leak from the overlay into the game (canvas input, PIXI global move, key shortcuts). */
const ISOLATED_EVENTS = [
    'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
    'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu',
    'touchstart', 'touchmove', 'touchend', 'wheel',
    'keydown', 'keyup', 'keypress',
];

/**
 * DOM debug overlay: floating panels of tweakable values, replacing dat.gui for new code.
 *
 * ```ts
 * const camera = DebugOverlay.instance.panel('Camera', { id: 'proto1.camera' });
 * camera.slider(settings, 'distance', 1, 20, 0.1).onChange(apply);
 * camera.color(material, 'color');
 * camera.vector(mesh, 'position', { step: 0.01 });
 * camera.select(config, 'mode', ShotControlMode);
 * camera.button('Reset ball', () => resetBall());
 * ```
 *
 * Enabled with `?debug=1` / `?debug=true`, or `initialize(true)` (the engine passes its `debug`
 * config). While disabled `panel()` returns an inert panel - controls still bind but nothing is
 * shown and no saved values are applied, so calling code needs no guards.
 *
 * Toggle everything with the launcher pill (top-left) or the backtick key.
 */
export class DebugOverlay implements DebugPanelHost {
    private static _instance?: DebugOverlay;

    public static get instance(): DebugOverlay {
        if (!DebugOverlay._instance) {
            DebugOverlay._instance = new DebugOverlay();
        }

        return DebugOverlay._instance;
    }

    private forced = false;
    private namespace = 'daybreak';
    private _store?: DebugSettingsStore;
    private ui: DebugOverlayUiState = {};
    private readonly panels = new Map<string, DebugPanel>();
    private readonly inertPanels = new Map<string, DebugPanel>();

    private root?: HTMLDivElement;
    private stack?: HTMLDivElement;
    private launcher?: HTMLDivElement;
    private launcherCount?: HTMLSpanElement;
    /** The small FPS readout under "Debug" on the launcher. */
    private launcherFps?: HTMLSpanElement;
    private lastFpsUpdate = 0;
    private menu?: HTMLDivElement;
    private toastEl?: HTMLDivElement;
    private toastTimer?: number;
    private suppressLauncherClick = false;
    private lastPoll = 0;
    private compactQuery?: MediaQueryList;

    private constructor() { }

    /** Shows the overlay when `force` is true or the URL has `?debug=1|true`. Safe to call repeatedly. */
    public initialize(force = false, namespace?: string): void {
        this.forced ||= force;

        if (namespace) {
            this.setNamespace(namespace);
        }

        if (this.isEnabled) {
            this.ensureDom();
        }
    }

    public get isEnabled(): boolean {
        if (this.forced) {
            return true;
        }

        try {
            const flag = new URLSearchParams(window.location.search).get('debug');
            return flag === '1' || flag === 'true';
        } catch {
            return false;
        }
    }

    /** Prefix for saved-settings cookies (e.g. the game slug). Set it before creating panels. */
    public setNamespace(namespace: string): void {
        if (this._store && namespace !== this.namespace) {
            console.warn('[DebugOverlay] setNamespace after panels were created - existing panels keep the old one.');
        }

        this.namespace = namespace;
        this._store = undefined;
    }

    /** Gets or creates a panel. `options.id` (default: title) keys its saved settings and layout. */
    public panel(title: string, options: DebugPanelOptions = {}): DebugPanel {
        const id = options.id ?? title;

        if (!this.isEnabled) {
            let inert = this.inertPanels.get(id);

            if (!inert) {
                inert = new DebugPanel(null, title, options);
                this.inertPanels.set(id, inert);
            }

            return inert;
        }

        const existing = this.panels.get(id);

        if (existing) {
            return existing;
        }

        this.ensureDom();
        const created = new DebugPanel(this, title, options);
        this.panels.set(id, created);
        this.panelStateChanged(created);
        return created;
    }

    public getPanel(id: string): DebugPanel | undefined {
        return this.panels.get(id) ?? this.inertPanels.get(id);
    }

    /** Destroys a panel (its saved settings stay saved). Use on scene teardown. */
    public removePanel(id: string): void {
        const panel = this.panels.get(id) ?? this.inertPanels.get(id);

        if (!panel) {
            return;
        }

        panel.destroy();
        this.panels.delete(id);
        this.inertPanels.delete(id);
        this.updateLauncher();
        this.renderMenu();
    }

    public get isVisible(): boolean {
        return !!this.root && !this.root.classList.contains('is-hidden');
    }

    public show(): void {
        this.setHidden(false);
    }

    public hide(): void {
        this.setHidden(true);
    }

    public toggle(): void {
        this.setHidden(this.isVisible);
    }

    // ----- DebugPanelHost --------------------------------------------------------------------

    public get store(): DebugSettingsStore {
        if (!this._store) {
            this._store = new DebugSettingsStore(this.namespace);
        }

        return this._store;
    }

    public get stackEl(): HTMLElement {
        this.ensureDom();
        return this.stack!;
    }

    public getPanelUi(panelId: string): DebugPanelUiState {
        return this.ui.panels?.[panelId] ?? {};
    }

    public updatePanelUi(panelId: string, patch: Partial<DebugPanelUiState>): void {
        this.ui.panels = { ...(this.ui.panels ?? {}), [panelId]: { ...this.getPanelUi(panelId), ...patch } };
        saveUiState(this.ui);
    }

    public toast(message: string, isError = false): void {
        if (!this.toastEl) {
            return;
        }

        this.toastEl.textContent = message;
        this.toastEl.classList.toggle('is-error', isError);
        this.toastEl.classList.add('is-visible');
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => this.toastEl?.classList.remove('is-visible'), isError ? 3200 : 1600);
    }

    public isCompact(): boolean {
        return this.compactQuery?.matches ?? false;
    }

    public bringToFront(panel: DebugPanel): void {
        this.panels.forEach((other) => other.element.classList.toggle('is-front', other === panel));
    }

    public panelStateChanged(_panel: DebugPanel): void {
        this.updateLauncher();

        if (this.menu && !this.menu.hidden) {
            this.renderMenu();
        }
    }

    // ----- DOM -------------------------------------------------------------------------------

    private ensureDom(): void {
        if (this.root) {
            return;
        }

        if (!document.getElementById(STYLE_ID)) {
            const style = el('style');
            style.id = STYLE_ID;
            style.textContent = DEBUG_OVERLAY_CSS;
            document.head.append(style);
        }

        this.ui = loadUiState();
        this.compactQuery = window.matchMedia(COMPACT_QUERY);

        const root = el('div', 'dbo-root');
        root.id = ROOT_ID;

        for (const type of ISOLATED_EVENTS) {
            root.addEventListener(type, (event) => event.stopPropagation());
        }

        this.stack = el('div', 'dbo-stack');
        this.launcher = this.createLauncher();
        this.menu = el('div', 'dbo-menu');
        this.menu.hidden = true;
        this.toastEl = el('div', 'dbo-toast');

        root.append(this.stack, this.launcher, this.menu, this.toastEl);
        document.body.append(root);
        this.root = root;

        this.setHidden(!!this.ui.hidden, false);

        if (this.ui.launcher) {
            this.placeLauncher(this.ui.launcher.x, this.ui.launcher.y);
        }

        window.addEventListener('keydown', (event) => {
            if (event.key !== TOGGLE_KEY || event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            const target = event.target as HTMLElement | null;

            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
                return;
            }

            this.toggle();
        });

        window.addEventListener('resize', () => {
            this.panels.forEach((panel) => panel.clampToViewport());

            if (this.ui.launcher) {
                this.placeLauncher(this.ui.launcher.x, this.ui.launcher.y);
            }

            this.closeMenu();
        });

        document.addEventListener('pointerdown', () => this.closeMenu());

        const poll = (now: number) => {
            requestAnimationFrame(poll);

            // The launcher is always on screen, so its FPS keeps updating with the panels hidden too.
            if (now - this.lastFpsUpdate >= FPS_INTERVAL_MS) {
                this.lastFpsUpdate = now;
                this.updateLauncherFps();
            }

            if (now - this.lastPoll < POLL_INTERVAL_MS || !this.isVisible) {
                return;
            }

            this.lastPoll = now;
            listeningControls.forEach((control) => control.refreshIfVisible());
        };

        requestAnimationFrame(poll);
    }

    private createLauncher(): HTMLDivElement {
        const launcher = el('div', 'dbo-launcher');

        const main = el('button', 'dbo-launcher-main');
        main.type = 'button';
        main.title = 'Show / hide debug panels  ( ` )';
        // "Debug" with the frame rate in small type under it.
        const label = el('span', 'dbo-launcher-label');

        this.launcherFps = el('span', 'dbo-launcher-fps', '-- fps');
        label.append(el('span', '', 'Debug'), this.launcherFps);
        main.append(el('span', 'dbo-dot'), label);
        main.addEventListener('click', () => {
            if (!this.consumeLauncherClick()) {
                this.toggle();
            }
        });

        const menuButton = el('button', 'dbo-launcher-menu');
        menuButton.type = 'button';
        menuButton.title = 'Panels';
        this.launcherCount = el('span', '', '0');
        menuButton.append(this.launcherCount, icon(ICONS.chevronDown, 12));
        menuButton.addEventListener('click', () => {
            if (this.consumeLauncherClick()) {
                return;
            }

            if (this.menu?.hidden) {
                this.openMenu();
            } else {
                this.closeMenu();
            }
        });

        launcher.append(main, menuButton);
        this.setupLauncherDrag(launcher);
        return launcher;
    }

    /** The engine's smoothed frame rate (PerformanceMonitor), coloured by how healthy it is. */
    private updateLauncherFps(): void {
        if (!this.launcherFps) {
            return;
        }

        const fps = Math.round(PerformanceMonitor.instance.getAverageFps());

        this.launcherFps.textContent = `${fps} fps`;
        this.launcherFps.dataset.level = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'low';
    }

    /** Drag the pill anywhere; capture-phase window listeners so the drag survives leaving it. */
    private setupLauncherDrag(launcher: HTMLDivElement): void {
        launcher.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) {
                return;
            }

            const rect = launcher.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            let dragging = false;

            const onMove = (move: PointerEvent) => {
                const dx = move.clientX - startX;
                const dy = move.clientY - startY;

                if (!dragging && Math.hypot(dx, dy) < 5) {
                    return;
                }

                dragging = true;
                this.closeMenu();
                this.placeLauncher(rect.left + dx, rect.top + dy);
            };

            const onUp = () => {
                window.removeEventListener('pointermove', onMove, true);
                window.removeEventListener('pointerup', onUp, true);
                window.removeEventListener('pointercancel', onUp, true);

                if (dragging) {
                    this.suppressLauncherClick = true;
                    window.setTimeout(() => { this.suppressLauncherClick = false; }, 0);
                    this.ui.launcher = { x: parseFloat(launcher.style.left), y: parseFloat(launcher.style.top) };
                    saveUiState(this.ui);
                }
            };

            window.addEventListener('pointermove', onMove, true);
            window.addEventListener('pointerup', onUp, true);
            window.addEventListener('pointercancel', onUp, true);
        });
    }

    private consumeLauncherClick(): boolean {
        const suppressed = this.suppressLauncherClick;
        this.suppressLauncherClick = false;
        return suppressed;
    }

    private placeLauncher(x: number, y: number): void {
        if (!this.launcher) {
            return;
        }

        const width = this.launcher.offsetWidth || 120;
        const height = this.launcher.offsetHeight || 36;
        this.launcher.style.left = `${clamp(x, 4, window.innerWidth - width - 4)}px`;
        this.launcher.style.top = `${clamp(y, 4, window.innerHeight - height - 4)}px`;
    }

    private setHidden(hidden: boolean, remember = true): void {
        this.root?.classList.toggle('is-hidden', hidden);

        if (!hidden) {
            this.panels.forEach((panel) => panel.isOpen && !panel.isMinimized && panel.refresh());
        }

        if (remember) {
            this.ui.hidden = hidden;
            saveUiState(this.ui);
        }
    }

    private updateLauncher(): void {
        if (this.launcherCount) {
            const open = [...this.panels.values()].filter((panel) => panel.isOpen).length;
            this.launcherCount.textContent = `${open}/${this.panels.size}`;
        }
    }

    private openMenu(): void {
        if (!this.menu || !this.launcher) {
            return;
        }

        this.renderMenu();
        this.menu.hidden = false;

        const rect = this.launcher.getBoundingClientRect();
        const menuRect = this.menu.getBoundingClientRect();
        const below = rect.bottom + 6 + menuRect.height <= window.innerHeight;

        this.menu.style.left = `${clamp(rect.left, 8, window.innerWidth - menuRect.width - 8)}px`;
        this.menu.style.top = `${below ? rect.bottom + 6 : Math.max(8, rect.top - 6 - menuRect.height)}px`;
    }

    private closeMenu(): void {
        if (this.menu) {
            this.menu.hidden = true;
        }
    }

    private renderMenu(): void {
        const menu = this.menu;

        if (!menu) {
            return;
        }

        menu.replaceChildren();

        if (this.panels.size === 0) {
            menu.append(el('div', 'dbo-menu-empty', 'No debug panels yet'));
        }

        this.panels.forEach((panel) => {
            const hint = panel.isMinimized ? 'minimized' : panel.isDirty ? 'unsaved' : '';
            menu.append(this.menuItem(panel.title, panel.isOpen, hint, () => {
                panel.toggleOpen();

                if (panel.isOpen) {
                    this.show();
                }
            }));
        });

        menu.append(el('div', 'dbo-menu-sep'));

        const anyOpen = [...this.panels.values()].some((panel) => panel.isOpen);

        menu.append(this.menuItem(anyOpen ? 'Close all panels' : 'Open all panels', null, '', () => {
            this.panels.forEach((panel) => (anyOpen ? panel.close() : panel.open()));

            if (!anyOpen) {
                this.show();
            }
        }));
        menu.append(this.menuItem('Collapse all', null, 'panels + folders', () => {
            this.panels.forEach((panel) => {
                panel.collapseAll();
                panel.setMinimized(true);
            });
        }));
        menu.append(this.menuItem('Reset layout', null, '', () => {
            this.panels.forEach((panel) => {
                panel.dock();
                panel.setMinimized(false);
                panel.open();
            });
            this.ui.launcher = null;
            this.launcher?.style.removeProperty('left');
            this.launcher?.style.removeProperty('top');
            saveUiState(this.ui);
            this.show();
            this.closeMenu();
        }));
    }

    private menuItem(label: string, checked: boolean | null, hint: string, action: () => void): HTMLButtonElement {
        const item = el('button', 'dbo-menu-item');
        item.type = 'button';

        if (checked !== null) {
            const check = el('span', 'dbo-check');
            item.classList.toggle('is-on', checked);

            if (checked) {
                check.append(icon(ICONS.check, 11));
            }

            item.append(check);
        }

        item.append(el('span', 'dbo-menu-label', label));

        if (hint) {
            item.append(el('span', 'dbo-menu-hint', hint));
        }

        item.addEventListener('click', () => {
            action();

            if (this.menu && !this.menu.hidden) {
                this.renderMenu();
            }
        });

        return item;
    }
}
