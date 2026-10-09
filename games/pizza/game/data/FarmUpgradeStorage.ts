// FarmUpgradeStorage.ts
//
// Which level each farm has been upgraded to at the farm manager (see FarmUpgradeTypes.ts) —
// same "static class + Signal + PlatformHandler persistence" shape as FarmPlotStorage.ts. A farm
// with no entry is level 1. load() must be awaited at boot (see index.ts).

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { getFarmUpgradeStats } from './FarmUpgradeTypes';
import { getFarmPlotConfig } from './FarmTypes';
import { CROP_CONFIG } from './CropTypes';
import type { ResourceType } from '../actions/ResourceTypes';

const STORAGE_KEY = 'PIZZA_FARM_UPGRADES';

export class FarmUpgradeStorage {
    private static readonly levels = new Map<string, number>();

    /** Fires with the farm id whose level changed. */
    static readonly onChange: Signal = new Signal();

    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const parsed = JSON.parse(raw) as Record<string, number>;
            for (const [farmId, level] of Object.entries(parsed ?? {})) {
                if (typeof level === 'number' && level > 1) {
                    this.levels.set(farmId, Math.floor(level));
                }
            }
        } catch (e) {
            console.error('FarmUpgradeStorage: failed to load save data', e);
        }
    }

    static getLevel(farmId: string): number {
        return this.levels.get(farmId) ?? 1;
    }

    static setLevel(farmId: string, level: number): void {
        this.levels.set(farmId, Math.max(1, Math.floor(level)));
        this.onChange.dispatch(farmId);
        void this.persist();
    }

    /** x crop growth speed for this farm right now. */
    static getGrowSpeed(farmId: string): number {
        return getFarmUpgradeStats(farmId, this.getLevel(farmId)).growSpeed;
    }

    /** Extra units per harvest for this farm right now. */
    static getYieldBonus(farmId: string): number {
        return getFarmUpgradeStats(farmId, this.getLevel(farmId)).yieldBonus;
    }

    /** Store price bonus (fraction) for `type` — the best among upgraded farms growing it (see FarmUpgradeLevelConfig.priceBonus). */
    static getPriceBonusFor(type: ResourceType): number {
        let best = 0;
        for (const farmId of this.levels.keys()) {
            const cropId = getFarmPlotConfig(farmId).assignedCropId;
            if (cropId && CROP_CONFIG[cropId]?.yield.resourceType === type) {
                best = Math.max(best, getFarmUpgradeStats(farmId, this.getLevel(farmId)).priceBonus);
            }
        }
        return best;
    }

    private static async persist(): Promise<void> {
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.levels)));
    }

    static async clearAll(): Promise<void> {
        this.levels.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
