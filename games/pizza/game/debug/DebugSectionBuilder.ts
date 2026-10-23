// DebugSectionBuilder.ts
//
// The debug menu's "Build <room>" buttons — builds a store section and everything inside it
// LIVE, no reload, through the same paths a player's payment takes (the camera flies to it,
// pieces pop in, what's inside spawns on its own gates):
//
//   1. the store is raised to the level the section and its contents need
//      (StoreProgressStorage.debugRaiseLevel — store `enables` and "store" appear requirements);
//   2. the section's next level is paid for free and completed (BuildingStorage.onLevelUp ->
//      its BuildingZone plays the normal build);
//   3. as their gates open, everything for sale drawn inside the section — storages, mix
//      stations, buildings (arcade machines) — plus the shelves selling its stations' products
//      (drawn in the main store) are bought the same way, one per tick so the build sequences
//      don't pile up. Gives up on what hasn't appeared after GIVE_UP_SEC.
//
// Notifications waiting for a tap are tapped through while it runs.

import type World from '../ecs/World';
import type WorldObjectRegistry from '../world/WorldObjectRegistry';
import { isInStoreSection } from '../world/WorldObjectRegistry';
import StoragePurchaseZone from '../store/StoragePurchaseZone';
import { StoreProgressStorage } from '../store/StoreProgressStorage';
import { StorageOwnershipStorage } from '../store/StorageOwnershipStorage';
import { BuildingStorage } from '../data/BuildingStorage';
import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { BuildingId } from '../data/BuildingId';
import { STORAGE_CONFIG_BY_ID, isStorageForSale } from '../data/StorageTypes';
import { MIX_STATION_CONFIG_BY_ID } from '../data/MixStationTypes';
import type { MilestoneRequirement } from '../data/MilestoneRequirement';
import type { ResourceType } from '../actions/ResourceTypes';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { storeLevelEnabling } from '../playtest/PlaytestUnlock';

/** Seconds between purchases (and gate re-checks). */
const TICK_SEC = 0.6;
/** Stop waiting for contents that never appear after this long. */
const GIVE_UP_SEC = 20;

export interface SectionBuildHost {
    readonly world: World;
    readonly worldObjects: WorldObjectRegistry;
}

/** See this file's own doc. Resolves with a one-line summary for a toast. */
export async function buildSectionNow(host: SectionBuildHost, sectionId: string): Promise<string> {
    const section = host.worldObjects.getStoreSections().find(s => s.id === sectionId);
    if (!section) {
        return `"${sectionId}" isn't drawn on the map`;
    }
    const inside = (type: string): string[] => [...host.worldObjects.getAllOfType(type)]
        .filter(([, placement]) => isInStoreSection(section, placement.x, placement.z))
        .map(([id]) => id);

    const stations = inside('mixStation').filter(id => {
        const config = MIX_STATION_CONFIG_BY_ID[id];
        return config && !config.disabled;
    });
    const products = new Set<ResourceType>(stations.map(id => MIX_STATION_CONFIG_BY_ID[id]!.resourceType));
    const mapStorages = host.worldObjects.getAllOfType('storage');
    const storages = [
        ...inside('storage'),
        ...[...mapStorages.keys()].filter(id => {
            const type = STORAGE_CONFIG_BY_ID[id]?.resourceType;
            return type !== undefined && products.has(type);
        }),
    ].filter((id, index, all) => {
        const config = STORAGE_CONFIG_BY_ID[id];
        return all.indexOf(id) === index && !!config && !config.disabled && isStorageForSale(config);
    });
    const purchases = [...storages, ...stations];
    const buildings = inside('building').filter(id => id !== sectionId && BUILDING_CONFIG[id as BuildingId] && !BUILDING_CONFIG[id as BuildingId].disabled);

    // 1. Store level.
    const storeId = section.storeId;
    if (storeId) {
        const needed = Math.max(
            ...[sectionId, ...purchases, ...buildings].map(storeLevelEnabling),
            ...[sectionId, ...buildings].map(id => storeLevelRequired(BUILDING_CONFIG[id as BuildingId]?.appearRequirement, storeId)),
            ...storages.map(id => storeLevelRequired(STORAGE_CONFIG_BY_ID[id]?.appearRequirement, storeId)),
        );
        StoreProgressStorage.debugRaiseLevel(storeId, needed);
    }

    // 2. The section itself.
    if (BuildingStorage.getLevel(sectionId as BuildingId) === 0) {
        payAndCompleteLevel(sectionId as BuildingId);
    }

    // 3. What's inside, as it appears.
    const pending = new Set<string>([...purchases, ...buildings.filter(id => BuildingStorage.getLevel(id as BuildingId) === 0)]);
    const buildingIds = new Set(buildings);
    let bought = 0;
    const startedAt = performance.now();
    while (pending.size > 0 && performance.now() - startedAt < GIVE_UP_SEC * 1000) {
        await waitSec(TICK_SEC);
        tapThroughNotifications();
        for (const id of [...pending]) {
            if (buildingIds.has(id) ? BuildingStorage.getLevel(id as BuildingId) > 0 : StorageOwnershipStorage.isOwned(id)) {
                pending.delete(id);
            }
        }
        const next = [...pending].find(id => buildingIds.has(id) || findPurchaseZone(host.world, id));
        if (!next) {
            continue;
        }
        if (buildingIds.has(next)) {
            payAndCompleteLevel(next as BuildingId);
        } else {
            findPurchaseZone(host.world, next)!.debugCompletePurchase();
        }
        pending.delete(next);
        bought++;
    }
    // The last purchases' notifications.
    for (let i = 0; i < 4; i++) {
        await waitSec(TICK_SEC);
        tapThroughNotifications();
    }
    const missed = pending.size > 0 ? ` — never appeared: ${[...pending].join(', ')}` : '';
    return `Built ${sectionId} + ${bought} inside${missed}`;
}

/** Pays the building's next level for free (money + every resource) and completes it. */
function payAndCompleteLevel(id: BuildingId): void {
    const next = BuildingStorage.getNextLevelConfig(id);
    if (!next) {
        return;
    }
    BuildingStorage.addMoneyProgress(id, next.money ?? 0);
    for (const [type, amount] of Object.entries(next.requirements) as [ResourceType, number][]) {
        BuildingStorage.addProgress(id, type, amount);
    }
    BuildingStorage.tryCompleteLevel(id);
}

function storeLevelRequired(requirement: MilestoneRequirement | undefined, storeId: string): number {
    return requirement?.type === 'store' && requirement.storeId === storeId ? requirement.level : 0;
}

function findPurchaseZone(world: World, storageId: string): StoragePurchaseZone | undefined {
    let found: StoragePurchaseZone | undefined;
    world.forEachEntity(entity => {
        if (!found && entity instanceof StoragePurchaseZone && entity.getStorageId() === storageId) {
            found = entity;
        }
    });
    return found;
}

function tapThroughNotifications(): void {
    if (UpgradeNotificationManager.instance.isAwaitingTap()) {
        UpgradeNotificationManager.instance.tapToContinue();
    }
}

function waitSec(sec: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, sec * 1000));
}
