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

/** Lightens (t > 0) or darkens (t < 0) a hex color by mixing toward white/black. */
export function shadeColor(color: number, t: number): number {
    const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
    const mix = (c: number) => Math.max(0, Math.min(255, Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t))));
    return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

/** Derives the 4-tone water shader palette (see WaterMaterial.ts) from one base color. */
export function deriveWaterTones(base: number): WaterColors {
    return {
        deep: shadeColor(base, -0.05),
        mid: base,
        bright: shadeColor(base, 0.12),
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
