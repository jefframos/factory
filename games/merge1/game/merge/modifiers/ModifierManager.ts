import { Signal } from "signals";
import { CurrencyType, InGameEconomy } from "../data/InGameEconomy";
import MergeAssets from "../MergeAssets";
import GameStorage from "../storage/GameStorage";

export enum ModifierType {
    SpawnSpeed = "SpawnSpeed",
    PassiveIncome = "PassiveIncome",
    TapIncome = "TapIncome",
    MergeIncome = "MergeIncome",
    MissionRewards = "MissionRewards",
    SpeedGeneration = "SpeedGeneration",
}

export interface IModifierConfig {
    type: ModifierType;
    name: string;
    icon: string;
    description: string;
    maxLevel: number;
    priceSteps: number[];
    maxPrice: number;
    unit: "%" | "x" | "s";
    calculateValue: (level: number) => number;
}

export class ModifierManager {
    private static _instance: ModifierManager;

    // Signals
    public readonly onModifierUpgraded: Signal = new Signal();
    public readonly onAvailabilityChanged: Signal = new Signal();

    private _levels: Map<ModifierType, number> = new Map();
    private _configs!: Record<ModifierType, IModifierConfig>;
    private _lastAvailabilityState: boolean = false;

    public static get instance(): ModifierManager {
        return this._instance || (this._instance = new ModifierManager());
    }

    private constructor() {
        this.setupConfigs();
        this.loadLevels();

        // Listen for currency changes to update notification dots/states
        InGameEconomy.instance.onCurrencyChanged.add(() => {
            this.refreshAvailability();
        });

        // Initial check
        this.refreshAvailability();
    }

    private setupConfigs(): void {
        this._configs = {
            [ModifierType.SpawnSpeed]: {
                type: ModifierType.SpawnSpeed,
                name: "Quick Paws",
                icon: MergeAssets.Textures.Modifiers.SpawnFast,
                description: "Cats spawn faster",
                maxLevel: 10,
                priceSteps: [5, 15, 30],
                maxPrice: 2500,
                unit: "%",
                calculateValue: (lvl) => lvl * 10
            },
            [ModifierType.SpeedGeneration]: {
                type: ModifierType.SpeedGeneration,
                name: "Quick Coins",
                icon: MergeAssets.Textures.Modifiers.CoinFast,
                description: "Generates coins faster",
                maxLevel: 10,
                priceSteps: [10, 20, 60],
                maxPrice: 2000,
                unit: "%",
                calculateValue: (lvl) => lvl * 10
            },
            [ModifierType.PassiveIncome]: {
                type: ModifierType.PassiveIncome,
                name: "Gold Purr",
                icon: MergeAssets.Textures.Modifiers.PassiveInconme,
                description: "Passive income boost",
                maxLevel: 10,
                priceSteps: [15, 50],
                maxPrice: 1000,
                unit: "%",
                calculateValue: (lvl) => lvl * 15
            },
            [ModifierType.TapIncome]: {
                type: ModifierType.TapIncome,
                name: "Clicker Bliss",
                icon: MergeAssets.Textures.Modifiers.TapGold,
                description: "More gold per tap",
                maxLevel: 10,
                priceSteps: [5, 10, 20, 40],
                maxPrice: 2000,
                unit: "%",
                calculateValue: (lvl) => lvl * 20
            },
            [ModifierType.MergeIncome]: {
                type: ModifierType.MergeIncome,
                name: "Merge Mastery",
                icon: MergeAssets.Textures.Modifiers.MergeBonus,
                description: "Gold bonus on merge",
                maxLevel: 10,
                priceSteps: [5, 10, 20, 40],
                maxPrice: 800,
                unit: "%",
                calculateValue: (lvl) => lvl * 25
            },
            [ModifierType.MissionRewards]: {
                type: ModifierType.MissionRewards,
                name: "Bounty Hunter",
                icon: MergeAssets.Textures.Modifiers.MissionBonus,
                description: "Better mission rewards",
                maxLevel: 10,
                priceSteps: [10],
                maxPrice: 800,
                unit: "%",
                calculateValue: (lvl) => lvl * 10
            }
        };
    }

    /**
     * Logic to determine if at least one upgrade is affordable
     */
    public hasAffordableItems(): boolean {
        const gems = InGameEconomy.instance.getAmount(CurrencyType.GEMS);

        return Object.values(this._configs).some(cfg => {
            const currentLvl = this.getLevel(cfg.type);
            if (currentLvl >= cfg.maxLevel) return false;

            const price = this.getUpgradePrice(cfg.type);
            return gems >= price;
        });
    }

    /**
     * Checks state and dispatches signal only if state flipped
     */
    public refreshAvailability(): void {
        const currentState = this.hasAffordableItems();
        if (currentState !== this._lastAvailabilityState) {
            this._lastAvailabilityState = currentState;
            this.onAvailabilityChanged.dispatch(currentState);
        }
    }

    public getUpgradePrice(type: ModifierType): number {
        const cfg = this._configs[type];
        const lvl = this.getLevel(type);

        if (lvl >= cfg.maxLevel) return Infinity;

        // 1. Fixed Steps
        if (lvl < cfg.priceSteps.length) {
            return cfg.priceSteps[lvl];
        }

        // 2. Exponential Curve
        const lastStepVal = cfg.priceSteps[cfg.priceSteps.length - 1];
        const stepsRemaining = cfg.maxLevel - cfg.priceSteps.length;
        const currentStepInCurve = lvl - (cfg.priceSteps.length - 1);

        if (stepsRemaining <= 0) return cfg.maxPrice;

        const multiplier = Math.pow(cfg.maxPrice / lastStepVal, 1 / stepsRemaining);
        const price = lastStepVal * Math.pow(multiplier, currentStepInCurve);

        return Math.floor(price);
    }

    public tryUpgrade(type: ModifierType): boolean {
        const lvl = this.getLevel(type);
        const cfg = this._configs[type];

        if (lvl >= cfg.maxLevel) return false;

        const price = this.getUpgradePrice(type);
        const economy = InGameEconomy.instance;

        if (economy.getAmount(CurrencyType.GEMS) >= price) {
            economy.spend(CurrencyType.GEMS, price);

            this._levels.set(type, lvl + 1);
            this.saveLevels();

            this.onModifierUpgraded.dispatch(type, lvl + 1);
            this.refreshAvailability();

            return true;
        }
        return false;
    }

    public getLevel(type: ModifierType): number {
        return this._levels.get(type) || 0;
    }

    public getConfig(type: ModifierType): IModifierConfig {
        return this._configs[type];
    }

    public getAllConfigs(): IModifierConfig[] {
        return Object.values(this._configs);
    }

    public getValue(type: ModifierType): number {
        return this._configs[type].calculateValue(this.getLevel(type));
    }

    public getNormalizedValue(type: ModifierType): number {
        return 1 + this.getValue(type) / 100;
    }

    private loadLevels(): void {
        const state = GameStorage.instance.getFullState();
        const saved = (state as any).modifierLevels || {};
        Object.keys(saved).forEach(k => this._levels.set(k as ModifierType, saved[k]));
    }

    private saveLevels(): void {
        GameStorage.instance.updateState({
            modifierLevels: Object.fromEntries(this._levels)
        });
    }
}