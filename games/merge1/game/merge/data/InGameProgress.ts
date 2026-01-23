import { Signal } from "signals";
import GameStorage, { IProgressionData, ProgressionType } from "../storage/GameStorage";

export class InGameProgress {
    private static _instance: InGameProgress;

    // Dispatches: (type, level, xp, xpRequired)
    public readonly onProgressChanged: Signal = new Signal();
    // Dispatches: (type, newLevel)
    public readonly onLevelUp: Signal = new Signal();

    public readonly onMaxEntitiesChanged: Signal = new Signal();

    private _dataMap: Map<string, IProgressionData> = new Map();

    private _lastCalculatedMax: number = 6;

    public static get instance(): InGameProgress {
        return this._instance || (this._instance = new InGameProgress());
    }

    private constructor() {
        this.loadFromStorage();
    }

    private loadFromStorage(): void {
        const state = GameStorage.instance.getFullState();

        this._lastCalculatedMax = this.getMaxGridSlots();

        // Ensure all defined ProgressionTypes exist in our local map
        Object.values(ProgressionType).forEach(type => {
            const saved = state?.progressions?.[type] || { level: 1, xp: 0, highestMergeLevel: 1 };
            this._dataMap.set(type, saved);
        });
    }

    public getXPRequiredForNextLevel(currentLevel: number): number {
        // Your requested math: 12, 36, 72, 120...
        return 6 * currentLevel * (currentLevel + 1);
    }

    public addXP(amount: number, type: string = ProgressionType.MAIN): void {
        const data = this.getProgression(type);
        data.xp += amount;

        let required = this.getXPRequiredForNextLevel(data.level);

        while (data.xp >= required) {
            data.xp -= required;
            data.level++;
            this.onLevelUp.dispatch(type, data.level);
            required = this.getXPRequiredForNextLevel(data.level);
        }

        this.sync(type);
    }

    public reportMergeLevel(level: number, type: string = ProgressionType.MAIN): void {
        const data = this.getProgression(type);
        if (level > data.highestMergeLevel) {
            data.highestMergeLevel = level;

            // CHECK FOR SLOT INCREASE
            const newMax = this.calculateMaxFromLevel(level);
            if (newMax > this._lastCalculatedMax) {
                this._lastCalculatedMax = newMax;
                this.onMaxEntitiesChanged.dispatch(newMax);
            }

            this.sync(type);
        }
    }

    private sync(type: string): void {
        const fullState = GameStorage.instance.getFullState() || this.createEmptyState();

        // Update the storage object with our latest map values
        fullState.progressions = Object.fromEntries(this._dataMap);

        GameStorage.instance.saveFullState(fullState);

        const data = this.getProgression(type);
        this.onProgressChanged.dispatch(type, data.level, data.xp, this.getXPRequiredForNextLevel(data.level));
    }

    private calculateMaxFromLevel(highestLevel: number): number {
        const baseSlots = 6;
        if (highestLevel < 5) return baseSlots;
        return Math.min(baseSlots + (highestLevel - 4), 28);
    }

    public getMaxGridSlots(): number {
        const data = this.getProgression(ProgressionType.MAIN);
        return this.calculateMaxFromLevel(data.highestMergeLevel);
    }

    public getProgression(type: string): IProgressionData {
        if (!this._dataMap.has(type)) {
            this._dataMap.set(type, { level: 1, xp: 0, highestMergeLevel: 1 });
        }
        return this._dataMap.get(type)!;
    }

    public getProgressions(): Map<string, IProgressionData> {
        return this._dataMap;
    }

    private createEmptyState(): any {
        return { progressions: {}, currencies: {}, entities: [], coinsOnGround: [] };
    }
}