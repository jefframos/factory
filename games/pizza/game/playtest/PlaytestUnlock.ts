// PlaytestUnlock.ts
//
// ?unlockTo=N — start a session as if the game had been played up to store level N with
// everything built that's possible by then, to test later content (the diner, the arcade) without
// building the whole way there first. index.ts wipes the save, loads the storages, then calls
// applyUnlockFromUrl() before the scene builds:
//
//   - every store at level N (open, with enough lifetime sales for sales-gated zones);
//   - every zone tutorial complete, every trigger fired;
//   - repeated until nothing new appears (building a room can unlock what's inside it):
//       buildings / store rooms whose appear requirement is met -> level 1 (no upgrades),
//       storages / animal stalls / mix stations for sale and enabled at that level -> owned,
//       farms enabled at that level -> owned;
//   - staff: a cashier, 2 restockers, a cleaner and a baker (what the hire desk sells by then);
//   - UNLOCK_MONEY in the wallet.
//
// Works with or without the bot (?bot&unlockTo=8, or plain ?unlockTo=8 to play it yourself);
// the terminal runner passes it with --unlock-to N. Like &fresh it replaces the save.

import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { BuildingId } from '../data/BuildingId';
import { BuildingStorage } from '../data/BuildingStorage';
import { STORAGE_CONFIG_BY_ID, isStorageForSale } from '../data/StorageTypes';
import { MIX_STATION_CONFIG_BY_ID } from '../data/MixStationTypes';
import { FARM_PLOT_CONFIG_BY_ID } from '../data/FarmTypes';
import { FarmPlotStorage } from '../data/FarmPlotStorage';
import { isMilestoneRequirementMet } from '../data/MilestoneRequirement';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import { TriggerStorage } from '../data/TriggerStorage';
import { TRIGGER_CONFIG_BY_ID } from '../data/TriggerTypes';
import { TutorialProgressStorage } from '../tutorial/TutorialProgressStorage';
import { ZONE_TUTORIAL_CONFIG } from '../tutorial/ZoneTutorialTypes';
import { STORE_CONFIG_BY_ID, StoreWorkerRole } from '../store/StoreTypes';
import { StoreProgressStorage } from '../store/StoreProgressStorage';
import { StorageOwnershipStorage } from '../store/StorageOwnershipStorage';
import { SavedStoreWorker, StoreWorkerStorage } from '../store/StoreWorkerStorage';

/** Money in the wallet after an unlock. */
const UNLOCK_MONEY = 2000;
/** Lifetime sales recorded (zones gated on "storeSales" reveal). */
const UNLOCK_TOTAL_SALES = 100;
/** Passes over buildings/storages/farms — each can unlock more (a room -> what's inside). */
const MAX_PASSES = 10;
/** The staff an unlocked store gets (roles the hire desk sells by then). */
const UNLOCK_STAFF: StoreWorkerRole[] = ['cashier', 'restocker', 'restocker', 'cleaner', 'baker'];

/**
 * Same rule as StoreUnlocks.isEnabled()'s store-level gate, read straight from the store configs
 * (StoreUnlocks needs the map, which isn't loaded yet at this point of boot): an id listed under
 * some store level's `enables` is available from that level on; one listed nowhere always is.
 */
function enabledAt(id: string, level: number): boolean {
    return storeLevelEnabling(id) <= level;
}

/** The lowest store level whose `enables` lists `id` — 0 when no level lists it (never gated). Also used by the debug menu's Build buttons. */
export function storeLevelEnabling(id: string): number {
    let lowest = Infinity;
    for (const config of Object.values(STORE_CONFIG_BY_ID)) {
        for (const entry of config?.levels ?? []) {
            if (entry.enables?.some(enable => enable.entityId === id)) {
                lowest = Math.min(lowest, entry.level);
            }
        }
    }
    return lowest === Infinity ? 0 : lowest;
}

/** The `?unlockTo=` level, if any. */
export function getUnlockLevel(): number | undefined {
    const raw = new URLSearchParams(window.location.search).get('unlockTo');
    const level = raw === null ? NaN : Math.floor(Number(raw));
    return Number.isFinite(level) && level >= 1 ? level : undefined;
}

/** See this file's own doc. Call after every storage has loaded, before the scene builds. */
export async function applyUnlockFromUrl(): Promise<void> {
    const level = getUnlockLevel();
    if (level === undefined) {
        return;
    }
    const storeIds = Object.keys(STORE_CONFIG_BY_ID).filter(id => !STORE_CONFIG_BY_ID[id]?.disabled);
    for (const storeId of storeIds) {
        StoreProgressStorage.debugSetLevel(storeId, level, UNLOCK_TOTAL_SALES);
    }
    for (const [zone, config] of Object.entries(ZONE_TUTORIAL_CONFIG)) {
        TutorialProgressStorage.setCompletedStepCount(Number(zone), config?.steps?.length ?? 0);
    }
    for (const id of Object.keys(TRIGGER_CONFIG_BY_ID)) {
        TriggerStorage.activate(id);
    }

    const built: string[] = [];
    for (let pass = 0; pass < MAX_PASSES; pass++) {
        let changed = false;
        for (const [id, config] of Object.entries(BUILDING_CONFIG)) {
            const buildingId = id as BuildingId;
            if (config.disabled || BuildingStorage.getLevel(buildingId) >= 1 || !enabledAt(id, level)) {
                continue;
            }
            if (config.appearRequirement && !isMilestoneRequirementMet(config.appearRequirement)) {
                continue;
            }
            BuildingStorage.debugSetLevel(buildingId, 1);
            built.push(id);
            changed = true;
        }
        const forSale: [string, boolean][] = [
            ...Object.entries(STORAGE_CONFIG_BY_ID).map(([id, config]): [string, boolean] => [id, !!config && !config.disabled && isStorageForSale(config)
                && (!config.appearRequirement || isMilestoneRequirementMet(config.appearRequirement))]),
            ...Object.entries(MIX_STATION_CONFIG_BY_ID).map(([id, config]): [string, boolean] => [id, !!config && !config.disabled
                && ((config.price?.amount ?? 0) > 0 || (config.resourceCost ?? []).some(cost => cost.amount > 0))]),
        ];
        for (const [id, buyable] of forSale) {
            if (buyable && !StorageOwnershipStorage.isOwned(id) && enabledAt(id, level)) {
                StorageOwnershipStorage.debugSetOwned(id);
                built.push(id);
                changed = true;
            }
        }
        for (const [id, config] of Object.entries(FARM_PLOT_CONFIG_BY_ID)) {
            if (config && !config.disabled && !FarmPlotStorage.isOwned(id) && enabledAt(id, level)) {
                FarmPlotStorage.debugSetOwned(id);
                built.push(id);
                changed = true;
            }
        }
        if (!changed) {
            break;
        }
    }

    await StoreWorkerStorage.load();
    for (const storeId of storeIds) {
        const roster: SavedStoreWorker[] = [...(StoreWorkerStorage.getRoster(storeId) ?? [])];
        const counts = new Map<StoreWorkerRole, number>();
        for (const role of UNLOCK_STAFF) {
            const index = (counts.get(role) ?? 0) + 1;
            counts.set(role, index);
            if (!roster.some(worker => worker.id === `${role}${index}`)) {
                roster.push({ id: `${role}${index}`, role, level: 1 });
            }
        }
        StoreWorkerStorage.setRoster(storeId, roster);
    }

    const balance = EconomyStorage.getBalance(CurrencyType.Money);
    if (balance < UNLOCK_MONEY) {
        EconomyStorage.add(CurrencyType.Money, UNLOCK_MONEY - balance);
    }
    console.log(`[PlaytestUnlock] store level ${level}: built/bought ${built.length} — ${built.join(', ')}`);
}
