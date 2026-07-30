// TowerHighScoreStorage.ts

import PlatformHandler from 'core/platforms/PlatformHandler';

const POINTS_KEY = 'TOWER_STACK_HIGH_SCORE_POINTS';
const HEIGHT_KEY = 'TOWER_STACK_HIGH_SCORE_HEIGHT';

/**
 * Persists the tower-stacking mini-game's best-ever run via PlatformHandler
 * — same load-once/cache/fire-and-forget-save shape as
 * games/tower/game/data/PowerupInventoryStorage.ts and its own
 * HighScoreStorage (which belongs to tower's OTHER, dungeon-style game mode
 * — see BaseDemoScene/PlayerFlowController — and must NOT be repurposed
 * here). Two INDEPENDENT stats, points and height climbed (meters) — a run
 * can set a new points record without a new height record or vice versa (a
 * shorter climb using bigger-value pieces vs. a taller climb using smaller
 * ones), so each needs its own cache/baseline/check.
 */
export class TowerHighScoreStorage {
    private static cachedPoints = 0;
    private static cachedHeight = 0;

    /** Snapshot of the caches taken at the start of the current run (see markRunStart) — lets the game-over popup tell "this run set a new record" apart from "the record was already this high going in." */
    private static runStartBestPoints = 0;
    private static runStartBestHeight = 0;

    /** Call once at boot, before any HUD/popup can read either stat — see index.ts's loadAssets(), alongside PowerupInventoryStorage.load(). */
    static async load(): Promise<void> {
        try {
            const [rawPoints, rawHeight] = await Promise.all([
                PlatformHandler.instance.platform.getItem(POINTS_KEY),
                PlatformHandler.instance.platform.getItem(HEIGHT_KEY),
            ]);

            this.cachedPoints = rawPoints ? Number(rawPoints) || 0 : 0;
            this.cachedHeight = rawHeight ? Number(rawHeight) || 0 : 0;
        } catch (e) {
            console.error('TowerHighScoreStorage: failed to load', e);
            this.cachedPoints = 0;
            this.cachedHeight = 0;
        }
    }

    static getPoints(): number {
        return this.cachedPoints;
    }

    static getHeight(): number {
        return this.cachedHeight;
    }

    /** Bumps and persists only when points is a new high. */
    static recordPoints(points: number): void {
        if (points <= this.cachedPoints) return;
        this.cachedPoints = points;
        void PlatformHandler.instance.platform.setItem(POINTS_KEY, String(points));
    }

    /** Bumps and persists only when heightMeters is a new high. */
    static recordHeight(heightMeters: number): void {
        if (heightMeters <= this.cachedHeight) return;
        this.cachedHeight = heightMeters;
        void PlatformHandler.instance.platform.setItem(HEIGHT_KEY, String(heightMeters));
    }

    /** Call when a fresh run begins (see IslandViewScene's start()/replay handling) — baselines both runStartBest values so isNewXHigh() can tell this run's own result apart from a record already set by an earlier run. */
    static markRunStart(): void {
        this.runStartBestPoints = this.cachedPoints;
        this.runStartBestHeight = this.cachedHeight;
    }

    /** True if `points` beats whatever the points high score was before this run started. */
    static isNewPointsHigh(points: number): boolean {
        return points > this.runStartBestPoints;
    }

    /** True if `heightMeters` beats whatever the height high score was before this run started. */
    static isNewHeightHigh(heightMeters: number): boolean {
        return heightMeters > this.runStartBestHeight;
    }

    /** Wipes both persisted bests back to a fresh install. */
    static async clearAll(): Promise<void> {
        this.cachedPoints = 0;
        this.cachedHeight = 0;
        this.runStartBestPoints = 0;
        this.runStartBestHeight = 0;

        await Promise.all([
            PlatformHandler.instance.platform.removeItem(POINTS_KEY),
            PlatformHandler.instance.platform.removeItem(HEIGHT_KEY),
        ]);
    }
}
