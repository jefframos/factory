// FarmUpgradeTypes.ts
//
// FARM UPGRADES — what the farm manager (a "farmDesk" on the map, see FarmDeskTypes.ts /
// store/FarmDeskZone.ts) sells for each owned farm: an upgrade ladder per farm id. Every farm
// starts at level 1 (no bonus); each entry is what it costs to REACH that level and what the
// farm does from then on:
//   - priceBonus: its crop sells for this much more in the store (0.4 = +40%) — what the default
//                 ladder uses (crops already grow fast enough).
//   - growSpeed:  crops grow this many times faster (1.5 = a 10 s crop takes ~6.7 s). Applied
//                 when a crop is planted (FarmPlotTile), so a crop already growing keeps its pace.
//                 Supported, unused by default.
//   - yieldBonus: extra units per harvest, on top of the crop's own yield (player and restockers).
//                 Supported, unused by default.
// The highest listed level is the max. Bought levels are saved in FarmUpgradeStorage.ts.
//
// Same {default, byId} shape as StorageTypes.ts: a farm uses DEFAULT_FARM_UPGRADE_CONFIG unless
// FARM_UPGRADE_CONFIG_BY_ID has an entry for its id. Edited from the pizza web editor's Farm
// Upgrades tab.

export interface FarmUpgradeLevelConfig {
    /** The level this buys (2, 3, ...). */
    level: number;
    /** Money (CurrencyType.Money) to reach it from the level below. */
    cost: number;
    /** + fraction on the store price of this farm's crop at this level (0.4 = +40%). Unset = 0. */
    priceBonus?: number;
    /** x crop growth speed at this level. Unset = 1. */
    growSpeed?: number;
    /** + units per harvest at this level. Unset = 0. */
    yieldBonus?: number;
}

export interface FarmUpgradeConfig {
    /** The ladder — see this file's own doc. Empty = this farm can't be upgraded. */
    levels: FarmUpgradeLevelConfig[];
}

export const DEFAULT_FARM_UPGRADE_CONFIG: FarmUpgradeConfig = {
    "levels": [
        {
            "level": 2,
            "cost": 40,
            "priceBonus": 0.2
        },
        {
            "level": 3,
            "cost": 90,
            "priceBonus": 0.4
        },
        {
            "level": 4,
            "cost": 180,
            "priceBonus": 0.7
        },
        {
            "level": 5,
            "cost": 350,
            "priceBonus": 1
        }
    ]
};

export const FARM_UPGRADE_CONFIG_BY_ID: Partial<Record<string, FarmUpgradeConfig>> = {};

export function getFarmUpgradeConfig(farmId: string): FarmUpgradeConfig {
    return FARM_UPGRADE_CONFIG_BY_ID[farmId] ?? DEFAULT_FARM_UPGRADE_CONFIG;
}

/** What a farm at `level` does — the entry for that level, or the highest one below it; level 1 = no bonus. */
export function getFarmUpgradeStats(farmId: string, level: number): { growSpeed: number; yieldBonus: number; priceBonus: number } {
    let best: FarmUpgradeLevelConfig | undefined;
    for (const entry of getFarmUpgradeConfig(farmId).levels) {
        if (entry.level <= level && (!best || entry.level > best.level)) {
            best = entry;
        }
    }
    return {
        growSpeed: Math.max(0.01, best?.growSpeed ?? 1),
        yieldBonus: Math.max(0, Math.round(best?.yieldBonus ?? 0)),
        priceBonus: Math.max(0, best?.priceBonus ?? 0),
    };
}

/** The upgrade a farm at `level` can buy next — undefined once it's at the top of its ladder. */
export function getNextFarmUpgrade(farmId: string, level: number): FarmUpgradeLevelConfig | undefined {
    return getFarmUpgradeConfig(farmId).levels.find(entry => entry.level === level + 1);
}

/** Highest level this farm can reach — 1 if it has no ladder. */
export function getFarmMaxLevel(farmId: string): number {
    return Math.max(1, ...getFarmUpgradeConfig(farmId).levels.map(entry => entry.level));
}
