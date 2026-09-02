// BackpackStorage.ts
//
// Global, entity-independent backpack — replaces the old per-entity
// BackpackComponent. "Global game data" the same way ShopStorage/
// HighScoreStorage are: a static class, not something living on MainPlayer,
// so anything (AutoGatherController when gathering, DropZone when
// depositing, BackpackUI when rendering) reads/writes the SAME state without
// needing a reference to the player entity. Observable via onChange (a
// Signal, same convention as ShopStorage.onEquipChanged) — BackpackUI
// subscribes once and updates only the slot whose resource actually
// changed, instead of polling every frame.
//
// Persisted via PlatformHandler (see ShopStorage.ts/GlobalResourceStorage.ts
// for the same pattern) — load() must be awaited once at boot (see
// index.ts), before anything reads getCount()/getAll(). Carrying resources
// across a reload matters just as much as the base stockpile does: without
// this, quitting mid-gather (backpack non-empty, not yet at the drop zone)
// would silently erase whatever hadn't been deposited yet. Every mutation
// fires off an async persist() (fire-and-forget from the caller's
// perspective — AutoGatherController/DropZone don't need to await it) so
// gathering/depositing never blocks on storage I/O.
//
// No per-type cap for now (removed — re-add one here first if a cap comes
// back later; nothing else needs to change). removeOne() is what DropZone
// calls per-unit as resources fly out to the drop zone over time (see
// DropZone.ts) — depositing is gradual, not an instant drainAll().

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';

const STORAGE_KEY = 'PIZZA_BACKPACK';

export class BackpackStorage {
    private static readonly counts = new Map<ResourceType, number>();

    /** Fires with the resource type whose count just changed — see this file's own doc. */
    static readonly onChange: Signal = new Signal();

    /**
     * Call once at boot (see index.ts), before anything reads getCount()/getAll().
     *
     * Drops any persisted key that isn't a CURRENT ResourceType — a save written before a
     * ResourceType gets renamed/removed (e.g. WoodLog -> Bark) would otherwise load that old
     * string in as if it were still valid, and every later reader (BackpackUI, RESOURCE_CONFIG
     * lookups, resolveResourceAssetKey()/ASSET_LIBRARY) assumes every key here IS one of the current
     * enum's values — one stale key was enough to crash BackpackUI's very first render (see
     * getAssetIcon()'s own doc), taking the whole scene build down with it.
     */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Partial<Record<ResourceType, number>> = raw ? JSON.parse(raw) : {};
            const validTypes: ReadonlySet<string> = new Set(Object.values(ResourceType));
            for (const [type, amount] of Object.entries(parsed)) {
                if (!validTypes.has(type)) {
                    console.warn(`BackpackStorage: dropping stale/unknown resource type "${type}" from save data`);
                    continue;
                }
                if (typeof amount === 'number' && amount > 0) {
                    this.counts.set(type as ResourceType, amount);
                }
            }
        } catch (e) {
            console.error('BackpackStorage: failed to load save data', e);
        }
    }

    static getCount(type: ResourceType): number {
        return this.counts.get(type) ?? 0;
    }

    /** Snapshot of every currently-nonzero count — see DropZone.tryDeposit(). */
    static getAll(): Map<ResourceType, number> {
        return new Map(this.counts);
    }

    /** Adds `amount` — returns it unchanged (no cap right now, see this file's own doc); kept as a return value so callers don't need to change if a cap comes back. */
    static add(type: ResourceType, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        this.counts.set(type, this.getCount(type) + amount);
        this.onChange.dispatch(type);
        void this.persist();
        return amount;
    }

    /** Removes exactly one, if any remain — see DropZone.ts's per-chip drain. Returns false (no-op) once already at 0. */
    static removeOne(type: ResourceType): boolean {
        const current = this.getCount(type);
        if (current <= 0) {
            return false;
        }

        this.counts.set(type, current - 1);
        this.onChange.dispatch(type);
        void this.persist();
        return true;
    }

    /** Removes exactly `amount`, only if at least that many are currently held — otherwise a no-op returning false, same all-or-nothing semantics CraftingTablePopup.ts needs when consuming a recipe's own multi-ingredient list (never partially deduct one ingredient if a later one turns out short). */
    static remove(type: ResourceType, amount: number): boolean {
        const current = this.getCount(type);
        if (amount <= 0 || current < amount) {
            return false;
        }

        this.counts.set(type, current - amount);
        this.onChange.dispatch(type);
        void this.persist();
        return true;
    }

    /** Empties everything at once and returns what it held — see DropZone.tryDeposit()'s fallback for when there's no loaded backpack cube to animate a gradual drain from (e.g. the FBX character hasn't finished loading yet). Prefer removeOne() for the normal animated path. */
    static drainAll(): Map<ResourceType, number> {
        const drained = this.getAll();
        void this.clearAll();
        return drained;
    }

    private static async persist(): Promise<void> {
        const data: Partial<Record<ResourceType, number>> = Object.fromEntries(this.counts);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset (and drainAll()'s own instant-clear path) — wipes every count back to empty, notifies subscribers, and removes the persisted save entirely. See the "Clear Backpack" DevGuiManager button in PizzaScene.ts. */
    static async clearAll(): Promise<void> {
        for (const type of this.counts.keys()) {
            this.counts.set(type, 0);
            this.onChange.dispatch(type);
        }
        this.counts.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
