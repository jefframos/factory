// StoreUnlocks.ts
//
// Answers "is this map object allowed to exist yet?" for everything a store
// level gates: any id listed in a StoreLevelConfig's `enables` (hidden until
// that store reaches that level), plus a store's `defaultStorageId` (hidden
// until the store opens, level 1). Ids no store mentions are never gated.
//
// RequirementRegistry consults isEnabled() for every spawn gate (buildings,
// queues, farms, shops, marts, crafting tables, storages) and rechecks
// whenever StoreProgressStorage.onLevelChanged fires, so a level-up makes
// its enabled objects appear immediately.
//
// Also owns the "is this storage usable by clients" rule shared by
// PizzaScene.setupStorages() and Store.ts — see isStorageAvailable().

import { StorageConfig, isStorageForSale } from '../data/StorageTypes';
import { readStoreLayouts } from './StoreLayout';
import { StoreProgressStorage } from './StoreProgressStorage';
import { StorageOwnershipStorage } from './StorageOwnershipStorage';
import { getStoreConfig } from './StoreTypes';

interface StoreGate {
    storeId: string;
    level: number;
}

export class StoreUnlocks {
    /** Built lazily on first query — the map has to be loaded, which it always is by the time anything spawns. */
    private static gates?: Map<string, StoreGate>;
    private static defaultStorageIds?: Set<string>;

    /** False while `entityId` is listed under a store level that store hasn't reached yet. */
    static isEnabled(entityId: string): boolean {
        const gate = this.getGates().get(entityId);
        return !gate || StoreProgressStorage.getLevel(gate.storeId) >= gate.level;
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
