// StorageOwnershipStorage.ts
//
// Which priced storages (see StorageConfig.price) the player has bought,
// plus coin progress toward the ones still for sale — same shape as
// FarmPlotStorage.ts (owned ids + partial progress), same static-class +
// PlatformHandler persistence. load() must be awaited once at boot (see
// index.ts) since PizzaScene.setupStorages() reads it while building.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_STORAGE_OWNERSHIP';

export class StorageOwnershipStorage {
    private static readonly ownedIds = new Set<string>();
    private static readonly progress = new Map<string, number>();

    /** Fires with the storage id the moment it's bought. */
    static readonly onPurchase: Signal = new Signal();
    /** Fires with the storage id whenever its coin progress changes. */
    static readonly onProgressChanged: Signal = new Signal();

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: { owned?: string[]; progress?: Record<string, number> } = raw ? JSON.parse(raw) : {};
            for (const id of parsed.owned ?? []) {
                this.ownedIds.add(id);
            }
            for (const [id, amount] of Object.entries(parsed.progress ?? {})) {
                if (typeof amount === 'number' && amount > 0) {
                    this.progress.set(id, amount);
                }
            }
        } catch (e) {
            console.error('StorageOwnershipStorage: failed to load save data', e);
        }
    }

    static isOwned(id: string): boolean {
        return this.ownedIds.has(id);
    }

    static getProgress(id: string): number {
        return this.progress.get(id) ?? 0;
    }

    /** Adds coin progress toward `price` — returns true (and marks it owned) once fully paid. */
    static addProgress(id: string, price: number, amount: number): boolean {
        if (this.ownedIds.has(id)) {
            return true;
        }
        const total = this.getProgress(id) + amount;
        if (total >= price) {
            this.progress.delete(id);
            this.ownedIds.add(id);
            void this.persist();
            this.onProgressChanged.dispatch(id);
            this.onPurchase.dispatch(id);
            return true;
        }
        this.progress.set(id, total);
        void this.persist();
        this.onProgressChanged.dispatch(id);
        return false;
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.ownedIds.clear();
        this.progress.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify({
            owned: [...this.ownedIds],
            progress: Object.fromEntries(this.progress),
        }));
    }
}
