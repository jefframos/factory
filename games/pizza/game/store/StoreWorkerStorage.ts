// StoreWorkerStorage.ts
//
// Each store's WORKER ROSTER — store id -> SavedStoreWorker[] (id, role,
// level, plus whatever a restocker is carrying right now). Seeded from the
// store's StoreConfig.workers the first time it opens (see Store.ts's
// restoreWorkers()); from then on this save is the source of truth, so a
// store upgrade later is just setLevel() — Store listens to onChange and
// hands the live worker its new stats.
//
// Same static-class + PlatformHandler shape as StoreMoneyStorage.ts,
// including its lazy, idempotent load() (called by Store.ts).

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';
import type { StoreWorkerRole } from './StoreTypes';

const STORAGE_KEY = 'PIZZA_STORE_WORKERS';

export interface SavedWorkerCarry {
    type: ResourceType;
    amount: number;
}

export interface SavedStoreWorker {
    id: string;
    role: StoreWorkerRole;
    level: number;
    /** Restocker only: items on its back (harvested, not delivered yet) — delivered after a reload instead of lost. */
    carried?: SavedWorkerCarry[];
}

export class StoreWorkerStorage {
    private static readonly rosters = new Map<string, SavedStoreWorker[]>();
    private static loading?: Promise<void>;
    private static loaded = false;

    /** Fires with the store id whenever a worker's level changes (setLevel()). */
    static readonly onLevelChanged: Signal = new Signal();

    static load(): Promise<void> {
        this.loading ??= (async () => {
            try {
                const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
                const parsed: Record<string, SavedStoreWorker[]> = raw ? JSON.parse(raw) : {};
                for (const [storeId, list] of Object.entries(parsed)) {
                    if (Array.isArray(list)) {
                        this.rosters.set(storeId, list);
                    }
                }
            } catch (e) {
                console.error('StoreWorkerStorage: failed to load save data', e);
            }
            this.loaded = true;
        })();
        return this.loading;
    }

    static isLoaded(): boolean {
        return this.loaded;
    }

    /** undefined = this store has never been seeded (see Store.restoreWorkers()). */
    static getRoster(storeId: string): readonly SavedStoreWorker[] | undefined {
        return this.rosters.get(storeId);
    }

    /** Replaces the whole roster for one store. */
    static setRoster(storeId: string, list: SavedStoreWorker[]): void {
        this.rosters.set(storeId, list);
        void this.persist();
    }

    /** Upgrade hook — sets one worker's level. No-op for an unknown worker. */
    static setLevel(storeId: string, workerId: string, level: number): void {
        const worker = this.rosters.get(storeId)?.find(entry => entry.id === workerId);
        if (!worker) {
            return;
        }
        worker.level = Math.max(1, Math.floor(level));
        void this.persist();
        this.onLevelChanged.dispatch(storeId);
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.rosters.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.rosters)));
    }
}
