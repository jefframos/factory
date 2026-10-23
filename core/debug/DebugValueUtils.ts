/**
 * Shape detection + plain-JSON (de)serialization for values the debug overlay binds to.
 * Saved settings are plain JSON, so every bound value goes through `toPlain` on save and
 * `assignPlain` on load / revert - live objects (THREE.Color, Vector3, arrays) are mutated in
 * place rather than replaced, so references held elsewhere in game code stay valid.
 */

export type VectorKey = 'x' | 'y' | 'z' | 'w';

const VECTOR_KEYS: VectorKey[] = ['x', 'y', 'z', 'w'];

/** THREE.Color (or anything with the same set/getHexString pair). */
export interface ColorLike {
    set(value: string): unknown;
    getHexString(): string;
}

export function isColorLike(value: unknown): value is ColorLike {
    return !!value
        && typeof value === 'object'
        && typeof (value as ColorLike).getHexString === 'function'
        && typeof (value as ColorLike).set === 'function';
}

/** `{ r, g, b }` in 0..1 without THREE's helpers. */
export function isRgbObject(value: unknown): value is { r: number; g: number; b: number } {
    return !!value
        && typeof value === 'object'
        && !isColorLike(value)
        && typeof (value as any).r === 'number'
        && typeof (value as any).g === 'number'
        && typeof (value as any).b === 'number';
}

export function isHexColorString(value: unknown): value is string {
    return typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

/** Components of a vector-like value: x/y(/z/w) objects (THREE vectors, Euler), or 2-4 number tuples. */
export function vectorComponents(value: unknown): (VectorKey | number)[] | null {
    if (Array.isArray(value)) {
        if (value.length >= 2 && value.length <= 4 && value.every((v) => typeof v === 'number')) {
            return value.map((_, index) => index);
        }

        return null;
    }

    if (!value || typeof value !== 'object' || isColorLike(value)) {
        return null;
    }

    const keys = VECTOR_KEYS.filter((key) => typeof (value as any)[key] === 'number');

    return keys.length >= 2 && keys[0] === 'x' && keys[1] === 'y' ? keys : null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const proto = Object.getPrototypeOf(value);

    return proto === Object.prototype || proto === null;
}

export function normalizeHex(value: string): string {
    let hex = value.trim().replace(/^#/, '').toLowerCase();

    if (hex.length === 3) {
        hex = hex.split('').map((c) => c + c).join('');
    }

    return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : '#000000';
}

export function numberToHex(value: number): string {
    return `#${(Math.max(0, Math.floor(value)) & 0xffffff).toString(16).padStart(6, '0')}`;
}

function channelToHex(channel: number): string {
    return Math.round(Math.min(1, Math.max(0, channel)) * 255).toString(16).padStart(2, '0');
}

/** Any supported color representation, as `#rrggbb`. */
export function colorToHex(value: unknown): string {
    if (isColorLike(value)) {
        return `#${value.getHexString()}`;
    }

    if (typeof value === 'number') {
        return numberToHex(value);
    }

    if (typeof value === 'string') {
        return normalizeHex(value);
    }

    if (isRgbObject(value)) {
        return `#${channelToHex(value.r)}${channelToHex(value.g)}${channelToHex(value.b)}`;
    }

    return '#000000';
}

/** A JSON-safe snapshot of `value`, or undefined if it holds nothing the overlay can restore. */
export function toPlain(value: unknown, depth = 0): unknown {
    if (depth > 6) {
        return undefined;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }

    if (isColorLike(value)) {
        return `#${value.getHexString()}`;
    }

    if (Array.isArray(value)) {
        return value.map((item) => toPlain(item, depth + 1) ?? null);
    }

    const components = vectorComponents(value);

    if (components) {
        const out: Record<string, number> = {};
        components.forEach((key) => { out[key] = (value as any)[key]; });
        return out;
    }

    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};

        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'function') {
                continue;
            }

            const plain = toPlain(item, depth + 1);

            if (plain !== undefined) {
                out[key] = plain;
            }
        }

        return out;
    }

    return undefined;
}

/**
 * Writes the plain snapshot `raw` back into `owner[key]`, mutating objects in place. Values whose
 * type doesn't match what's there now are ignored (a renamed / retyped setting just falls back
 * to its code default instead of breaking the game). Returns whether anything was written.
 */
export function assignPlain(owner: any, key: PropertyKey, raw: unknown, depth = 0): boolean {
    if (depth > 6 || owner === null || owner === undefined) {
        return false;
    }

    const current = owner[key];

    if (typeof current === 'number') {
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            owner[key] = raw;
            return true;
        }

        if (isHexColorString(raw)) {
            owner[key] = parseInt(normalizeHex(raw).slice(1), 16);
            return true;
        }

        return false;
    }

    if (typeof current === 'boolean') {
        if (typeof raw === 'boolean') {
            owner[key] = raw;
            return true;
        }

        return false;
    }

    if (typeof current === 'string') {
        if (typeof raw === 'string') {
            owner[key] = raw;
            return true;
        }

        return false;
    }

    if (isColorLike(current)) {
        if (isHexColorString(raw)) {
            current.set(normalizeHex(raw));
            return true;
        }

        return false;
    }

    if (Array.isArray(current)) {
        if (!Array.isArray(raw)) {
            return false;
        }

        // Grow with plain copies (nothing live to mutate yet), shrink by truncating.
        for (let i = 0; i < raw.length; i++) {
            if (i < current.length && current[i] !== null && typeof current[i] === typeof raw[i]) {
                if (!assignPlain(current, i, raw[i], depth + 1) && typeof raw[i] !== 'object') {
                    current[i] = raw[i];
                }
            } else {
                current[i] = clonePlain(raw[i]);
            }
        }

        current.length = raw.length;
        return true;
    }

    if (current && typeof current === 'object') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return false;
        }

        if (isRgbObject(current) && isHexColorString(raw)) {
            const hex = parseInt(normalizeHex(raw).slice(1), 16);
            current.r = ((hex >> 16) & 255) / 255;
            current.g = ((hex >> 8) & 255) / 255;
            current.b = (hex & 255) / 255;
            return true;
        }

        let wrote = false;

        for (const [childKey, childRaw] of Object.entries(raw)) {
            if (childKey in current) {
                wrote = assignPlain(current, childKey, childRaw, depth + 1) || wrote;
            }
        }

        return wrote;
    }

    return false;
}

export function clonePlain<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

export function plainEquals(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Decimal places implied by a step (0.1 -> 1, 0.025 -> 3, 5 -> 0). */
export function decimalsForStep(step: number): number {
    if (!Number.isFinite(step) || step <= 0) {
        return 3;
    }

    const text = step.toString();

    if (text.includes('e-')) {
        return Math.min(8, parseInt(text.split('e-')[1], 10));
    }

    const dot = text.indexOf('.');

    return dot < 0 ? 0 : Math.min(8, text.length - dot - 1);
}

export function snapToStep(value: number, step: number | undefined, min?: number): number {
    if (!step || step <= 0) {
        return value;
    }

    const base = min ?? 0;
    const snapped = Math.round((value - base) / step) * step + base;

    return parseFloat(snapped.toFixed(decimalsForStep(step)));
}

export function clamp(value: number, min?: number, max?: number): number {
    if (min !== undefined && value < min) {
        return min;
    }

    if (max !== undefined && value > max) {
        return max;
    }

    return value;
}

/** Human label from a property key: `shotForwardSpeed` -> `Shot Forward Speed`. */
export function prettifyKey(key: string): string {
    return key
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (c) => c.toUpperCase());
}

export function formatReadout(value: unknown, decimals = 3): string {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(decimals);
    }

    if (value === null || value === undefined) {
        return String(value);
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
        return String(value);
    }

    const components = vectorComponents(value);

    if (components) {
        return components.map((key) => formatReadout((value as any)[key], decimals)).join(', ');
    }

    if (isColorLike(value)) {
        return `#${value.getHexString()}`;
    }

    try {
        return JSON.stringify(toPlain(value));
    } catch {
        return String(value);
    }
}
