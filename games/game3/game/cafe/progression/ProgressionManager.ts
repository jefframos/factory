import { Signal } from 'signals';
import { DevGuiManager } from "../utils/DevGuiManager";
import { Observable } from '../utils/Observable';

type UnlockCondition =
    | { type: 'areaLevel'; areaId: string; level: number }
    | { type: 'actionsCompleted'; areaId: string; count: number }
    | { type: 'areaMaxed'; areaId: string };

export interface StaticAreaData {
    name: string;
    maxLevel?: number;
    unlockConditions: UnlockCondition[];
    upgradeThreshold?: number | number[];
}

export interface AreaProgress {
    level: Observable;
    actionsCompleted: Observable;
    unlocked: boolean;
    currentValue: Observable;
    nextLevelThreshold: number;
    isMaxLevel: boolean;
    normalizedValue: number;
    normalizedAction: number;
}

interface SaveState {
    areas: Record<string, AreaProgress>;
}

export class ProgressionManager {
    private static _instance: ProgressionManager;
    public static get instance(): ProgressionManager {
        if (!this._instance) {
            this._instance = new ProgressionManager();
        }
        return this._instance;
    }

    private static readonly STORAGE_KEY = 'doge_progression_data';

    private staticData: Record<string, StaticAreaData> = {};
    private saveState: SaveState = { areas: {} };

    public onLevelUp: Signal = new Signal();
    public onAreaUnlocked: Signal = new Signal();

    private constructor() {
        DevGuiManager.instance.addButton('Reset Progression', () => {
            this.reset();
            window.location.reload();
        }, 'PROGRESSION');
    }

    public initialize(staticData: Record<string, StaticAreaData>) {
        this.staticData = staticData;
        this.load();
        this.checkAllUnlocks();
    }

    public completeAction(areaId: string): void {
        const area = this.getOrCreateArea(areaId);
        area.actionsCompleted.value++;

        const staticDef = this.staticData[areaId];
        if (area.level.value < this.getMaxLevel(staticDef)) {
            area.level.value++;
            this.updateAreaProgress(areaId);
            this.onLevelUp.dispatch(areaId, area.level.value);
        } else {
            this.updateAreaProgress(areaId);
        }


        this.checkAllUnlocks();
        this.save();
    }

    public addValue(areaId: string, value: number): { overflow: number } {
        const area = this.getOrCreateArea(areaId);
        const def = this.staticData[areaId];
        const thresholds = Array.isArray(def.upgradeThreshold) ? def.upgradeThreshold : [def.upgradeThreshold ?? 0];

        const maxLevel = this.getMaxLevel(def);
        let currentLevel = area.level.value;
        let currentValue = area.currentValue.value + value;

        let willLevelUp = false;
        while (currentLevel < maxLevel) {
            const needed = thresholds[currentLevel] ?? 0;
            if (currentValue >= needed) {
                currentValue -= needed;
                currentLevel++;
                willLevelUp = true;
            } else break;
        }

        if (currentValue < 0) {
            currentValue = 0;
        }

        const overflow = (currentLevel >= maxLevel && currentValue > 0) ? currentValue : 0;

        area.level.value = currentLevel;
        area.currentValue.value = currentValue;
        if (willLevelUp) {
            this.onLevelUp.dispatch(areaId, currentLevel);
        }
        this.checkAllUnlocks();
        this.save();

        const nextThreshold = thresholds[currentLevel] ?? 0;
        area.nextLevelThreshold = currentLevel >= maxLevel ? 0 : nextThreshold;
        area.isMaxLevel = currentLevel >= maxLevel;

        area.normalizedValue = area.nextLevelThreshold > 0 ? area.currentValue.value / area.nextLevelThreshold : 1;
        const maxActions = this.getMaxActionRequirement(def);
        area.normalizedAction = maxActions > 0 ? area.actionsCompleted.value / maxActions : 1;

        this.updateAreaProgress(areaId);

        return { overflow: overflow * (value >= 0 ? 1 : -1) };
    }

    private getOrCreateArea(id: string): AreaProgress {
        if (!this.saveState.areas[id]) {
            const def = this.staticData[id];
            this.saveState.areas[id] = {
                level: new Observable(0),
                actionsCompleted: new Observable(0),
                unlocked: def?.unlockConditions.length === 0,
                currentValue: new Observable(0),
                nextLevelThreshold: 0,
                isMaxLevel: false,
                normalizedValue: 0,
                normalizedAction: 0,
            };
        }
        return this.saveState.areas[id];
    }

    private getMaxLevel(def: StaticAreaData): number {
        if (Array.isArray(def.upgradeThreshold)) {
            return def.upgradeThreshold.length;
        }
        return def.maxLevel ?? 1;
    }

    private getMaxActionRequirement(def: StaticAreaData): number {
        const related = Object.values(this.staticData).flatMap(d => d.unlockConditions.filter(c => c.type === 'actionsCompleted' && c.areaId === def.name));
        return related.reduce((max, cond: any) => Math.max(max, cond.count), 0);
    }

    private checkAllUnlocks() {
        for (const [id, def] of Object.entries(this.staticData)) {
            const current = this.getOrCreateArea(id);
            if (current.unlocked) continue;

            const unlocked = def.unlockConditions.every(cond => {
                const target = this.getOrCreateArea(cond.areaId);

                if (!target) {
                    console.warn(`[Unlock Check] Area '${cond.areaId}' not found for unlock condition in '${id}'`);
                    return false; // Treat missing area as not satisfying the condition
                }

                switch (cond.type) {
                    case 'areaLevel':
                        return target.level.value >= cond.level;
                    case 'areaMaxed': {
                        const staticTarget = this.staticData[cond.areaId];
                        if (!staticTarget) {
                            console.warn(`[Unlock Check] Static data for '${cond.areaId}' not found in 'areaMaxed' condition for '${id}'`);
                            return false;
                        }
                        return target.level.value >= this.getMaxLevel(staticTarget);
                    }
                    case 'actionsCompleted':
                        return target.actionsCompleted.value >= cond.count;
                }
            });

            if (unlocked) {
                current.unlocked = true;
                console.log(`Unlocked area: ${id}`);
                this.onAreaUnlocked.dispatch(id);
            }
        }
    }


    private save() {
        const flatState: Record<string, { level: number; actionsCompleted: number; currentValue: number; unlocked: boolean }> = {};
        for (const [id, progress] of Object.entries(this.saveState.areas)) {
            flatState[id] = {
                level: progress.level.value,
                actionsCompleted: progress.actionsCompleted.value,
                currentValue: progress.currentValue.value,
                unlocked: progress.unlocked
            };
        }
        localStorage.setItem(ProgressionManager.STORAGE_KEY, JSON.stringify(flatState));
    }

    private load() {
        const json = localStorage.getItem(ProgressionManager.STORAGE_KEY);
        if (json) {
            try {
                const flatState: Record<string, { level: number; actionsCompleted: number; currentValue: number; unlocked: boolean }> = JSON.parse(json);
                for (const [id, data] of Object.entries(flatState)) {
                    this.saveState.areas[id] = {
                        level: new Observable(data.level),
                        actionsCompleted: new Observable(data.actionsCompleted),
                        currentValue: new Observable(data.currentValue),
                        unlocked: data.unlocked,
                        nextLevelThreshold: 0,
                        isMaxLevel: false,
                        normalizedValue: 0,
                        normalizedAction: 0
                    };

                    this.updateAreaProgress(id);
                }
            } catch {
                this.saveState = { areas: {} };
            }
        }
    }
    private updateAreaProgress(areaId: string): void {
        const area = this.getOrCreateArea(areaId);
        if (!area) {
            console.warn(`[Progress Update] Area '${areaId}' not found.`);
            return;
        }

        const def = this.staticData[areaId];
        if (!def) {
            console.warn(`[Progress Update] Static definition for area '${areaId}' not found.`);
            return;
        }

        const thresholds = Array.isArray(def.upgradeThreshold)
            ? def.upgradeThreshold
            : [def.upgradeThreshold ?? 0];

        const maxLevel = this.getMaxLevel(def);
        const currentLevel = area.level.value;

        area.nextLevelThreshold = currentLevel < maxLevel
            ? thresholds[currentLevel] ?? 0
            : 0;

        area.isMaxLevel = currentLevel >= maxLevel;

        area.normalizedValue = area.nextLevelThreshold > 0
            ? area.currentValue.value / area.nextLevelThreshold
            : 1;

        const maxActions = this.getMaxActionRequirement(def);
        area.normalizedAction = maxActions > 0
            ? area.actionsCompleted.value / maxActions
            : 1;
    }


    public getAreaProgress(id: string): AreaProgress | undefined {
        this.updateAreaProgress(id)
        return this.saveState.areas[id];
    }

    public isUnlocked(id: string): boolean {
        return this.getOrCreateArea(id).unlocked;
    }

    public reset() {
        localStorage.removeItem(ProgressionManager.STORAGE_KEY);
        this.saveState = { areas: {} };
        this.checkAllUnlocks();
    }
}
