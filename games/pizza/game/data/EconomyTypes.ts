// EconomyTypes.ts
//
// Data-driven definition of the game's currencies — same "pure data, no
// engine imports" shape as ResourceTypes.ts (ActionType/ResourceConfig).
// Money is the BASE currency (queue task rewards, eventually shop spend);
// a second currency (gems, tickets, ...) slots in here later as another
// CurrencyType member + CURRENCY_CONFIG entry — nothing that reads
// CURRENCY_CONFIG generically needs to change.

import { AssetLibraryKey } from '../world/AssetLibraryRegistry';

export enum CurrencyType {
    Money = 'money',
}

export interface CurrencyConfig {
    /** Display name for UI (EconomyUI, queue reward line, ...). */
    label: string;
    /** Which AssetLibraryRegistry entry's icon represents this currency — see getAssetIcon(). */
    assetKey: AssetLibraryKey;
}

export const CURRENCY_CONFIG: Record<CurrencyType, CurrencyConfig> = {
    [CurrencyType.Money]: {
        label: 'Money',
        assetKey: 'money',
    },
};
