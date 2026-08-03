import PlatformHandler from 'core/platforms/PlatformHandler';

const KEY = 'CLOG_HIGH_SCORE';

/** Persists the player's best-ever score (head + tail, same stat as the in-game leaderboard) via PlatformHandler — see IWorld3dScene.playerScore. */
export class HighScoreStorage {
    private static cached = 0;
    /** Snapshot of `cached` taken at the start of the current run (see markRunStart) — lets the End Game screen tell "this run set a new record" apart from "the record was already this high going in." */
    private static runStartBest = 0;

    /** Call once at boot, before the boot menu or BaseDemoScene.update() can run. */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(KEY);
            this.cached = raw ? Number(raw) || 0 : 0;
        } catch (e) {
            console.error('HighScoreStorage: failed to load', e);
            this.cached = 0;
        }
    }

    static get(): number {
        return this.cached;
    }

    /** Bumps and persists only when score is a new high — cheap to call every frame. */
    static recordScore(score: number): void {
        if (score <= this.cached) return;
        this.cached = score;
        void PlatformHandler.instance.platform.setItem(KEY, String(score));
    }

    /** Call when a fresh run begins (see BaseDemoScene.handleJoinServer) — baselines runStartBest so isNewHighScore can tell this run's own climb apart from a record already set by an earlier run. */
    static markRunStart(): void {
        this.runStartBest = this.cached;
    }

    /** True if `score` beats whatever the high score was before this run started. */
    static isNewHighScore(score: number): boolean {
        return score > this.runStartBest;
    }

    /** Wipes the persisted best back to a fresh install — see SettingsMenu's Clear Data action. */
    static async clearAll(): Promise<void> {
        this.cached = 0;
        this.runStartBest = 0;
        await PlatformHandler.instance.platform.removeItem(KEY);
    }
}
