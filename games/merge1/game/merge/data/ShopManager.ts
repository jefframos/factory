import { Signal } from "signals";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import GameStorage from "../storage/GameStorage";
import { ProgressionStats } from "./ProgressionStats";
import { StaticData } from "./StaticData";

export interface IShopItemConfig {
    id: string;
    thumb: string;
    level: number;
    basePrice: number;
    unlockAtLevel: number;
}

export class ShopManager {
    private static _instance: ShopManager;

    // Config and State
    private _shopConfigs: IShopItemConfig[] = [];
    private _purchaseHistory: Map<string, number> = new Map();

    // Signals and UI State
    public readonly onAvailabilityChanged: Signal = new Signal();
    private _lastAvailabilityState: boolean = false;
    private priceIncreaseCoef = 1.35;

    public static get instance(): ShopManager {
        return this._instance || (this._instance = new ShopManager());
    }

    private constructor() {
        // 1. Build the configuration based on StaticData
        this.buildShopConfig();

        // 2. Load saved purchase data
        this.loadHistory();

        // 3. Setup Listeners
        InGameEconomy.instance.onCurrencyChanged.add(() => {
            this.refreshAvailability();
        });
        InGameProgress.instance.onLevelUp.add(() => {
            this.refreshAvailability();
        });
    }

    /**
     * Builds the internal shop configuration list.
     */
    private buildShopConfig(): void {
        this._shopConfigs = Array.from({ length: StaticData.entityCount }, (_, i) => {
            const level = i + 1;
            const unlockAtLevel = level === 1 ? 1 : level + 1;

            // Price math: Level 1 is cheap (50), others follow the 2.5x curve
            const basePrice = level <= 1 ? 50 : 500 * Math.pow(2.5, i);

            return {
                id: `buy_lvl_${level}`,
                level: level,
                basePrice: basePrice,
                unlockAtLevel: unlockAtLevel,
                thumb: `ENTITY_${level}`
            };
        });
    }

    private loadHistory(): void {
        const state = GameStorage.instance.getFullState();
        const saved = (state as any).shopHistory || {};
        Object.keys(saved).forEach(key => this._purchaseHistory.set(key, saved[key]));
    }

    /**
     * Getter to access the configs if needed by UI
     */
    public get configs(): IShopItemConfig[] {
        return this._shopConfigs;
    }

    public get allConfigs(): IShopItemConfig[] {
        return this._shopConfigs;
    }

    /** * Get a specific config by ID or Level 
     */
    public getConfigById(id: string): IShopItemConfig | undefined {
        return this._shopConfigs.find(c => c.id === id);
    }

    public getConfigByLevel(level: number): IShopItemConfig | undefined {
        return this._shopConfigs.find(c => c.level === level);
    }

    /** * Returns how many times an item has been bought 
     */
    public getPurchaseCount(itemId: string): number {
        return this._purchaseHistory.get(itemId) || 0;
    }
    public getPrice(itemId: string): number {
        const config = this._shopConfigs.find(c => c.id === itemId);
        if (!config) return 0;

        const count = this._purchaseHistory.get(itemId) || 0;
        return Math.floor(config.basePrice * Math.pow(this.priceIncreaseCoef, count));
    }

    public isUnlocked(itemId: string): boolean {
        const config = this._shopConfigs.find(c => c.id === itemId);
        if (!config) return false;

        const userLevel = InGameProgress.instance.getProgression("MAIN").level;
        return userLevel >= config.unlockAtLevel;
    }

    public tryPurchase(itemId: string): number | null {
        const config = this._shopConfigs.find(c => c.id === itemId);
        if (!config || !this.isUnlocked(itemId)) return null;

        const price = this.getPrice(itemId);
        const economy = InGameEconomy.instance;

        if (economy.getAmount(CurrencyType.MONEY) >= price) {
            economy.spend(CurrencyType.MONEY, price);
            ProgressionStats.instance.recordCurrencySpent(CurrencyType.MONEY, price);

            const currentCount = this._purchaseHistory.get(itemId) || 0;
            this._purchaseHistory.set(itemId, currentCount + 1);

            this.saveHistory();
            this.refreshAvailability();

            return config.level;
        }

        return null;
    }

    public hasAffordableItems(): boolean {
        const money = InGameEconomy.instance.getAmount(CurrencyType.MONEY);

        return this._shopConfigs.some(config => {
            if (!this.isUnlocked(config.id)) return false;
            const price = this.getPrice(config.id);
            return money >= price;
        });
    }

    public refreshAvailability(): void {
        const currentState = this.hasAffordableItems();
        if (currentState !== this._lastAvailabilityState) {
            this._lastAvailabilityState = currentState;
            this.onAvailabilityChanged.dispatch(currentState);
        }
    }

    private saveHistory(): void {
        const historyObj = Object.fromEntries(this._purchaseHistory);
        GameStorage.instance.updateState({
            shopHistory: historyObj
        });
    }

    public resetShop(): void {
        this._purchaseHistory.clear();
        this.saveHistory();
        this.refreshAvailability();
    }
}