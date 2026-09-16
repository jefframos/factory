// FarmPlotStorage.ts
//
// Global, entity-independent farm-plot purchase progression — same
// "static class + Signal + PlatformHandler persistence" shape as
// ShopUpgradeStorage.ts: tracks, per farm plot id, how much money has been
// deposited toward its own FarmPlotConfig.price (`progress`, drained one
// coin at a time by FarmZone while the player stands in its trigger — same
// continuous "storage mutates on landing, not on departure" flow
// ShopZone/BuildingZone/QueueZone/CraftZone all use for their own deposits)
// and whether it's been fully paid off yet (`ownedIds`) — a plot purchase
// is a one-shot completion (no upgrade LADDER the way a shop has, so no
// `level`/cooldown fields exist here at all, unlike ShopUpgradeStorage).
//
// load() must be awaited once at boot (see index.ts) before PizzaScene
// spawns any FarmZone/FarmPlotTile — a plot bought (or partway paid) last
// session has to come back exactly as it was left, not reset to empty.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { FarmPlotConfig } from './FarmTypes';

const STORAGE_KEY = 'PIZZA_FARMS';

interface FarmPlotSaveData {
    ownedIds: string[];
    /** Money deposited so far toward a NOT-YET-owned plot's price — meaningless (and never read) once that id is in `ownedIds`. */
    progress: Record<string, number>;
}

export class FarmPlotStorage {
    private static readonly ownedIds = new Set<string>();
    private static readonly progress = new Map<string, number>();

    /** Fires with the farm id that just got fully paid off — see FarmZone.tryCompletePurchase(). */
    static readonly onPurchase: Signal = new Signal();
    /** Fires with the farm id whenever its deposit progress changes (but hasn't completed the purchase yet) — see FarmZone.refreshLabel(), the one thing that redraws the price/progress panel off this. */
    static readonly onProgressChanged: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads isOwned()/getProgress(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw);
            for (const id of (parsed.ownedIds ?? []) as string[]) {
                this.ownedIds.add(id);
            }
            for (const [id, amount] of Object.entries((parsed.progress ?? {}) as Record<string, number>)) {
                if (typeof amount === 'number' && amount > 0) {
                    this.progress.set(id, amount);
                }
            }
        } catch (e) {
            console.error('FarmPlotStorage: failed to load save data', e);
        }
    }

    static isOwned(id: string): boolean {
        return this.ownedIds.has(id);
    }

    /** How much money has been deposited so far toward `id`'s own price — 0 for a plot nothing's ever been paid toward (or one already owned, see this file's own doc). */
    static getProgress(id: string): number {
        return this.progress.get(id) ?? 0;
    }

    /**
     * Credits `amount` toward `id`'s price, capped so progress never exceeds it — returns how
     * much was actually accepted (<= amount), same convention as ShopUpgradeStorage.addProgress().
     * No-ops (returns 0) if `id` is already owned.
     */
    static addProgress(id: string, config: FarmPlotConfig, amount: number): number {
        if (amount <= 0 || this.isOwned(id)) {
            return 0;
        }

        const current = this.getProgress(id);
        const accepted = Math.min(amount, config.price.amount - current);
        if (accepted <= 0) {
            return 0;
        }

        this.progress.set(id, current + accepted);
        this.onProgressChanged.dispatch(id);
        void this.persist();
        return accepted;
    }

    /**
     * Completes `id`'s purchase once its full price has been deposited — moves it into
     * `ownedIds`, clears its progress, and persists. Returns whether it actually completed (call
     * unconditionally after every addProgress(), same "check the return value" convention as
     * ShopUpgradeStorage.tryCompleteUpgrade()/QueueStorage.tryCompleteTask()) — false if it isn't
     * fully funded yet or was already owned.
     */
    static tryCompletePurchase(id: string, config: FarmPlotConfig): boolean {
        if (this.isOwned(id) || this.getProgress(id) < config.price.amount) {
            return false;
        }

        this.ownedIds.add(id);
        this.progress.delete(id);
        this.onPurchase.dispatch(id);
        void this.persist();
        return true;
    }

    private static async persist(): Promise<void> {
        const data: FarmPlotSaveData = {
            ownedIds: Array.from(this.ownedIds),
            progress: Object.fromEntries(this.progress),
        };
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — see GateStorage.clearAll()'s own doc for the same caveat: doesn't retroactively re-show any already-purchased FarmZone this session, only affects what the NEXT scene load spawns as owned. */
    static async clearAll(): Promise<void> {
        this.ownedIds.clear();
        this.progress.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
