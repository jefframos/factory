
import { Observable } from '../utils/Observable';
export enum SoftCurrency {
    COINS = 'coins',
}

export enum HardCurrency {
    GEMS = 'gems',
}

export enum SpecialCurrency {
    STARS = 'stars',
}
export class LevelCurrencyData {
    public soft: Record<SoftCurrency, Observable> = {
        [SoftCurrency.COINS]: new Observable(),
    };

    public hard: Record<HardCurrency, Observable> = {
        [HardCurrency.GEMS]: new Observable(),
    };

    public special: Record<SpecialCurrency, Observable> = {
        [SpecialCurrency.STARS]: new Observable(),
    };

    public dispose(): void {
        Object.values(this.soft).forEach(c => c.dispose());
        Object.values(this.hard).forEach(c => c.dispose());
        Object.values(this.special).forEach(c => c.dispose());
    }

    public toJSON(): any {
        return {
            soft: Object.fromEntries(Object.entries(this.soft).map(([k, v]) => [k, v.value])),
            hard: Object.fromEntries(Object.entries(this.hard).map(([k, v]) => [k, v.value])),
            special: Object.fromEntries(Object.entries(this.special).map(([k, v]) => [k, v.value])),
        };
    }

    public static fromJSON(data: any): LevelCurrencyData {
        const instance = new LevelCurrencyData();

        for (const [key, val] of Object.entries(data.soft ?? {})) {
            if (instance.soft[key as SoftCurrency]) {
                instance.soft[key as SoftCurrency].fromJSON(val);
            }
        }
        for (const [key, val] of Object.entries(data.hard ?? {})) {
            if (instance.hard[key as HardCurrency]) {
                instance.hard[key as HardCurrency].fromJSON(val);
            }
        }
        for (const [key, val] of Object.entries(data.special ?? {})) {
            if (instance.special[key as SpecialCurrency]) {
                instance.special[key as SpecialCurrency].fromJSON(val);
            }
        }

        return instance;
    }
}
