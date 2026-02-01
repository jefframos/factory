import { Signal } from "signals";
import GameStorage, { IProgressionData, ProgressionType } from "../storage/GameStorage";

export class InGameProgress {
    private static _instance: InGameProgress;

    // Dispatches: (type, level, xp, xpRequired)
    public readonly onProgressChanged: Signal = new Signal();
    // Dispatches: (type, newLevel)
    public readonly onLevelUp: Signal = new Signal();
    // Dispatches: (newMaxSlots)
    public readonly onMaxEntitiesChanged: Signal = new Signal();
    public readonly onMaxEntitiesShopChanged: Signal = new Signal();

    private _dataMap: Map<string, IProgressionData> = new Map();
    private _lastCalculatedMax: number = 6;

    public static get instance(): InGameProgress {
        return this._instance || (this._instance = new InGameProgress());
    }

    private constructor() {
        this.loadFromStorage();
    }

    /**
     * Loads saved progression and populates the local map.
     * Order of operations is critical here to avoid initialization loops.
     */
    private loadFromStorage(): void {
        const state = GameStorage.instance.getFullState();

        // 1. Populate the map with defaults or saved data first
        Object.values(ProgressionType).forEach(type => {
            const saved = state?.progressions?.[type] || {
                level: 1,
                xp: 0,
                highestMergeLevel: 1
            };
            this._dataMap.set(type, saved);
        });

        // 2. Now that data exists in the map, calculate the grid capacity
        this._lastCalculatedMax = this.getMaxGridSlots();

        console.log(`[Progress] Loaded. Highest Level: ${this.getProgression(ProgressionType.MAIN).highestMergeLevel}, Max Slots: ${this._lastCalculatedMax}`);
    }

    /**
     * Progression Math: 6 * L * (L + 1)
     * Level 1: 12 XP
     * Level 2: 36 XP
     * Level 3: 72 XP
     */
    public getXPRequiredForNextLevel(currentLevel: number): number {
        return 6 * currentLevel * (currentLevel + 1);
    }

    /**
     * Adds XP and handles multiple level-ups if necessary.
     */
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

    /**
     * Reports a new merge. If it's the highest level seen, checks for grid unlocks.
     */
    public reportMergeLevel(level: number, type: string = ProgressionType.MAIN): void {
        const data = this.getProgression(type);

        if (level > data.highestMergeLevel) {
            data.highestMergeLevel = level;
            // Check if this new level unlocks a slot
            const newMax = this.calculateMaxFromLevel(level);
            if (newMax > this._lastCalculatedMax) {
                this._lastCalculatedMax = newMax;
                this.onMaxEntitiesShopChanged.dispatch(newMax);
            }
            this.onMaxEntitiesChanged.dispatch(level);

            this.sync(type);
        }
    }

    /**
     * Saves ONLY the progressions slice to storage.
     */
    private sync(type: string): void {
        const progressionRecord = Object.fromEntries(this._dataMap);

        // Patch update to avoid overwriting currencies or entities
        GameStorage.instance.updateState({
            progressions: progressionRecord
        });

        const data = this.getProgression(type);
        this.onProgressChanged.dispatch(
            type,
            data.level,
            data.xp,
            this.getXPRequiredForNextLevel(data.level)
        );
    }

    /**
     * Logic for grid unlocks based on merge progress.
     */
    private calculateMaxFromLevel(highestLevel: number): number {
        const baseSlots = 6;
        if (highestLevel < 5) return baseSlots;
        // Formula: Adds 1 slot for every level starting at level 5
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
}