// missions/MissionStats.ts
import { CurrencyType } from "../data/InGameEconomy";
import GameStorage, { IMissionStatsSaveData } from "../storage/GameStorage";

function createDefaultStats(): IMissionStatsSaveData {
    return {
        tapsOnCreatures: 0,
        mergesDone: 0,
        eggsHatched: 0,
        lifetimeEarned: {
            [CurrencyType.MONEY]: 0,
            [CurrencyType.GEMS]: 0,
            [CurrencyType.ENERGY]: 0
        }
    };
}

export class MissionStats {
    private static _instance: MissionStats;

    public static get instance(): MissionStats {
        return this._instance || (this._instance = new MissionStats());
    }

    private _stats: IMissionStatsSaveData;

    private constructor() {
        const state = GameStorage.instance.getFullState();
        const loaded = state.missionStats ? state.missionStats : createDefaultStats();

        loaded.eggsHatched ??= 0;
        loaded.lifetimeEarned ??= {};
        loaded.lifetimeEarned[CurrencyType.MONEY] ??= 0;
        loaded.lifetimeEarned[CurrencyType.GEMS] ??= 0;
        loaded.lifetimeEarned[CurrencyType.ENERGY] ??= 0;

        this._stats = loaded;
        this.sync();
    }

    public get snapshot(): IMissionStatsSaveData {
        return this._stats;
    }

    public incCreatureTap(amount: number = 1): void {
        this._stats.tapsOnCreatures += amount;
        this.sync();
    }

    public incMerge(amount: number = 1): void {
        this._stats.mergesDone += amount;
        this.sync();
    }
    public incEggHatched(amount: number = 1): void {
        this._stats.eggsHatched += amount;
        this.sync();
    }
    /**
     * “Collect X coins/gems” should be interpreted as “earned”, not “current balance”.
     * If you want “have X at once”, that’s a different mission type.
     */
    public addLifetimeEarned(type: CurrencyType, amount: number): void {
        if (amount <= 0) return;
        const current = this._stats.lifetimeEarned[type] || 0;
        this._stats.lifetimeEarned[type] = current + amount;
        this.sync();
    }

    private sync(): void {
        GameStorage.instance.updateState({
            missionStats: this._stats
        });
    }
}
