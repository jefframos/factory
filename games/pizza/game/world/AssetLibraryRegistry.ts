// AssetLibraryRegistry.ts
//
// Central catalog of spawnable visual assets — trees, rocks, and anything
// else that gets scattered around the world — keyed by a plain string id
// rather than tied to any one gameplay concept. ResourceRegistry.ts maps a
// gameplay ResourceType to an entry here (see RESOURCE_ASSET_KEYS); a future
// purely-decorative prop scatterer (bushes, debris — nothing gatherable)
// could just as well pick straight from ASSET_LIBRARY without ever touching
// ResourceType.
//
// Each entry is a `models` list (one is picked at random per spawn — lets a
// single "tree" logical asset vary between e.g. MODELS.Tree/MODELS.TreeHigh)
// plus scale/rotation ranges rolled once per spawn. An empty `models` list
// means "no glb yet for this entry" — callers are expected to fall back to
// a primitive placeholder (see ResourceNode.ts) rather than error.

import * as PIXI from 'pixi.js';
import { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';

/** A constant value, or a [min, max] tuple to roll randomly within — see resolveRange(). */
export type NumberRange = number | [number, number];

export interface AssetLibraryEntry {
    /** Candidate models for this asset — one is picked at random per spawn (see pickRandom()). Empty = no glb yet; caller falls back to a primitive placeholder. */
    models: ModelDefinition[];
    /** Uniform scale applied to the picked model. */
    scale: NumberRange;
    /** Yaw rotation in degrees applied to the picked model, so identical models spawning near each other don't all face the same way. */
    rotationDeg: NumberRange;
    /** Texture alias (packed 'images' bundle) shown for this asset in inventory-style UI (see BackpackUI.ts) — omit until real icon art exists; getAssetIcon() falls back to PIXI.Texture.WHITE. */
    icon?: string;
}

/** Reads an entry's icon texture, falling back to a flat white square (tintable) if none is set yet — see AssetLibraryEntry.icon's own doc. */
export function getAssetIcon(key: AssetLibraryKey): PIXI.Texture {
    const entry: AssetLibraryEntry = ASSET_LIBRARY[key];
    return entry.icon ? PIXI.Texture.from(entry.icon) : PIXI.Texture.WHITE;
}

/** Resolves a NumberRange to an actual value — a plain number passes through unchanged (constant), a [min, max] tuple rolls uniformly within it. */
export function resolveRange(range: NumberRange): number {
    if (typeof range === 'number') {
        return range;
    }
    const [min, max] = range;
    return min + Math.random() * (max - min);
}

/** Picks one entry at random — used for AssetLibraryEntry.models. */
export function pickRandom<T>(items: readonly T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

export const ASSET_LIBRARY = {
    tree: {
        models: [MODELS.Tree, MODELS.TreeHigh],
        scale: [1.85, 2.15],
        rotationDeg: [0, 360],
    },
    stone: {
        // No stone model yet — add one here whenever real art exists; nothing else needs to change.
        models: [],
        scale: 1,
        rotationDeg: [0, 360],
    },
} satisfies Record<string, AssetLibraryEntry>;

export type AssetLibraryKey = keyof typeof ASSET_LIBRARY;
