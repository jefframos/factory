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
    /** See StorageAccepts' own doc. */
    accepts: StorageAccepts;
    /**
     * MODELS "Group.Key" dot-paths (e.g. "Restaurant.Crate") — first entry used, resolved at
     * runtime via ModelSnapshotTool.resolveModelDef(). Deliberately strings, not MODELS.*
     * expressions: the web editor's {default, byId} sync writes plain values (see
     * syncToSource.mjs's syncQueues()), same convention as PlayerConfig.backpack.models. Empty
     * (or an unknown ref) = no mesh.
     */
    models: string[];
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
export const STORAGE_CONFIG_BY_ID: Partial<Record<string, StorageConfig>> = {};

/** The config a storage with this id should use — its own override if STORAGE_CONFIG_BY_ID has one, else DEFAULT_STORAGE_CONFIG. */
export function getStorageConfig(id: string): StorageConfig {
    return STORAGE_CONFIG_BY_ID[id] ?? DEFAULT_STORAGE_CONFIG;
}
