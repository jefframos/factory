import { Signal } from "signals";
import { ProgressCookieStore } from "./ProgressCookieStore";

export class InGameEconomy {
    private static _instance: InGameEconomy;

    public readonly onCoinsChanged: Signal = new Signal();
    public readonly onGemsChanged: Signal = new Signal();
    public readonly onPurchaseFailed: Signal = new Signal();

    private store: ProgressCookieStore;

    // Local cache to allow synchronous access
    private _coins: number = 0;
    private _gems: number = 0;
    private _isInitialized: boolean = false;

    private constructor() {
        this.store = new ProgressCookieStore();
    }

    public static get instance(): InGameEconomy {
        if (!InGameEconomy._instance) {
            InGameEconomy._instance = new InGameEconomy();
        }
        return InGameEconomy._instance;
    }

    /**
     * Call this once at game start (e.g., in your Boot or Preloader scene)
     */
    public async initialize(): Promise<void> {
        const progress = await this.store.load();
        this._coins = progress.coins ?? 0;
        this._gems = progress.gems ?? 0;
        this._isInitialized = true;

        // Notify any listeners (like the UI Hud) of the initial values
        this.onCoinsChanged.dispatch(this._coins);
        this.onGemsChanged.dispatch(this._gems);
    }

    // Getters now return the cached value instantly
    public get coins(): number {
        return this._coins;
    }

    public get gems(): number {
        return this._gems;
    }

    public async purchase(normalCost: number, specialCost: number = 0): Promise<boolean> {
        if (!this._isInitialized) await this.initialize();

        if (this._coins < normalCost) {
            this.onPurchaseFailed.dispatch("Not enough coins");
            return false;
        }
        if (this._gems < specialCost) {
            this.onPurchaseFailed.dispatch("Not enough gems");
            return false;
        }

        // Update local cache
        this._coins -= normalCost;
        this._gems -= specialCost;

        // Save to store and Notify
        await this.syncWithStore();

        this.onCoinsChanged.dispatch(this._coins);
        this.onGemsChanged.dispatch(this._gems);

        return true;
    }

    public async addCurrency(amount: number, isSpecial: boolean = false): Promise<void> {
        if (!this._isInitialized) await this.initialize();

        if (isSpecial) {
            this._gems += amount;
            this.onGemsChanged.dispatch(this._gems);
        } else {
            this._coins += amount;
            this.onCoinsChanged.dispatch(this._coins);
        }

        await this.syncWithStore();
    }

    /**
     * Internal helper to write the current local state back to the cookie/store
     */
    private async syncWithStore(): Promise<void> {
        const progress = await this.store.load();
        progress.coins = this._coins;
        progress.gems = this._gems;
        this.store.save(progress);
    }
}