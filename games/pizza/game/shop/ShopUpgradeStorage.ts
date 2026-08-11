// ShopUpgradeStorage.ts
//
// Global, entity-independent tool-upgrade progression — same "static class +
// Signal + PlatformHandler persistence" shape as QueueStorage.ts/
// BuildingStorage.ts. Tracks, per shop id: how many levels have been bought
// (`level`, 0 = none yet), how much money has been deposited toward the NEXT
// level's cost (`progress`, drained one coin at a time by ShopZone while the
// player stands in its trigger — same "storage mutates on landing, not on
// departure" convention every other deposit flow here follows), and the
// epoch-ms timestamp the next purchase becomes available at once one
// completes (same cooldown shape as QueueStorage's nextTaskAtEpochMs).
//
// ACTION_CONFIG itself (see ActionTypes.ts) is NOT persisted — it's a plain
// in-memory const mutated live by applyShopLevel() (see ShopTypes.ts). What
// IS persisted here is just `level`, which is what lets reapplyAllShopUpgrades()
// (called once at boot, after load()) replay every already-bought level back
// onto the fresh default ACTION_CONFIG on the next session.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { applyShopLevel, resetAllActionConfigs, SHOP_CONFIG_BY_ID, ShopConfig } from './ShopTypes';

const STORAGE_KEY = 'PIZZA_SHOP_UPGRADES';

interface ShopUpgradeState {
    level: number;
    /** Money deposited toward levels[level]'s cost — reset to 0 whenever a purchase completes. Meaningless once the shop is already maxed out. */
    progress: number;
    /** Epoch ms the next purchase becomes available at — undefined while never on cooldown yet, treated the same as "already passed" (see tryStartDeposit()). */
    nextUpgradeAtEpochMs?: number;
}

function createDefaultState(): ShopUpgradeState {
    return { level: 0, progress: 0 };
}

export class ShopUpgradeStorage {
    private static readonly states = new Map<string, ShopUpgradeState>();

    /** Fires with the shop id whenever ANYTHING about its state changes — progress ticking or a level completing into cooldown, same one-Signal-covers-everything convention as QueueStorage.onTaskChanged. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getState(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Record<string, ShopUpgradeState> = raw ? JSON.parse(raw) : {};
            for (const [id, state] of Object.entries(parsed)) {
                if (state && typeof state.level === 'number' && typeof state.progress === 'number') {
                    this.states.set(id, { level: state.level, progress: state.progress, nextUpgradeAtEpochMs: state.nextUpgradeAtEpochMs });
                }
            }
        } catch (e) {
            console.error('ShopUpgradeStorage: failed to load save data', e);
        }
    }

    /** Replays every already-bought level of every configured shop back onto ACTION_CONFIG — call once at boot, right after load(). ACTION_CONFIG itself starts out at its hand-authored base values every session (it's a plain module-level const, not persisted), so without this a reload would silently forget every previously-purchased upgrade's effect even though `level` itself survived the reload. */
    static reapplyAllShopUpgrades(): void {
        for (const [id, config] of Object.entries(SHOP_CONFIG_BY_ID) as [string, ShopConfig][]) {
            const level = this.getLevel(id);
            for (let i = 0; i < level; i++) {
                applyShopLevel(config, config.levels[i]);
            }
        }
    }

    private static state(id: string): ShopUpgradeState {
        let state = this.states.get(id);
        if (!state) {
            state = createDefaultState();
            this.states.set(id, state);
        }
        return state;
    }

    /** Read-only snapshot of `id`'s current state — ShopZone reads this every frame/on every onChange to decide what its panel should show. */
    static getState(id: string): Readonly<ShopUpgradeState> {
        return this.state(id);
    }

    static getLevel(id: string): number {
        return this.state(id).level;
    }

    static isMaxLevel(id: string, config: ShopConfig): boolean {
        return this.getLevel(id) >= config.levels.length;
    }

    /** True while `id`'s cooldown from its last purchase hasn't elapsed yet — mirrors QueueStorage.tryRollNextTask()'s "never set == already passed" treatment for a shop that's never bought anything. */
    static isOnCooldown(id: string): boolean {
        const state = this.state(id);
        return state.nextUpgradeAtEpochMs !== undefined && Date.now() < state.nextUpgradeAtEpochMs;
    }

    /** Seconds remaining on `id`'s cooldown, floored at 0 — purely for ShopZone's countdown text, see refreshLabel(). */
    static getCooldownRemainingSec(id: string): number {
        const state = this.state(id);
        if (state.nextUpgradeAtEpochMs === undefined) {
            return 0;
        }
        return Math.max(0, Math.ceil((state.nextUpgradeAtEpochMs - Date.now()) / 1000));
    }

    /**
     * Credits `amount` toward `id`'s NEXT level's cost, capped so progress never exceeds it —
     * returns how much was actually accepted (<= amount), same convention as
     * BuildingStorage.addProgress()/QueueStorage.addProgress(). No-ops (returns 0) if the shop
     * is already maxed out.
     */
    static addProgress(id: string, config: ShopConfig, amount: number): number {
        if (amount <= 0 || this.isMaxLevel(id, config)) {
            return 0;
        }

        const state = this.state(id);
        const cost = config.levels[state.level].cost;
        const accepted = Math.min(amount, cost - state.progress);
        if (accepted <= 0) {
            return 0;
        }

        state.progress += accepted;
        this.onChange.dispatch(id);
        void this.persist();
        return accepted;
    }

    /**
     * Completes `id`'s next level once its full cost has been deposited — bumps `level`,
     * resets progress, starts the cooldown, and applies the just-bought level's ActionConfig
     * changes live (see applyShopLevel()). Returns the just-bought level (undefined if it
     * isn't actually fully funded yet or the shop is maxed), same "call unconditionally, check
     * the return value" convention as QueueStorage.tryCompleteTask().
     */
    static tryCompleteUpgrade(id: string, config: ShopConfig) {
        if (this.isMaxLevel(id, config)) {
            return undefined;
        }

        const state = this.state(id);
        const level = config.levels[state.level];
        if (state.progress < level.cost) {
            return undefined;
        }

        state.level += 1;
        state.progress = 0;
        state.nextUpgradeAtEpochMs = Date.now() + level.cooldownSec * 1000;
        applyShopLevel(config, level);
        this.onChange.dispatch(id);
        void this.persist();
        return level;
    }

    private static async persist(): Promise<void> {
        const data: Record<string, ShopUpgradeState> = Object.fromEntries(this.states);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /**
     * Debug/dev reset — wipes every shop's level/progress/cooldown, notifies subscribers, and
     * removes the persisted save entirely. UNLIKE every other *Storage.clearAll() here (which
     * only ever wipes ITS OWN save data), this ALSO resets ACTION_CONFIG's live values back to
     * their hand-authored defaults (see resetAllActionConfigs()) — a shop's `level` is
     * meaningless as a UI number unless the actual gameplay numbers it controls come back down
     * with it.
     */
    static async clearAll(): Promise<void> {
        for (const id of this.states.keys()) {
            this.states.set(id, createDefaultState());
            this.onChange.dispatch(id);
        }
        this.states.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
        resetAllActionConfigs();
    }
}
