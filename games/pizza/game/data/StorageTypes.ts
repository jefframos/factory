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
import { CurrencyType } from './EconomyTypes';
import type { FloorLabelSide, PopupFrameChoice } from '../ui/PopupConfig';
import type { ItemOrientation } from '../world/ResourceDisplayModel';
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

/** What buying a storage costs — same shape as FarmPlotPrice. */
export interface StoragePrice {
    currency: CurrencyType;
    amount: number;
}

/** One resource a storage costs on top of its price (e.g. 20 wood) — paid from the backpack, see StoragePurchaseZone.ts. */
export interface StorageResourceCost {
    /** Named `resourceType` so the web editor's sync writes a real ResourceType.X value (see syncToSource.mjs's ENUM_VALUE_FIELDS). */
    resourceType: ResourceType;
    amount: number;
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
     * When true, this storage is a TRASH: it takes ONLY garbage (ResourceType.Garbage — see
     * store/StoreGarbage.ts; `accepts`/`resourceType` are ignored) off the player exactly like a
     * storage, but every piece is destroyed on landing — nothing is stored, no pile, no count. Its
     * signpost shows a trash icon instead of an item + count, and stores never sell from it (see
     * store/Store.ts). Unset = a normal storage.
     */
    trash?: boolean;
    /**
     * Trash only: once the player has stood in it this many seconds (and carries no garbage), it
     * also takes everything on their stack — crops, eggs, butter, ... ('farm' items; never wood,
     * stone or other building resources). The way out of carrying something nobody buys. Walking
     * past doesn't trigger it. Unset / 0 = garbage only.
     */
    dumpAnyAfterSec?: number;
    /**
     * Optional continuous ambient particle effect (see vfx/ParticleRegistry.ts — PARTICLE_REGISTRY),
     * emitted from this storage's drop point (dropOffset) for as long as it stands — same slot
     * GateConfig/CraftTableConfig carry. Unset = no particles.
     */
    particleEffectId?: string;
    /** Particles per second for particleEffectId. Unset = 4 (same rate gates/crafting tables use). */
    particleSpawnRate?: number;
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
     * Optional Entity Views id (EntityViewRegistry.ts) for the storage's own mesh — when it resolves,
     * it WINS over `models`/`scale`/`rotationDeg` above (its own offset is added on top of the
     * storage's position). Unset or empty view = the inline `models` fields, unchanged.
     */
    view?: string;
    /**
     * Which side of the storage its signpost stands on — the signpost itself (model, scale, icon)
     * is shared by every storage, see STORAGE_SIGNPOST_CONFIG. Unset = 'north'.
     */
    signpostSide?: FloorLabelSide;
    /** When true, this storage has no signpost at all (post and icon) — e.g. the trash, whose model already says what it is. Unset = signpost shown. */
    hideSignpost?: boolean;
    /** Distance from the storage's edge to the signpost, world units. Unset = 0.2. */
    signpostGap?: number;
    /** Yaw of this storage's signpost model, degrees. Unset = 0. The item icon keeps facing the camera. */
    signpostRotationDeg?: number;
    /**
     * Where the pile starts (the first item's bottom-center) — and so where dropped items land —
     * relative to the storage object's own position, world units. Default sits half-way up
     * Restaurant.Crate (0.8 tall), so the pile rises out of it.
     */
    dropOffset: { x?: number; y?: number; z?: number };
    /** How stored items are laid out — see StoragePileConfig's own doc. The grid spans 80% of the mesh's own floor. */
    pile: StoragePileConfig;
    /** Multiplier on each stored item's real world size. Optional — missing uses the player's own PlayerConfig.carrier.itemScale, so items look the same on the stack and in storage. */
    itemScale?: number;
    /** Optional fixed yaw (degrees) for every stored item, so long items (carrots) lie aligned. Unset = scattered yaws, the natural-pile look (fine for round items). */
    itemYawDeg?: number;
    /** How stored items are turned — 'lying' (tall items on their side, the default), 'standing' (as authored) or 'upsideDown' (as authored, flipped — e.g. carrots tip-down). See ResourceDisplayModel's ItemOrientation. */
    itemOrientation?: ItemOrientation;
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
    /**
     * How this storage shows its info — the stored count (only when `resourceType` is set) and, while
     * for sale, its price:
     *   - 'Floor' (FLOOR_FRAME — the default when unset): painted on the floor in 3D. The count sits
     *     just south of the storage; the price sits on the purchase area (its dropper, or its own footprint).
     *   - any FrameRegistry preset (e.g. 'QueueFrame'): a floating popup on the UI layer in that frame.
     */
    frame?: PopupFrameChoice;
    /** Which side of the storage the stored-count floor label sits on. Unset = 'south'. */
    floorLabelSide?: FloorLabelSide;
    /** Floor label height in world units (width grows with the text). Unset = 2.7. */
    floorLabelSize?: number;
    /** Gap between the storage's south edge and the floor label, world units. Unset = 0.3. */
    floorLabelGap?: number;
    /**
     * Optional — when set, the storage starts "for sale": the player stands in its footprint to
     * pay, same coin-drain flow as a farm plot (see store/StoragePurchaseZone.ts). Unset = owned
     * from the start. A store's `defaultStorageId` is always free regardless (see StoreTypes.ts).
     */
    price?: StoragePrice;
    /**
     * Optional resources it ALSO costs (e.g. 20 wood), paid from the backpack while the player
     * stands on the purchase area, alongside the price's coins — it's bought once everything is
     * paid. Unset/empty = coins only (or free, with no price either).
     */
    resourceCost?: StorageResourceCost[];
    /** When true, this storage isn't spawned at all — same convention as every other entity's `disabled`. */
    disabled?: boolean;
    /**
     * When true the player TAKES from this storage instead of dropping off: standing in its area,
     * its items fly onto the player's stack one at a time while there's room (StorageZone's
     * collect mode). For a storage something else fills — e.g. an animal stall's egg box (see
     * AnimalStallTypes.ts). Unset = the normal drop-off storage.
     */
    collect?: boolean;
    /**
     * A ShelfTypes.ts shelf id — the storage is drawn as that shelf (its model, replacing
     * models/view/scale) with items on its fixed slots instead of the crate grid, and holds at
     * most one item per slot: the player can't drop off more. Unset = the normal crate + pile.
     */
    shelf?: string;
    /** Holds at most this many items — the player can't drop off more (e.g. a mix station's ingredient spot: one batch). Unset = a shelf's slot count, else unlimited. */
    maxItems?: number;
}

/**
 * The signpost every storage shares — one model/scale and one item-icon size for all of them, so
 * it's tuned in one place (the Storages tab's "Signpost" card). Each storage only picks where its
 * own stands (StorageConfig.signpostSide/signpostGap) and its yaw (signpostRotationDeg). The icon
 * is the storage's `resourceType` item — a storage without one gets the post but no icon.
 */
export interface StorageSignpostConfig {
    /** First entry used — "Group.Key" string or MODELS.* ref, same as StorageConfig.models. Empty = no signposts at all. */
    models: (string | ModelDefinition)[];
    /** Uniform scale on the signpost model's native size. */
    scale: number;
    /** Nudge off each storage's side/gap spot, [x, y, z] world units — x/z turn with that storage's signpostRotationDeg. The icon moves with it. */
    offset: [number, number, number];
    /** Where the item icon's center sits, [x, y, z] world units from the signpost's base — y is the height above the ground; x/z turn with the storage's signpostRotationDeg. */
    iconOffset: [number, number, number];
    /** Size of the item icon, world units (1 = one unit square). */
    iconScale: number;
}

export const STORAGE_SIGNPOST_CONFIG: StorageSignpostConfig = {
    "models": [
        "Survival.SignpostSingle"
    ],
    "scale": 12,
    "offset": [
        0,
        -2.8,
        0
    ],
    "iconOffset": [
        0,
        4.6,
        0.3
    ],
    "iconScale": 1.5
};

/** Applied to every discovered "storage" object unless STORAGE_CONFIG_BY_ID has an override for its id. */
export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
    "accepts": "farm",
    "models": [
        "Restaurant.Crate"
    ],
    "view": "storageView",
    "scale": 1,
    "rotationDeg": 0,
    "dropOffset": {},
    "pile": {
        "columns": 2,
        "rows": 2,
        "layers": 3
    },
    "price": {
        "currency": CurrencyType.Money,
        "amount": 10
    },
    "resourceCost": [
        {
            "resourceType": ResourceType.Wood,
            "amount": 20
        }
    ]
};

/** Per-storage-id overrides — sparse: only storages a level designer has customized need an entry. */
export const STORAGE_CONFIG_BY_ID: Partial<Record<string, StorageConfig>> = {
    "storage2": {
        "accepts": "farm",
        "resourceType": ResourceType.Tomato,
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
        "popupBobOffset": 3,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 10
        },
        "resourceCost": [
            {
                "resourceType": ResourceType.Wood,
                "amount": 20
            }
        ],
        "view": "storageView",
    },
    "storage1": {
        "accepts": "farm",
        "resourceType": ResourceType.Carrot,
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 90,
        "dropOffset": {},
        "pile": {
            "columns": 4,
            "rows": 4,
            "layers": 1
        },
        "popupBobOffset": 3,
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 0
        },
        "view": "storageView",
        "itemOrientation": "standing",
        "resourceCost": []
    },
    "storage3": {
        "accepts": "farm",
        "resourceType": ResourceType.Broccoli,
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 2,
            "rows": 2,
            "layers": 3
        },
        "popupBobOffset": 3,
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 10
        },
        "resourceCost": [
            {
                "resourceType": ResourceType.Wood,
                "amount": 20
            }
        ],
        "view": "storageView",
    },
    "storage4": {
        "accepts": "farm",
        "resourceType": ResourceType.Strawberry,
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 2,
            "rows": 2,
            "layers": 3
        },
        "popupBobOffset": 3,
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 10
        },
        "resourceCost": [
            {
                "resourceType": ResourceType.Wood,
                "amount": 20
            }
        ],
        "view": "storageView",
    },
    "trash1": {
        "name": "Trash",
        "accepts": "farm",
        "trash": true,
        "dumpAnyAfterSec": 1.5,
        "hideSignpost": true,
        "particleEffectId": "trashFire",
        "particleSpawnRate": 10,
        "models": [MODELS.Restaurant.Trashcan],
        "scale": 0.5,
        "rotationDeg": 0,
        "dropOffset": {
            "y": 1
        },
        "pile": {
            "columns": 2,
            "rows": 2,
            "layers": 3
        },
        "solid": 1,
        "view": "trashcanView",
        "price": {
            "currency": CurrencyType.Money,
            "amount": 25
        },
        "resourceCost": []
    },
    "storage5": {
        "accepts": "farm",
        "resourceType": ResourceType.Corn,
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 2,
            "rows": 2,
            "layers": 3
        },
        "popupBobOffset": 3,
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 10
        },
        "resourceCost": [
            {
                "resourceType": ResourceType.Wood,
                "amount": 20
            }
        ],
        "view": "storageView",
    },
    "chickenStall": {
        "name": "Chicken Stall Egg Box",
        "accepts": "farm",
        "resourceType": ResourceType.Egg,
        "collect": true,
        "models": [MODELS.Restaurant.Crate],
        "view": "storageView",
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 3,
            "rows": 3,
            "layers": 2
        },
        "itemOrientation": "standing",
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 20
        },
        "resourceCost": []
    },
    "storageEgg": {
        "name": "Egg Storage",
        "accepts": "farm",
        "resourceType": ResourceType.Egg,
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 90,
        "dropOffset": {},
        "pile": {
            "columns": 4,
            "rows": 4,
            "layers": 1
        },
        "itemOrientation": "standing",
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 0
        },
        "view": "storageView",
        "popupBobOffset": 3,
        "resourceCost": []
    },
    "storageMilk": {
        "name": "Milk Shelf",
        "accepts": "farm",
        "resourceType": ResourceType.Milk,
        "shelf": "shelfEnd",
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 3,
            "rows": 2,
            "layers": 1
        },
        "itemOrientation": "standing",
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 0
        },
        "resourceCost": []
    },
    "cowStall": {
        "name": "Cow Stall Milk Box",
        "accepts": "farm",
        "resourceType": ResourceType.Milk,
        "collect": true,
        "models": [MODELS.Restaurant.Crate],
        "view": "storageView",
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 2,
            "rows": 2,
            "layers": 1
        },
        "itemOrientation": "standing",
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 20
        },
        "resourceCost": [],
        "signpostSide": "east"
    },
    "storageButter": {
        "name": "Butter Shelf",
        "accepts": "farm",
        "resourceType": ResourceType.Butter,
        "shelf": "shelfBoxes",
        "models": [MODELS.Restaurant.Crate],
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 3,
            "rows": 3,
            "layers": 1
        },
        "itemOrientation": "standing",
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 0
        },
        "resourceCost": []
    },
    "storageBread": {
        "name": "Bread Storage",
        "accepts": "farm",
        "resourceType": ResourceType.Bread,
        "models": [MODELS.Restaurant.Crate],
        "view": "storageView",
        "scale": 1,
        "rotationDeg": 0,
        "dropOffset": {},
        "pile": {
            "columns": 3,
            "rows": 3,
            "layers": 1
        },
        "itemOrientation": "standing",
        "popupBobOffset": 3,
        "solid": 1,
        "price": {
            "currency": CurrencyType.Money,
            "amount": 0
        },
        "resourceCost": []
    }
};

/** Its resource costs that actually cost something (amount > 0). */
export function getStorageResourceCost(config: StorageConfig): StorageResourceCost[] {
    return (config.resourceCost ?? []).filter(cost => cost.amount > 0);
}

/** True when buying this storage costs anything — coins or resources. */
export function isStorageForSale(config: StorageConfig): boolean {
    return (config.price?.amount ?? 0) > 0 || getStorageResourceCost(config).length > 0;
}

/** The config a storage with this id should use — its own override if STORAGE_CONFIG_BY_ID has one, else DEFAULT_STORAGE_CONFIG. */
export function getStorageConfig(id: string): StorageConfig {
    return STORAGE_CONFIG_BY_ID[id] ?? DEFAULT_STORAGE_CONFIG;
}
