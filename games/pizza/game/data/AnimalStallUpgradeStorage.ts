// AnimalStallUpgradeStorage.ts
//
// Which level each animal stall has been upgraded to at the animal keeper (a "farmDesk" of kind
// 'animals' — see FarmDeskTypes.ts). Every level past 1 adds one more animal to the stall (see
// AnimalStallTypes.getAnimalCountAt()). Same "static class + Signal + PlatformHandler persistence"
// shape as FarmUpgradeStorage.ts. A stall with no entry is level 1. load() at boot.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_ANIMAL_STALL_UPGRADES';

export class AnimalStallUpgradeStorage {
    private static readonly levels = new Map<string, number>();

    /** Fires with the stall id whose level changed. */
    static readonly onChange: Signal = new Signal();

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) as Record<string, number> : {};
            for (const [stallId, level] of Object.entries(parsed ?? {})) {
                if (typeof level === 'number' && level > 1) {
                    this.levels.set(stallId, Math.floor(level));
                }
            }
        } catch (e) {
            console.error('AnimalStallUpgradeStorage: failed to load save data', e);
        }
    }

    static getLevel(stallId: string): number {
        return this.levels.get(stallId) ?? 1;
    }

    static setLevel(stallId: string, level: number): void {
        this.levels.set(stallId, Math.max(1, Math.floor(level)));
        this.onChange.dispatch(stallId);
        void PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.levels)));
    }

    static async clearAll(): Promise<void> {
        this.levels.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
