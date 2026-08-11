// ActionTypes.ts
//
// Data-driven definition of the auto-actions the player performs on
// resources (chopping, mining, ...) — see PlayerActionController.ts, which
// reads every field below and drives ThirdPersonCharacter's animator
// ACTION LAYER (see AnimatorController's own doc): animationTrigger starts
// that layer's upper-body-only clip (playAction()) and stopAction() fades
// it back out, running concurrently with the base idle/run/jump layer
// rather than replacing it — unlike jump(), which still goes through the
// base layer's board directly.
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

import { ToolId } from './ToolRegistry';

export enum ActionType {
    Chop = 'chop',
    Mine = 'mine',
    /** Bare-handed gathering (berries, ...) — no tool involved, plays its own 'pick' action-layer clip (see MainPlayer.ts's registerAnimation('pick', ...)). */
    Gather = 'gather',
}

export interface ActionConfig {
    /**
     * Seconds per hit CYCLE — one full animation loop, one hit. This is the whole
     * timing model: PlayerActionController never watches the animation's actual
     * playback state to decide when to hit (see that file's own doc for why that
     * drifted/got stuck) — it just runs a plain hitIntervalSec-long cycle and fires
     * the hit at hitTime's normalized point within it. Upgradeable; the animation's
     * playback speed (its own clip duration / hitIntervalSec, see
     * PlayerActionController.animationSpeedFor()) is recalculated to match whenever
     * this changes, so one clip loop always takes exactly one cycle. The clip's
     * duration itself comes straight from the loaded THREE.AnimationClip
     * (AnimatorController.getClipDuration()) — not hand-maintained here — so it's
     * never out of sync with whatever FBX is actually assigned to animationTrigger.
     */
    hitIntervalSec: number;
    /** Life removed from the target per hit — see ActionTarget.applyHit(). */
    damagePerHit: number;
    /**
     * Normalized position (0–1) within one hit cycle where the hit lands — e.g. 0.8
     * means 80% of the way through each hitIntervalSec-long cycle, which (since the
     * clip is scaled to loop exactly once per cycle) is also 80% through the animation.
     * Stays constant across hitIntervalSec upgrades; only the animation's playback
     * speed changes to keep matching it.
     */
    hitTime: number;
    /**
     * Whether the player walking out of the target's range cancels the action. The target
     * KEEPS whatever life it had left (nothing resets it — see ResourceNode.applyHit()),
     * so wandering off mid-chop and coming back later resumes from where it stopped
     * rather than starting the tree over.
     */
    cancelOnLeaveRange: boolean;
    /** Action-layer clip id this action plays — see AnimatorController.playActionLayer()/ThirdPersonCharacter.playAction(). Must match a registerAnimation() id (see MainPlayer.ts). */
    animationTrigger: string;
    /** Which ToolRegistry entry (see ToolRegistry.ts) PlayerActionController shows in the right hand for the action's duration — see CharacterBody.showTool(). undefined means bare hands (Gather). */
    tool?: ToolId;
}

export const ACTION_CONFIG: Record<ActionType, ActionConfig> = {
    [ActionType.Chop]: { hitIntervalSec: 1, damagePerHit: 1, hitTime: 0.8, cancelOnLeaveRange: true, animationTrigger: 'chop', tool: 'axe' },
    [ActionType.Mine]: { hitIntervalSec: 1.5, damagePerHit: 1, hitTime: 0.4, cancelOnLeaveRange: true, animationTrigger: 'mine', tool: 'pickaxe' },
    [ActionType.Gather]: { hitIntervalSec: 2, damagePerHit: 1, hitTime: 0.6, cancelOnLeaveRange: true, animationTrigger: 'pick' },
};

/**
 * A frozen snapshot of ACTION_CONFIG's hand-authored defaults, taken before anything (a shop
 * upgrade — see ShopTypes.applyShopLevel()) ever mutates it live. ACTION_CONFIG itself is NOT
 * persisted between sessions (only ShopUpgradeStorage's `level` is); this is what lets a debug
 * "reset upgrades" action put its hitIntervalSec/damagePerHit back to exactly where a fresh
 * session would start, without hand-duplicating these numbers a second time elsewhere. See
 * ShopTypes.resetAllActionConfigs(), the one reader.
 */
export const BASE_ACTION_CONFIG: Record<ActionType, ActionConfig> = JSON.parse(JSON.stringify(ACTION_CONFIG));
