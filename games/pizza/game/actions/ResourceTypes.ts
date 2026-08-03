// ResourceTypes.ts
//
// Data-driven definition of what a ResourceNode can be — which ActionType
// gathering it plays (see ActionTypes.ts), how much it yields per gather,
// and how it looks (AutoGatherController/ResourceNode read this instead of
// hardcoding per-resource branches). Two resource types for now, matching
// the design doc's "start with Wood, unlock Stone" — Iron/Crystal slot in
// here later without touching ResourceNode/AutoGatherController at all.

import { ActionType } from './ActionTypes';

export enum ResourceType {
    Tree = 'tree',
    Stone = 'stone',
}

export interface ResourceConfig {
    /** Which timed action (see ActionTypes.ts) gathering this resource plays. */
    action: ActionType;
    /**
     * How many hit-points this node absorbs before it yields — the player chips this down
     * damagePerHit at a time (see ActionConfig), and partial progress SURVIVES walking
     * away, so this is "how much total work a full harvest is," not a timer. Combined with
     * the action's hitIntervalSec/damagePerHit, this is what actually sets time-to-harvest:
     * 5 life at 1 damage per 1s = the design doc's 5 seconds per tree.
     */
    maxLife: number;
    /** How much of this resource one successful gather cycle grants. */
    amountPerGather: number;
    /** Seconds the node stays depleted (hidden, trigger disabled) before it respawns — see ResourceNode.deplete()/respawn(). */
    respawnSec: number;
    /** Display name for UI (drop-zone deposit popup, etc.) — see ScreenAnchorComponent usage in DropZone. */
    label: string;
    /** Placeholder color for this resource's primitive mesh (cylinder for Tree, box for Stone — see ResourceNode.ts) until real art exists. */
    color: number;
}

export const RESOURCE_CONFIG: Record<ResourceType, ResourceConfig> = {
    [ResourceType.Tree]: {
        action: ActionType.Chop,
        maxLife: 5,
        amountPerGather: 1,
        respawnSec: 8,
        label: 'Wood',
        color: 0x6b4423,
    },
    [ResourceType.Stone]: {
        action: ActionType.Mine,
        maxLife: 5,
        amountPerGather: 1,
        respawnSec: 10,
        label: 'Stone',
        color: 0x8a8a8a,
    },
};
