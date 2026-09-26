// StoreMoneyStorage.ts
//
// Money clients have paid that's still lying on each store's money drop,
// waiting for the player to collect it — store id -> amount. Persisted so a
// reload doesn't lose uncollected money. Same static-class + PlatformHandler
// shape as StorageInventory.ts, except load() is called lazily by Store.ts
// (idempotent) so this feature needs no boot-time wiring in index.ts.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_STORE_MONEY';

export class StoreMoneyStorage {
    private static readonly amounts = new Map<string, number>();
    private static loading?: Promise<void>;

    /** Fires with the store id whose pile just changed. */
    static readonly onChange: Signal = new Signal();

    static load(): Promise<void> {
        this.loading ??= (async () => {
            try {
                const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
                const parsed: Record<string, number> = raw ? JSON.parse(raw) : {};
                for (const [storeId, amount] of Object.entries(parsed)) {
                    if (typeof amount === 'number' && amount > 0) {
                        // Added on top — anything paid before the load resolved is kept.
                        this.amounts.set(storeId, (this.amounts.get(storeId) ?? 0) + amount);
                        this.onChange.dispatch(storeId);
                    }
                }
            } catch (e) {
                console.error('StoreMoneyStorage: failed to load save data', e);
            }
        })();
        return this.loading;
    }

    static get(storeId: string): number {
        return this.amounts.get(storeId) ?? 0;
    }

    static add(storeId: string, amount: number): void {
        if (amount <= 0) {
            return;
        }
        this.amounts.set(storeId, this.get(storeId) + amount);
        void this.persist();
        this.onChange.dispatch(storeId);
    }

    /** Empties the pile and returns what was on it. */
    static takeAll(storeId: string): number {
        const amount = this.get(storeId);
        if (amount <= 0) {
            return 0;
        }
        this.amounts.delete(storeId);
        void this.persist();
        this.onChange.dispatch(storeId);
        return amount;
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        const ids = [...this.amounts.keys()];
        this.amounts.clear();
        ids.forEach(id => this.onChange.dispatch(id));
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.amounts)));
    }
}
