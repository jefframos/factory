// DynamicResourceStorage.ts
//
// Persisted positions for DynamicResourceSpawner.ts's own scattered
// instances — same "static class + PlatformHandler persistence" shape as
// BackpackStorage/QueueStorage, keyed by DynamicResourceConfig.id (a plain
// string, same open-ended convention QueueStorage uses for queue ids).
//
// Only the (col, row) tile cell is persisted, not a live entity — an
// instance far from the player is tracked as pure data (this is exactly
// what keeps a walked-away area's loot from silently regenerating with a
// brand new random layout every time the player wanders back: the SAME
// cells stay reserved, whether or not anything is currently rendered
// there). DynamicResourceSpawner is the only thing that turns a persisted
// record into an actual LooseResourceNode, and only for however long the
// player is within PERFORMANCE_CONFIG.resourceLoadRadius/UnloadRadius of it
// — see that file's own doc.
//
// A record's (col, row) pair IS its own id — two different instances of the
// same config can never legitimately share a cell (see
// DynamicResourceSpawner.isFarEnough()), so there's no need for a separate
// generated id.
//
// load() must be awaited once at boot (see index.ts) before anything reads
// getRecords(). Every mutation fires an async persist() (fire-and-forget,
// same convention as every other *Storage.ts here).

import PlatformHandler from 'core/platforms/PlatformHandler';

const STORAGE_KEY = 'PIZZA_DYNAMIC_RESOURCES';

export interface DynamicResourceRecord {
    col: number;
    row: number;
}

export class DynamicResourceStorage {
    private static readonly recordsByConfigId = new Map<string, DynamicResourceRecord[]>();

    /** Call once at boot (see index.ts), before anything reads getRecords(). */
    static async load(): Promise<void> {
        try {
            const raw = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            const parsed: Record<string, DynamicResourceRecord[]> = raw ? JSON.parse(raw) : {};
            for (const [configId, records] of Object.entries(parsed)) {
                if (Array.isArray(records)) {
                    this.recordsByConfigId.set(configId, records.filter(r => typeof r?.col === 'number' && typeof r?.row === 'number'));
                }
            }
        } catch (e) {
            console.error('DynamicResourceStorage: failed to load save data', e);
        }
    }

    /** Every persisted record for `configId` — a fresh copy, so a caller can't mutate this storage's own state by holding onto the returned array. Empty array (not undefined) if nothing's been spawned for this config yet. */
    static getRecords(configId: string): DynamicResourceRecord[] {
        return [...(this.recordsByConfigId.get(configId) ?? [])];
    }

    /** Reserves (col, row) for `configId` — called the instant DynamicResourceSpawner spawns a new instance there, so the cell survives a reload even if the player leaves before it's ever picked up. */
    static addRecord(configId: string, record: DynamicResourceRecord): void {
        let records = this.recordsByConfigId.get(configId);
        if (!records) {
            records = [];
            this.recordsByConfigId.set(configId, records);
        }
        records.push(record);
        void this.persist();
    }

    /** Frees (col, row) for `configId` — called once that instance is fully harvested (see LooseResourceNode.ts's onConsumed), so a picked-up spot doesn't count against density forever. No-ops if that cell was never actually recorded (defensive; shouldn't happen). */
    static removeRecord(configId: string, record: DynamicResourceRecord): void {
        const records = this.recordsByConfigId.get(configId);
        if (!records) {
            return;
        }
        const index = records.findIndex(r => r.col === record.col && r.row === record.row);
        if (index === -1) {
            return;
        }
        records.splice(index, 1);
        void this.persist();
    }

    private static async persist(): Promise<void> {
        const data: Record<string, DynamicResourceRecord[]> = Object.fromEntries(this.recordsByConfigId);
        await PlatformHandler.instance.platform.setItem(STORAGE_KEY, JSON.stringify(data));
    }

    /** Debug/dev + "Clear Data" reset — wipes every persisted record and removes the save entirely. Live-rendered instances (if any) are NOT this class's job to tear down — see DynamicResourceSpawner.resetAll(), which clears both. */
    static async clearAll(): Promise<void> {
        this.recordsByConfigId.clear();
        await PlatformHandler.instance.platform.removeItem(STORAGE_KEY);
    }
}
