// ItemStorage.ts
//
// Global, entity-independent crafted-item inventory — same "static class +
// Signal + PlatformHandler persistence" shape as BackpackStorage, but for
// ItemType (crafted goods: axe, pickaxe, ...) rather than ResourceType
// (gathered raw materials). Kept as its own storage instead of folding into
// BackpackStorage since items and resources are conceptually different
// buckets (backpack = what CraftZone/BuildingZone consume, items = what
// crafting produces and the player equips/holds) even though the persistence
// shape is identical.
//
// Seeds DEFAULT_STARTING_ITEMS the very first time this ever loads (raw ===
// null, i.e. no save key has EVER been written) — see load(). Computed from
// ToolRegistry.ts's own per-tool `startWith` flag (see that field's own
// doc) rather than hand-typed here — checking "Start With" on a tool in the
// web editor's Tools tab is the entire way to grant it from a fresh save,
// no ItemStorage.ts edit needed. Empty by default (every tool before that
// flag existed): a brand new player starts with NO tools at all — see
// CraftTypes.ts's "craftAxe" table (bark -> axe) and GateTypes.ts's
// GateId.GateAxe, which together are the very first thing the player has
// to do to progress at all, UNLESS a tool's own startWith flag short-
// circuits that for whichever ItemType shares its id.
//
// load() must be awaited once at boot (see index.ts) before anything reads
// getCount()/getAll(). Every mutation fires an async persist() (fire-and-
// forget, same convention as BackpackStorage) so a craft's completion never
// blocks on storage I/O.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ItemType, ITEM_CONFIG } from './ItemTypes';
import { toolStartsWithPlayer, ToolId } from '../actions/ToolRegistry';

const STORAGE_KEY = 'PIZZA_ITEMS';

/** One of whichever ItemType's own ItemConfig.toolId points at a TOOL_LIBRARY entry with `startWith` checked — see this file's own top doc and ToolVisualEntry.startWith's own doc. Computed once, at module load (TOOL_LIBRARY is compile-time data, never changes at runtime), not re-derived per call. */
function computeDefaultStartingItems(): Partial<Record<ItemType, number>> {
    const defaults: Partial<Record<ItemType, number>> = {};
    for (const type of Object.values(ItemType)) {
        if (toolStartsWithPlayer(ITEM_CONFIG[type].toolId)) {
            defaults[type] = 1;
        }
    }
    return defaults;
}

/** What a brand new save starts with — see load()'s own doc and computeDefaultStartingItems() for how this is actually derived. */
const DEFAULT_STARTING_ITEMS: Partial<Record<ItemType, number>> = computeDefaultStartingItems();

export class ItemStorage {
    private static readonly counts = new Map<ItemType, number>();

    /** Fires with the item type whose count just changed. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getCount()/getAll(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (raw === null) {
                for (const [type, amount] of Object.entries(DEFAULT_STARTING_ITEMS)) {
                    this.counts.set(type as ItemType, amount as number);
                }
                void this.persist();
                return;
            }

            const parsed: Partial<Record<ItemType, number>> = JSON.parse(raw);
            for (const [type, amount] of Object.entries(parsed)) {
                if (typeof amount === 'number' && amount > 0) {
                    this.counts.set(type as ItemType, amount);
                }
            }
        } catch (e) {
            console.error('ItemStorage: failed to load save data', e);
        }
    }

    static getCount(type: ItemType): number {
        return this.counts.get(type) ?? 0;
    }

    static hasCount(type: ItemType, amount: number): boolean {
        return this.getCount(type) >= amount;
    }

    /** True if the player owns at least one item whose ItemConfig.toolId is `toolId` — the "does the player have a shovel" check (e.g. FarmPlotConfig.requiredTool), going through ITEM_CONFIG's item->tool join rather than assuming item and tool ids match. */
    static hasTool(toolId: ToolId): boolean {
        for (const type of Object.values(ItemType)) {
            if (ITEM_CONFIG[type].toolId === toolId && this.getCount(type) > 0) {
                return true;
            }
        }
        return false;
    }

    /** True once the player owns at least one of ANY item type — removeOne() can leave a zeroed-out entry in `counts` (see that method's own doc), so this checks values rather than just Map.size. Used to gate the backpack icon's first-ever appearance (see BackpackUnlockStorage.ts). */
    static hasAny(): boolean {
        for (const amount of this.counts.values()) {
            if (amount > 0) {
                return true;
            }
        }
        return false;
    }

    /** Snapshot of every currently-nonzero count. */
    static getAll(): Map<ItemType, number> {
        return new Map(this.counts);
    }

    static add(type: ItemType, amount: number): number {
        if (amount <= 0) {
            return 0;
        }

        this.counts.set(type, this.getCount(type) + amount);
        this.onChange.dispatch(type);
        void this.persist();
        return amount;
    }

    /** Removes exactly one, if any remain. Returns false (no-op) once already at 0. */
    static removeOne(type: ItemType): boolean {
        const current = this.getCount(type);
        if (current <= 0) {
            return false;
        }

        this.counts.set(type, current - 1);
        this.onChange.dispatch(type);
        void this.persist();
        return true;
    }

    private static async persist(): Promise<void> {
        const data: Partial<Record<ItemType, number>> = Object.fromEntries(this.counts);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — wipes every count back to empty (NOT re-seeded with defaults; see resetToDefaults() for that), notifies subscribers, and removes the persisted save entirely. */
    static async clearAll(): Promise<void> {
        for (const type of this.counts.keys()) {
            this.counts.set(type, 0);
            this.onChange.dispatch(type);
        }
        this.counts.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    /**
     * "Clear Data"'s actual reset — wipes every count AND re-seeds DEFAULT_STARTING_ITEMS, same
     * starting state a brand-new save gets from load() (see that method's own doc). Plain
     * clearAll() alone (see PizzaScene's dev-GUI "Reset Everything" button) would leave the
     * player with NO tools at all rather than "back to just an axe" — this is what the wider
     * reset flow actually calls to put the player back at a genuinely fresh start.
     */
    static async resetToDefaults(): Promise<void> {
        this.counts.clear();
        for (const [type, amount] of Object.entries(DEFAULT_STARTING_ITEMS)) {
            this.counts.set(type as ItemType, amount as number);
        }
        for (const type of Object.values(ItemType)) {
            this.onChange.dispatch(type);
        }
        await this.persist();
    }
}
