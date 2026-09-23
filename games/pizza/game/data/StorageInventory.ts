// StorageInventory.ts
//
// What every map storage (see StorageTypes.ts / StorageZone.ts) currently
// holds — storage id -> resource type -> count. Same static-class +
// PlatformHandler persistence shape as BackpackStorage.ts; onChange fires with
// the storage id whose contents just changed, so each StorageZone only
// refreshes its own label.
//
// load() must be awaited once at boot (see index.ts), before anything reads it.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';

const STORAGE_KEY = 'PIZZA_STORAGE_INVENTORY';

export class StorageInventory {
    private static readonly contents = new Map<string, Map<ResourceType, number>>();

    /** Fires with the storage id whose contents just changed. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts). Drops any saved resource type that no longer exists, same as BackpackStorage.load(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Record<string, Partial<Record<string, number>>> = raw ? JSON.parse(raw) : {};
            const validTypes: ReadonlySet<string> = new Set(Object.values(ResourceType));
            for (const [storageId, counts] of Object.entries(parsed)) {
                const map = new Map<ResourceType, number>();
                for (const [type, amount] of Object.entries(counts)) {
                    if (validTypes.has(type) && typeof amount === 'number' && amount > 0) {
                        map.set(type as ResourceType, amount);
                    }
                }
                this.contents.set(storageId, map);
            }
        } catch (e) {
            console.error('StorageInventory: failed to load save data', e);
        }
    }

    static getCount(storageId: string, type: ResourceType): number {
        return this.contents.get(storageId)?.get(type) ?? 0;
    }

    /** Snapshot of one storage's non-zero counts. */
    static getAll(storageId: string): Map<ResourceType, number> {
        return new Map(this.contents.get(storageId) ?? []);
    }

    static getTotal(storageId: string): number {
        let total = 0;
        for (const amount of this.contents.get(storageId)?.values() ?? []) {
            total += amount;
        }
        return total;
    }

    static add(storageId: string, type: ResourceType, amount: number): void {
        let map = this.contents.get(storageId);
        if (!map) {
            map = new Map();
            this.contents.set(storageId, map);
        }
        map.set(type, (map.get(type) ?? 0) + amount);
        void this.persist();
        this.onChange.dispatch(storageId);
    }

    /** Removes up to `amount` — returns how many were actually removed. For whatever later consumes stored items (nothing does yet). */
    static remove(storageId: string, type: ResourceType, amount: number): number {
        const map = this.contents.get(storageId);
        const have = map?.get(type) ?? 0;
        const removed = Math.min(have, amount);
        if (!map || removed <= 0) {
            return 0;
        }
        if (have - removed > 0) {
            map.set(type, have - removed);
        } else {
            map.delete(type);
        }
        void this.persist();
        this.onChange.dispatch(storageId);
        return removed;
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        const ids = [...this.contents.keys()];
        this.contents.clear();
        ids.forEach(id => this.onChange.dispatch(id));
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        const data: Record<string, Partial<Record<ResourceType, number>>> = {};
        for (const [storageId, map] of this.contents) {
            data[storageId] = Object.fromEntries(map);
        }
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }
}
