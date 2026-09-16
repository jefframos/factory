// FarmCropStorage.ts
//
// Global, entity-independent "what's planted in which farm cell" state —
// same "static class + Signal + PlatformHandler persistence" shape as
// FarmPlotStorage.ts/BackpackStorage.ts. A plot's own per-cell identity
// (FarmPlotTile.farmId/col/row) is keyed into `planted` via tileKey() — this
// is the "future planting interaction needs to key its own per-cell state"
// extension point FarmPlotTile.ts's own doc pointed at.
//
// `plantedAtSec` is a wall-clock timestamp (Date.now() / 1000), not a
// countdown — growth/harvest readiness is computed from elapsed REAL time
// against it (see CropTypes.isCropReady()), the same "carries correctly
// across a reload with no separate offline-catchup step" reasoning every
// other timestamp-based cooldown in this codebase uses (GateStorage,
// QueueStorage), rather than a duration that has to be paused/resumed.
//
// load() must be awaited once at boot (see index.ts) before PizzaScene
// spawns any FarmPlotTile — a crop planted last session has to come back
// still growing (or already ready to harvest), not reset to empty.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { CropId } from './CropTypes';

const STORAGE_KEY = 'PIZZA_FARM_CROPS';

export interface PlantedCrop {
    cropId: CropId;
    plantedAtSec: number;
}

interface FarmCropSaveData {
    planted: Record<string, PlantedCrop>;
}

export class FarmCropStorage {
    private static readonly planted = new Map<string, PlantedCrop>();

    /** Fires with the tile key that just got planted or harvested — see CropVisualComponent.ts, the one thing that redraws a cell's own growth mesh off this. */
    static readonly onChange: Signal = new Signal();

    /** Call once at boot (see index.ts), before anything reads getPlanted(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }

            const parsed = JSON.parse(raw) as FarmCropSaveData;
            const validCropIds: ReadonlySet<string> = new Set(Object.values(CropId));
            for (const [key, crop] of Object.entries(parsed.planted ?? {})) {
                if (!crop || typeof crop.plantedAtSec !== 'number' || !validCropIds.has(crop.cropId)) {
                    console.warn(`FarmCropStorage: dropping malformed/stale planted crop at "${key}" from save data`);
                    continue;
                }
                this.planted.set(key, crop);
            }
        } catch (e) {
            console.error('FarmCropStorage: failed to load save data', e);
        }
    }

    /** Stable per-cell identity — same triple FarmPlotTile.ts already carries (farmId/col/row), joined into one string so it can key a plain Map/JSON object. */
    static tileKey(farmId: string, col: number, row: number): string {
        return `${farmId}:${col}:${row}`;
    }

    /** Undefined means this cell is empty (never planted, or already harvested). */
    static getPlanted(key: string): PlantedCrop | undefined {
        return this.planted.get(key);
    }

    /** No-ops if `key` already has something growing — a caller must harvest() first. */
    static plant(key: string, cropId: CropId, plantedAtSec: number): void {
        if (this.planted.has(key)) {
            return;
        }

        this.planted.set(key, { cropId, plantedAtSec });
        this.onChange.dispatch(key);
        void this.persist();
    }

    /** Clears `key` back to empty — no-ops (returns false) if nothing was planted there. Callers are responsible for crediting CropConfig.yield themselves BEFORE calling this (see FarmPlotTile.ts), same "storage just tracks state, doesn't own the side effect" split BackpackStorage/EconomyStorage use. */
    static harvest(key: string): boolean {
        if (!this.planted.delete(key)) {
            return false;
        }

        this.onChange.dispatch(key);
        void this.persist();
        return true;
    }

    private static async persist(): Promise<void> {
        const data: FarmCropSaveData = {
            planted: Object.fromEntries(this.planted),
        };
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev reset — see FarmPlotStorage.clearAll()'s own caveat: doesn't retroactively clear any already-spawned FarmPlotTile's own mesh this session, only affects what the NEXT scene load spawns as planted. */
    static async clearAll(): Promise<void> {
        this.planted.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
