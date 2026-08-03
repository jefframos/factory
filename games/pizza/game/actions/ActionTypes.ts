// ActionTypes.ts
//
// Data-driven definition of the auto-actions the player performs on
// resources (chopping, mining, ...) — see PlayerActionController.ts, which
// reads every field below and fires animationTrigger/ACTION_DONE_TRIGGER on
// ThirdPersonCharacter's animator (see CharacterBody.setUp() for the
// matching board transitions — 'any' -> animationTrigger -> back to 'idle'
// on ACTION_DONE_TRIGGER, same shape jump() already used).
//
// Actions are REPEATED HITS against a target's life, not one fixed-length
// wait: every hitIntervalSec the action deals damagePerHit to whatever it's
// acting on (see ActionTarget in PlayerActionController.ts), and finishes
// only once that target reports itself depleted. Total time to clear a
// target therefore falls out of the data rather than being configured
// directly — a tree with maxLife 5 (see ResourceTypes.ts) under Chop's
// 1 damage every 1s is the design doc's "5 seconds per tree". Tool
// upgrades (M4) raise damagePerHit rather than shrinking a duration, which
// is both the more natural knob for a better axe and the reason the
// per-hit numbers are the source of truth here.

export enum ActionType {
    Chop = 'chop',
    Mine = 'mine',
}

export interface ActionConfig {
    /**
     * Seconds between individual hits — one swing of the axe/pickaxe. Should be tuned to
     * roughly the length of animationTrigger's clip: the clip loops for the whole action
     * (see PlayerActionController, which triggers it once on start rather than restarting
     * it per hit, so hits land mid-loop instead of snapping the pose back every time).
     */
    hitIntervalSec: number;
    /** Life removed from the target per hit — see ActionTarget.applyHit(). */
    damagePerHit: number;
    /**
     * Whether the player walking out of the target's range cancels the action. The target
     * KEEPS whatever life it had left (nothing resets it — see ResourceNode.applyHit()),
     * so wandering off mid-chop and coming back later resumes from where it stopped
     * rather than starting the tree over.
     */
    cancelOnLeaveRange: boolean;
    /** Animator-board trigger name that enters this action's animation state — see CharacterBody.setUp(). */
    animationTrigger: string;
}

export const ACTION_CONFIG: Record<ActionType, ActionConfig> = {
    [ActionType.Chop]: { hitIntervalSec: 1, damagePerHit: 1, cancelOnLeaveRange: true, animationTrigger: 'chop' },
    [ActionType.Mine]: { hitIntervalSec: 1.2, damagePerHit: 1, cancelOnLeaveRange: true, animationTrigger: 'mine' },
};

/** Shared trigger every action's animation state transitions back to 'idle' on — fired by PlayerActionController when an action ends, whether it completed or was cancelled (both stop the swing). Consumed by CharacterBody.setUp()'s per-action transitions. One shared name (not per-action) since "the action just ended" means the same thing regardless of which one it was. */
export const ACTION_DONE_TRIGGER = 'actionDone';
