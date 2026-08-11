// QueueTypes.ts
//
// Data-driven definition of what a queue's tasks look like — same "pure
// data, no engine imports" shape as ResourceTypes.ts/BuildingTypes.ts.
// Unlike BuildingId/GateId (small, fixed, hand-authored enums each with
// their own upgrade-ladder config), a queue's id comes straight from
// whatever's drawn on the Tiled map (see WorldObjectRegistry.getAllOfType()
// /PizzaScene.setupQueues()) — there's no fixed enum of queue ids to attach
// per-id config to ahead of time. So QUEUE_CONFIG_BY_ID is an OPTIONAL
// override map (empty by default): any queue id not listed there just gets
// DEFAULT_QUEUE_CONFIG, which is what lets a level designer drop a brand
// new "queue7" object on the map and have it fully work with zero code
// changes — see getQueueConfig(), the one reader.

import { ResourceType } from '../actions/ResourceTypes';

export interface QueueTaskDef {
    resourceType: ResourceType;
    /** How many units of resourceType this task asks for. */
    amount: number;
    /** CurrencyType.Money awarded once `amount` is fully delivered. */
    rewardAmount: number;
}

export interface QueueConfig {
    /** Seconds after completing a task before the next one becomes available — see QueueStorage.tryRollNextTask(). */
    cooldownSec: number;
    /** One is picked at random whenever a new task starts — see QueueStorage.tryRollNextTask(). */
    possibleTasks: QueueTaskDef[];
}

/** Applied to every discovered queue unless QUEUE_CONFIG_BY_ID has an override for its id — see this file's own doc. */
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
    cooldownSec: 30,
    possibleTasks: [
        { resourceType: ResourceType.Tree, amount: 10, rewardAmount: 25 },
        { resourceType: ResourceType.Stone, amount: 8, rewardAmount: 30 },
        { resourceType: ResourceType.Berries, amount: 15, rewardAmount: 20 },
    ],
};

/** Per-queue-id overrides — e.g. QUEUE_CONFIG_BY_ID['queue1'] = { cooldownSec: 10, possibleTasks: [...] } for a queue that should behave differently from every other one. Empty until a level actually needs one. */
export const QUEUE_CONFIG_BY_ID: Partial<Record<string, QueueConfig>> = {};

/** The config a queue with this id should use — its own override if QUEUE_CONFIG_BY_ID has one, else DEFAULT_QUEUE_CONFIG. */
export function getQueueConfig(id: string): QueueConfig {
    return QUEUE_CONFIG_BY_ID[id] ?? DEFAULT_QUEUE_CONFIG;
}
