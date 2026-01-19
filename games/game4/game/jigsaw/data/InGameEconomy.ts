import { Signal } from "signals";
import { ProgressCookieStore } from "./ProgressCookieStore";

export class InGameEconomy {
    private static _instance: InGameEconomy;

    // Signals for UI updates
    public readonly onCoinsChanged: Signal = new Signal(); // dispatch(newTotal)
    public readonly onGemsChanged: Signal = new Signal();  // dispatch(newTotal)
    public readonly onPurchaseFailed: Signal = new Signal(); // dispatch(reason)

    private store: ProgressCookieStore;

    private constructor() {
        this.store = new ProgressCookieStore();
    }

    public static get instance(): InGameEconomy {
        if (!InGameEconomy._instance) {
            InGameEconomy._instance = new InGameEconomy();
        }
        return InGameEconomy._instance;
    }

    // Getters
    public get coins(): number {
        return this.store.load().coins ?? 0;
    }

    public get gems(): number {
        return this.store.load().gems ?? 0;
    }

    /**
     * Attempts to spend currency. Returns true if successful.
     */
    public purchase(normalCost: number, specialCost: number = 0): boolean {
        const progress = this.store.load();
        const currentCoins = progress.coins ?? 0;
        const currentGems = progress.gems ?? 0;


        // Check if user can afford both
        if (currentCoins < normalCost) {
            this.onPurchaseFailed.dispatch("Not enough coins");
            return false;
        }
        if (currentGems < specialCost) {
            this.onPurchaseFailed.dispatch("Not enough gems");
            return false;
        }

        // Deduct currency
        progress.coins = currentCoins - normalCost;
        progress.gems = currentGems - specialCost;

        // Save and Notify
        this.store.save(progress);
        this.onCoinsChanged.dispatch(progress.coins);
        this.onGemsChanged.dispatch(progress.gems);

        console.log(progress)

        return true;
    }

    public addCurrency(amount: number, isSpecial: boolean = false): void {
        const progress = this.store.load();
        if (isSpecial) {
            progress.gems = (progress.gems ?? 0) + amount;
            this.store.save(progress);
            this.onGemsChanged.dispatch(progress.gems);
        } else {
            progress.coins = (progress.coins ?? 0) + amount;
            this.store.save(progress);
            this.onCoinsChanged.dispatch(progress.coins);
        }
    }
}