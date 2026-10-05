// StoreUnlocks.ts
//
// Answers "is this map object allowed to exist yet?" for everything a store
// level gates: any id listed in a StoreLevelConfig's `enables` (hidden until
// that store reaches that level), plus a store's `defaultStorageId` (hidden
// until the store opens, level 1). Ids no store mentions are never gated.
//
// Also gated by WHERE an object is drawn (see registerPlacementGates()):
//   - inside a "storeSection" rect -> hidden until that section is built,
//   - else inside a store's area   -> hidden until that store opens (level 1).
// RequirementRegistry rechecks on a building level-up (a section built) and on
// a store level change (a store opening), so these appear right away too.
//
// RequirementRegistry consults isEnabled() for every spawn gate (buildings,
// queues, farms, shops, marts, crafting tables, storages) and rechecks
// whenever StoreProgressStorage.onLevelChanged fires, so a level-up makes
// its enabled objects appear immediately.
//
// Also owns the "is this storage usable by clients" rule shared by
// PizzaScene.setupStorages() and Store.ts — see isStorageAvailable().

import { BUILDING_CONFIG } from '../data/BuildingTypes';
import { BuildingId } from '../data/BuildingId';
import { BuildingStorage } from '../data/BuildingStorage';
import { StorageConfig, isStorageForSale } from '../data/StorageTypes';
import type WorldObjectRegistry from '../world/WorldObjectRegistry';
import { readStoreLayouts, rectContains } from './StoreLayout';
import { StoreProgressStorage } from './StoreProgressStorage';
import { StorageOwnershipStorage } from './StorageOwnershipStorage';
import { getStoreConfig } from './StoreTypes';

interface StoreGate {
    storeId: string;
    level: number;
}

/** Map object types whose spawn goes through RequirementRegistry — the ones registerPlacementGates() gates by position. Buildings are left out: a section and a store's starter are themselves buildings drawn inside those areas. */
const PLACEMENT_GATED_TYPES = ['storage', 'shop', 'queue', 'mart', 'farm'];

export class StoreUnlocks {
    /** Built lazily on first query — the map has to be loaded, which it always is by the time anything spawns. */
    private static gates?: Map<string, StoreGate>;
    private static defaultStorageIds?: Set<string>;
    /** entityId -> "may it exist yet?" from where it's drawn — see registerPlacementGates(). */
    private static readonly placementGates = new Map<string, () => boolean>();

    /** False while `entityId` is listed under a store level that store hasn't reached yet, or sits in a section / store that isn't built / open yet (see registerPlacementGates()). */
    static isEnabled(entityId: string): boolean {
        const gate = this.getGates().get(entityId);
        if (gate && StoreProgressStorage.getLevel(gate.storeId) < gate.level) {
            return false;
        }
        return this.placementGates.get(entityId)?.() ?? true;
    }

    /**
     * Gates every PLACEMENT_GATED_TYPES object by where it's drawn (its center): inside a
     * "storeSection" rect -> until that section is built (level 1, same rule BuildingZone uses);
     * else inside a (non-disabled) store's area -> until that store opens. Call once, before the
     * spawn gates are registered.
     */
    static registerPlacementGates(worldObjects: WorldObjectRegistry): void {
        const sections = worldObjects.getStoreSections();
        const stores = readStoreLayouts().filter(layout => !getStoreConfig(layout.id).disabled);
        for (const type of PLACEMENT_GATED_TYPES) {
            for (const [id, placement] of worldObjects.getAllOfType(type)) {
                const section = sections.find(s => rectContains(s.placement, placement.x, placement.z));
                if (section) {
                    this.placementGates.set(id, () => isSectionBuilt(section.id));
                    console.log(`[StoreUnlocks] ${type} "${id}" waits for section "${section.id}" to be built`);
                    continue;
                }
                const store = stores.find(layout => rectContains(layout.area, placement.x, placement.z));
                if (store) {
                    this.placementGates.set(id, () => StoreProgressStorage.getLevel(store.id) >= 1);
                }
            }
        }
    }

    static isDefaultStorage(storageId: string): boolean {
        this.getGates();
        return this.defaultStorageIds!.has(storageId);
    }

    /** Owned = free (costs nothing — see isStorageForSale() — or a store's default storage) or bought. */
    static isStorageOwned(storageId: string, config: StorageConfig): boolean {
        return !isStorageForSale(config) || this.isDefaultStorage(storageId) || StorageOwnershipStorage.isOwned(storageId);
    }

    /** Usable by clients: not disabled, enabled by its store level (if gated), and owned. */
    static isStorageAvailable(storageId: string, config: StorageConfig): boolean {
        return !config.disabled && this.isEnabled(storageId) && this.isStorageOwned(storageId, config);
    }

    private static getGates(): Map<string, StoreGate> {
        if (this.gates) {
            return this.gates;
        }
        this.gates = new Map();
        this.defaultStorageIds = new Set();

        const add = (entityId: string | undefined, gate: StoreGate): void => {
            if (!entityId) {
                return;
            }
            const existing = this.gates!.get(entityId);
            // Listed more than once — the lowest level wins (the object appears as early as any entry allows).
            if (!existing || gate.level < existing.level) {
                this.gates!.set(entityId, gate);
            }
        };

        for (const layout of readStoreLayouts()) {
            const config = getStoreConfig(layout.id);
            if (config.disabled) {
                continue;
            }
            if (config.defaultStorageId) {
                this.defaultStorageIds.add(config.defaultStorageId);
                add(config.defaultStorageId, { storeId: layout.id, level: 1 });
            }
            for (const entry of config.levels ?? []) {
                for (const enable of entry.enables ?? []) {
                    add(enable.entityId, { storeId: layout.id, level: Math.max(1, entry.level) });
                }
            }
        }

        if (this.gates.size > 0) {
            console.log(`[StoreUnlocks] gated by store level: ${[...this.gates].map(([id, g]) => `${id} (${g.storeId} Lv${g.level})`).join(', ')}`);
        }
        return this.gates;
    }
}

/** A store section is built once its building reaches level 1 — same rule as BuildingZone's own isSectionBuilt(). */
function isSectionBuilt(sectionId: string): boolean {
    return BUILDING_CONFIG[sectionId as BuildingId] !== undefined && BuildingStorage.getLevel(sectionId as BuildingId) >= 1;
}
