// ResourceTypes.ts
//
// Data-driven definition of what a ResourceNode can be — which ActionType
// gathering it plays (see ActionTypes.ts), how much it yields per gather,
// and how it looks (AutoGatherController/ResourceNode read this instead of
// hardcoding per-resource branches). Wood/Stone/Berries for now — Iron/
// Crystal slot in here later without touching ResourceNode/
// AutoGatherController at all.

import { ActionType } from './ActionTypes';

export enum ResourceType {
    Tree = 'tree',
    Stone = 'stone',
    Berries = 'berries',
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
    /**
     * Horizontal radius of a SOLID collider centered on the node, blocking the player from
     * walking through it — separate from the gather-radius trigger (see ResourceNode.awake(),
     * TRIGGER_HALF_EXTENTS), which stays a trigger regardless so gathering range is unaffected.
     * 0 means no solid collider at all — the player can walk straight over the node (berry
     * bushes: low enough to step over). Trees/rocks get a nonzero radius so they physically
     * block the player like the ground/environment does.
     */
    solidRadius: number;
}

export const RESOURCE_CONFIG: Record<ResourceType, ResourceConfig> = {
    [ResourceType.Tree]: {
        action: ActionType.Chop,
        maxLife: 5,
        amountPerGather: 1,
        respawnSec: 60,
        label: 'Wood',
        color: 0x6b4423,
        solidRadius: 0.5,
    },
    [ResourceType.Stone]: {
        action: ActionType.Mine,
        maxLife: 5,
        amountPerGather: 1,
        respawnSec: 80,
        label: 'Stone',
        color: 0x8a8a8a,
        solidRadius: 0.6,
    },
    [ResourceType.Berries]: {
        action: ActionType.Gather,
        maxLife: 2,
        amountPerGather: 1,
        respawnSec: 50,
        label: 'Berries',
        color: 0xcc2244,
        solidRadius: 0,
    },
};
