// EconomyStorage.ts
//
// Global, entity-independent currency balances — same "static class + Signal
// + PlatformHandler persistence" shape as GlobalResourceStorage.ts (a
// Map<KeyType, number> plus one onChange Signal). Money (see EconomyTypes.ts)
// is credited by QueueZone on task completion; nothing spends yet, but
// spend() exists alongside add() from the start since a shop/purchase flow
// is the obvious next consumer and costs nothing to have ready now.
//
// load() must be awaited once at boot (see index.ts) before anything reads
// getBalance()/getAll(). Every mutation fires an async persist()
// (fire-and-forget, same convention as every other *Storage.ts here) so a
// queue reward never blocks on storage I/O.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { CurrencyType } from './EconomyTypes';

const STORAGE_KEY = 'PIZZA_ECONOMY';

export class EconomyStorage {
    private static readonly balances = new Map<CurrencyType, number>();

    /** Fires with the currency type whose balance just changed — see this file's own doc. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getBalance()/getAll(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Partial<Record<CurrencyType, number>> = raw ? JSON.parse(raw) : {};
            for (const [type, amount] of Object.entries(parsed)) {
                if (typeof amount === 'number' && amount > 0) {
                    this.balances.set(type as CurrencyType, amount);
                }
            }
        } catch (e) {
            console.error('EconomyStorage: failed to load save data', e);
        }
    }

    static getBalance(type: CurrencyType): number {
        return this.balances.get(type) ?? 0;
    }

    /** Snapshot of every currently-nonzero balance — see EconomyUI's constructor. */
    static getAll(): Map<CurrencyType, number> {
        return new Map(this.balances);
    }

    /** Credits `amount` to `type` and persists — see QueueZone, once per completed task. */
    static add(type: CurrencyType, amount: number): void {
        if (amount <= 0) {
            return;
        }

        this.balances.set(type, this.getBalance(type) + amount);
        this.onChange.dispatch(type);
        void this.persist();
    }

    /** Debits `amount` from `type` if (and only if) the balance can cover it — returns whether it did, so a caller (a future shop purchase) can just check the return value rather than reading the balance separately first. */
    static spend(type: CurrencyType, amount: number): boolean {
        if (amount <= 0) {
            return true;
        }

        const current = this.getBalance(type);
        if (current < amount) {
            return false;
        }

        this.balances.set(type, current - amount);
        this.onChange.dispatch(type);
        void this.persist();
        return true;
    }

    private static async persist(): Promise<void> {
        const data: Partial<Record<CurrencyType, number>> = Object.fromEntries(this.balances);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — wipes every balance back to empty, notifies subscribers, and removes the persisted save entirely. */
    static async clearAll(): Promise<void> {
        for (const type of this.balances.keys()) {
            this.balances.set(type, 0);
            this.onChange.dispatch(type);
        }
        this.balances.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
