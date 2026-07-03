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
