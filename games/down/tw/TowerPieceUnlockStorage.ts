// TowerPieceUnlockStorage.ts

import PlatformHandler from 'core/platforms/PlatformHandler';

const MAX_TIER_KEY = 'TOWER_STACK_MAX_TIER_UNLOCKED';

/**
 * Persists the highest piece tier EVER reached across every run — same
 * load-once/cache/fire-and-forget-save shape as TowerHighScoreStorage.
 * FaceTowerGameController.maxTierReached resets to 0 every fresh run (it
 * drives THIS run's own piece-drop pool/zone-weight scaling, which is
 * meant to start over each time) — this is the separate, permanent record
 * PieceProgressionBar reads instead, so a piece the player has ever
 * unlocked stays shown as unlocked even after a reset. See
 * IslandViewScene.update(), which feeds Math.max() of this and the current
 * run's own maxTierReached into the bar.
 */
export class TowerPieceUnlockStorage {
    private static cachedMaxTier = 0;

    /** Call once at boot, before any HUD can read it — see index.ts's loadAssets(), alongside TowerHighScoreStorage.load(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(MAX_TIER_KEY);
            this.cachedMaxTier = raw ? Number(raw) || 0 : 0;
        } catch (e) {
            console.error('TowerPieceUnlockStorage: failed to load', e);
            this.cachedMaxTier = 0;
        }
    }

    static getMaxTier(): number {
        return this.cachedMaxTier;
    }

    /** Bumps and persists only when `tier` is a new all-time high — see FaceTowerGameController.handleMerge(), the sole caller. */
    static recordTier(tier: number): void {
        if (tier <= this.cachedMaxTier) {
            return;
        }

        this.cachedMaxTier = tier;
        void PlatformHandler.instance.platform.setItem(MAX_TIER_KEY, String(tier));
    }

    /** Wipes the persisted record back to a fresh install. */
    static async clearAll(): Promise<void> {
        this.cachedMaxTier = 0;
        await PlatformHandler.instance.platform.removeItem(MAX_TIER_KEY);
    }
}
