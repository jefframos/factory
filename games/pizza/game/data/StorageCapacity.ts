// StorageCapacity.ts
//
// How full a drop-off storage (a shop crate / shelf) gets on its own:
//
//   - The PLAYER can always drop more — there's no limit (only StorageConfig.maxItems, e.g. a mix
//     station's ingredient box, stops them — see StorageZone.isFull()).
//   - A RESTOCKER only fills it up to getStorageStockCap() — past that it finds nothing to do
//     there (Store.findRestockJob()), so only the player pushes the stock higher.
//   - The pile only DRAWS that many items too (StorageZone.buildLayout()) — the rest are counted
//     (signpost "xN", clients, the save) but not rendered, which keeps a big stock cheap.

import { StorageConfig } from './StorageTypes';
import { getShelfConfig } from './ShelfTypes';

/** Most items a drop-off storage draws, and the most a restocker puts on it. */
export const STORAGE_STOCK_CAP = 8;

/** Same fallback grid as StorageZone.buildLayout(). */
const DEFAULT_PILE = { columns: 3, rows: 3, layers: 4 };

/** The pile's own layout size — a shelf's slot count, else its grid — before STORAGE_STOCK_CAP. */
export function getStorageLayoutCapacity(config: StorageConfig): number {
    const shelf = getShelfConfig(config.shelf);
    if (shelf) {
        return shelf.slots.length;
    }
    const pile = config.pile ?? DEFAULT_PILE;
    return pile.columns * pile.rows * pile.layers;
}

/**
 * Restocker limit = drawn limit for a drop-off storage. Collect boxes and maxItems storages keep
 * their full layout — their capacity is gameplay (an animal stall's box, a mix station's batch).
 */
export function getStorageStockCap(config: StorageConfig): number {
    const layout = getStorageLayoutCapacity(config);
    if (config.collect || config.trash || config.maxItems !== undefined) {
        return layout;
    }
    return Math.min(layout, STORAGE_STOCK_CAP);
}
