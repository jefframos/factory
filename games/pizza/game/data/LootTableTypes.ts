// LootTableTypes.ts
//
// Reusable, named pools of QueueTaskDef — same "separate id-keyed lookup
// joined by convention, not embedded inline" shape as EntityViewRegistry.ts,
// one level below QuestGiverTypes.ts: a QuestGiverVariant (see that file's
// own doc) references ONE loot table by id instead of carrying its own
// possibleTasks list inline, so the exact same task pool can be reused
// across multiple variants (or, in principle, multiple queues) without
// duplicating it, and so the pizza web editor can manage it as its own
// flat, addable/removable list of entries (a nested list of tasks INSIDE
// each variant made the Quest Givers tab's own "+ Add" flow for tasks
// impossible to drive from the generic editor — see this file's own
// introduction commit).

import { QueueTaskDef } from './QueueTypes';
import { ResourceType } from '../actions/ResourceTypes';

export interface LootTableConfig {
    possibleTasks: QueueTaskDef[];
}

/** Per-loot-table-id config, set from the pizza web editor's "Loot Tables" tab — empty by default. */
export const LOOT_TABLE_CONFIG: Record<string, LootTableConfig> = {
    queue1BaseLoot: {
        possibleTasks: [
            {
                "resourceType": ResourceType.Wood,
                "amount": 10,
                "rewardAmount": 25
            },
            {
                "resourceType": ResourceType.Stone,
                "amount": 8,
                "rewardAmount": 30
            },
            {
                "resourceType": ResourceType.Berries,
                "amount": 15,
                "rewardAmount": 20
            }
        ],
    },
};

export function getLootTable(id: string): LootTableConfig | undefined {
    return LOOT_TABLE_CONFIG[id];
}
