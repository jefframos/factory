// StorageTypes.ts
//
// A STORAGE — a "storage"-typed object drawn on the Tiled map's "mapSettings"
// layer (e.g. `storage1`), plus an optional "dropper" rect targeting it. While
// the player stands in the dropper (or on the storage itself, if it has none),
// every carried item this storage accepts flies off the top of the player's
// stack into it, one at a time, and piles up there as real models (an
// ItemPile — the same system as the player's own stack) — see StorageZone.ts
// for the runtime and StorageInventory.ts for what it persists.
//
// Same {default, byId} two-export shape as FarmTypes.ts/QueueTypes.ts: every
// storage placed on the map uses DEFAULT_STORAGE_CONFIG unless
// STORAGE_CONFIG_BY_ID has an override for its id. Edited from the pizza web
// editor's Storages tab.

import { ResourceType } from '../actions/ResourceTypes';
import type { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';
import MODELS from "../../registry/assetsRegistry/modelsRegistry";

/**
 * What a storage takes, by ResourceConfig.category (see ResourceTypes.ts):
 *   - 'farm':   crop harvests (the default — a food storage)
 *   - 'main':   regular resources (wood, stone, ...)
 *   - 'animal': caught animals
 *   - 'all':    anything
 */
export type StorageAccepts = 'farm' | 'main' | 'animal' | 'all';

export interface StoragePileConfig {
    /** Most items per row / per column of each layer (fewer if the largest stored item doesn't fit that many — see ItemPile.ts). */
    columns: number;
    rows: number;
    /** Most layers drawn — anything past columns x rows x layers is still stored, just not shown. */
    layers: number;
}

export interface StorageConfig {
    /** Display name — shown in the web editor. Optional. */
    name?: string;
    /** See StorageAccepts' own doc. Ignored when `resourceType` is set. */
    accepts: StorageAccepts;
    /**
     * Optional — when set, this storage takes ONLY this one resource (e.g. carrots), whatever
     * `accepts` says; everything else stays on the player. Unset = anything `accepts` allows.
     * Named `resourceType` so the web editor's sync writes it as a real ResourceType.X enum value
     * (see syncToSource.mjs's ENUM_VALUE_FIELDS).
     */
    resourceType?: ResourceType;
    /**
     * First entry used. Either form is fine — a MODELS "Group.Key" string (e.g.
     * "Restaurant.Crate") or a real MODELS.* reference — because the web editor's sync writes
     * `default` as strings but each `byId` entry as MODELS.* (see
     * ModelSnapshotTool.resolveModelRef(), which StorageZone resolves through). Empty (or an
     * unknown ref) = no mesh.
     */
    models: (string | ModelDefinition)[];
    /** Uniform scale on the model's native size (Restaurant.Crate is 2 x 0.8 x 2 world units at 1). */
    scale: number;
    /** Yaw, degrees. */
    rotationDeg: number;
    /**
     * Where the pile starts (the first item's bottom-center) — and so where dropped items land —
     * relative to the storage object's own position, world units. Default sits half-way up
     * Restaurant.Crate (0.8 tall), so the pile rises out of it.
     */
    dropOffset: { x?: number; y?: number; z?: number };
    /** How stored items are laid out — see StoragePileConfig's own doc. The grid spans 80% of the mesh's own floor. */
    pile: StoragePileConfig;
    /** Multiplier on each stored item's real world size. Optional — missing uses the player's own PlayerConfig.backpack.itemScale, so items look the same on the stack and in storage. */
    itemScale?: number;
    /**
     * Height (world units) of the "only this resource" popup's bottom above the TOP of the pile —
     * same field name/meaning as every other entity's popupBobOffset (see PopupConfig.ts). Only
     * shown when `resourceType` is set. Optional — missing uses StorageZone's own default (1).
     */
    popupBobOffset?: number;
    /**
     * 0-1 fraction of the storage's OWN footprint (not its dropper's) that becomes a solid collider
     * — same 0/1/0.5 meaning as every building/shop/queue's `solid` (see SolidArea.ts). Unset/0 =
     * walk-through. With no dropper the storage's footprint is also its drop-off trigger, so that
     * trigger is padded outward when solid (see PizzaScene.setupStorages()) — otherwise the
     * collider would stop the player from ever reaching it.
     */
    solid?: number;
    /** When true, this storage isn't spawned at all — same convention as every other entity's `disabled`. */
    disabled?: boolean;
}

/** Applied to every discovered "storage" object unless STORAGE_CONFIG_BY_ID has an override for its id. */
export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
    "accepts": "farm",
    "models": [
        "Restaurant.Crate"
    ],
    "scale": 1,
    "rotationDeg": 0,
    "dropOffset": {},
    "pile": {
        "columns": 2,
        "rows": 2,
        "layers": 3
    }
};

/** Per-storage-id overrides — sparse: only storages a level designer has customized need an entry. */
export const STORAGE_CONFIG_BY_ID: Partial<Record<string, StorageConfig>> = {
    "storage2": {
        "accepts": "farm",
        "resourceType": ResourceType.Carrot,
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 2,
            "rows": 2,
            "layers": 3
        },
        "solid": 1,
        "popupBobOffset": 3
    }
};

/** The config a storage with this id should use — its own override if STORAGE_CONFIG_BY_ID has one, else DEFAULT_STORAGE_CONFIG. */
export function getStorageConfig(id: string): StorageConfig {
    return STORAGE_CONFIG_BY_ID[id] ?? DEFAULT_STORAGE_CONFIG;
}
