import PlatformHandler from "@core/platforms/PlatformHandler";
import { Signal } from "signals";

export enum CurrencyType {
    COINS = "coins",
    STARS = "stars"
}

export enum InGameTools {
    HINT = "hint",
    SKIP = "skip"
}
export interface IEconomySaveData {
    version: number;
    currencies: Record<CurrencyType, number>;
    unlockedItems: string[]; // List of permanent IDs (skins, themes, etc.)
    tools: Record<InGameTools, number>; // Consumables (e.g., "hint": 5, "skip": 2)
}

export class EconomyStorage {
    private static readonly KEY = "HEX_ECONOMY_DATA";
    private static readonly CURRENT_VERSION = 1;

    private static _cachedData: IEconomySaveData | null = null;
    public static readonly onCurrencyChanged: Signal = new Signal();

    private static createDefaultData(): IEconomySaveData {
        return {
            version: this.CURRENT_VERSION,
            currencies: {
                [CurrencyType.COINS]: 0,
                [CurrencyType.STARS]: 0
            },
            unlockedItems: [],
            tools: {
                [InGameTools.HINT]: 10,
                [InGameTools.SKIP]: 0
            }
        };
    }

    private static async ensureLoaded(): Promise<IEconomySaveData> {
        if (this._cachedData) return this._cachedData;

        try {
            const raw = await PlatformHandler.instance.platform.getItem(this.KEY);
            let parsed = raw ? JSON.parse(raw) : null;

            if (parsed && parsed.version !== this.CURRENT_VERSION) {
                console.warn("Economy version mismatch. Resetting economy.");
                parsed = null;
            }

            if (!parsed) {
                this._cachedData = this.createDefaultData();
            } else {
                // Merge to ensure new currency types or tools exist
                this._cachedData = {
                    ...this.createDefaultData(),
                    ...parsed,
                    currencies: { ...this.createDefaultData().currencies, ...parsed.currencies },
                    tools: { ...this.createDefaultData().tools, ...parsed.tools }
                };
            }
        } catch (e) {
            this._cachedData = this.createDefaultData();
        }
        return this._cachedData!;
    }

    // --- Currency Logic ---

    public static async getBalance(type: CurrencyType): Promise<number> {
        const data = await this.ensureLoaded();
        return data.currencies[type] || 0;
    }

    public static async addCurrency(type: CurrencyType, amount: number): Promise<void> {
        const data = await this.ensureLoaded();
        data.currencies[type] = (data.currencies[type] || 0) + amount;
        await this.persist();

        this.onCurrencyChanged.dispatch(type, data.currencies[type]);
    }

    // --- Shop & Permanent Items ---

    public static async isItemUnlocked(itemId: string): Promise<boolean> {
        const data = await this.ensureLoaded();
        return data.unlockedItems.includes(itemId);
    }

    /**
     * Tries to purchase a permanent item or skin
     */
    public static async tryPurchaseItem(itemId: string, cost: number, currency: CurrencyType): Promise<boolean> {
        const data = await this.ensureLoaded();

        if (data.unlockedItems.includes(itemId)) return true;
        if (data.currencies[currency] < cost) return false;

        data.currencies[currency] -= cost;
        data.unlockedItems.push(itemId);
        await this.persist();

        this.onCurrencyChanged.dispatch(currency, data.currencies[currency]);

        return true;
    }

    // --- Tools & Consumables ---

    public static async getToolCount(toolId: InGameTools): Promise<number> {
        const data = await this.ensureLoaded();
        return data.tools[toolId] || 0;
    }

    public static async addTool(toolId: InGameTools, count: number): Promise<void> {
        const data = await this.ensureLoaded();
        data.tools[toolId] = (data.tools[toolId] || 0) + count;
        await this.persist();
    }

    public static async useTool(toolId: InGameTools): Promise<boolean> {
        const data = await this.ensureLoaded();
        if (!data.tools[toolId] || data.tools[toolId] <= 0) return false;

        data.tools[toolId]--;
        await this.persist();
        return true;
    }

    // --- Global Helpers ---

    private static async persist(): Promise<void> {
        if (!this._cachedData) return;
        await PlatformHandler.instance.platform.setItem(this.KEY, JSON.stringify(this._cachedData));
    }

    public static async clearEconomy(): Promise<void> {
        this._cachedData = this.createDefaultData();
        await PlatformHandler.instance.platform.removeItem(this.KEY);
    }
}