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
// wait: every hitIntervalSec the action removes hitScale life from whatever
// it's acting on (see PlayerActionController.update(), which caps that at
// whatever life the target has actually got left — no overkill), and
// finishes only once that target reports itself depleted. Total time to
// clear a target therefore falls out of the data rather than being
// configured directly — a tree with maxLife 5 (see ResourceTypes.ts) under
// Chop's default hitScale 1/1s hitIntervalSec is the design doc's "5 seconds
// per tree".
//
// Tool upgrades (M4) are THREE independent knobs, not one:
//   - hitIntervalSec: swings faster, no change to yield per swing.
//   - hitScale: how many hits one swing counts as — shrinks the hit COUNT
//     needed to clear a target (a level whose hitScale reaches 5 one-shots
//     a 5-life tree), capped at the target's remaining life so overkill
//     never counts for more hits than the target actually had left.
//   - resourcePerHit: how much AutoGatherController.onHitLanded() banks
//     PER HIT (amountPerGather * resourcePerHit * hits) — deliberately NEVER
//     capped by remaining life, unlike hitScale. This is what lets a
//     resourcePerHit upgrade pull a total yield well past a tree's own
//     maxLife: hitScale 3 with resourcePerHit 3 on a 5-life tree banks 3
//     hits' worth (capped) at 3 each = 9 in one swing, then the last 2
//     life's worth (hitScale capped to 2) banks 2*3 = 6 more — 15 total,
//     not the 5 a hitScale-only reading of "5 life = 5 wood" would suggest.

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
    /**
     * How many hits one swing counts as — life removed from the target per swing (see
     * ActionTarget.applyHit()). Capped at the target's own remaining life for a killing blow
     * (see PlayerActionController.update()), so this can go arbitrarily high (a 10-level axe
     * ladder tops out well past most maxLife values) without ever removing more life than a
     * target actually had. Purely about hit COUNT/kill speed — see resourcePerHit for the
     * separate, uncapped knob that controls how much each of those hits is actually worth.
     */
    hitScale: number;
    /**
     * Yield banked per hit — see AutoGatherController.onHitLanded(), which multiplies this by
     * amountPerGather and the (possibly hitScale-capped) hit count a swing actually removed.
     * Deliberately NEVER capped by a target's remaining life the way hitScale is: this is
     * "how much extra you extract per hit," not "how fast you kill," so a resourcePerHit
     * upgrade is what lets a fully-upgraded tool pull a total yield well past a tree's own
     * maxLife (see this file's own doc for the worked example).
     */
    resourcePerHit: number;
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
    [ActionType.Chop]: { hitIntervalSec: 1, hitScale: 1, resourcePerHit: 1, hitTime: 0.8, cancelOnLeaveRange: true, animationTrigger: 'chop', tool: "axe" },
    [ActionType.Mine]: { hitIntervalSec: 1.5, hitScale: 1, resourcePerHit: 1, hitTime: 0.4, cancelOnLeaveRange: true, animationTrigger: 'mine', tool: "pickaxe" },
    [ActionType.Gather]: { hitIntervalSec: 2, hitScale: 1, resourcePerHit: 1, hitTime: 0.6, cancelOnLeaveRange: true, animationTrigger: 'pick' },
};

/**
 * A frozen snapshot of ACTION_CONFIG's hand-authored defaults, taken before anything (a shop
 * upgrade — see ShopTypes.applyShopLevel()) ever mutates it live. ACTION_CONFIG itself is NOT
 * persisted between sessions (only ShopUpgradeStorage's `level` is); this is what lets a debug
 * "reset upgrades" action put its hitIntervalSec/hitScale/resourcePerHit back to exactly where a fresh
 * session would start, without hand-duplicating these numbers a second time elsewhere. See
 * ShopTypes.resetAllActionConfigs(), the one reader.
 */
export const BASE_ACTION_CONFIG: Record<ActionType, ActionConfig> = JSON.parse(JSON.stringify(ACTION_CONFIG));
