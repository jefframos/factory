import {
    ArrayControl,
    ButtonControl,
    ColorControl,
    createAutoControl,
    DebugControl,
    DebugValueControl,
    el,
    icon,
    ICONS,
    MonitorControl,
    NumberControl,
    SelectControl,
    TextControl,
    ToggleControl,
    VectorControl,
    type DebugArrayOptions,
    type DebugAutoOptions,
    type DebugButtonDef,
    type DebugChangeSource,
    type DebugChoices,
    type DebugControlOptions,
    type DebugControlOwner,
    type DebugMonitorOptions,
    type DebugNumberOptions,
    type DebugSelectOptions,
    type DebugVectorOptions,
} from './DebugControls';
import type { DebugPanelUiState, DebugSettingsStore } from './DebugPersistence';
import { clamp, clonePlain, isColorLike, isPlainObject, isRgbObject, plainEquals, prettifyKey, vectorComponents } from './DebugValueUtils';

/** What a panel needs from the overlay that owns it. */
export interface DebugPanelHost {
    readonly store: DebugSettingsStore;
    readonly stackEl: HTMLElement;
    getPanelUi(panelId: string): DebugPanelUiState;
    updatePanelUi(panelId: string, patch: Partial<DebugPanelUiState>): void;
    toast(message: string, isError?: boolean): void;
    /** Phone layout: panels sit in a bottom sheet and can't be dragged. */
    isCompact(): boolean;
    bringToFront(panel: DebugPanel): void;
    panelStateChanged(panel: DebugPanel): void;
}

export interface DebugFolderOptions {
    collapsed?: boolean;
}

export interface DebugObjectOptions extends DebugAutoOptions {
    /** Folder title; `null` adds the controls straight into this folder. Default: prettified constructor name. */
    label?: string | null;
    /** Only these keys (in this order). Default: every own enumerable key not starting with `_`. */
    keys?: string[];
    exclude?: string[];
    /** Per-key label overrides. */
    labels?: Record<string, string>;
    collapsed?: boolean;
    persist?: boolean;
    listen?: boolean;
    /** Called after any property in the object changes. */
    onChange?: (key: string, value: unknown) => void;
}

type Key<T> = keyof T & (string | number);

interface FolderDom {
    element: HTMLElement;
    body: HTMLElement;
}

/** A collapsible group of controls. A DebugPanel is the root folder of a floating card. */
export class DebugFolder implements DebugControlOwner {
    public readonly element: HTMLElement;
    protected readonly bodyEl: HTMLElement;

    private readonly childFolders = new Map<string, DebugFolder>();
    private readonly controls: DebugControl[] = [];
    private readonly changeListeners: ((control: DebugControl, source: DebugChangeSource) => void)[] = [];

    protected constructor(
        protected readonly dom: FolderDom,
        private readonly rootPanel: DebugPanel | null,
        public readonly parent: DebugFolder | null,
        public readonly name: string,
        /** Slash path from the panel root ('' for the panel itself). */
        public readonly path: string,
    ) {
        this.element = dom.element;
        this.bodyEl = dom.body;
    }

    public get panel(): DebugPanel {
        return this.rootPanel ?? (this as unknown as DebugPanel);
    }

    // ----- structure -------------------------------------------------------------------------

    /** Gets or creates a sub-folder; `'Lights/Sun'` creates both levels. */
    public folder(path: string, options: DebugFolderOptions = {}): DebugFolder {
        let current: DebugFolder = this;

        for (const part of path.split('/').map((p) => p.trim()).filter(Boolean)) {
            current = current.childFolder(part, options);
        }

        return current;
    }

    public getFolder(path: string): DebugFolder | undefined {
        let current: DebugFolder | undefined = this;

        for (const part of path.split('/').map((p) => p.trim()).filter(Boolean)) {
            current = current?.childFolders.get(part);
        }

        return current === this ? undefined : current;
    }

    public removeFolder(path: string): void {
        const folder = this.getFolder(path);

        if (folder) {
            folder.parent?.childFolders.delete(folder.name);
            folder.destroy();
        }
    }

    /** Removes a control created by this folder. */
    public remove(control: DebugControl): void {
        const index = this.controls.indexOf(control);

        if (index >= 0) {
            this.controls.splice(index, 1);
        }

        if (control instanceof DebugValueControl) {
            this.panel.unregisterValueControl(control);
        }

        control.destroy();
    }

    /** Removes every control and sub-folder. */
    public clear(): void {
        [...this.controls].forEach((control) => this.remove(control));
        [...this.childFolders.keys()].forEach((name) => this.removeFolder(name));
    }

    public setCollapsed(collapsed: boolean): this {
        if (this.path) {
            this.element.classList.toggle('is-collapsed', collapsed);
            this.panel.rememberFolderCollapsed(this.path, collapsed);
        }

        return this;
    }

    public collapse(): this {
        return this.setCollapsed(true);
    }

    public expand(): this {
        return this.setCollapsed(false);
    }

    /** Collapses every sub-folder (and array list) below this one. */
    public collapseAll(): this {
        this.controls.forEach((control) => {
            if (control instanceof ArrayControl) {
                control.setCollapsed(true);
            }
        });

        this.childFolders.forEach((folder) => {
            folder.collapseAll();
            folder.collapse();
        });
        return this;
    }

    /** Fires after any control in this folder (or its sub-folders) changes. */
    public onChange(listener: (control: DebugControl, source: DebugChangeSource) => void): this {
        this.changeListeners.push(listener);
        return this;
    }

    public handleControlChange(control: DebugControl, source: DebugChangeSource): void {
        for (const listener of this.changeListeners) {
            try {
                listener(control, source);
            } catch (error) {
                console.error('[DebugOverlay] folder onChange failed', error);
            }
        }

        this.parent?.handleControlChange(control, source);
    }

    /**
     * Re-reads every bound value into the UI. Call after game code changes bound values itself
     * (presets, resets...) - it also re-syncs the modified markers and the Apply button.
     */
    public refresh(): void {
        this.refreshTree();
        this.panel.syncState();
    }

    protected refreshTree(): void {
        this.controls.forEach((control) => control.refresh());
        this.childFolders.forEach((folder) => folder.refreshTree());
    }

    // ----- controls --------------------------------------------------------------------------

    /** Slider when `min` and `max` are given, otherwise a drag-to-scrub number field. */
    public number<T extends object>(target: T, key: Key<T>, options: DebugNumberOptions = {}): NumberControl {
        return this.add(new NumberControl(this.labelFor(key, options), target, key, options), options.id);
    }

    /** Shorthand for `number` with a range (same argument order as the old DebugMenuManager.addSlider). */
    public slider<T extends object>(target: T, key: Key<T>, min: number, max: number, step?: number, label?: string): NumberControl {
        return this.number(target, key, { min, max, step, label });
    }

    /** Several numeric properties sharing one range (old DebugMenuManager.addProperties). */
    public numbers<T extends object>(target: T, keys: Key<T>[], range?: readonly [number, number], step?: number, prefix?: string): NumberControl[] {
        return keys.map((key) => this.number(target, key, {
            min: range?.[0],
            max: range?.[1],
            step,
            label: prefix ? `${prefix}.${String(key)}` : undefined,
        }));
    }

    public toggle<T extends object>(target: T, key: Key<T>, options: DebugControlOptions<boolean> = {}): ToggleControl {
        return this.add(new ToggleControl(this.labelFor(key, options), target, key, options), options.id);
    }

    /** THREE.Color (edited in place), 0xRRGGBB number, '#rrggbb' string or { r, g, b }. */
    public color<T extends object>(target: T, key: Key<T>, options: DebugControlOptions<string> = {}): ColorControl {
        return this.add(new ColorControl(this.labelFor(key, options), target, key, options), options.id);
    }

    /** Pick one of `choices`: a TS enum, a label->value record, or an array of values. */
    public select<T extends object, V = unknown>(target: T, key: Key<T>, choices: DebugChoices<V>, options: DebugSelectOptions<V> = {}): SelectControl<V> {
        return this.add(new SelectControl<V>(this.labelFor(key, options), target, key, choices, options), options.id);
    }

    /** Alias of `select`, for enums. */
    public enum<T extends object, V = unknown>(target: T, key: Key<T>, enumObject: DebugChoices<V>, options: DebugSelectOptions<V> = {}): SelectControl<V> {
        return this.select(target, key, enumObject, options);
    }

    public text<T extends object>(target: T, key: Key<T>, options: DebugControlOptions<string> = {}): TextControl {
        return this.add(new TextControl(this.labelFor(key, options), target, key, options), options.id);
    }

    /** THREE.Vector2/3/4, Euler, { x, y(, z, w) } or a 2-4 number tuple, edited in place. */
    public vector<T extends object>(target: T, key: Key<T>, options: DebugVectorOptions = {}): VectorControl {
        return this.add(new VectorControl(this.labelFor(key, options), target, key, options), options.id);
    }

    public array<T extends object>(target: T, key: Key<T>, options: DebugArrayOptions = {}): ArrayControl {
        return this.add(new ArrayControl(this.labelFor(key, options), target, key, options), options.id);
    }

    /** Picks the control from the property's current value (number, boolean, string, color, vector, array, object). */
    public auto<T extends object>(target: T, key: Key<T>, options: DebugControlOptions & DebugAutoOptions = {}): DebugValueControl<any> | DebugFolder | null {
        const value = (target as any)[key];

        if (Array.isArray(value) && !vectorComponents(value)) {
            return this.array(target, key, options);
        }

        if (Array.isArray(value)) {
            return this.vector(target, key, options);
        }

        if (isPlainObject(value) && !vectorComponents(value) && !isRgbObject(value)) {
            return this.object(value, { ...options, label: options.label ?? prettifyKey(String(key)), persist: options.persist, onChange: undefined });
        }

        const control = createAutoControl(this.labelFor(key, options), target, key, options);
        return control ? this.add(control, options.id) : null;
    }

    /**
     * One control per property of `target`, picked from each value's type. Nested plain objects
     * become sub-folders. Returns the folder holding them.
     */
    public object<T extends object>(target: T, options: DebugObjectOptions = {}): DebugFolder {
        const label = options.label === undefined
            ? prettifyKey(target.constructor?.name && target.constructor !== Object ? target.constructor.name : 'Object')
            : options.label;
        const folder = label === null ? this : this.folder(label, { collapsed: options.collapsed });
        const keys = options.keys ?? Object.keys(target).filter((key) => !key.startsWith('_'));

        for (const key of keys) {
            if (options.exclude?.includes(key)) {
                continue;
            }

            const value = (target as any)[key];

            if (typeof value === 'function' || value === undefined || value === null) {
                continue;
            }

            const controlOptions: DebugControlOptions & DebugAutoOptions = {
                label: options.labels?.[key],
                ranges: options.ranges,
                step: options.step,
                min: options.min,
                max: options.max,
                persist: options.persist,
                listen: options.listen,
                onChange: options.onChange ? (v: unknown) => options.onChange!(key, v) : undefined,
            };

            if (isPlainObject(value) && !vectorComponents(value) && !isRgbObject(value) && !isColorLike(value)) {
                const child = folder.object(value, { ...options, keys: undefined, label: options.labels?.[key] ?? prettifyKey(key), collapsed: true });

                if (options.onChange) {
                    child.onChange((control) => options.onChange!(key, (control as DebugValueControl).getValue?.()));
                }

                continue;
            }

            folder.auto(target, key as Key<T>, controlOptions);
        }

        return folder;
    }

    public button(label: string, action: () => void, options: Omit<DebugButtonDef, 'label' | 'action'> = {}): ButtonControl {
        return this.add(new ButtonControl([{ label, action, ...options }]));
    }

    /** Several buttons side by side in one row. */
    public buttons(defs: DebugButtonDef[]): ButtonControl {
        return this.add(new ButtonControl(defs));
    }

    /** Read-only live readout: `monitor('FPS', () => fps)` or `monitor(stats, 'drawCalls')`. */
    public monitor(label: string, read: () => unknown, options?: DebugMonitorOptions): MonitorControl;
    public monitor<T extends object>(target: T, key: Key<T>, options?: DebugMonitorOptions): MonitorControl;
    public monitor(a: any, b: any, options: DebugMonitorOptions = {}): MonitorControl {
        if (typeof a === 'string' && typeof b === 'function') {
            return this.add(new MonitorControl(options.label ?? a, b, options));
        }

        return this.add(new MonitorControl(options.label ?? prettifyKey(String(b)), () => a[b], options));
    }

    /** One readout per key (old DebugMenuManager.addLabels). */
    public monitors<T extends object>(target: T, keys: Key<T>[], prefix?: string): MonitorControl[] {
        return keys.map((key) => this.monitor(target, key, { label: prefix ? `${prefix}.${String(key)}` : undefined }));
    }

    // ----- internals -------------------------------------------------------------------------

    protected add<C extends DebugControl>(control: C, explicitId?: string): C {
        control.owner = this;
        this.controls.push(control);
        this.bodyEl.append(control.row);

        if (control instanceof DebugValueControl) {
            this.panel.registerValueControl(control, this.path, explicitId);
        }

        return control;
    }

    protected destroy(): void {
        [...this.controls].forEach((control) => this.remove(control));
        this.childFolders.forEach((folder) => folder.destroy());
        this.childFolders.clear();
        this.element.remove();
    }

    private childFolder(name: string, options: DebugFolderOptions): DebugFolder {
        const existing = this.childFolders.get(name);

        if (existing) {
            return existing;
        }

        const path = this.path ? `${this.path}/${name}` : name;
        const element = el('div', 'dbo-folder');
        const head = el('div', 'dbo-folder-head');
        const chev = icon(ICONS.chevronDown, 12);
        chev.classList.add('dbo-chev');
        head.append(chev, el('span', 'dbo-folder-title', name));

        const body = el('div', 'dbo-folder-body');
        element.append(head, body);

        const folder = new DebugFolder({ element, body }, this.panel, this, name, path);
        const remembered = this.panel.folderCollapsedState(path);
        element.classList.toggle('is-collapsed', remembered ?? options.collapsed ?? this.panel.foldersCollapsed);
        head.addEventListener('click', () => folder.setCollapsed(!element.classList.contains('is-collapsed')));

        this.childFolders.set(name, folder);
        this.bodyEl.append(element);
        return folder;
    }

    private labelFor(key: PropertyKey, options: { label?: string }): string {
        return options.label ?? prettifyKey(String(key));
    }
}

// ---------------------------------------------------------------------------------------------

export interface DebugPanelOptions {
    /** Stable id used for saved settings + layout. Default: the title. */
    id?: string;
    /** Show Apply and restore saved settings (default true). */
    persist?: boolean;
    /** Initial state the first time this panel is seen (afterwards the remembered layout wins). */
    minimized?: boolean;
    closed?: boolean;
    /** Default for folders created without `collapsed` (default false). */
    foldersCollapsed?: boolean;
}

interface PanelDom extends FolderDom {
    title: HTMLDivElement;
    header: HTMLDivElement;
    revert: HTMLButtonElement;
    apply: HTMLButtonElement;
    minimize: HTMLButtonElement;
    close: HTMLButtonElement;
}

function headerButton(className: string, title: string, content: string | SVGSVGElement): HTMLButtonElement {
    const button = el('button', `dbo-hbtn ${className}`);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);

    if (typeof content === 'string') {
        button.textContent = content;
    } else {
        button.classList.add('is-icon');
        button.append(content);
    }

    return button;
}

/**
 * A floating card: `Title ...... Revert  Apply  _  x`.
 *
 * - Values are captured as defaults when each control is created (that's the game code's value).
 * - Apply saves every value that differs from its default to a cookie; the next load re-applies
 *   them (change handlers fire once, right after creation, so the game picks them up).
 * - Revert puts every value back to its default and deletes the saved cookie.
 */
export class DebugPanel extends DebugFolder {
    public readonly id: string;
    public readonly persist: boolean;
    public readonly foldersCollapsed: boolean;

    private readonly valueControls = new Map<string, DebugValueControl<any>>();
    private saved: Record<string, unknown> = {};
    private dirty = false;

    constructor(private readonly host: DebugPanelHost | null, title: string, options: DebugPanelOptions = {}) {
        super(DebugPanel.createDom(title), null, null, title, '');
        this.id = options.id ?? title;
        this.persist = options.persist ?? true;
        this.foldersCollapsed = options.foldersCollapsed ?? false;

        const dom = this.dom as PanelDom;
        dom.apply.hidden = !this.persist;

        if (!host) {
            // Overlay disabled: controls still work against their targets, nothing is shown or saved.
            return;
        }

        if (this.persist) {
            this.saved = host.store.load(this.id) ?? {};
        }

        const ui = host.getPanelUi(this.id);
        this.element.classList.toggle('is-minimized', ui.minimized ?? !!options.minimized);
        this.element.classList.toggle('is-closed', ui.closed ?? !!options.closed);
        this.syncMinimizeButton();

        if (ui.floating && !host.isCompact()) {
            this.placeFloating(ui.floating.x, ui.floating.y);
        }

        dom.revert.addEventListener('click', () => this.revert());
        dom.apply.addEventListener('click', () => this.apply());
        dom.minimize.addEventListener('click', () => this.setMinimized(!this.isMinimized));
        dom.close.addEventListener('click', () => this.close());
        this.element.addEventListener('pointerdown', () => host.bringToFront(this));
        dom.header.addEventListener('dblclick', (event) => {
            if ((event.target as Element).closest('button')) {
                return;
            }

            if (this.isFloating) {
                this.dock();
            } else {
                this.setMinimized(!this.isMinimized);
            }
        });
        this.setupDrag(dom.header);

        host.stackEl.append(this.element);
        this.updateDirty();
    }

    public get title(): string {
        return this.name;
    }

    public get isOpen(): boolean {
        return !this.element.classList.contains('is-closed');
    }

    public get isMinimized(): boolean {
        return this.element.classList.contains('is-minimized');
    }

    public get isFloating(): boolean {
        return this.element.classList.contains('is-floating');
    }

    public get isDirty(): boolean {
        return this.dirty;
    }

    public get isInert(): boolean {
        return this.host === null;
    }

    public open(): this {
        this.element.classList.remove('is-closed');
        this.refresh();
        this.host?.updatePanelUi(this.id, { closed: false });
        this.host?.panelStateChanged(this);
        return this;
    }

    public close(): this {
        this.element.classList.add('is-closed');
        this.host?.updatePanelUi(this.id, { closed: true });
        this.host?.panelStateChanged(this);
        return this;
    }

    public toggleOpen(): this {
        return this.isOpen ? this.close() : this.open();
    }

    public setMinimized(minimized: boolean): this {
        this.element.classList.toggle('is-minimized', minimized);
        this.syncMinimizeButton();

        if (!minimized) {
            this.refresh();
        }

        this.host?.updatePanelUi(this.id, { minimized });
        this.host?.panelStateChanged(this);
        return this;
    }

    /** Saves every value that differs from its code default (cookie). */
    public apply(): void {
        if (!this.host || !this.persist) {
            return;
        }

        const data: Record<string, unknown> = { ...this.saved };

        this.valueControls.forEach((control, id) => {
            const current = control.serialize();

            if (plainEquals(current, control.defaultValue)) {
                delete data[id];
            } else {
                data[id] = clonePlain(current);
            }
        });

        if (Object.keys(data).length === 0) {
            this.host.store.clear(this.id);
        } else if (!this.host.store.save(this.id, data)) {
            this.host.toast(`${this.title}: too much data to fit in cookies`, true);
            return;
        }

        this.saved = data;
        this.updateDirty();
        this.host.toast(`${this.title} saved`);
    }

    /** Back to the game code's values, and forgets anything saved. */
    public revert(): void {
        this.valueControls.forEach((control) => control.resetToDefault('revert'));

        if (this.host && this.persist) {
            this.host.store.clear(this.id);
        }

        this.saved = {};
        this.updateDirty();
        this.host?.toast(`${this.title} reverted to defaults`);
    }

    /** Docks a dragged-out panel back into the stack. */
    public dock(): void {
        this.element.classList.remove('is-floating');
        this.element.style.left = '';
        this.element.style.top = '';
        this.element.style.maxHeight = '';
        this.host?.updatePanelUi(this.id, { floating: null });
    }

    /** Keeps a floating panel reachable after the window shrinks. */
    public clampToViewport(): void {
        if (!this.isFloating) {
            return;
        }

        const x = parseFloat(this.element.style.left) || 0;
        const y = parseFloat(this.element.style.top) || 0;
        this.placeFloating(x, y);
    }

    public destroy(): void {
        super.destroy();
        this.valueControls.clear();
    }

    public handleControlChange(control: DebugControl, source: DebugChangeSource): void {
        super.handleControlChange(control, source);

        if (control instanceof DebugValueControl) {
            control.updateModifiedMarker();
        }

        this.updateDirty();
    }

    /** Called by folders when a value control is added: captures its default and restores any saved value. */
    public registerValueControl(control: DebugValueControl<any>, folderPath: string, explicitId?: string): void {
        control.captureDefault();

        if (!control.persistable || !this.host) {
            return;
        }

        const baseId = explicitId ?? (folderPath ? `${folderPath}/${String(control.key)}` : String(control.key));
        let id = baseId;

        for (let n = 2; this.valueControls.has(id); n++) {
            id = `${baseId}~${n}`;
        }

        control.persistId = id;
        this.valueControls.set(id, control);

        if (this.persist && id in this.saved && control.deserialize(clonePlain(this.saved[id]))) {
            control.refresh();
            // After the caller's chained .onChange(...) is attached, so game code sees the saved value.
            queueMicrotask(() => {
                if (control.owner) {
                    control.emit('restore');
                }
            });
        }

        control.updateModifiedMarker();
        this.updateDirty();
    }

    /** Recomputes modified markers + unsaved state from the current values (no handlers fire). */
    public syncState(): void {
        this.valueControls.forEach((control) => control.updateModifiedMarker());
        this.updateDirty();
    }

    public unregisterValueControl(control: DebugValueControl<any>): void {
        if (control.persistId !== null && this.valueControls.get(control.persistId) === control) {
            this.valueControls.delete(control.persistId);
            this.updateDirty();
        }
    }

    public folderCollapsedState(path: string): boolean | undefined {
        return this.host?.getPanelUi(this.id).collapsedFolders?.[path];
    }

    public rememberFolderCollapsed(path: string, collapsed: boolean): void {
        if (!this.host) {
            return;
        }

        const collapsedFolders = { ...(this.host.getPanelUi(this.id).collapsedFolders ?? {}), [path]: collapsed };
        this.host.updatePanelUi(this.id, { collapsedFolders });
    }

    private updateDirty(): void {
        let dirty = false;
        let modified = false;

        this.valueControls.forEach((control, id) => {
            const current = control.serialize();

            if (!plainEquals(current, control.defaultValue)) {
                modified = true;
            }

            const baseline = id in this.saved ? this.saved[id] : control.defaultValue;

            if (!plainEquals(current, baseline)) {
                dirty = true;
            }
        });

        this.dirty = dirty;
        const dom = this.dom as PanelDom;
        dom.apply.classList.toggle('is-dirty', dirty);
        dom.apply.disabled = !dirty;
        dom.apply.title = dirty ? 'Save these values (cookie) - they load automatically next time' : 'Nothing to save';
        dom.revert.disabled = !modified && Object.keys(this.saved).length === 0;
    }

    private syncMinimizeButton(): void {
        const button = (this.dom as PanelDom).minimize;
        const minimized = this.isMinimized;
        button.replaceChildren(icon(minimized ? ICONS.square : ICONS.minus, 13));
        button.title = minimized ? 'Expand' : 'Minimize';
        button.setAttribute('aria-label', button.title);
    }

    private placeFloating(x: number, y: number): void {
        const width = this.element.offsetWidth || 320;
        const left = clamp(x, 80 - width, window.innerWidth - 80);
        const top = clamp(y, 0, window.innerHeight - 40);

        this.element.classList.add('is-floating');
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        // Body scrolls instead of running off the bottom of the screen.
        this.element.style.maxHeight = `${Math.max(120, window.innerHeight - top - 12)}px`;
    }

    private setupDrag(header: HTMLElement): void {
        header.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || (event.target as Element).closest('button') || !this.host || this.host.isCompact()) {
                return;
            }

            const rect = this.element.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            let dragging = false;

            header.setPointerCapture(event.pointerId);

            const onMove = (move: PointerEvent) => {
                const dx = move.clientX - startX;
                const dy = move.clientY - startY;

                if (!dragging && Math.hypot(dx, dy) < 4) {
                    return;
                }

                dragging = true;
                this.element.classList.add('is-dragging');
                this.placeFloating(rect.left + dx, rect.top + dy);
            };

            const onUp = () => {
                header.removeEventListener('pointermove', onMove);
                header.removeEventListener('pointerup', onUp);
                header.removeEventListener('pointercancel', onUp);

                if (dragging) {
                    this.element.classList.remove('is-dragging');
                    this.host?.updatePanelUi(this.id, {
                        floating: { x: parseFloat(this.element.style.left), y: parseFloat(this.element.style.top) },
                    });
                }
            };

            header.addEventListener('pointermove', onMove);
            header.addEventListener('pointerup', onUp);
            header.addEventListener('pointercancel', onUp);
        });
    }

    private static createDom(title: string): PanelDom {
        const element = el('div', 'dbo-panel');
        const header = el('div', 'dbo-header');
        const titleEl = el('div', 'dbo-title', title);
        titleEl.title = `${title} - drag to move, double-click to dock / minimize`;

        const revert = headerButton('is-revert', 'Revert to the game code defaults (also clears saved values)', 'Revert');
        const apply = headerButton('is-apply', 'Save', 'Apply');
        const minimize = headerButton('is-min', 'Minimize', icon(ICONS.minus, 13));
        const close = headerButton('is-close', 'Close (reopen from the Debug menu)', icon(ICONS.close, 13));

        header.append(titleEl, revert, apply, minimize, close);

        const body = el('div', 'dbo-body');
        element.append(header, body);

        return { element, body, header, title: titleEl, revert, apply, minimize, close };
    }
}
