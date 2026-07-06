/**
 * One persistent NPC in the world population — exists whether or not it's
 * currently rendered. `state: 'idle'` records are simulated as plain data by
 * NpcRoster; `state: 'active'` records are backed by a real BotController +
 * PlayerEntity (owned by NpcDirector) and are NOT touched by the roster's own
 * simulation loop — the live BT/physics drives them instead.
 */
export type NpcRecord = {
    readonly id: number;
    /** Head value — mirrors PlayerEntity.value. */
    value: number;
    /** Tail cube values, sorted descending — mirrors PlayerEntity.tailSnapshot() ordering. */
    tailValues: number[];
    state: 'idle' | 'active';
    /** Seconds accumulated toward this record's next idle feed tick. Unused while active. */
    idleSince: number;
    /** Loose "last seen" position hint, world-units. Not authoritative — see NpcDirector for how it's used. */
    approxX: number;
    approxZ: number;
};

/** No config dependency here on purpose — callers (NpcRoster) pass the respawn value from NpcConfig so this file stays pure data. */
export function createFreshRecord(id: number, startValue: number): NpcRecord {
    return {
        id,
        value: startValue,
        tailValues: [],
        state: 'idle',
        idleSince: 0,
        approxX: 0,
        approxZ: 0,
    };
}

/** Total value: head + every tail cube — same definition as PlayerEntity.score. */
export function scoreOf(record: NpcRecord): number {
    return record.tailValues.reduce((sum, v) => sum + v, record.value);
}

/**
 * Plain-data equivalent of PlayerEntity.scheduleMerges, shared by NpcRoster
 * and GrowthSimulator: absorbs a head-matching front tail cube into the head
 * first (same priority reason as the real one — otherwise a tail merge can
 * double past the head and permanently orphan it), then collapses adjacent
 * equal pairs closest to the head first, re-checking head-absorb after each
 * collapse since a tail merge can produce a new head match. Takes a bare
 * {value, tailValues} shape (not the full NpcRecord) so GrowthSimulator's
 * throwaway simulation entities can reuse it without depending on the rest
 * of NpcRecord's fields.
 */
export function collapseMerges(entity: { value: number; tailValues: number[] }): void {
    let changed = true;
    while (changed) {
        changed = false;

        while (entity.tailValues.length > 0 && entity.tailValues[0] === entity.value) {
            entity.value *= 2;
            entity.tailValues.shift();
            changed = true;
        }

        for (let i = 0; i < entity.tailValues.length - 1; i++) {
            if (entity.tailValues[i] === entity.tailValues[i + 1]) {
                entity.tailValues[i] *= 2;
                entity.tailValues.splice(i + 1, 1);
                changed = true;
                break;
            }
        }
    }
}
