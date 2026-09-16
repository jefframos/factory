// GemStorage.ts

import PlatformHandler from 'core/platforms/PlatformHandler';

const KEY = 'TOWER_GEMS';

/** Starting balance granted the first time this key is ever read (see load()) — a genuinely fresh install, or right after the dev "Clear Data" button (see IslandViewScene.setupDataDevGui()) wipes and reloads. */
const FRESH_INSTALL_GEMS = 100;

/**
 * Persists the tower game's gem balance — earned from big merges (see
 * PieceStorage.getMergeGemReward/FaceTowerGameController.handleMerge) and
 * from a run's final score (see IslandViewScene's onGameOver), spent on
 * powerups (see IslandViewScene.useHudPowerup) at each powerup's own gem
 * cost (see PowerupStorage.getPowerupGemCost()). Same load-once/cache/
 * fire-and-forget-save shape as TowerHighScoreStorage.
 */
export class GemStorage {
    private static cached = 0;

    /** Call once at boot, before any HUD/popup can read the balance — see index.ts's loadAssets(), alongside PowerupInventoryStorage.load(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(KEY);

            if (raw === null) {
                // Nothing ever saved under this key — fresh data (first-ever
                // boot, or right after Clear Data). Grant the starting
                // balance and persist it immediately, rather than leaving a
                // "fresh install" player at 0 until their first merge/score.
                this.cached = FRESH_INSTALL_GEMS;
                this.save();
            } else {
                this.cached = Number(raw) || 0;
            }
        } catch (e) {
            console.error('GemStorage: failed to load', e);
            this.cached = 0;
        }
    }

    static get(): number {
        return this.cached;
    }

    static add(amount: number): void {
        if (amount <= 0) return;
        this.cached += amount;
        this.save();
    }

    /** Deducts `amount` and returns true if affordable; leaves the balance untouched and returns false otherwise. */
    static spend(amount: number): boolean {
        if (this.cached < amount) return false;
        this.cached -= amount;
        this.save();
        return true;
    }

    private static save(): void {
        void PlatformHandler.instance.platform.setItem(KEY, String(this.cached));
    }

    static async clearAll(): Promise<void> {
        this.cached = 0;
        await PlatformHandler.instance.platform.removeItem(KEY);
    }
}
