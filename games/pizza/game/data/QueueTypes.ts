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
import { ItemType } from '../crafting/ItemTypes';
import { MilestoneRequirement } from './MilestoneRequirement';
import { PopupMode } from '../ui/PopupConfig';
import { FrameName } from '../ui/FrameRegistry';

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
    /**
     * Optional — when set, this queue's QueueZone isn't spawned at all (see PizzaScene.
     * trySpawnQueues()) until MilestoneRequirement.ts's isMilestoneRequirementMet() says this
     * is satisfied. Same shared requirement shape GateTypes.ts's GateConfig.requirement uses
     * ("a building reaching a required level" or "owning a particular crafted item" — see
     * that file's own doc), for the exact same reason: a queue appearing is just as much "some
     * OTHER game milestone happened" as a gate unlocking is. Checked once at boot for every
     * queue already drawn on the map, AND again every time notifyBuildingLevelUp()/
     * notifyItemCrafted() fires — see PizzaScene.ts's own doc — so a queue whose requirement
     * becomes true mid-session appears right then, not only after a reload. undefined (the
     * default for every queue below except queue1) means "always appears," unchanged from
     * before this field existed.
     */
    appearRequirement?: MilestoneRequirement;
    /** Requirements-panel style — see PopupConfig.ts's own doc. undefined behaves as 'complete' (this queue's existing reward-line + resource-row panel), unchanged from before this field existed. */
    popupMode?: PopupMode;
    /** How high above this queue's own base the requirements panel floats — see PopupConfig.ts's own doc. undefined/0 sits it right at the queue's base instead of floating. */
    popupBobOffset?: number;
    /** Optional real-mesh override, keyed into EntityViewRegistry.ts's ENTITY_VIEW_CONFIG — see BuildingLevelConfig.view's own doc for the full convention. undefined keeps QueueZone's own existing hardcoded visual, unchanged from before this field existed. */
    view?: string;
    /** Overrides FrameRegistry.ts's 'QueueFrame' default for THIS queue's own popup — see PopupConfig.ts's resolvePopupFrameName()'s own doc. undefined uses the type-wide default. */
    frame?: FrameName;
}

/** Applied to every discovered queue unless QUEUE_CONFIG_BY_ID has an override for its id — see this file's own doc. */
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
    "cooldownSec": 30,
    "possibleTasks": [
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
    ]
};

/** Per-queue-id overrides — e.g. QUEUE_CONFIG_BY_ID['queue1'] = { cooldownSec: 10, possibleTasks: [...] } for a queue that should behave differently from every other one. */
export const QUEUE_CONFIG_BY_ID: Partial<Record<string, QueueConfig>> = {
    // Doesn't appear at all until the player has crafted a pickaxe — see QueueConfig.
    // appearRequirement's own doc. Everything else (cooldown, tasks) stays the default.
    queue1: {
        ...DEFAULT_QUEUE_CONFIG,
        appearRequirement: {
            "type": "item",
            "item": ItemType.Pickaxe
        },
        "cooldownSec": 30,
        "possibleTasks": [
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
        "popupBobOffset": 2
    },
};

/** The config a queue with this id should use — its own override if QUEUE_CONFIG_BY_ID has one, else DEFAULT_QUEUE_CONFIG. */
export function getQueueConfig(id: string): QueueConfig {
    return QUEUE_CONFIG_BY_ID[id] ?? DEFAULT_QUEUE_CONFIG;
}
