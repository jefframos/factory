// BackpackCapacityStorage.ts
//
// The player's carry-stack capacity UPGRADE level — how many farm items
// (see CarryStack.ts) the backpack can hold at once. Level 0 is
// PlayerConfig.backpack.capacity.base (3 by default); each level adds
// `perLevel`, up to `maxLevel`. Same static-class + PlatformHandler
// persistence shape as BackpackUnlockStorage.ts.
//
// Only the LEVEL is persisted — the actual numbers come from PlayerConfig, so
// retuning base/perLevel in the web editor applies to existing saves too.
// upgrade() is the one entry point anything that sells/awards a backpack
// upgrade should call (today: the dev GUI's Backpack folder).
//
// load() must be awaited once at boot (see index.ts), before anything reads
// getCapacity().

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getPlayerConfig } from './PlayerConfig';

const STORAGE_KEY = 'PIZZA_BACKPACK_CAPACITY_LEVEL';
/** Used if PlayerConfig.backpack.capacity is missing (e.g. a hand-edited PLAYER_CONFIG_BY_ID.default whose `backpack` object predates the field — that object REPLACES the default's wholesale). */
const FALLBACK_CAPACITY = { base: 3, perLevel: 1, maxLevel: 12 };

function capacityConfig(): { base: number; perLevel: number; maxLevel: number } {
    return getPlayerConfig().backpack.capacity ?? FALLBACK_CAPACITY;
}

export class BackpackCapacityStorage {
    private static level = 0;

    /** Fires (with the new capacity) whenever the level changes. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed = raw ? Number(JSON.parse(raw)) : 0;
            this.level = Number.isFinite(parsed) ? this.clampLevel(parsed) : 0;
        } catch (e) {
            console.error('BackpackCapacityStorage: failed to load save data', e);
        }
    }

    static getLevel(): number {
        return this.level;
    }

    static getMaxLevel(): number {
        return capacityConfig().maxLevel;
    }

    static isMaxed(): boolean {
        return this.level >= this.getMaxLevel();
    }

    /** How many farm items the backpack holds at the current level — see this file's own doc. */
    static getCapacity(): number {
        const { base, perLevel } = capacityConfig();
        return base + this.level * perLevel;
    }

    /** +1 level. Returns false (and changes nothing) if already maxed. */
    static upgrade(): boolean {
        if (this.isMaxed()) {
            return false;
        }
        this.level++;
        void this.persist();
        this.onChange.dispatch(this.getCapacity());
        return true;
    }

    /** Debug/dev reset — same convention as every other *Storage.ts's own clearAll(). */
    static async clearAll(): Promise<void> {
        this.level = 0;
        this.onChange.dispatch(this.getCapacity());
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }

    private static clampLevel(level: number): number {
        return Math.max(0, Math.min(Math.floor(level), this.getMaxLevel()));
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(this.level));
    }
}
