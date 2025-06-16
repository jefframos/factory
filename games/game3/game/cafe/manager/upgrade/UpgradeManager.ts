import { DevGuiManager } from "../../utils/DevGuiManager";

export type UpgradeableAttributes = Record<string, number[]>;

export interface StationUpgradeData {
    type: string;
    requiredLevel?: number;
    item: string[];
    attributes: UpgradeableAttributes; // speed, stack, price, etc.
}

export interface StationUpgradeState {
    level: number;
}

export class UpgradeManager {
    private static readonly STORAGE_KEY = 'doge_upgrade_data';

    private static _instance: UpgradeManager;
    public static get instance(): UpgradeManager {
        if (!this._instance) this._instance = new UpgradeManager();
        return this._instance;
    }

    private upgrades: Record<string, StationUpgradeData> = {};
    private state: Record<string, StationUpgradeState> = {};

    private constructor() {
        DevGuiManager.instance.addButton('Wipe Upgrades', () => {
            this.reset();
        }, 'UPGRADE')
    }

    public initialize(data: Record<string, StationUpgradeData>) {
        this.upgrades = data;
        this.load();
    }
    public getUpgrade(stationId: string) {
        return { state: this.state[stationId], raw: this.upgrades[stationId] }
    }
    public upgrade(stationId: string): boolean {
        const current = this.state[stationId] ?? { level: 0 };
        const config = this.upgrades[stationId];

        if (!config) {
            console.warn(`[UpgradeManager] No upgrade data for station: ${stationId}`);
            return false;
        }

        const maxLevel = this.getMaxLevel(stationId);
        if (current.level >= maxLevel) return false;

        current.level++;
        this.state[stationId] = current;
        this.save();
        return true;
    }
    public canUpgrade(stationId: string, availableValue: number, attribute: string = "price"): boolean {
        const config = this.upgrades[stationId];
        if (!config) {
            console.warn(`[UpgradeManager] No upgrade config for station '${stationId}'`);
            return false;
        }

        const level = this.getCurrentLevel(stationId);
        const nextLevel = level + 1;
        const maxLevel = this.getMaxLevel(stationId);

        if (nextLevel >= maxLevel) return false;

        const upgradeCost = config.attributes[attribute]?.[nextLevel];
        if (upgradeCost === undefined) {
            console.warn(`[UpgradeManager] No attribute '${attribute}' defined for level ${nextLevel} in '${stationId}'`);
            return false;
        }

        return availableValue >= upgradeCost;
    }

    public getCurrentLevel(stationId: string): number {
        return this.state[stationId]?.level ?? 0;
    }

    public getAttributeValue(stationId: string, attribute: string): number | undefined {
        const config = this.upgrades[stationId];
        if (!config || !config.attributes[attribute]) return undefined;
        const level = this.getCurrentLevel(stationId);
        return config.attributes[attribute][level];
    }

    public getMaxLevel(stationId: string): number {
        const config = this.upgrades[stationId];
        const firstAttr = config?.attributes[Object.keys(config.attributes)[0]];
        return firstAttr?.length ?? 0;
    }

    public save(): void {
        localStorage.setItem(UpgradeManager.STORAGE_KEY, JSON.stringify(this.state));
    }

    public load(): void {
        try {
            const json = localStorage.getItem(UpgradeManager.STORAGE_KEY);
            if (json) {
                this.state = JSON.parse(json);
            }
        } catch {
            this.state = {};
        }
    }

    public reset(): void {
        localStorage.removeItem(UpgradeManager.STORAGE_KEY);
        this.state = {};
    }
}
