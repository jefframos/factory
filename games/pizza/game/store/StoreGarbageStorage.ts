// StoreGarbageStorage.ts
//
// Garbage lying on each store's floor — store id -> SavedGarbage[] (what it
// was, and where). A dirty store stays dirty after a reload (and keeps
// putting clients off — see StoreConfig.maxGarbage). Same static-class +
// PlatformHandler shape as StoreMoneyStorage.ts, including its lazy,
// idempotent load() (called by Store.ts).

import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';

const STORAGE_KEY = 'PIZZA_STORE_GARBAGE';

export interface SavedGarbage {
    /** The item it was — drawn darkened as that item (see StoreGarbage.ts); picked up as ResourceType.Garbage. */
    type: ResourceType;
    x: number;
    z: number;
    /** Yaw, radians — so a reload doesn't reshuffle the mess. */
    yaw: number;
}

export class StoreGarbageStorage {
    private static readonly garbage = new Map<string, SavedGarbage[]>();
    private static loading?: Promise<void>;
    private static loaded = false;

    static load(): Promise<void> {
        this.loading ??= (async () => {
            try {
                const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
                const parsed: Record<string, SavedGarbage[]> = raw ? JSON.parse(raw) : {};
                for (const [storeId, list] of Object.entries(parsed)) {
                    if (Array.isArray(list) && list.length > 0) {
                        this.garbage.set(storeId, list);
                    }
                }
            } catch (e) {
                console.error('StoreGarbageStorage: failed to load save data', e);
            }
            this.loaded = true;
        })();
        return this.loading;
    }

    static isLoaded(): boolean {
        return this.loaded;
    }

    static get(storeId: string): readonly SavedGarbage[] {
        return this.garbage.get(storeId) ?? [];
    }

    /** Replaces one store's whole list. */
    static set(storeId: string, list: SavedGarbage[]): void {
        if (list.length > 0) {
            this.garbage.set(storeId, list);
        } else if (!this.garbage.delete(storeId)) {
            return;
        }
        void this.persist();
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.garbage.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.garbage)));
    }
}
