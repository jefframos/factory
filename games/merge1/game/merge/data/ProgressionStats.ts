// data/ProgressionStats.ts
import GameStorage from "../storage/GameStorage";
import { CurrencyType } from "./InGameEconomy";

export interface IProgressionStats {
    // Economy totals (lifetime)
    coinsCollected: number;   // total coins added to currency (from gameplay)
    gemsCollected: number;    // total gems added to currency (from gameplay)

    // Merge loop
    eggsHatched: number;
    mergesMade: number;

    // Entity outcomes
    animalsSpawned: number;
    eggsSpawned: number;

    // Meta / engagement
    sessionsStarted: number;
    totalPlaySeconds: number;

    // Spend tracking (optional but useful)
    coinsSpent: number;
    gemsSpent: number;

    // Highest achievements
    highestMergeLevel: number;
}

const DEFAULT_STATS: IProgressionStats = {
    coinsCollected: 0,
    gemsCollected: 0,

    eggsHatched: 0,
    mergesMade: 0,

    animalsSpawned: 0,
    eggsSpawned: 0,

    sessionsStarted: 0,
    totalPlaySeconds: 0,

    coinsSpent: 0,
    gemsSpent: 0,

    highestMergeLevel: 0
};

/**
 * ProgressionStats
 * - Owns lifetime stats (saved under GameStorage.state.stats)
 * - Saves are guaranteed after any change (throttled) and flushed on tab hide/unload
 * - Does NOT rely on update(dt) being called, but offers update(dt) for playtime tracking.
 */
export class ProgressionStats {
    private static _instance: ProgressionStats | null = null;

    public static get instance(): ProgressionStats {
        if (!this._instance) {
            this._instance = new ProgressionStats();
        }
        return this._instance;
    }

    private _stats: IProgressionStats = { ...DEFAULT_STATS };

    // Persistence control
    private _dirty: boolean = false;
    private _flushTimer: number | null = null;
    private _lastFlushAtMs: number = 0;

    // Throttle LocalStorage writes (ms)
    private readonly _minFlushIntervalMs: number = 150;

    private constructor() {
        this.load();

        // Never lose stats on tab close/background
        window.addEventListener("beforeunload", this.onBeforeUnload);
        document.addEventListener("visibilitychange", this.onVisibilityChange);
    }

    public dispose(): void {
        window.removeEventListener("beforeunload", this.onBeforeUnload);
        document.removeEventListener("visibilitychange", this.onVisibilityChange);

        if (this._flushTimer !== null) {
            window.clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
    }

    public get snapshot(): Readonly<IProgressionStats> {
        return this._stats;
    }

    public load(): void {
        const state: any = GameStorage.instance.getFullState?.() ?? {};
        const saved = state.stats;

        if (saved && typeof saved === "object") {
            this._stats = { ...DEFAULT_STATS, ...saved };
        } else {
            this._stats = { ...DEFAULT_STATS };
        }

        this._dirty = false;
        this._lastFlushAtMs = 0;

        if (this._flushTimer !== null) {
            window.clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
    }

    /**
     * Optional. You can call recordPlaySeconds directly; this exists for convenience.
     * Saving does not depend on update().
     */
    public update(dtSeconds: number): void {
        this.recordPlaySeconds(dtSeconds);
    }

    public flushNow(): void {
        if (!this._dirty) {
            return;
        }

        this._dirty = false;
        this._lastFlushAtMs = Date.now();

        // Persist a clone to avoid accidental reference sharing
        GameStorage.instance.updateState({
            stats: { ...this._stats }
        });

        if (this._flushTimer !== null) {
            window.clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }
    }

    private markDirty(): void {
        this._dirty = true;

        const now = Date.now();
        const elapsed = now - this._lastFlushAtMs;

        // If enough time passed, flush immediately
        if (elapsed >= this._minFlushIntervalMs) {
            this.flushNow();
            return;
        }

        // Otherwise schedule soonest flush (single timer)
        if (this._flushTimer !== null) {
            return;
        }

        const delay = Math.max(0, this._minFlushIntervalMs - elapsed);

        this._flushTimer = window.setTimeout(() => {
            this._flushTimer = null;
            this.flushNow();
        }, delay);
    }

    private onBeforeUnload = (): void => {
        this.flushNow();
    };

    private onVisibilityChange = (): void => {
        if (document.visibilityState === "hidden") {
            this.flushNow();
        }
    };

    // --- Recording helpers ---

    public recordSessionStart(): void {
        this._stats.sessionsStarted++;
        this.markDirty();
    }

    public recordPlaySeconds(dtSeconds: number): void {
        if (dtSeconds <= 0) {
            return;
        }
        this._stats.totalPlaySeconds += dtSeconds;
        this.markDirty();
    }

    public recordEggSpawned(count: number = 1): void {
        this._stats.eggsSpawned += Math.max(0, count);
        this.markDirty();
    }

    public recordAnimalSpawned(count: number = 1): void {
        this._stats.animalsSpawned += Math.max(0, count);
        this.markDirty();
    }

    public recordEggHatched(count: number = 1): void {
        this._stats.eggsHatched += Math.max(0, count);
        this.markDirty();
    }

    public recordMerge(nextLevel: number): void {
        this._stats.mergesMade++;

        if (nextLevel > this._stats.highestMergeLevel) {
            this._stats.highestMergeLevel = nextLevel;
        }

        this.markDirty();
    }

    public recordCurrencyGained(type: CurrencyType, amount: number): void {
        const v = Math.max(0, amount);
        if (v <= 0) {
            return;
        }

        if (type === CurrencyType.MONEY) {
            this._stats.coinsCollected += v;
        } else if (type === CurrencyType.GEMS) {
            this._stats.gemsCollected += v;
        }

        this.markDirty();
    }

    public recordCurrencySpent(type: CurrencyType, amount: number): void {
        const v = Math.max(0, amount);
        if (v <= 0) {
            return;
        }

        if (type === CurrencyType.MONEY) {
            this._stats.coinsSpent += v;
        } else if (type === CurrencyType.GEMS) {
            this._stats.gemsSpent += v;
        }

        this.markDirty();
    }

    /**
     * Optional helper for migrations / testing.
     */
    public resetToDefaults(flush: boolean = true): void {
        this._stats = { ...DEFAULT_STATS };
        this._dirty = true;
        if (flush) {
            this.flushNow();
        } else {
            this.markDirty();
        }
    }

    public hardReset(): void {
        // stop pending flush
        if (this._flushTimer !== null) {
            window.clearTimeout(this._flushTimer);
            this._flushTimer = null;
        }

        this._stats = { ...DEFAULT_STATS };
        this._dirty = false;
        this._lastFlushAtMs = 0;

        // write fresh defaults immediately (optional, but keeps memory+disk aligned)
        GameStorage.instance.updateState({
            stats: { ...this._stats }
        });
    }
}
