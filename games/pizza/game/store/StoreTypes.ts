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
    /**
     * Pacing while the store has only ONE shelf (available storage). spawnIntervalSec/maxClients
     * above are the pacing with EVERY shelf in the store available; in between, each shelf added
     * moves pacing a step from these toward those — see getStorePacing(). Unset =
     * spawnIntervalSec x DEFAULT_START_SPAWN_INTERVAL_FACTOR.
     */
    startSpawnIntervalSec?: number;
    /** Same, for maxClients. Unset = min(DEFAULT_START_MAX_CLIENTS, maxClients). */
    startMaxClients?: number;
    /** x moodStepSec with only one shelf (more forgiving early on), easing to x1 with every shelf. Unset = DEFAULT_START_PATIENCE_MULTIPLIER. */
    startPatienceMultiplier?: number;
    /** Seconds a client stays in one mood before dropping a step (see StoreClientMood). Unset = DEFAULT_MOOD_STEP_SEC. */
    moodStepSec?: number;
    /** Each client's own tolerance: its mood step time is x a random value between these two. Unset = DEFAULT_MIN/MAX_CLIENT_PATIENCE. */
    minClientPatience?: number;
    maxClientPatience?: number;
    /** What a VERY HAPPY client's payment is multiplied by. Unset = DEFAULT_VERY_HAPPY_PAY_MULTIPLIER. */
    veryHappyPayMultiplier?: number;
    /** Fraction taken off a SAD or ANGRY client's payment (0.2 = 20% less, rounded). Unset = DEFAULT_UNHAPPY_PAY_PENALTY. */
    unhappyPayPenalty?: number;
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
        },
        {
            "npcId": "shopper3"
        },
        {
            "npcId": "shopper4"
        },
        {
            "npcId": "shopper5"
        },
        {
            "npcId": "shopper6"
        },
        {
            "npcId": "shopper7"
        },
        {
            "npcId": "shopper8"
        },
        {
            "npcId": "shopper9"
        },
        {
            "npcId": "shopper10"
        },
        {
            "npcId": "shopper11"
        },
        {
            "npcId": "shopper12"
        },
        {
            "npcId": "shopper13"
        },
        {
            "npcId": "shopper14"
        },
        {
            "npcId": "shopper15"
        },
        {
            "npcId": "shopper16"
        },
        {
            "npcId": "shopper17"
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
            },
            {
                "npcId": "shopper3"
            },
            {
                "npcId": "shopper4"
            },
            {
                "npcId": "shopper5"
            },
            {
                "npcId": "shopper6"
            },
            {
                "npcId": "shopper7"
            },
            {
                "npcId": "shopper8"
            },
            {
                "npcId": "shopper9"
            },
            {
                "npcId": "shopper10"
            },
            {
                "npcId": "shopper11"
            },
            {
                "npcId": "shopper12"
            },
            {
                "npcId": "shopper13"
            },
            {
                "npcId": "shopper14"
            },
            {
                "npcId": "shopper15"
            },
            {
                "npcId": "shopper16"
            },
            {
                "npcId": "shopper17"
            }
        ],
        "spawnIntervalSec": 12,
        "startSpawnIntervalSec": 24,
        "maxClients": 5,
        "startMaxClients": 2,
        "startPatienceMultiplier": 1.6,
        "moodStepSec": 20,
        "minClientPatience": 0.8,
        "maxClientPatience": 1.6,
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

/**
 * A client's mood, best to worst — see StoreClient.ts. Arrives HAPPY, drops one step every
 * moodStepSec until paid, and climbs one step each time it completes an item while more are
 * still left. Dropping to SAD with nothing bought makes it leave; with something bought it
 * stays until its order is done (SAD, then ANGRY) and pays less.
 */
export type StoreClientMood = 'veryHappy' | 'happy' | 'annoyed' | 'sad' | 'angry';

/** Worst to best — a mood's index is its "happiness", used to step up/down. */
export const STORE_MOOD_LADDER: readonly StoreClientMood[] = ['angry', 'sad', 'annoyed', 'happy', 'veryHappy'];

/** Texture key (packed 'ui' bundle, ui{tps}/faces) shown in the client's bubble for each mood. */
export const STORE_MOOD_ICON: Record<StoreClientMood, string> = {
    veryHappy: 'emoji-very-happy',
    happy: 'emoji-happy',
    annoyed: 'emoji-annoyed',
    sad: 'emoji-sad',
    angry: 'emoji-angry',
};

export const DEFAULT_MOOD_STEP_SEC = 20;
export const DEFAULT_VERY_HAPPY_PAY_MULTIPLIER = 2;
export const DEFAULT_UNHAPPY_PAY_PENALTY = 0.2;
export const DEFAULT_START_SPAWN_INTERVAL_FACTOR = 1.6;
export const DEFAULT_START_MAX_CLIENTS = 2;
export const DEFAULT_START_PATIENCE_MULTIPLIER = 1.5;
export const DEFAULT_MIN_CLIENT_PATIENCE = 0.8;
export const DEFAULT_MAX_CLIENT_PATIENCE = 1.5;

/** How busy/forgiving a store is right now — see getStorePacing(). */
export interface StorePacing {
    spawnIntervalSec: number;
    maxClients: number;
    /** x moodStepSec for clients spawned now, before their own random tolerance. */
    patienceMultiplier: number;
}

/**
 * Pacing for a store with `shelves` of its `totalShelves` storages available: the `start*`
 * values at one shelf, the regular spawnIntervalSec/maxClients (and x1 patience) with all of
 * them, a linear step per shelf in between — so each new shelf brings a few more clients.
 */
export function getStorePacing(config: StoreConfig, shelves: number, totalShelves: number): StorePacing {
    const t = totalShelves > 1 ? Math.min(1, Math.max(0, (shelves - 1) / (totalShelves - 1))) : 1;
    const lerp = (from: number, to: number) => from + (to - from) * t;
    const startInterval = config.startSpawnIntervalSec ?? config.spawnIntervalSec * DEFAULT_START_SPAWN_INTERVAL_FACTOR;
    const startMax = config.startMaxClients ?? Math.min(DEFAULT_START_MAX_CLIENTS, config.maxClients);
    return {
        spawnIntervalSec: lerp(startInterval, config.spawnIntervalSec),
        // Rounded down so client count grows on the slow side (2 -> 3 -> 5 over three shelves, not 2 -> 4 -> 5).
        maxClients: Math.max(1, Math.floor(lerp(startMax, config.maxClients) + 1e-6)),
        patienceMultiplier: lerp(config.startPatienceMultiplier ?? DEFAULT_START_PATIENCE_MULTIPLIER, 1),
    };
}

/** Seconds per mood step for one new client — the store's pacing x that client's own random tolerance. */
export function rollClientMoodStepSec(config: StoreConfig, pacing: StorePacing): number {
    const min = config.minClientPatience ?? DEFAULT_MIN_CLIENT_PATIENCE;
    const max = Math.max(min, config.maxClientPatience ?? DEFAULT_MAX_CLIENT_PATIENCE);
    const tolerance = min + Math.random() * (max - min);
    return (config.moodStepSec ?? DEFAULT_MOOD_STEP_SEC) * pacing.patienceMultiplier * tolerance;
}

/** What a client in `mood` pays for an order worth `price` — x2 when very happy, 20% less (rounded) when sad/angry, by default. */
export function applyMoodToPrice(config: StoreConfig, mood: StoreClientMood, price: number): number {
    if (price <= 0) {
        return 0;
    }
    if (mood === 'veryHappy') {
        return Math.round(price * (config.veryHappyPayMultiplier ?? DEFAULT_VERY_HAPPY_PAY_MULTIPLIER));
    }
    if (mood === 'sad' || mood === 'angry') {
        return Math.max(1, Math.round(price * (1 - (config.unhappyPayPenalty ?? DEFAULT_UNHAPPY_PAY_PENALTY))));
    }
    return price;
}

/** An item's BASE price per unit (before StoreConfig.priceMultiplier) — the same base `price` marts already trade at (see ResourceConfig.price). A priceless resource still pays 1 so a store never gives an item away. */
export function getStoreItemPrice(type: ResourceType): number {
    return RESOURCE_CONFIG[type]?.price ?? 1;
}

/** Which way `storageId`'s waiting line extends — undefined = toward the store's center. */
export function getStorageSpotDirection(config: StoreConfig, storageId: string): StoreSpotDirection | undefined {
    return config.storageSpotDirections?.find(entry => entry.storageId === storageId)?.direction;
}
