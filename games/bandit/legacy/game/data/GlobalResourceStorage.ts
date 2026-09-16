// GlobalResourceStorage.ts
//
// Global, entity-independent BASE STOCKPILE — everything the player has ever
// successfully deposited at the drop zone (see DropZone.ts), as opposed to
// BackpackStorage.ts's counts of what's currently being CARRIED and not yet
// deposited. Same "global game data" static-class shape as BackpackStorage/
// ShopStorage — anything (DropZone when depositing, GlobalResourcesUI when
// rendering) reads/writes the SAME state with no player-entity reference
// needed. Observable via onChange (a Signal, same convention as
// BackpackStorage.onChange) — GlobalResourcesUI subscribes once and updates
// only the row whose resource actually changed, instead of polling.
//
// Persisted via PlatformHandler (see ShopStorage.ts/HighScoreStorage.ts for
// the same pattern) — load() must be awaited once at boot (see index.ts),
// before anything reads getCount()/getAll(). Every add() fires off an async
// persist() (fire-and-forget from the caller's perspective — DropZone
// doesn't need to await it, same as ShopStorage.equip()) so a deposit
// survives a reload without the caller ever blocking on it.
//
// Only ever GROWS in normal play — there's no removeOne()/drainAll() here,
// since nothing in the game currently spends from the base stockpile. Add
// withdrawal methods here first if that ever changes; nothing else would
// need to. clearAll() exists purely as a debug/dev reset (see the
// DevGuiManager button wired up in PizzaScene.ts) and IS awaited by that
// caller, since a debug "clear my data" action should actually confirm the
// wipe hit storage before reporting done.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ResourceType } from '../actions/ResourceTypes';

const STORAGE_KEY = 'PIZZA_GLOBAL_RESOURCES';

export class GlobalResourceStorage {
    private static readonly counts = new Map<ResourceType, number>();

    /** Fires with the resource type whose count just changed — see this file's own doc. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getCount()/getAll(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Partial<Record<ResourceType, number>> = raw ? JSON.parse(raw) : {};
            for (const [type, amount] of Object.entries(parsed)) {
                if (typeof amount === 'number' && amount > 0) {
                    this.counts.set(type as ResourceType, amount);
                }
            }
        } catch (e) {
            console.error('GlobalResourceStorage: failed to load save data', e);
        }
    }

    static getCount(type: ResourceType): number {
        return this.counts.get(type) ?? 0;
    }

    /** Snapshot of every currently-nonzero count — see GlobalResourcesUI's constructor. */
    static getAll(): Map<ResourceType, number> {
        return new Map(this.counts);
    }

    /** Adds `amount` to the base stockpile and persists — see DropZone.ts, called once per unit as it lands, alongside BackpackStorage.removeOne() for that same unit. */
    static add(type: ResourceType, amount: number): void {
        if (amount <= 0) {
            return;
        }

        this.counts.set(type, this.getCount(type) + amount);
        this.onChange.dispatch(type);
        void this.persist();
    }

    private static async persist(): Promise<void> {
        const data: Partial<Record<ResourceType, number>> = Object.fromEntries(this.counts);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — wipes every count back to empty, notifies subscribers, and removes the persisted save entirely. See the "Clear Global Resources" DevGuiManager button in PizzaScene.ts. */
    static async clearAll(): Promise<void> {
        for (const type of this.counts.keys()) {
            this.counts.set(type, 0);
            this.onChange.dispatch(type);
        }
        this.counts.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
