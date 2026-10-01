// StoreClientStorage.ts
//
// Clients that have already picked up at least one item, per store — store id
// -> SavedStoreClient[]. Picking removes the item from StorageInventory, so a
// reload that dropped these clients would lose those items for good; Store.ts
// saves them (see Store.saveClients()) and respawns them on load, and they
// carry on with the rest of their list / walk to the cashier and pay.
// Clients with nothing picked yet aren't saved — nothing to lose.
//
// Same static-class + PlatformHandler shape as StoreMoneyStorage.ts, including
// its lazy, idempotent load() (called by Store.ts, no boot-time wiring).

import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';
import type { NpcLook } from '../data/NpcTypes';

const STORAGE_KEY = 'PIZZA_STORE_CLIENTS';

export interface SavedStoreClientWant {
    type: ResourceType;
    remaining: number;
    bought: number;
}

export interface SavedStoreClient {
    npcId: string;
    /** Its rolled look — so it looks the same after a reload. Missing in older saves (re-rolled). */
    look?: NpcLook;
    wants: SavedStoreClientWant[];
    moodIndex: number;
    moodStepSec: number;
    x: number;
    z: number;
    exitX: number;
    exitZ: number;
}

export class StoreClientStorage {
    private static readonly clients = new Map<string, SavedStoreClient[]>();
    private static loading?: Promise<void>;
    private static loaded = false;

    static load(): Promise<void> {
        this.loading ??= (async () => {
            try {
                const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
                const parsed: Record<string, SavedStoreClient[]> = raw ? JSON.parse(raw) : {};
                for (const [storeId, list] of Object.entries(parsed)) {
                    if (Array.isArray(list) && list.length > 0) {
                        this.clients.set(storeId, list);
                    }
                }
            } catch (e) {
                console.error('StoreClientStorage: failed to load save data', e);
            }
            this.loaded = true;
        })();
        return this.loading;
    }

    static isLoaded(): boolean {
        return this.loaded;
    }

    static get(storeId: string): readonly SavedStoreClient[] {
        return this.clients.get(storeId) ?? [];
    }

    /** Replaces the whole saved list for one store. */
    static set(storeId: string, list: SavedStoreClient[]): void {
        if (list.length > 0) {
            this.clients.set(storeId, list);
        } else if (!this.clients.delete(storeId)) {
            return;
        }
        void this.persist();
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.clients.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.clients)));
    }
}
