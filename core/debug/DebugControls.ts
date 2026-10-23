import {
    assignPlain,
    clamp,
    clonePlain,
    colorToHex,
    decimalsForStep,
    formatReadout,
    isColorLike,
    isHexColorString,
    isPlainObject,
    isRgbObject,
    normalizeHex,
    plainEquals,
    prettifyKey,
    snapToStep,
    toPlain,
    vectorComponents,
} from './DebugValueUtils';

/** Why a value changed: the user, saved settings loaded at startup, Revert, or game code calling setValue. */
export type DebugChangeSource = 'user' | 'restore' | 'revert' | 'code';

export interface DebugControlOwner {
    handleControlChange(control: DebugControl, source: DebugChangeSource): void;
}

export interface DebugControlOptions<V = any> {
    /** Row label; defaults to the prettified property key. */
    label?: string;
    /** Key in the saved settings; defaults to `<folder path>/<property key>`. */
    id?: string;
    /** Include in Apply / Revert / saved settings (default true for editable values). */
    persist?: boolean;
    onChange?: (value: V) => void;
    /** Fires once a drag / typing session ends, not on every intermediate value. */
    onFinishChange?: (value: V) => void;
    tooltip?: string;
    disabled?: boolean;
    /** Keep the UI in sync when game code changes the value (polled ~10x/s while visible). */
    listen?: boolean;
}

/** Controls that poll their target while visible (see DebugOverlay's refresh loop). */
export const listeningControls = new Set<DebugControl>();

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(path: string, size = 14): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.innerHTML = path;
    return svg;
}

export const ICONS = {
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    minus: '<path d="M5 12h14"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);

    if (className) {
        node.className = className;
    }

    if (text !== undefined) {
        node.textContent = text;
    }

    return node;
}

/**
 * Horizontal drag on `handle` nudges a number (Blender-style scrubbing). Shift = 10x, Alt = 0.1x.
 * A plain click/tap (no movement) is left alone, so double-click-to-reset still works.
 */
export function attachScrub(
    handle: HTMLElement,
    opts: {
        get: () => number;
        set: (value: number, finished: boolean) => void;
        step?: number;
        min?: number;
        max?: number;
    },
): void {
    handle.classList.add('is-scrub');

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }

        const startX = event.clientX;
        const startValue = opts.get();
        const baseStep = opts.step ?? Math.max(Math.abs(startValue) * 0.005, 0.01);
        let scrubbing = false;
        let last = startValue;

        handle.setPointerCapture(event.pointerId);

        const onMove = (move: PointerEvent) => {
            const dx = move.clientX - startX;

            if (!scrubbing && Math.abs(dx) < 4) {
                return;
            }

            scrubbing = true;
            const factor = move.shiftKey ? 10 : move.altKey ? 0.1 : 1;
            const raw = startValue + dx * baseStep * factor;
            const next = clamp(snapToStep(raw, opts.step ? opts.step * (move.altKey ? 0.1 : 1) : undefined), opts.min, opts.max);

            if (next !== last) {
                last = next;
                opts.set(next, false);
            }
        };

        const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);

            if (scrubbing) {
                opts.set(last, true);
            }
        };

        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
    });
}

/** Text field that edits a number: commits on Enter/blur, arrow keys step (Shift = 10x). */
function createNumberField(
    className: string,
    opts: {
        get: () => number;
        set: (value: number, finished: boolean) => void;
        format: (value: number) => string;
        step?: number;
        min?: number;
        max?: number;
    },
): HTMLInputElement {
    const input = el('input', className);
    input.type = 'text';
    input.inputMode = 'decimal';
    input.spellcheck = false;
    input.autocomplete = 'off';

    const commit = () => {
        const parsed = parseFloat(input.value.replace(',', '.'));

        if (Number.isFinite(parsed)) {
            opts.set(clamp(parsed, opts.min, opts.max), true);
        }

        input.value = opts.format(opts.get());
    };

    input.addEventListener('change', commit);
    input.addEventListener('focus', () => input.select());
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            input.blur();
            return;
        }

        if (event.key === 'Escape') {
            input.value = opts.format(opts.get());
            input.blur();
            return;
        }

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const step = (opts.step ?? 0.1) * (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
            const next = clamp(snapToStep(opts.get() + step, opts.step), opts.min, opts.max);
            opts.set(next, true);
            input.value = opts.format(next);
        }
    });

    return input;
}

// ---------------------------------------------------------------------------------------------

export abstract class DebugControl {
    public readonly row: HTMLDivElement;
    public readonly labelEl: HTMLDivElement;
    public readonly ctrlEl: HTMLDivElement;
    public owner: DebugControlOwner | null = null;

    protected constructor(label: string, tooltip?: string) {
        this.row = el('div', 'dbo-row');
        this.labelEl = el('div', 'dbo-label', label);
        this.labelEl.title = tooltip ?? label;
        this.ctrlEl = el('div', 'dbo-ctrl');
        this.row.append(this.labelEl, this.ctrlEl);
    }

    /** Reads the bound value back into the UI. */
    public abstract refresh(): void;

    public name(label: string): this {
        this.labelEl.textContent = label;
        this.labelEl.title = label;
        return this;
    }

    public listen(enabled = true): this {
        if (enabled) {
            listeningControls.add(this);
        } else {
            listeningControls.delete(this);
        }

        return this;
    }

    public setDisabled(disabled: boolean): this {
        this.row.classList.toggle('is-disabled', disabled);
        return this;
    }

    public show(visible = true): this {
        this.row.style.display = visible ? '' : 'none';
        return this;
    }

    public hide(): this {
        return this.show(false);
    }

    /** Polled refresh: skipped while hidden or while the user is typing in it. */
    public refreshIfVisible(): void {
        if (!this.row.isConnected || this.row.getClientRects().length === 0) {
            return;
        }

        const active = document.activeElement;

        if (active && this.row.contains(active) && active instanceof HTMLInputElement && active.type !== 'range') {
            return;
        }

        this.refresh();
    }

    public destroy(): void {
        listeningControls.delete(this);
        this.row.remove();
        this.owner = null;
    }
}

/** A control bound to `target[key]`. Saved / reverted values go through toPlain / assignPlain. */
export abstract class DebugValueControl<V = unknown> extends DebugControl {
    /** Key in the saved settings, or null when this value isn't saved. Set by the owning panel. */
    public persistId: string | null = null;
    public readonly persistable: boolean;

    private readonly changeHandlers: ((value: V) => void)[] = [];
    private readonly finishHandlers: ((value: V) => void)[] = [];
    private defaultSnapshot: unknown = undefined;
    private hasDefault = false;

    protected constructor(
        label: string,
        public readonly target: any,
        public readonly key: PropertyKey,
        options: DebugControlOptions<V>,
    ) {
        super(label, options.tooltip);
        this.persistable = options.persist ?? true;

        if (options.onChange) {
            this.changeHandlers.push(options.onChange);
        }

        if (options.onFinishChange) {
            this.finishHandlers.push(options.onFinishChange);
        }

        if (options.disabled) {
            this.setDisabled(true);
        }

        if (options.listen) {
            this.listen();
        }

        this.labelEl.addEventListener('dblclick', () => {
            if (this.hasDefault) {
                this.resetToDefault('user');
            }
        });
    }

    public getValue(): V {
        return this.target[this.key];
    }

    /** Sets the value from game code: updates the UI and fires change handlers. */
    public setValue(value: V): this {
        this.write(value);
        this.refresh();
        this.emit('code');
        return this;
    }

    public onChange(handler: (value: V) => void): this {
        this.changeHandlers.push(handler);
        return this;
    }

    public onFinishChange(handler: (value: V) => void): this {
        this.finishHandlers.push(handler);
        return this;
    }

    public serialize(): unknown {
        return toPlain(this.target[this.key]);
    }

    /** Applies a saved snapshot to the target (no UI refresh / events). */
    public deserialize(raw: unknown): boolean {
        return assignPlain(this.target, this.key, raw);
    }

    /** Snapshots the current (game code) value as this control's default. */
    public captureDefault(): void {
        this.defaultSnapshot = clonePlain(this.serialize());
        this.hasDefault = true;
        this.labelEl.title = `${this.labelEl.textContent ?? ''}  ·  double-click to reset`;
    }

    public get defaultValue(): unknown {
        return this.defaultSnapshot;
    }

    public isModified(): boolean {
        return this.hasDefault && !plainEquals(this.serialize(), this.defaultSnapshot);
    }

    public resetToDefault(source: DebugChangeSource = 'code'): void {
        if (!this.hasDefault || !this.isModified()) {
            return;
        }

        this.deserialize(clonePlain(this.defaultSnapshot));
        this.refresh();
        this.emit(source);
    }

    public updateModifiedMarker(): void {
        this.row.classList.toggle('is-modified', this.persistId !== null && this.isModified());
    }

    /** Runs change handlers and tells the owner (folder -> panel) so dirty/modified state updates. */
    public emit(source: DebugChangeSource, finished = true): void {
        const value = this.getValue();

        for (const handler of this.changeHandlers) {
            try {
                handler(value);
            } catch (error) {
                console.error('[DebugOverlay] onChange handler failed', error);
            }
        }

        if (finished) {
            for (const handler of this.finishHandlers) {
                try {
                    handler(value);
                } catch (error) {
                    console.error('[DebugOverlay] onFinishChange handler failed', error);
                }
            }
        }

        this.owner?.handleControlChange(this, source);
    }

    protected write(value: V): void {
        this.target[this.key] = value;
    }

    /** UI -> target, then refresh + events. */
    protected commit(value: V, finished = true): void {
        this.write(value);
        this.refresh();
        this.emit('user', finished);
    }
}

// ---------------------------------------------------------------------------------------------

export interface DebugNumberOptions extends DebugControlOptions<number> {
    min?: number;
    max?: number;
    step?: number;
    /** Decimal places shown; defaults to what `step` implies. */
    decimals?: number;
}

/** Slider + number field when min and max are given, otherwise a scrubbable number field. */
export class NumberControl extends DebugValueControl<number> {
    private readonly range?: HTMLInputElement;
    private readonly field: HTMLInputElement;
    private readonly decimals: number;

    constructor(label: string, target: any, key: PropertyKey, private options: DebugNumberOptions = {}) {
        super(label, target, key, options);

        const { min, max } = options;
        const step = options.step ?? (min !== undefined && max !== undefined ? niceStep(max - min) : undefined);
        this.options = { ...options, step };
        this.decimals = options.decimals ?? (step !== undefined ? decimalsForStep(step) : 3);

        const set = (value: number, finished: boolean) => this.commit(value, finished);

        if (min !== undefined && max !== undefined) {
            const range = el('input', 'dbo-range');
            range.type = 'range';
            range.min = String(min);
            range.max = String(max);
            range.step = step !== undefined ? String(step) : 'any';
            range.addEventListener('input', () => set(parseFloat(range.value), false));
            range.addEventListener('change', () => set(parseFloat(range.value), true));
            this.range = range;
            this.ctrlEl.append(range);
        }

        this.field = createNumberField(this.range ? 'dbo-input is-num' : 'dbo-input', {
            get: () => this.getValue(),
            set,
            format: (value) => this.format(value),
            step,
            min,
            max,
        });

        this.ctrlEl.append(this.field);
        attachScrub(this.labelEl, { get: () => this.getValue(), set, step, min, max });
        this.refresh();
    }

    public refresh(): void {
        const value = Number(this.getValue());

        if (this.range) {
            this.range.value = String(value);
            const { min = 0, max = 1 } = this.options;
            const fill = max > min ? ((clamp(value, min, max) - min) / (max - min)) * 100 : 0;
            this.range.style.setProperty('--fill', `${fill}%`);
        }

        if (document.activeElement !== this.field) {
            this.field.value = this.format(value);
        }
    }

    public deserialize(raw: unknown): boolean {
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            return false;
        }

        return assignPlain(this.target, this.key, clamp(raw, this.options.min, this.options.max));
    }

    private format(value: number): string {
        return Number.isFinite(value) ? value.toFixed(this.decimals) : String(value);
    }
}

function niceStep(span: number): number {
    if (!(span > 0)) {
        return 0.01;
    }

    return Math.pow(10, Math.floor(Math.log10(span)) - 2);
}

// ---------------------------------------------------------------------------------------------

export class ToggleControl extends DebugValueControl<boolean> {
    private readonly input: HTMLInputElement;

    constructor(label: string, target: any, key: PropertyKey, options: DebugControlOptions<boolean> = {}) {
        super(label, target, key, options);
        this.row.classList.add('is-toggle');

        this.input = el('input', 'dbo-switch');
        this.input.type = 'checkbox';
        this.input.addEventListener('change', () => this.commit(this.input.checked));
        this.ctrlEl.style.justifyContent = 'flex-end';
        this.ctrlEl.append(this.input);

        // The whole row is the hit area - easier on touch.
        this.row.addEventListener('click', (event) => {
            if (event.target !== this.input) {
                this.commit(!this.getValue());
            }
        });

        this.refresh();
    }

    public refresh(): void {
        this.input.checked = !!this.getValue();
    }
}

// ---------------------------------------------------------------------------------------------

/**
 * Edits THREE.Color (in place), 0xRRGGBB numbers, '#rrggbb' strings or { r, g, b } (0..1).
 * The value passed to change handlers is always '#rrggbb'.
 */
export class ColorControl extends DebugValueControl<string> {
    private readonly swatch: HTMLInputElement;
    private readonly hex: HTMLInputElement;

    constructor(label: string, target: any, key: PropertyKey, options: DebugControlOptions<string> = {}) {
        super(label, target, key, options);

        this.swatch = el('input', 'dbo-swatch');
        this.swatch.type = 'color';
        this.swatch.addEventListener('input', () => this.commit(this.swatch.value, false));
        this.swatch.addEventListener('change', () => this.commit(this.swatch.value, true));

        this.hex = el('input', 'dbo-input is-hex');
        this.hex.type = 'text';
        this.hex.spellcheck = false;
        this.hex.maxLength = 7;
        this.hex.addEventListener('change', () => {
            if (isHexColorString(this.hex.value) || isHexColorString(`#${this.hex.value}`)) {
                this.commit(normalizeHex(this.hex.value));
            } else {
                this.refresh();
            }
        });
        this.hex.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.hex.blur();
            }
        });

        this.ctrlEl.append(this.swatch, this.hex);
        this.refresh();
    }

    public getValue(): string {
        return colorToHex(this.target[this.key]);
    }

    public refresh(): void {
        const hex = this.getValue();
        this.swatch.value = hex;

        if (document.activeElement !== this.hex) {
            this.hex.value = hex;
        }
    }

    protected write(hex: string): void {
        const current = this.target[this.key];

        if (isColorLike(current)) {
            current.set(hex);
        } else if (typeof current === 'number') {
            this.target[this.key] = parseInt(hex.slice(1), 16);
        } else if (isRgbObject(current)) {
            assignPlain(this.target, this.key, hex);
        } else {
            this.target[this.key] = hex;
        }
    }
}

// ---------------------------------------------------------------------------------------------

export type DebugChoices<T> = readonly T[] | Readonly<Record<string, T>>;

export interface DebugSelectOptions<T> extends DebugControlOptions<T> {
    /** 'buttons' = segmented control, 'dropdown' = <select>; 'auto' picks buttons for a few short options. */
    style?: 'auto' | 'buttons' | 'dropdown';
}

interface Choice<T> {
    label: string;
    value: T;
}

/** Arrays, plain label->value records and TS enums (numeric enums' reverse entries are skipped). */
export function normalizeChoices<T>(choices: DebugChoices<T>): Choice<T>[] {
    if (Array.isArray(choices)) {
        return choices.map((value) => ({ label: String(value), value }));
    }

    const record = choices as Record<string, T>;

    return Object.entries(record)
        .filter(([key, value]) => !(/^\d+$/.test(key) && typeof value === 'string' && (record as any)[value as string] === Number(key)))
        .map(([key, value]) => ({ label: key, value }));
}

export class SelectControl<T = unknown> extends DebugValueControl<T> {
    private readonly choices: Choice<T>[];
    private readonly select?: HTMLSelectElement;
    private readonly buttons: HTMLButtonElement[] = [];

    constructor(label: string, target: any, key: PropertyKey, choices: DebugChoices<T>, options: DebugSelectOptions<T> = {}) {
        super(label, target, key, options);
        this.choices = normalizeChoices(choices);

        const style = options.style ?? 'auto';
        const totalChars = this.choices.reduce((sum, choice) => sum + choice.label.length, 0);
        const useButtons = style === 'buttons' || (style === 'auto' && this.choices.length <= 4 && totalChars <= 26);

        if (useButtons) {
            const seg = el('div', 'dbo-seg');

            this.choices.forEach((choice) => {
                const button = el('button', '', choice.label);
                button.type = 'button';
                button.title = choice.label;
                button.addEventListener('click', () => this.commit(choice.value));
                this.buttons.push(button);
                seg.append(button);
            });

            this.ctrlEl.append(seg);
        } else {
            const select = el('select', 'dbo-select');

            this.choices.forEach((choice, index) => {
                const option = el('option', '', choice.label);
                option.value = String(index);
                select.append(option);
            });

            select.addEventListener('change', () => {
                const choice = this.choices[parseInt(select.value, 10)];

                if (choice) {
                    this.commit(choice.value);
                }
            });

            this.select = select;
            this.ctrlEl.append(select);
        }

        this.refresh();
    }

    public refresh(): void {
        const index = this.indexOf(this.getValue());

        if (this.select) {
            this.select.value = String(index);
        }

        this.buttons.forEach((button, i) => button.classList.toggle('is-active', i === index));
    }

    public deserialize(raw: unknown): boolean {
        const choice = this.choices.find((c) => plainEquals(toPlain(c.value), raw));

        if (!choice) {
            return false;
        }

        this.target[this.key] = choice.value;
        return true;
    }

    private indexOf(value: T): number {
        const exact = this.choices.findIndex((choice) => choice.value === value);
        return exact >= 0 ? exact : this.choices.findIndex((choice) => plainEquals(toPlain(choice.value), toPlain(value)));
    }
}

// ---------------------------------------------------------------------------------------------

export class TextControl extends DebugValueControl<string> {
    private readonly input: HTMLInputElement;

    constructor(label: string, target: any, key: PropertyKey, options: DebugControlOptions<string> = {}) {
        super(label, target, key, options);

        this.input = el('input', 'dbo-input');
        this.input.type = 'text';
        this.input.spellcheck = false;
        this.input.addEventListener('input', () => this.commit(this.input.value, false));
        this.input.addEventListener('change', () => this.commit(this.input.value, true));
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                this.input.blur();
            }
        });

        this.ctrlEl.append(this.input);
        this.refresh();
    }

    public refresh(): void {
        if (document.activeElement !== this.input) {
            this.input.value = String(this.getValue() ?? '');
        }
    }
}

// ---------------------------------------------------------------------------------------------

export interface DebugVectorOptions extends DebugControlOptions<unknown> {
    min?: number;
    max?: number;
    step?: number;
    decimals?: number;
}

const AXIS_LABELS = ['X', 'Y', 'Z', 'W'];

/**
 * x/y(/z/w) objects - THREE.Vector2/3/4, Euler, plain { x, y } - or 2-4 number tuples. The
 * object is edited in place (never replaced), so `mesh.position` & co. work directly.
 */
export class VectorControl extends DebugValueControl<unknown> {
    private readonly fields: HTMLInputElement[] = [];
    private readonly components: (string | number)[];
    private readonly decimals: number;

    constructor(label: string, target: any, key: PropertyKey, private readonly options: DebugVectorOptions = {}) {
        super(label, target, key, options);
        this.components = vectorComponents(target[key]) ?? ['x', 'y', 'z'];
        this.decimals = options.decimals ?? (options.step !== undefined ? decimalsForStep(options.step) : 3);

        if (this.components.length >= 3) {
            this.row.classList.add('is-stacked');
        }

        const vec = el('div', 'dbo-vec');

        this.components.forEach((component, index) => {
            const field = el('div', 'dbo-vec-field');
            const axis = el('div', 'dbo-axis', AXIS_LABELS[index]);
            axis.dataset.axis = String(index);

            const get = () => Number(this.getValue() && (this.getValue() as any)[component]) || 0;
            const set = (value: number, finished: boolean) => {
                (this.getValue() as any)[component] = value;
                this.refresh();
                this.emit('user', finished);
            };

            const input = createNumberField('', {
                get,
                set,
                format: (value) => value.toFixed(this.decimals),
                step: options.step,
                min: options.min,
                max: options.max,
            });

            attachScrub(axis, { get, set, step: options.step ?? 0.01, min: options.min, max: options.max });
            this.fields.push(input);
            field.append(axis, input);
            vec.append(field);
        });

        this.ctrlEl.append(vec);
        this.refresh();
    }

    public refresh(): void {
        const value = this.getValue() as any;

        this.components.forEach((component, index) => {
            const field = this.fields[index];

            if (field && document.activeElement !== field) {
                field.value = Number(value?.[component] ?? 0).toFixed(this.decimals);
            }
        });
    }
}

// ---------------------------------------------------------------------------------------------

export interface DebugMonitorOptions {
    label?: string;
    decimals?: number;
    /** Custom readout text. */
    format?: (value: unknown) => string;
    tooltip?: string;
}

/** Read-only readout, refreshed while visible. */
export class MonitorControl extends DebugControl {
    private readonly output: HTMLDivElement;
    private lastText = '';

    constructor(label: string, private readonly read: () => unknown, private readonly options: DebugMonitorOptions = {}) {
        super(label, options.tooltip);
        this.output = el('div', 'dbo-monitor');
        this.ctrlEl.append(this.output);
        this.listen();
        this.refresh();
    }

    public refresh(): void {
        let text: string;

        try {
            const value = this.read();
            text = this.options.format ? this.options.format(value) : formatReadout(value, this.options.decimals ?? 3);
        } catch {
            text = '-';
        }

        if (text !== this.lastText) {
            this.lastText = text;
            this.output.textContent = text;
            this.output.title = text;
        }
    }
}

// ---------------------------------------------------------------------------------------------

export interface DebugButtonDef {
    label: string;
    action: () => void;
    variant?: 'default' | 'accent' | 'danger';
    tooltip?: string;
}

/** One or more buttons sharing a full-width row. */
export class ButtonControl extends DebugControl {
    public readonly buttons: HTMLButtonElement[] = [];

    constructor(defs: DebugButtonDef[]) {
        super('');
        this.row.classList.add('is-full');
        this.labelEl.remove();
        this.ctrlEl.classList.add('dbo-btns');

        for (const def of defs) {
            const button = el('button', `dbo-btn${def.variant && def.variant !== 'default' ? ` is-${def.variant}` : ''}`, def.label);
            button.type = 'button';
            button.title = def.tooltip ?? def.label;
            button.addEventListener('click', () => {
                try {
                    def.action();
                } catch (error) {
                    console.error(`[DebugOverlay] button "${def.label}" failed`, error);
                }
            });
            this.buttons.push(button);
            this.ctrlEl.append(button);
        }
    }

    public name(label: string): this {
        if (this.buttons[0]) {
            this.buttons[0].textContent = label;
        }

        return this;
    }

    public refresh(): void {
        // Nothing bound.
    }
}

// ---------------------------------------------------------------------------------------------

export interface DebugAutoOptions {
    /** [min, max, step?] per numeric property key (array items use the array's own range). */
    ranges?: Record<string, readonly [number, number, number?]>;
    step?: number;
    min?: number;
    max?: number;
}

/**
 * Picks a control for `target[key]` from its current value. Plain objects and arrays aren't
 * handled here (folders build those) - returns null for them and for anything unsupported.
 */
export function createAutoControl(
    label: string,
    target: any,
    key: PropertyKey,
    options: DebugControlOptions & DebugAutoOptions = {},
): DebugValueControl<any> | null {
    const value = target[key];
    const range = typeof key === 'string' ? options.ranges?.[key] : undefined;

    if (typeof value === 'number') {
        return new NumberControl(label, target, key, {
            ...options,
            min: range?.[0] ?? options.min,
            max: range?.[1] ?? options.max,
            step: range?.[2] ?? options.step,
        });
    }

    if (typeof value === 'boolean') {
        return new ToggleControl(label, target, key, options);
    }

    if (typeof value === 'string') {
        return isHexColorString(value)
            ? new ColorControl(label, target, key, options)
            : new TextControl(label, target, key, options);
    }

    if (isColorLike(value) || isRgbObject(value)) {
        return new ColorControl(label, target, key, options);
    }

    if (vectorComponents(value) && !Array.isArray(value)) {
        return new VectorControl(label, target, key, options);
    }

    return null;
}

export interface DebugArrayOptions extends DebugControlOptions<unknown[]>, DebugAutoOptions {
    /** Adds "+ Add" and per-item remove buttons. */
    resizable?: boolean;
    /** New item for "+ Add"; defaults to a copy of the last item. */
    createItem?: (array: unknown[]) => unknown;
    itemLabel?: (index: number, item: unknown) => string;
    collapsed?: boolean;
}

/**
 * An array, edited item by item (numbers, toggles, colors, vectors, text, or small objects). Saved
 * as one value, so Revert / Apply treat the whole list (including its length) as a unit.
 */
export class ArrayControl extends DebugValueControl<unknown[]> implements DebugControlOwner {
    private readonly body: HTMLDivElement;
    private readonly countEl: HTMLSpanElement;
    private readonly addRow?: ButtonControl;
    private items: DebugControl[] = [];
    private renderedLength = -1;

    constructor(label: string, target: any, key: PropertyKey, private readonly options: DebugArrayOptions = {}) {
        super(label, target, key, options);

        // Laid out as a folder rather than a label/control row.
        this.row.className = 'dbo-folder';
        this.row.replaceChildren();

        const head = el('div', 'dbo-folder-head');
        head.append(icon(ICONS.chevronDown, 12), el('span', 'dbo-folder-title', label));
        this.countEl = el('span', 'dbo-folder-count');
        head.append(this.countEl);
        head.addEventListener('click', () => this.row.classList.toggle('is-collapsed'));

        this.body = el('div', 'dbo-folder-body');
        this.row.append(head, this.body);
        this.row.classList.toggle('is-collapsed', !!options.collapsed);
        (head.firstChild as Element).classList.add('dbo-chev');

        if (options.resizable) {
            this.addRow = new ButtonControl([{
                label: '+ Add',
                action: () => this.addItem(),
            }]);
        }

        this.refresh();
    }

    public handleControlChange(_control: DebugControl, source: DebugChangeSource): void {
        this.emit(source);
    }

    public setCollapsed(collapsed: boolean): this {
        this.row.classList.toggle('is-collapsed', collapsed);
        this.row.querySelectorAll('.dbo-folder').forEach((item) => item.classList.toggle('is-collapsed', collapsed));
        return this;
    }

    public refresh(): void {
        const array = this.getValue();
        const length = Array.isArray(array) ? array.length : 0;

        if (length !== this.renderedLength) {
            this.rebuild();
        } else {
            this.items.forEach((item) => item.refresh());
        }
    }

    public destroy(): void {
        this.items.forEach((item) => item.destroy());
        super.destroy();
    }

    private addItem(): void {
        const array = this.getValue();

        if (!Array.isArray(array)) {
            return;
        }

        const last = array[array.length - 1];
        const next = this.options.createItem
            ? this.options.createItem(array)
            : last && typeof (last as any).clone === 'function' ? (last as any).clone() : clonePlain(last ?? 0);

        array.push(next);
        this.refresh();
        this.emit('user');
    }

    private removeItem(index: number): void {
        const array = this.getValue();

        if (!Array.isArray(array)) {
            return;
        }

        array.splice(index, 1);
        this.refresh();
        this.emit('user');
    }

    private rebuild(): void {
        this.items.forEach((item) => item.destroy());
        this.items = [];
        this.body.replaceChildren();

        const array = this.getValue();
        const length = Array.isArray(array) ? array.length : 0;
        this.renderedLength = length;
        this.countEl.textContent = `${length}`;

        for (let index = 0; index < length; index++) {
            const item = array[index];
            const label = this.options.itemLabel?.(index, item) ?? `[${index}]`;
            const rowHost = this.options.resizable ? el('div', 'dbo-array-item') : this.body;

            if (isPlainObject(item) && !vectorComponents(item) && !isRgbObject(item)) {
                rowHost.append(this.buildObjectItem(label, item));
            } else {
                const control = createAutoControl(label, array, index, { ...this.options, persist: false, onChange: undefined, onFinishChange: undefined, listen: false });

                if (!control) {
                    const readout = new MonitorControl(label, () => array[index]);
                    this.items.push(readout);
                    rowHost.append(readout.row);
                } else {
                    control.owner = this;
                    this.items.push(control);
                    rowHost.append(control.row);
                }
            }

            if (this.options.resizable && rowHost !== this.body) {
                const remove = el('button', 'dbo-array-remove');
                remove.type = 'button';
                remove.title = 'Remove';
                remove.append(icon(ICONS.close, 12));
                remove.addEventListener('click', () => this.removeItem(index));
                rowHost.append(remove);
                this.body.append(rowHost);
            }
        }

        if (this.addRow) {
            this.body.append(this.addRow.row);
        }
    }

    private buildObjectItem(label: string, item: Record<string, unknown>): HTMLElement {
        const folder = el('div', 'dbo-folder is-collapsed');
        const head = el('div', 'dbo-folder-head');
        const chev = icon(ICONS.chevronDown, 12);
        chev.classList.add('dbo-chev');
        head.append(chev, el('span', 'dbo-folder-title', label));
        head.addEventListener('click', () => folder.classList.toggle('is-collapsed'));

        const body = el('div', 'dbo-folder-body');
        folder.append(head, body);

        for (const childKey of Object.keys(item)) {
            const control = createAutoControl(prettifyKey(childKey), item, childKey, { ...this.options, persist: false, onChange: undefined, onFinishChange: undefined, listen: false });

            if (control) {
                control.owner = this;
                this.items.push(control);
                body.append(control.row);
            }
        }

        return folder;
    }
}
