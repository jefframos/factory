// StaffUpgradeAlert.ts
//
// "Something to spend on" check behind the Icon_Exclamation badge on the hire desk's in-game
// "Hire" button (HireDeskZone) and on HireWorkersPopup's Upgrade tab — one shared rule so the
// two never disagree: true when ANY of the store's workers has a next upgrade level (see
// StoreTypes.getNextWorkerUpgrade()) the player can afford right now.

import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import { getNextWorkerUpgrade, getStoreConfig } from './StoreTypes';
import { StoreWorkerStorage } from './StoreWorkerStorage';

/** Exclamation badge texture — the same one BackpackButton/BuildingZone use. */
export const STAFF_ALERT_TEXTURE = 'Icon_Exclamation';

export function canAffordAnyWorkerUpgrade(storeId: string): boolean {
    const config = getStoreConfig(storeId);
    const balance = EconomyStorage.getBalance(CurrencyType.Money);
    return (StoreWorkerStorage.getRoster(storeId) ?? []).some(worker => {
        const next = getNextWorkerUpgrade(config, worker.role, worker.level ?? 1);
        return next !== undefined && balance >= next.cost;
    });
}
