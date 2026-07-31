import * as PIXI from 'pixi.js';
import type { WaterColors } from '../builders/WaterMaterial';

export interface IslandConfig {
    id: string;
    /** Relative path under images/non-preload/ — e.g. "islands/island.webp". Resolve with resolveIslandImagePath(). */
    texture: string;
    skyColor: string;
    ambientColor: string;
    waterColor: string;
    /** Exactly one island in islands.json should set this — see getDefaultIsland(). */
    isDefault?: boolean;
}

/**
 * Island art is served straight from the asset pipeline's non-preload output
 * (raw-assets/non-preload/islands/*.webp), not bundled by Vite — same
 * convention as ShopStorage.resolveShopImagePath.
 */
const NON_PRELOAD_IMAGE_BASE = 'clog/images/non-preload/';

export function resolveIslandImagePath(relativePath: string): string {
    return `${NON_PRELOAD_IMAGE_BASE}${relativePath}`;
}

export function parseHexColor(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/** Adjusts saturation of a hex color.
 * t > 0 increases saturation (towards 100%)
 * t < 0 decreases saturation (towards grayscale)
 * t is expected in the range [-1, 1]
 */
export function saturateColor(color: number, t: number): number {
    let r = ((color >> 16) & 0xff) / 255;
    let g = ((color >> 8) & 0xff) / 255;
    let b = (color & 0xff) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    let h = 0;
    let s = 0;
    const l = (max + min) * 0.5;

    if (max !== min) {
        const d = max - min;

        s = l > 0.5
            ? d / (2 - max - min)
            : d / (max + min);

        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            default:
                h = (r - g) / d + 4;
                break;
        }

        h /= 6;
    }

    // Adjust saturation
    s = Math.max(0, Math.min(1,
        t >= 0
            ? s + (1 - s) * t
            : s * (1 + t)
    ));

    const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    if (s === 0) {
        const gray = Math.round(l * 255);
        return (gray << 16) | (gray << 8) | gray;
    }

    const q = l < 0.5
        ? l * (1 + s)
        : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);

    return (Math.round(r * 255) << 16)
        | (Math.round(g * 255) << 8)
        | Math.round(b * 255);
}

/** Lightens (t > 0) or darkens (t < 0) a hex color by mixing toward white/black. */
export function shadeColor(color: number, t: number): number {
    const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    const mix = (c: number) => Math.max(0, Math.min(255, Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t))));
    return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** Derives the 4-tone water shader palette (see WaterMaterial.ts) from one base color. */
export function deriveWaterTones(base: number): WaterColors {
    return {
        deep: saturateColor(base, 0.5),
        mid: base,
        bright: shadeColor(saturateColor(base, 0.5), 0.12),
        foam: shadeColor(base, 0.75),
    };
}

/**
 * Populated in place from the 'json' PIXI bundle (raw-assets/json/islands.json)
 * once it finishes loading — see MyGame.loadAssets() in index.ts. Kept as a
 * mutated const array (rather than reassigned) so existing imports of
 * ISLANDS stay valid references.
 */
export const ISLANDS: IslandConfig[] = [];

/** Call once the 'json' PIXI.Assets bundle has loaded — see index.ts loadAssets(). */
export function loadIslands(): void {
    const islands = PIXI.Assets.get('islands.json') as IslandConfig[];
    ISLANDS.splice(0, ISLANDS.length, ...islands);
}

/** Dev-menu override — see setSelectedIslandId(). Null means "use islands.json's isDefault flag" (normal gameplay). */
let selectedIslandId: string | null = null;

/** Call from the dev GUI to pick a level to preview — takes effect the next time getDefaultIsland() is read (see BaseDemoScene's Levels dropdown, which follows this with spawnFreshWorld()). */
export function setSelectedIslandId(id: string): void {
    selectedIslandId = id;
}

export function getDefaultIsland(): IslandConfig {
    if (selectedIslandId) {
        const selected = ISLANDS.find(i => i.id === selectedIslandId);
        if (selected) return selected;
    }
    return ISLANDS.find(i => i.isDefault) ?? ISLANDS[0];
}
