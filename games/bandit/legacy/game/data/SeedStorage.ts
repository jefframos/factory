// SeedStorage.ts
//
// Global, entity-independent seed bank — same "static class + Signal +
// PlatformHandler persistence" shape as BackpackStorage.ts, just keyed by
// SeedId instead of ResourceType. Kept as its OWN map (not folded into
// BackpackStorage) because a seed and the crop it grows into are two
// independently-held bankable things — see SeedTypes.ts's own doc.
//
// FarmPlotTile.ts's seed-picker popup reads getCount()/getAll() to only
// ever offer a seed the player actually has, and calls removeOne() the
// instant a planting succeeds — same "storage mutates on the action, not
// speculatively" convention BackpackStorage.removeOne()/DropZone use.
//
// load() must be awaited once at boot (see index.ts) before PizzaScene
// spawns any FarmPlotTile — seeds carried across a reload matter the same
// way an unbanked backpack resource does.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { SeedId } from './SeedTypes';

const STORAGE_KEY = 'PIZZA_SEEDS';

export class SeedStorage {
    private static readonly counts = new Map<SeedId, number>();

    /** Fires with the seed id whose count just changed — see this file's own doc. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getCount()/getAll(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Partial<Record<SeedId, number>> = raw ? JSON.parse(raw) : {};
            const validIds: ReadonlySet<string> = new Set(Object.values(SeedId));
            for (const [id, amount] of Object.entries(parsed)) {
                if (!validIds.has(id)) {
                    console.warn(`SeedStorage: dropping stale/unknown seed id "${id}" from save data`);
                    continue;
                }
                if (typeof amount === 'number' && amount > 0) {
                    this.counts.set(id as SeedId, amount);
                }
            }
        } catch (e) {
            console.error('SeedStorage: failed to load save data', e);
        }
    }

    static getCount(id: SeedId): number {
        return this.counts.get(id) ?? 0;
    }

    /** Snapshot of every currently-nonzero count — see FarmPlotTile.ts's seed-picker. */
    static getAll(): Map<SeedId, number> {
        return new Map(this.counts);
    }

    /** Adds `amount` — returns it unchanged, same "no cap, kept as a return value for future-proofing" convention as BackpackStorage.add(). */
    static add(id: SeedId, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        this.counts.set(id, this.getCount(id) + amount);
        this.onChange.dispatch(id);
        void this.persist();
        return amount;
    }

    /** Removes exactly one, if any remain — see FarmPlotTile.tryPlant(). Returns false (no-op) once already at 0. */
    static removeOne(id: SeedId): boolean {
        const current = this.getCount(id);
        if (current <= 0) {
            return false;
        }

        this.counts.set(id, current - 1);
        this.onChange.dispatch(id);
        void this.persist();
        return true;
    }

    private static async persist(): Promise<void> {
        const data: Partial<Record<SeedId, number>> = Object.fromEntries(this.counts);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — wipes every count back to empty, notifies subscribers, and removes the persisted save entirely. */
    static async clearAll(): Promise<void> {
        for (const id of this.counts.keys()) {
            this.counts.set(id, 0);
            this.onChange.dispatch(id);
        }
        this.counts.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
