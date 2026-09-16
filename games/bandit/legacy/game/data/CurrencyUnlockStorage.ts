// CurrencyUnlockStorage.ts
//
// Persists which CurrencyType.ts members the player has EVER held a positive balance of — same
// static-class + PlatformHandler persistence shape as BackpackUnlockStorage.ts, just a set of
// currencies instead of a single pair of booleans. Used by EconomyUI.ts to keep the Gem/Energy
// pills out of the topbar until the player's actually earned one of each, same "sticky once
// true" reasoning as that file's own doc: EconomyStorage.spend() can drop a balance back to 0
// (see that method), and a pill that vanished the moment its balance was spent back down would
// read as a bug, not a reveal.
//
// load() must be awaited once at boot (see index.ts), before EconomyUI reads hasEverHeld().

import PlatformHandler from 'core/platforms/PlatformHandler';
import { CurrencyType } from './EconomyTypes';

const STORAGE_KEY = 'PIZZA_CURRENCY_UNLOCK';

export class CurrencyUnlockStorage {
    private static readonly everHeld = new Set<CurrencyType>();

    /** Call once at boot (see index.ts), before anything reads hasEverHeld(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed: string[] = JSON.parse(raw);
            for (const type of parsed) {
                if (Object.values(CurrencyType).includes(type as CurrencyType)) {
                    this.everHeld.add(type as CurrencyType);
                }
            }
        } catch (e) {
            console.error('CurrencyUnlockStorage: failed to load save data', e);
        }
    }

    static hasEverHeld(type: CurrencyType): boolean {
        return this.everHeld.has(type);
    }

    /** No-op once `type` is already marked (see this file's own doc on why this is sticky) — safe to call on every single balance gain rather than only the first. */
    static markHeld(type: CurrencyType): void {
        if (this.everHeld.has(type)) {
            return;
        }
        this.everHeld.add(type);
        void this.persist();
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.everHeld)));
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.everHeld.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
