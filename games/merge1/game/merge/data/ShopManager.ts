import { Signal } from "signals";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import { InGameProgress } from "../data/InGameProgress";
import GameStorage from "../storage/GameStorage";
import { ProgressionStats } from "./ProgressionStats";
export interface IShopItemConfig {
    id: string;
    thumb: string;
    level: number;       // Level of the animal/egg to spawn
    basePrice: number;   // Initial cost
    unlockAtLevel: number; // User progression level required to buy
}

export const SHOP_CONFIG: IShopItemConfig[] = Array.from({ length: 24 }, (_, i) => {
    const level = i + 1;
    //const priceIncreaseCoef = 1.15;
    const unlockAtLevel = level === 1 ? 1 : level + 4; // Level 1 is always available

    // Price math: 500 * (2.5 ^ (level - 1))
    const basePrice = 500 * Math.pow(2.5, i);

    return {
        id: `buy_lvl_${level}`,
        level: level,
        basePrice: level <= 1 ? 50 : basePrice,
        unlockAtLevel: unlockAtLevel,
        //thumb: `MergeAsset_Level_${level}_${'H'}`
        thumb: `ENTITY_${level}`
    };
});
export class ShopManager {
    private static _instance: ShopManager;
    private _purchaseHistory: Map<string, number> = new Map();
    public readonly onAvailabilityChanged: Signal = new Signal();
    private _lastAvailabilityState: boolean = false;
    private priceIncreaseCoef = 1.35;
    public static get instance(): ShopManager {
        return this._instance || (this._instance = new ShopManager());
    }

    private constructor() {
        this.loadHistory();

        InGameEconomy.instance.onCurrencyChanged.add(() => {
            this.refreshAvailability();
        });
        InGameProgress.instance.onLevelUp.add(() => {
            this.refreshAvailability();
        });
    }

    private loadHistory(): void {
        const state = GameStorage.instance.getFullState();
        // We assume 'shopHistory' exists in your IFarmSaveData interface
        const saved = (state as any).shopHistory || {};
        Object.keys(saved).forEach(key => this._purchaseHistory.set(key, saved[key]));
    }

    /**
     * The Multiplier: 1.15 is the industry standard for merge games.
     */
    public getPrice(itemId: string): number {
        const config = SHOP_CONFIG.find(c => c.id === itemId);
        if (!config) return 0;

        const count = this._purchaseHistory.get(itemId) || 0;
        return Math.floor(config.basePrice * Math.pow(this.priceIncreaseCoef, count));
    }

    public isUnlocked(itemId: string): boolean {
        const config = SHOP_CONFIG.find(c => c.id === itemId);
        if (!config) return false;

        const userLevel = InGameProgress.instance.getProgression("MAIN").level;
        return userLevel >= config.unlockAtLevel;
    }

    /**
     * Attempts to purchase an item. Returns the animal level if successful.
     */
    public tryPurchase(itemId: string): number | null {
        const config = SHOP_CONFIG.find(c => c.id === itemId);
        if (!config || !this.isUnlocked(itemId)) return null;

        const price = this.getPrice(itemId);
        const economy = InGameEconomy.instance;

        if (economy.getAmount(CurrencyType.MONEY) >= price) {
            // 1. Deduct Money
            economy.spend(CurrencyType.MONEY, price);
            ProgressionStats.instance.recordCurrencySpent(CurrencyType.MONEY, price);

            // 2. Increment Purchase Count
            const currentCount = this._purchaseHistory.get(itemId) || 0;
            this._purchaseHistory.set(itemId, currentCount + 1);

            // DEBUG: Check if memory updated
            console.log(`Bought ${itemId}. New count: ${this._purchaseHistory.get(itemId)}`);

            // 3. Save Shop State
            this.saveHistory();

            this.refreshAvailability();

            return config.level;
        }

        return null;
    }
    public hasAffordableItems(): boolean {
        const money = InGameEconomy.instance.getAmount(CurrencyType.MONEY);

        return SHOP_CONFIG.some(config => {
            if (!this.isUnlocked(config.id)) return false;
            const price = this.getPrice(config.id);
            return money >= price;
        });
    }

    public refreshAvailability(): void {
        const currentState = this.hasAffordableItems();
        if (currentState !== this._lastAvailabilityState) {
            this._lastAvailabilityState = currentState;
            // Dispatch true if something new can be bought, false if not
            this.onAvailabilityChanged.dispatch(currentState);
        }
    }
    private saveHistory(): void {
        // We convert the Map to a plain Object so localStorage can read it
        const historyObj = Object.fromEntries(this._purchaseHistory);

        // Use the patch method we added to GameStorage
        GameStorage.instance.updateState({
            shopHistory: historyObj
        });
    }

    /**
     * Easy Reset for your DevGui
     */
    public resetShop(): void {
        this._purchaseHistory.clear();
        this.saveHistory();
    }
}