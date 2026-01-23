import { Signal } from "signals";
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
            // Priority 1: state.currencies[type]
            // Priority 2: state.coins (migration)
            // Priority 3: 0
            let initialValue = 0;
            if (state?.currencies && state.currencies[type] !== undefined) {
                initialValue = state.currencies[type];
            } else if (type === CurrencyType.MONEY && state?.coins !== undefined) {
                initialValue = state.coins;
            }

            this._currencies.set(type as CurrencyType, initialValue);
        });
    }

    public add(type: CurrencyType, amount: number): void {
        const current = this.getAmount(type);
        const next = current + amount;

        this._currencies.set(type, next);

        // --- THE CRITICAL FIX: ACTUAL SAVE ---
        const fullState = GameStorage.instance.getFullState();
        if (fullState) {
            // Update the currencies object inside the state
            fullState.currencies = Object.fromEntries(this._currencies);

            // Push to LocalStorage
            GameStorage.instance.saveFullState(fullState);
        }

        this.onCurrencyChanged.dispatch(type, next);
    }

    public getAmount(type: CurrencyType): number {
        return this._currencies.get(type) || 0;
    }
}