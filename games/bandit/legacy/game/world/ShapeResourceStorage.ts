// ShapeResourceStorage.ts
//
// Persisted positions for ShapeResourceSpawner.ts's own scattered instances
// — sibling to DynamicResourceStorage.ts, same "static class + PlatformHandler
// persistence" shape, keyed by ShapeResourceTypes.shapePlacementKey(). Only
// difference: a shape spawner's candidate spots aren't discrete tile cells,
// so a record here is a raw world-space (x, z) point instead of a (col,
// row) pair — see ShapeResourceSpawner.ts's own doc for why (random point
// inside an arbitrary rect/circle/polygon, not a painted grid).
//
// load() must be awaited once at boot (see index.ts) before anything reads
// getRecords(). Every mutation fires an async persist() (fire-and-forget,
// same convention as DynamicResourceStorage.ts).

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_SHAPE_RESOURCES';

export interface ShapeResourceRecord {
    x: number;
    z: number;
}

export class ShapeResourceStorage {
    private static readonly recordsByPlacementKey = new Map<string, ShapeResourceRecord[]>();

    /** Call once at boot (see index.ts), before anything reads getRecords(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Record<string, ShapeResourceRecord[]> = raw ? JSON.parse(raw) : {};
            for (const [placementKey, records] of Object.entries(parsed)) {
                if (Array.isArray(records)) {
                    this.recordsByPlacementKey.set(placementKey, records.filter(r => typeof r?.x === 'number' && typeof r?.z === 'number'));
                }
            }
        } catch (e) {
            console.error('ShapeResourceStorage: failed to load save data', e);
        }
    }

    /** Every persisted record for `placementKey` (see ShapeResourceTypes.shapePlacementKey()) — a fresh copy. Empty array (not undefined) if nothing's been spawned for this placement yet. */
    static getRecords(placementKey: string): ShapeResourceRecord[] {
        return [...(this.recordsByPlacementKey.get(placementKey) ?? [])];
    }

    /** Reserves (x, z) for `placementKey` — called the instant ShapeResourceSpawner spawns a new instance there, so the point survives a reload even if the player leaves before it's ever picked up. */
    static addRecord(placementKey: string, record: ShapeResourceRecord): void {
        let records = this.recordsByPlacementKey.get(placementKey);
        if (!records) {
            records = [];
            this.recordsByPlacementKey.set(placementKey, records);
        }
        records.push(record);
        void this.persist();
    }

    /** Frees (x, z) for `placementKey` — called once that instance is fully harvested. No-ops if that point was never actually recorded (defensive; shouldn't happen). Matches on exact value since these are only ever produced (never rounded/quantized) by ShapeResourceSpawner itself. */
    static removeRecord(placementKey: string, record: ShapeResourceRecord): void {
        const records = this.recordsByPlacementKey.get(placementKey);
        if (!records) {
            return;
        }
        const index = records.findIndex(r => r.x === record.x && r.z === record.z);
        if (index === -1) {
            return;
        }
        records.splice(index, 1);
        void this.persist();
    }

    private static async persist(): Promise<void> {
        const data: Record<string, ShapeResourceRecord[]> = Object.fromEntries(this.recordsByPlacementKey);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev + "Clear Data" reset — wipes every persisted record and removes the save entirely. Live-rendered instances (if any) are NOT this class's job to tear down — see ShapeResourceSpawner.resetAll(), which clears both. */
    static async clearAll(): Promise<void> {
        this.recordsByPlacementKey.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
