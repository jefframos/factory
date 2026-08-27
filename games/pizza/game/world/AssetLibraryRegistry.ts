// AssetLibraryRegistry.ts
//
// Central catalog of spawnable visual assets — trees, rocks, and anything
// else that gets scattered around the world — keyed by a plain string id
// rather than tied to any one gameplay concept. ResourceRegistry.ts maps a
// gameplay ResourceType to an entry here (see resolveResourceAssetKey()); a future
// purely-decorative prop scatterer (bushes, debris — nothing gatherable)
// could just as well pick straight from ASSET_LIBRARY without ever touching
// ResourceType.
//
// Each entry is a `models` list (one is picked at random per spawn — lets a
// single "tree" logical asset vary between e.g. MODELS.Props.Tree/MODELS.Props.TreeHigh)
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

/**
 * Reads an entry's icon texture, falling back to a flat white square (tintable) if none is set
 * yet — see AssetLibraryEntry.icon's own doc. Also falls back (with a warning, not a throw) for
 * a `key` that doesn't resolve to any entry at all — e.g. a stale ResourceType string surviving
 * in an old save from before an AssetLibraryRegistry key got renamed. BackpackStorage.load()
 * already filters these out at the source, but this is what keeps a caller reading a bad key
 * from ANY other path (a future renamed AssetLibraryKey, a caller passing a raw string) from
 * crashing the whole scene build over one missing icon.
 */
export function getAssetIcon(key: AssetLibraryKey): PIXI.Texture {
    const entry: AssetLibraryEntry | undefined = ASSET_LIBRARY[key];
    if (!entry) {
        console.warn(`[AssetLibraryRegistry] no entry for key "${key}" — falling back to a blank icon`);
        return PIXI.Texture.WHITE;
    }
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
        models: [MODELS.Props.Tree, MODELS.Props.TreeHigh],
        scale: [
            1.85,
            2.15
        ],
        rotationDeg: [
            0,
            360
        ],
        "icon": "wood-log"
    },
    stone: {
        // No stone model yet — add one here whenever real art exists; nothing else needs to change.
        models: [MODELS.Resources.StoneChunksSmall],
        scale: [
            1,
            1.2
        ],
        rotationDeg: [
            0,
            360
        ],
        icon: "stone-chunk"
    },
    berries: {
        // No berry-bush model yet — add one here whenever real art exists; nothing else needs to change.
        models: [],
        scale: 1,
        rotationDeg: [
            0,
            360
        ],
        icon: "wild-berries"
    },
    bark: {
        // Two variants — one is picked at random per spawn (see pickRandom()) so identical logs
        // scattered near each other don't all look the same.
        models: [MODELS.Resources.WoodLogA, MODELS.Resources.WoodLogB],
        scale: [
            0.8,
            1.1
        ],
        rotationDeg: [
            0,
            360
        ],
        icon: "tree-bark",
    },
    pebble: {
        // Reusing the small stone-chunks model as a stand-in until a dedicated pebble model
        // exists — nothing else needs to change once one does, just swap this list.
        models: [MODELS.Resources.StoneChunksSmall],
        scale: [
            0.5,
            0.8
        ],
        rotationDeg: [
            0,
            360
        ],
        icon: "sharpening-stone",
    },
    grassFiber: {
        // Two variants — one is picked at random per spawn (see pickRandom()); both bank the
        // same flat amountPerGather regardless of which got picked (see ResourceTypes.ts's own
        // doc on ResourceType.GrassFiber).
        models: [MODELS.Pirate.GrassPlant, MODELS.Pirate.Grass],
        scale: [
            0.8,
            1.2
        ],
        rotationDeg: [
            0,
            360
        ],
        icon: "plant-fiber",
    },
    money: {
        // No 3D presence at all — money is a currency, never a gatherable world prop.
        models: [],
        scale: 1,
        rotationDeg: 0,
        icon: "ItemIcon_Money_Bill-2",
    },
    /**
     * The berry bush PROVIDER's own world appearance (see ProviderTypes.ts/
     * ProviderRegistry.ts's resolveProviderAssetKey()) — deliberately a SEPARATE entry from
     * `berries` above, which is the berries ITEM's own icon (see ResourceRegistry.ts's
     * resolveResourceAssetKey()). The bush and the thing it drops are different concepts now;
     * before ProviderTypes.ts existed they shared one conflated entry.
     */
    berryBush: {
        // No berry-bush model yet — add one here whenever real art exists.
        models: [],
        scale: 1,
        rotationDeg: [
            0,
            360
        ],
        "icon": "wild-berries"
    },
    "wood": {
        models: [],
        scale: 1,
        rotationDeg: 0,
        "icon": "wood-log"
    },
    "crystal": {
        "icon": "iron-ore",
        "models": [],
        "scale": 1,
        "rotationDeg": 0
    },
    "palm": {
        "models": [MODELS.Pirate.PalmBend, MODELS.Pirate.PalmStraight],
        "scale": [
            1,
            1
        ],
        "rotationDeg": [
            0,
            360
        ],
        "icon": "tree-bark"
    },
    "crystalDeposit": {
        "models": [MODELS.Resources.SilverNuggetLarge],
        "scale": 4,
        "rotationDeg": [
            1,
            1
        ],
        "icon": "iron-ore"
    },
    "berry": {
        "icon": "wild-berries",
        "models": [],
        "scale": 1,
        "rotationDeg": [
            0,
            360
        ]
    },
    "stoneDeposit": {
        models: [MODELS.Resources.StoneChunksLarge, MODELS.Resources.StoneChunksSmall],
        scale: [
            1.5,
            2
        ],
        "rotationDeg": [
            0,
            360
        ],
        "icon": "stone-chunk"
    },
    "iron": {
        "icon": "iron-ore",
        "models": [],
        "scale": 1,
        "rotationDeg": 0
    },
    "ironDeposit": {
        "icon": "iron-ore",
        "models": [MODELS.Resources.SilverNuggetLarge, MODELS.Resources.SilverNuggetLarge],
        "scale": [
            1.5,
            2
        ],
        "rotationDeg": [
            0,
            360
        ]
    },
    "rope": {
        "icon": "rope-coil",
        "models": [],
        "scale": 1,
        "rotationDeg": 0
    },
    /**
     * Doubles as BOTH the caught-Pig resource's backpack/UI icon (via ResourceRegistry.ts's
     * identity mapping — ResourceType.Pig === 'pig') AND AnimalNode's own live world model
     * while a Pig is still wandering uncaught (see AnimalNode.ts, which resolves its visual the
     * same way LooseResourceNode does — through resolveResourceAssetKey(ANIMAL_CONFIG[type].resourceType)).
     * `icon` isn't a real asset yet — see this file's own doc, ModelSnapshotTool.ts (the
     * top-down-render tool this key's name was chosen to match) can generate one; drop it at
     * raw-assets/images/survive{tps}/animal-pig.png and run `npm run image` to make this real.
     */
    "pig": {
        "icon": "pizza-model-snapshots_Pets-AnimalPig",
        "models": [MODELS.Pets.AnimalPig],
        "scale": 0.5,
        "rotationDeg": 0
    },
    "gem": {
        "icon": "ResourceBar_Single_Icon_Gem",
        "models": [],
        "scale": 1,
        "rotationDeg": 0
    },
    "energy": {
        "icon": "ResourceBar_Single_Icon_Energy",
        "models": [],
        "scale": 1,
        "rotationDeg": 0
    }
} satisfies Record<string, AssetLibraryEntry>;

export type AssetLibraryKey = keyof typeof ASSET_LIBRARY;
