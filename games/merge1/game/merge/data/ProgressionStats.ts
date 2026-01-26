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

export class ProgressionStats {
    private static _instance: ProgressionStats | null = null;

    public static get instance(): ProgressionStats {
        if (!this._instance) {
            this._instance = new ProgressionStats();
        }
        return this._instance;
    }

    private _stats: IProgressionStats = { ...DEFAULT_STATS };
    private _dirty: boolean = false;
    private _saveCooldown: number = 0;

    private constructor() {
        this.load();
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
        this._saveCooldown = 0;
    }

    public update(dtSeconds: number): void {
        // Debounced saving (avoid writing every frame)
        if (!this._dirty) {
            return;
        }

        this._saveCooldown -= dtSeconds;
        if (this._saveCooldown > 0) {
            return;
        }

        this.flushNow();
    }

    public flushNow(): void {
        this._dirty = false;
        this._saveCooldown = 0;

        GameStorage.instance.updateState({
            stats: this._stats
        });
    }

    private markDirty(): void {
        this._dirty = true;
        this._saveCooldown = 0.35; // small debounce
    }

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
}
