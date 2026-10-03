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
import type { StoreWaitStyle } from './StoreQueueSpots';

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

/**
 * What a store worker does (see StoreWorker.ts):
 *   - 'cashier':   serves at the cashier and collects the money drop — StoreCashierWorker.ts.
 *   - 'restocker': refills the emptiest shelf from the farms — StoreRestockerWorker.ts.
 *   - 'cleaner':   picks garbage off the floor and throws it in the trash — StoreCleanerWorker.ts.
 */
export type StoreWorkerRole = 'cashier' | 'restocker' | 'cleaner';

/** NPCs tab id EVERY store worker wears — one shared look (edit it there to change them all). */
export const WORKER_NPC_ID = 'worker';

/**
 * One worker a store starts with. The store's roster is SAVED (StoreWorkerStorage.ts) the first
 * time it opens — from then on the save is the source of truth for each worker's level (so the
 * store can upgrade it); an entry added here later still joins an existing save.
 */
export interface StoreWorkerEntry {
    /** Unique within the store, e.g. "cashier1", "restocker2". */
    id: string;
    role: StoreWorkerRole;
    /** Starting level. Unset = 1. */
    level?: number;
}

/** One role a store's hire desk (see HireDeskZone.ts) offers. */
export interface StoreHireRoleConfig {
    role: StoreWorkerRole;
    /** Money (CurrencyType.Money) per hire. */
    cost: number;
    /** Most of this role the store can have in total, starting workers included. Unset = 1 for a cashier (a store only ever has one — see Store.hireWorker()), else DEFAULT_HIRE_MAX_COUNT. */
    maxCount?: number;
    /** Upgrade ladder for every worker of this role — each entry is what it costs to REACH that level; the highest listed level is the max. Empty/unset = DEFAULT_WORKER_UPGRADES. */
    upgrades?: StoreWorkerUpgradeConfig[];
}

/** One rung of a worker's upgrade ladder — see StoreHireRoleConfig.upgrades. */
export interface StoreWorkerUpgradeConfig {
    /** The level this buys (2, 3, ...). */
    level: number;
    /** Money (CurrencyType.Money) to reach it from the level below. */
    cost: number;
}

/** What a role's workers can upgrade to when its StoreHireRoleConfig has no `upgrades`. */
export const DEFAULT_WORKER_UPGRADES: readonly StoreWorkerUpgradeConfig[] = [
    { level: 2, cost: 50 },
    { level: 3, cost: 100 },
];

/** A role's resolved upgrade ladder for this store — see StoreHireRoleConfig.upgrades. Works for a role the desk doesn't sell too (a starting worker), using the defaults. */
export function getWorkerUpgrades(config: StoreConfig, role: StoreWorkerRole): readonly StoreWorkerUpgradeConfig[] {
    const upgrades = getStoreHireRoles(config).find(entry => entry.role === role)?.upgrades;
    return upgrades && upgrades.length > 0 ? upgrades : DEFAULT_WORKER_UPGRADES;
}

/** The upgrade a worker at `level` can buy next — undefined once it's at its role's max (see getWorkerMaxLevel()). */
export function getNextWorkerUpgrade(config: StoreConfig, role: StoreWorkerRole, level: number): StoreWorkerUpgradeConfig | undefined {
    return getWorkerUpgrades(config, role).find(upgrade => upgrade.level === level + 1);
}

/** Highest level a worker of this role can reach — 1 if the ladder is somehow empty. */
export function getWorkerMaxLevel(config: StoreConfig, role: StoreWorkerRole): number {
    return Math.max(1, ...getWorkerUpgrades(config, role).map(upgrade => upgrade.level));
}

/** What a store's hire desk sells — see HireDeskZone.ts / HireWorkersPopup.ts. Unset on a store = DEFAULT_HIRE_ROLES, worker NPC look. */
export interface StoreHiringConfig {
    /** NPCs tab id for whoever stands at the desk. Unset = WORKER_NPC_ID. */
    npcId?: string;
    /** Roles offered, in popup order. Empty/unset = DEFAULT_HIRE_ROLES. */
    roles?: StoreHireRoleConfig[];
}

/** StoreHireRoleConfig.maxCount fallback for non-cashier roles. */
export const DEFAULT_HIRE_MAX_COUNT = 3;

/** What a hire desk offers when its store has no `hiring.roles` set. */
export const DEFAULT_HIRE_ROLES: readonly StoreHireRoleConfig[] = [
    { role: 'cashier', cost: 100, maxCount: 1 },
    { role: 'restocker', cost: 75 },
    { role: 'cleaner', cost: 75 },
];

/** Resolved hire-desk roles for a store — see StoreHiringConfig. */
export function getStoreHireRoles(config: StoreConfig): readonly StoreHireRoleConfig[] {
    const roles = config.hiring?.roles;
    return roles && roles.length > 0 ? roles : DEFAULT_HIRE_ROLES;
}

/** Resolved StoreHireRoleConfig.maxCount — see that field's own doc. */
export function getHireMaxCount(entry: StoreHireRoleConfig): number {
    if (entry.role === 'cashier') {
        return 1;
    }
    return entry.maxCount ?? DEFAULT_HIRE_MAX_COUNT;
}

/** A store's staff hat — same fields as an NPC hat entry (NpcTypes.ts's NpcHatEntry), minus the weight. */
export interface StoreWorkerHat {
    /** First entry used — a MODELS "Group.Key" ref (e.g. "Hats.CashierHat"). Empty = no hat. */
    models?: string[];
    /** See HatSpec (CharacterBody.ts) — fitted-size multiplier, lift (fraction of the head), yaw. */
    scale?: number;
    offsetY?: number;
    rotationDeg?: number;
}

/** A cashier's stats at one level — see StoreCashierWorkerConfig.levels. */
export interface StoreWorkerLevelConfig {
    /** The level this entry is for (1, 2, ...). */
    level: number;
    /** Walk speed, world units per second. */
    moveSpeed: number;
    /** Seconds between the worker reaching the cashier (with a client ready) and that client paying — the worker's own Pay Time. */
    payDelaySec: number;
}

/**
 * Settings shared by this store's CASHIER workers (StoreCashierWorker.ts): serves at the cashier's
 * npcPoint while clients are waiting to pay — exactly like the player standing there — and walks
 * to the money drop's npcPoint to send the pile to the player's wallet every `collectEverySales`
 * sales, or whenever no client is waiting. Otherwise wanders near the cashier.
 */
export interface StoreCashierWorkerConfig {
    /** Sales served in a row before the worker walks off to collect the money drop. Unset = DEFAULT_WORKER_COLLECT_EVERY_SALES. */
    collectEverySales?: number;
    /** How far from its cashier point it strolls while idle, world units. Unset = DEFAULT_WORKER_WANDER_RADIUS. */
    wanderRadius?: number;
    /** Stats per level. The entry for the worker's level (or the highest one below it) is used; empty/unset = the store's own client Walk Speed and Pay Time. */
    levels?: StoreWorkerLevelConfig[];
}

/** A restocker's stats at one level — see StoreRestockerWorkerConfig.levels. */
export interface StoreRestockerLevelConfig {
    level: number;
    /** Walk speed, world units per second (the player walks at PlayerConfig.walkSpeed — 5). */
    moveSpeed: number;
    /** How many items fit on its back at once. */
    carryCapacity: number;
}

/**
 * Settings shared by this store's RESTOCKER workers (StoreRestockerWorker.ts): picks the shelf
 * (a storage with a `resourceType`) with the fewest items whose crop is ready on some farm,
 * harvests up to carryCapacity of it into the crate on its back, and brings it to that shelf.
 * Otherwise wanders among the store's shelves.
 */
export interface StoreRestockerWorkerConfig {
    /** How far from the middle of the store's shelves it strolls while idle, world units. Unset = DEFAULT_RESTOCKER_WANDER_RADIUS. */
    wanderRadius?: number;
    /** Stats per level (entry for the worker's level, or the highest below it). Empty/unset = DEFAULT_RESTOCKER_MOVE_SPEED / DEFAULT_RESTOCKER_CARRY_CAPACITY. */
    levels?: StoreRestockerLevelConfig[];
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
    /**
     * How waiting clients stand (see StoreQueueSpots.ts): 'cluster' gathers them around the
     * shelf/cashier (biased toward its line direction), 'line' keeps the straight line. The
     * queue order is the same either way. Unset = 'cluster'.
     */
    waitStyle?: StoreWaitStyle;
    /** Nav grid cell size, world units (see store/nav/StoreNavGrid.ts). Smaller = tighter paths, more cells. Unset = DEFAULT_NAV_CELL_SIZE. */
    navCellSize?: number;
    /** A client's personal-space radius, world units — obstacles are grown by this and clients steer apart at about twice it. Unset = DEFAULT_CLIENT_RADIUS. */
    clientRadius?: number;
    /** 0-1: each time a client waiting in a shelf line (not at the front) gets restless, the chance it goes browsing another shelf instead of standing. Unset = DEFAULT_BROWSE_CHANCE. */
    browseChance?: number;
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
    /** EntityViewRegistry view for the solid counter drawn in the cashier rect (see StorePropVisual.ts) — the player serves standing against it. Unset = DEFAULT_CASHIER_VIEW. */
    cashierView?: string;
    /** Same, for the money drop — paid bills pile on its top. Unset = DEFAULT_MONEY_DROP_VIEW. */
    moneyDropView?: string;
    /**
     * Pacing while the store has only ONE shelf (available storage). spawnIntervalSec/maxClients
     * above are the pacing with EVERY shelf in the store available; in between, each shelf added
     * moves pacing a step from these toward those — see getStorePacing(). Unset =
     * spawnIntervalSec x DEFAULT_START_SPAWN_INTERVAL_FACTOR.
     */
    startSpawnIntervalSec?: number;
    /** Same, for maxClients. Unset = min(DEFAULT_START_MAX_CLIENTS, maxClients). */
    startMaxClients?: number;
    /** Extra clients allowed inside per hired worker (on top of the shelf-based max — see getStorePacing()). Fractions add up (0.5 = one more per two workers). Unset = DEFAULT_CLIENTS_PER_WORKER. */
    clientsPerWorker?: number;
    /** Extra clients allowed inside per store level above 1. Unset = DEFAULT_CLIENTS_PER_LEVEL. */
    clientsPerLevel?: number;
    /**
     * How far past the max (above) the store may still go when it's STUCK — full and nobody has
     * paid for stuckSec: one more client is let in each stuckSec, up to this many; any payment
     * closes the extra slots again. Unset = DEFAULT_OVERFLOW_CLIENTS.
     */
    overflowClients?: number;
    /** Seconds full with no payment before one overflow client is let in — see overflowClients. Unset = DEFAULT_STUCK_SEC. */
    stuckSec?: number;
    /**
     * Seconds a client stays at the bottom mood (ANGRY) while still waiting before it drops
     * everything it carries on the floor as garbage and walks out without paying (see
     * StoreClient.ts / store/StoreGarbage.ts). Unset = DEFAULT_ANGRY_DROP_SEC.
     */
    angryDropSec?: number;
    /** Pieces of garbage on the floor at which clients stop coming altogether until it's cleaned up. Unset = DEFAULT_MAX_GARBAGE. */
    maxGarbage?: number;
    /** Below maxGarbage, each piece on the floor makes clients come this much less often (0.15 = spawn interval +15% per piece). Unset = DEFAULT_GARBAGE_SPAWN_SLOWDOWN. */
    garbageSpawnSlowdown?: number;
    /** When true, early store levels cap how low a client's mood can drop (level 1: happy, level 2: annoyed — see Store.getMoodFloor()). Unset/false = clients can always get angry. */
    forgivingEarlyLevels?: boolean;
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
    /** Workers this store starts with — see StoreWorkerEntry's own doc. Empty/unset = the player does everything. */
    workers?: StoreWorkerEntry[];
    /** Settings for this store's cashier workers — see StoreCashierWorkerConfig's own doc. */
    cashierWorker?: StoreCashierWorkerConfig;
    /** Settings for this store's restocker workers — see StoreRestockerWorkerConfig's own doc. */
    restockerWorker?: StoreRestockerWorkerConfig;
    /** Settings for this store's cleaner workers — same shape as restockers (speed + carry spaces per level). See StoreCleanerWorker.ts. */
    cleanerWorker?: StoreRestockerWorkerConfig;
    /** Body/head color EVERY worker of this store wears — so each store's staff has its own look. Unset = the NPCs tab's "worker" look. */
    workerColor?: string;
    /** Hat every worker of this store wears — see StoreWorkerHat. Unset / no model = the "worker" look's own (none by default). */
    workerHat?: StoreWorkerHat;
    /** Checker this store's floor uses — a StoreViewTypes.ts FLOOR_CHECKER_BY_ID id (Store View tab -> Floor). Unset = DEFAULT_FLOOR_CHECKER. */
    floorChecker?: string;
    /** Style this store's walls use — a StoreViewTypes.ts WALL_STYLE_BY_ID id (Store View tab -> Wall). Unset = DEFAULT_WALL_STYLE. */
    wallStyle?: string;
    /** What this store's hire desk(s) offer — see StoreHiringConfig. Unset = DEFAULT_HIRE_ROLES. */
    hiring?: StoreHiringConfig;
    /** When true, this store isn't spawned at all — same convention as every other entity's `disabled`. */
    disabled?: boolean;
}

/** Applied to every store drawn on the map unless STORE_CONFIG_BY_ID has an override for its id. Edited from the pizza web editor's Stores tab. */
export const DEFAULT_STORE_CONFIG: StoreConfig = {
    "npcs": [
        {
            "npcId": "shopper"
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
    "billsPerPile": 20,
    "bubbleOffset": 0.6,
    "levels": [],
    "workers": [],
    "cashierWorker": {
        "levels": []
    },
    "restockerWorker": {
        "levels": []
    },
    "cleanerWorker": {
        "levels": []
    },
    "workerHat": {
        "models": []
    }
};

/** Per-store-id overrides — sparse: only stores a level designer has customized need an entry. */
export const STORE_CONFIG_BY_ID: Partial<Record<string, StoreConfig>> = {
    "farmStore1": {
        "hiring": {
            "roles": [
                {
                    "role": "cashier", "cost": 100, "maxCount": 1,
                    "upgrades": [{ "level": 2, "cost": 80 }, { "level": 3, "cost": 160 }]
                },
                {
                    "role": "restocker", "cost": 75, "maxCount": 3,
                    "upgrades": [{ "level": 2, "cost": 60 }, { "level": 3, "cost": 120 }]
                },
                {
                    "role": "cleaner", "cost": 75, "maxCount": 2,
                    "upgrades": [{ "level": 2, "cost": 60 }, { "level": 3, "cost": 120 }]
                }
            ]
        },
        "workerColor": "#2ecc40",
        "workerHat": {
            "models": [
                "Hats.CashierHat"
            ]
        },
        "restockerWorker": {
            "wanderRadius": 3,
            "levels": [
                {
                    "level": 1,
                    "moveSpeed": 1.5,
                    "carryCapacity": 1
                },
                {
                    "level": 2,
                    "moveSpeed": 2,
                    "carryCapacity": 2
                },
                {
                    "level": 3,
                    "moveSpeed": 3,
                    "carryCapacity": 3
                }
            ]
        },
        "cashierWorker": {
            "collectEverySales": 5,
            "wanderRadius": 2,
            "levels": [
                {
                    "level": 1,
                    "moveSpeed": 1.5,
                    "payDelaySec": 4
                },
                {
                    "level": 2,
                    "moveSpeed": 2,
                    "payDelaySec": 3
                },
                {
                    "level": 3,
                    "moveSpeed": 3.6,
                    "payDelaySec": 2
                }
            ]
        },
        "npcs": [
            {
                "npcId": "shopper"
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
            },
            {
                "storageId": "storage4",
                "direction": "west"
            },
            {
                "storageId": "storage5",
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
            },
            {
                "level": 4,
                "requirementType": "money",
                "amount": 200,
                "enables": [
                    {
                        "entityId": "farm4"
                    },
                    {
                        "entityId": "storage4"
                    }
                ]
            },
            {
                "level": 5,
                "requirementType": "money",
                "amount": 350,
                "enables": [
                    {
                        "entityId": "farm5"
                    },
                    {
                        "entityId": "storage5"
                    }
                ]
            }
        ],
        "defaultStorageId": "storage1",
        "billsPerPile": 10,
        "workers": [],
        "cleanerWorker": {
            "levels": [
                {
                    "level": 1,
                    "moveSpeed": 1.5,
                    "carryCapacity": 1
                }
            ]
        }
    }
};

export function getStoreConfig(id: string): StoreConfig {
    return STORE_CONFIG_BY_ID[id] ?? DEFAULT_STORE_CONFIG;
}

/** StoreCashierWorkerConfig.collectEverySales fallback. */
export const DEFAULT_WORKER_COLLECT_EVERY_SALES = 5;
/** StoreCashierWorkerConfig.wanderRadius fallback, world units. */
export const DEFAULT_WORKER_WANDER_RADIUS = 2;

/** StoreRestockerWorkerConfig.wanderRadius fallback, world units. */
export const DEFAULT_RESTOCKER_WANDER_RADIUS = 3;
/** Restocker walk speed with no levels configured — a bit slower than the player's own walkSpeed (5). */
export const DEFAULT_RESTOCKER_MOVE_SPEED = 4;
/** Restocker carry capacity with no levels configured. */
export const DEFAULT_RESTOCKER_CARRY_CAPACITY = 2;

/** The entry for `level` in a worker level list — or the highest one below it; undefined when none fits. */
function pickLevelEntry<T extends { level: number }>(levels: readonly T[] | undefined, level: number): T | undefined {
    const wanted = Math.max(1, Math.floor(level));
    return [...(levels ?? [])]
        .filter(candidate => candidate.level <= wanted)
        .sort((a, b) => b.level - a.level)[0];
}

/** A cashier worker's stats at `level` — see StoreCashierWorkerConfig.levels. */
export function getCashierLevelStats(config: StoreConfig, level: number): { moveSpeed: number; payDelaySec: number } {
    const entry = pickLevelEntry(config.cashierWorker?.levels, level);
    return {
        moveSpeed: entry?.moveSpeed ?? config.moveSpeed,
        payDelaySec: entry?.payDelaySec ?? config.payDelaySec,
    };
}

/** A restocker worker's stats at `level` — see StoreRestockerWorkerConfig.levels. */
export function getRestockerLevelStats(config: StoreConfig, level: number): { moveSpeed: number; carryCapacity: number } {
    const entry = pickLevelEntry(config.restockerWorker?.levels, level);
    return {
        moveSpeed: entry?.moveSpeed ?? DEFAULT_RESTOCKER_MOVE_SPEED,
        carryCapacity: Math.max(1, Math.floor(entry?.carryCapacity ?? DEFAULT_RESTOCKER_CARRY_CAPACITY)),
    };
}

/** A cleaner worker's stats at `level` — StoreConfig.cleanerWorker.levels, same defaults as a restocker's. */
export function getCleanerLevelStats(config: StoreConfig, level: number): { moveSpeed: number; carryCapacity: number } {
    const entry = pickLevelEntry(config.cleanerWorker?.levels, level);
    return {
        moveSpeed: entry?.moveSpeed ?? DEFAULT_RESTOCKER_MOVE_SPEED,
        carryCapacity: Math.max(1, Math.floor(entry?.carryCapacity ?? DEFAULT_RESTOCKER_CARRY_CAPACITY)),
    };
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

/** StoreConfig.cashierView / moneyDropView fallbacks — kitchen cabinets for now (see EntityViewRegistry.ts). */
export const DEFAULT_CASHIER_VIEW = 'storeCashierView';
export const DEFAULT_MONEY_DROP_VIEW = 'storeMoneyDropView';
export const DEFAULT_NAV_CELL_SIZE = 0.3;
export const DEFAULT_CLIENT_RADIUS = 0.35;
export const DEFAULT_BROWSE_CHANCE = 0.4;
export const DEFAULT_MOOD_STEP_SEC = 20;
export const DEFAULT_VERY_HAPPY_PAY_MULTIPLIER = 2;
export const DEFAULT_UNHAPPY_PAY_PENALTY = 0.2;
export const DEFAULT_START_SPAWN_INTERVAL_FACTOR = 1.6;
export const DEFAULT_START_MAX_CLIENTS = 2;
export const DEFAULT_START_PATIENCE_MULTIPLIER = 1.5;
export const DEFAULT_MIN_CLIENT_PATIENCE = 0.8;
export const DEFAULT_MAX_CLIENT_PATIENCE = 1.5;

/** StoreConfig.clientsPerWorker / clientsPerLevel / overflowClients / stuckSec fallbacks. */
export const DEFAULT_CLIENTS_PER_WORKER = 1;
export const DEFAULT_CLIENTS_PER_LEVEL = 0.5;
export const DEFAULT_OVERFLOW_CLIENTS = 2;
export const DEFAULT_STUCK_SEC = 15;
/** StoreConfig.angryDropSec / maxGarbage fallbacks. */
export const DEFAULT_ANGRY_DROP_SEC = 8;
export const DEFAULT_MAX_GARBAGE = 15;
export const DEFAULT_GARBAGE_SPAWN_SLOWDOWN = 0.15;

/** How busy/forgiving a store is right now — see getStorePacing(). */
export interface StorePacing {
    spawnIntervalSec: number;
    /** Soft cap on clients inside — the store can go past it by up to overflowClients while stuck (see StoreConfig.overflowClients). */
    maxClients: number;
    overflowClients: number;
    stuckSec: number;
    /** x moodStepSec for clients spawned now, before their own random tolerance. */
    patienceMultiplier: number;
}

/**
 * Pacing for a store with `shelves` of its `totalShelves` storages available: the `start*`
 * values at one shelf, the regular spawnIntervalSec/maxClients (and x1 patience) with all of
 * them, a linear step per shelf in between — so each new shelf brings a few more clients. On top
 * of that shelf-based max, every hired worker (clientsPerWorker) and every store level above 1
 * (clientsPerLevel) allow a little more — the more help the player has, the busier it gets.
 */
export function getStorePacing(config: StoreConfig, shelves: number, totalShelves: number, workers = 0, level = 1): StorePacing {
    const t = totalShelves > 1 ? Math.min(1, Math.max(0, (shelves - 1) / (totalShelves - 1))) : 1;
    const lerp = (from: number, to: number) => from + (to - from) * t;
    const startInterval = config.startSpawnIntervalSec ?? config.spawnIntervalSec * DEFAULT_START_SPAWN_INTERVAL_FACTOR;
    const startMax = config.startMaxClients ?? Math.min(DEFAULT_START_MAX_CLIENTS, config.maxClients);
    return {
        spawnIntervalSec: lerp(startInterval, config.spawnIntervalSec),
        // Rounded down so client count grows on the slow side (2 -> 3 -> 5 over three shelves, not 2 -> 4 -> 5).
        maxClients: Math.max(1, Math.floor(
            lerp(startMax, config.maxClients)
            + Math.max(0, workers) * (config.clientsPerWorker ?? DEFAULT_CLIENTS_PER_WORKER)
            + Math.max(0, level - 1) * (config.clientsPerLevel ?? DEFAULT_CLIENTS_PER_LEVEL)
            + 1e-6,
        )),
        overflowClients: Math.max(0, Math.floor(config.overflowClients ?? DEFAULT_OVERFLOW_CLIENTS)),
        stuckSec: Math.max(1, config.stuckSec ?? DEFAULT_STUCK_SEC),
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
