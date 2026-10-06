// StoreProgressStorage.ts
//
// Each store's level plus its progress toward the next one — store id ->
// { level, money, sales }. `money`/`sales` count only since the last level
// up (they reset on each one). Level 0 = closed (starter not built yet, and
// no StoreConfig.openRequirement met), level 1 = open. See StoreTypes.ts's
// StoreLevelConfig for the ladder. `totalMoney`/`totalSales` never reset —
// lifetime counters behind MilestoneRequirement's 'storeSales' kind (e.g.
// "zone 2 opens after the store's first sale").
//
// onLevelChanged is what makes level-gated map objects appear (see
// StoreUnlocks.ts / RequirementRegistry). Same static-class +
// PlatformHandler shape as StorageInventory.ts; load() must be awaited once
// at boot (see index.ts) since spawn gating reads it while the scene builds.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { StoreConfig, getNextStoreLevel } from './StoreTypes';

const STORAGE_KEY = 'PIZZA_STORE_PROGRESS';

interface StoreProgress {
    level: number;
    money: number;
    sales: number;
    /** Lifetime — never reset on a level-up. */
    totalMoney: number;
    totalSales: number;
}

export class StoreProgressStorage {
    private static readonly states = new Map<string, StoreProgress>();

    /** Fires with (storeId, newLevel). */
    static readonly onLevelChanged: Signal = new Signal();
    /** Fires with the store id whenever money/sales progress changes. */
    static readonly onProgressChanged: Signal = new Signal();

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Record<string, Partial<StoreProgress>> = raw ? JSON.parse(raw) : {};
            for (const [storeId, state] of Object.entries(parsed)) {
                const level = Math.max(0, Math.floor(state.level ?? 0));
                const money = Math.max(0, state.money ?? 0);
                const sales = Math.max(0, state.sales ?? 0);
                this.states.set(storeId, {
                    level,
                    money,
                    sales,
                    // Saves from before the lifetime counters: at least one sale per level-up past 1.
                    totalMoney: Math.max(money, state.totalMoney ?? 0),
                    totalSales: Math.max(sales + Math.max(0, level - 1), state.totalSales ?? 0),
                });
            }
        } catch (e) {
            console.error('StoreProgressStorage: failed to load save data', e);
        }
    }

    static getLevel(storeId: string): number {
        return this.states.get(storeId)?.level ?? 0;
    }

    static getMoney(storeId: string): number {
        return this.states.get(storeId)?.money ?? 0;
    }

    static getSales(storeId: string): number {
        return this.states.get(storeId)?.sales ?? 0;
    }

    /** Clients who ever paid at this store — never reset (see this file's own doc). */
    static getTotalSales(storeId: string): number {
        return this.states.get(storeId)?.totalSales ?? 0;
    }

    /** Level 0 -> 1, the moment the store opens (starter built, or its openRequirement met). No-op if already open. */
    static open(storeId: string): void {
        const state = this.state(storeId);
        if (state.level >= 1) {
            return;
        }
        state.level = 1;
        state.money = 0;
        state.sales = 0;
        void this.persist();
        this.onLevelChanged.dispatch(storeId, state.level);
    }

    /**
     * A client paid `amount` — counts toward the next level, and levels up (possibly more than
     * once) whenever the next entry's requirement is met. Returns every level reached by this sale.
     */
    static recordSale(storeId: string, config: StoreConfig, amount: number): number[] {
        const state = this.state(storeId);
        if (state.level < 1) {
            return [];
        }
        state.money += amount;
        state.sales += 1;
        state.totalMoney += amount;
        state.totalSales += 1;

        const reached: number[] = [];
        let next = getNextStoreLevel(config, state.level);
        while (next && (next.requirementType === 'sales' ? state.sales : state.money) >= next.amount) {
            state.level = next.level;
            state.money = 0;
            state.sales = 0;
            reached.push(next.level);
            next = getNextStoreLevel(config, state.level);
        }

        void this.persist();
        this.onProgressChanged.dispatch(storeId);
        for (const level of reached) {
            this.onLevelChanged.dispatch(storeId, level);
        }
        return reached;
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        const ids = [...this.states.keys()];
        this.states.clear();
        ids.forEach(id => this.onLevelChanged.dispatch(id, 0));
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static state(storeId: string): StoreProgress {
        let state = this.states.get(storeId);
        if (!state) {
            state = { level: 0, money: 0, sales: 0, totalMoney: 0, totalSales: 0 };
            this.states.set(storeId, state);
        }
        return state;
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.states)));
    }
}
