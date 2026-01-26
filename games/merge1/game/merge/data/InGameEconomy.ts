import { Signal } from "signals";
import { MissionManager } from "../missions/MissionManager";
import GameStorage from "../storage/GameStorage";

export enum CurrencyType {
    MONEY = "money",
    GEMS = "gems",
    ENERGY = "energy"
}

export class InGameEconomy {
    private static _instance: InGameEconomy;

    public readonly onCurrencyChanged: Signal = new Signal();
    private _currencies: Map<CurrencyType, number> = new Map();

    public static get instance(): InGameEconomy {
        return this._instance || (this._instance = new InGameEconomy());
    }

    private constructor() {
        this.loadFromStorage();
    }

    private loadFromStorage(): void {
        const state = GameStorage.instance.getFullState();

        Object.values(CurrencyType).forEach(type => {
            let initialValue = 0;

            // Check current currencies object or handle legacy .coins field
            if (state?.currencies && state.currencies[type] !== undefined) {
                initialValue = state.currencies[type];
            } else if (type === CurrencyType.MONEY && (state as any)?.coins !== undefined) {
                initialValue = (state as any).coins;
            }

            this._currencies.set(type as CurrencyType, initialValue);
        });
    }

    public add(type: CurrencyType, amount: number): void {
        const current = this.getAmount(type);
        const next = current + amount;

        this._currencies.set(type, next);

        if (amount > 0) {
            MissionManager.instance.reportCurrencyEarned(type, amount);
        }

        // --- PATCH UPDATE ONLY ---
        // We convert the map to a plain object and send ONLY the currencies key
        GameStorage.instance.updateState({
            currencies: Object.fromEntries(this._currencies)
        });

        this.onCurrencyChanged.dispatch(type, next);
    }

    /**
     * Subtracts currency. Returns true if successful, false if insufficient funds.
     */
    public spend(type: CurrencyType, amount: number): boolean {
        const current = this.getAmount(type);
        if (current < amount) return false;



        this.add(type, -amount);
        return true;
    }

    public getAmount(type: CurrencyType): number {
        return this._currencies.get(type) || 0;
    }

    public get currencies(): Record<string, number> {
        return Object.fromEntries(this._currencies);
    }
}