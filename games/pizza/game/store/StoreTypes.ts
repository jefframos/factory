// StoreTypes.ts
//
// A STORE — a grocery-style mart drawn on the Tiled map's "stores" layer
// (see StoreLayout.ts): clients spawn at its entrance, walk to the storages
// inside it to pick up the items they want, queue at the cashier, pay once
// the player stands there (the money lands on the store's money drop), then
// walk to the exit and despawn. See Store.ts for the runtime.
//
// Same {default, byId} two-export shape as StorageTypes.ts/QueueTypes.ts:
// every store drawn on the map uses DEFAULT_STORE_CONFIG unless
// STORE_CONFIG_BY_ID has an override for its id. Edited from the pizza web
// editor's Stores tab (games/pizza/web).

import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';

export type StoreSpotDirection = 'north' | 'south' | 'east' | 'west';

export interface StoreNpcEntry {
    /** NpcTypes.ts id. */
    npcId: string;
}

export interface StoreSpotDirectionEntry {
    /** A "storage" id on the map (inside this store). */
    storageId: string;
    direction: StoreSpotDirection;
}

/** What progress toward a store level counts: money clients paid, or number of clients who paid. */
export type StoreLevelRequirementType = 'money' | 'sales';

export interface StoreEnableEntry {
    /** Any map object id — a storage, farm, building, queue, shop, mart or crafting table. Hidden until this level is reached. */
    entityId: string;
}

export interface StoreLevelConfig {
    /**
     * The level this entry is FOR. A store is level 0 while closed and level 1 the moment it
     * opens (starter built) — a level-1 entry's requirement is ignored, its `enables` just
     * appear on opening. Every higher level needs `amount` of `requirementType`, counted from
     * the moment the previous level was reached.
     */
    level: number;
    requirementType: StoreLevelRequirementType;
    amount: number;
    /** Map objects that stay hidden until the store reaches this level. */
    enables?: StoreEnableEntry[];
}

export interface StoreConfig {
    /** Display name — shown in the web editor. Optional. */
    name?: string;
    /** Looks a client can have — each client picks one at random (NPCs tab ids). */
    npcs: StoreNpcEntry[];
    /** Seconds between two client spawns (while below maxClients). */
    spawnIntervalSec: number;
    /** Most clients inside the store at once — also caps how long any waiting line can get. */
    maxClients: number;
    /** Client walk speed, world units per second. */
    moveSpeed: number;
    /** Most DIFFERENT items one client asks for (at least 1). */
    maxDistinctItems: number;
    /** Most units of each item one client asks for (at least 1). */
    maxAmountPerItem: number;
    /** Multiplier on each item's base Resources-tab price — what a client actually pays. */
    priceMultiplier: number;
    /** Distance between two waiting spots in a line (storage or cashier), world units. */
    spotSpacing: number;
    /** Gap between a storage's/the cashier's own edge and the first waiting spot, world units. */
    spotMargin: number;
    /**
     * Which way a storage's waiting line extends. Storages not listed line up toward the
     * store's own center, which works for most layouts — list one when two storages sit
     * close enough that their lines would cross.
     */
    storageSpotDirections?: StoreSpotDirectionEntry[];
    /** Same, for the cashier's line. Unset = toward the store's own center. */
    cashierSpotDirection?: StoreSpotDirection;
    /** Seconds a client takes to pick up ONE unit once it's at the front of a storage line. */
    pickDelaySec: number;
    /** Seconds between the player reaching the cashier and the front client paying. */
    payDelaySec: number;
    /** How much money one bill on the money-drop pile represents (visual only). */
    moneyPerBill: number;
    /** How tall one money pile gets (in bills) before the next pile starts beside it (visual only). */
    billsPerPile: number;
    /** Height of the want-bubble above the client's head, world units. */
    bubbleOffset: number;
    /** A storage (map id, inside this store) that is FREE and appears the moment the store opens. Unset = the player has to buy every storage. */
    defaultStorageId?: string;
    /** Level ladder — see StoreLevelConfig's own doc. Empty/unset = the store stays level 1 forever. */
    levels?: StoreLevelConfig[];
    /** When true, this store isn't spawned at all — same convention as every other entity's `disabled`. */
    disabled?: boolean;
}

/** Applied to every store drawn on the map unless STORE_CONFIG_BY_ID has an override for its id. Edited from the pizza web editor's Stores tab. */
export const DEFAULT_STORE_CONFIG: StoreConfig = {
    "npcs": [
        {
            "npcId": "shopper1"
        },
        {
            "npcId": "shopper2"
        }
    ],
    "spawnIntervalSec": 6,
    "maxClients": 5,
    "moveSpeed": 2.5,
    "maxDistinctItems": 2,
    "maxAmountPerItem": 2,
    "priceMultiplier": 1,
    "spotSpacing": 1.3,
    "spotMargin": 0.6,
    "storageSpotDirections": [],
    "pickDelaySec": 0.5,
    "payDelaySec": 0.5,
    "moneyPerBill": 5,
    "bubbleOffset": 0.6
};

/** Per-store-id overrides — sparse: only stores a level designer has customized need an entry. */
export const STORE_CONFIG_BY_ID: Partial<Record<string, StoreConfig>> = {
    "farmStore1": {
        "npcs": [
            {
                "npcId": "shopper1"
            },
            {
                "npcId": "shopper2"
            }
        ],
        "spawnIntervalSec": 15,
        "maxClients": 5,
        "moveSpeed": 2.5,
        "maxDistinctItems": 2,
        "maxAmountPerItem": 2,
        "priceMultiplier": 1,
        "spotSpacing": 2.5,
        "spotMargin": 0.6,
        "storageSpotDirections": [
            {
                "storageId": "storage1",
                "direction": "south"
            },
            {
                "storageId": "storage2",
                "direction": "south"
            },
            {
                "storageId": "storage3",
                "direction": "west"
            }
        ],
        "cashierSpotDirection": "east",
        "pickDelaySec": 1,
        "payDelaySec": 1,
        "moneyPerBill": 5,
        "bubbleOffset": 2,
        "levels": [
            {
                "level": 1,
                "requirementType": "money",
                "amount": 0,
                "enables": [
                    {
                        "entityId": "farm1"
                    }
                ]
            },
            {
                "level": 2,
                "requirementType": "money",
                "amount": 50,
                "enables": [
                    {
                        "entityId": "farm2"
                    },
                    {
                        "entityId": "storage2"
                    }
                ]
            },
            {
                "level": 3,
                "requirementType": "money",
                "amount": 100,
                "enables": [
                    {
                        "entityId": "farm3"
                    },
                    {
                        "entityId": "storage3"
                    }
                ]
            }
        ],
        "defaultStorageId": "storage1",
        "billsPerPile": 10
    }
};

export function getStoreConfig(id: string): StoreConfig {
    return STORE_CONFIG_BY_ID[id] ?? DEFAULT_STORE_CONFIG;
}

/** The entry for reaching the level after `currentLevel` — undefined once the ladder is done (or while closed, level 0: opening isn't a paid level). */
export function getNextStoreLevel(config: StoreConfig, currentLevel: number): StoreLevelConfig | undefined {
    if (currentLevel < 1) {
        return undefined;
    }
    let next: StoreLevelConfig | undefined;
    for (const entry of config.levels ?? []) {
        if (entry.level > currentLevel && (!next || entry.level < next.level)) {
            next = entry;
        }
    }
    return next;
}

/** An item's BASE price per unit (before StoreConfig.priceMultiplier) — the same base `price` marts already trade at (see ResourceConfig.price). A priceless resource still pays 1 so a store never gives an item away. */
export function getStoreItemPrice(type: ResourceType): number {
    return RESOURCE_CONFIG[type]?.price ?? 1;
}

/** Which way `storageId`'s waiting line extends — undefined = toward the store's center. */
export function getStorageSpotDirection(config: StoreConfig, storageId: string): StoreSpotDirection | undefined {
    return config.storageSpotDirections?.find(entry => entry.storageId === storageId)?.direction;
}
