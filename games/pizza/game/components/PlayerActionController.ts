// PlayerActionController.ts
//
// Runs the player's automatic, repeated-hit actions (chopping, mining, ...)
// — see ActionTypes.ts for the per-action timing/damage. An action is a loop,
// not a single wait: `onPlayActionAnimation()` starts it, and from then on
// this component
//
//   1. fires the per-action animator-board trigger once (ACTION_CONFIG's
//      animationTrigger — 'chop'/'mine', see CharacterBody.setUp() for the
//      matching transitions) so the swing clip loops for the whole action.
//      A no-op if the FBX character hasn't loaded, since actions never wait
//      on that load (see MainPlayer's own doc) — the hits below still land
//      on schedule with no visible character yet.
//   2. turns the player to face the target via FacingComponent.
//   3. every hitIntervalSec, deals damagePerHit to the target
//      (ActionTarget.applyHit) — and finishes as 'completed' the moment the
//      target reports itself depleted.
//   4. on either ending, clears facing, fires ACTION_DONE_TRIGGER to drop
//      back to idle, and resolves the returned Promise with which ending it
//      was.
//
// cancel() ends an in-flight action as 'cancelled' instead — used when the
// player wanders out of range (see AutoGatherController). The target keeps
// whatever life it had; nothing here resets it, so returning later resumes
// the same tree rather than restarting it.
//
// NOTE ON MOVEMENT: this deliberately does NOT freeze the player while an
// action runs. Walking away is the cancel gesture, so freezing movement
// would make cancellation unreachable — the two features are mutually
// exclusive by construction. Both the disable-on-start and re-enable-on-end
// calls are therefore left out (rather than just the disable, which would
// let this component clobber an unrelated external freeze, e.g. a cutscene,
// every time an action ended).
//
// Only one action at a time — calling onPlayActionAnimation() while isBusy
// is true throws rather than silently queuing or replacing the in-flight
// one.

import * as THREE from 'three';
import Component from '../ecs/Component';
import { ACTION_CONFIG, ACTION_DONE_TRIGGER, ActionType } from '../actions/ActionTypes';
import FacingComponent from './FacingComponent';
import CharacterVisualComponent from './CharacterVisualComponent';

/** How an action ended — callers branch on this instead of assuming a resolved Promise means success (see AutoGatherController, which only banks a yield on 'completed'). */
export type ActionResult = 'completed' | 'cancelled';

/**
 * Whatever an action can be performed ON — deliberately just "something with a world
 * position that absorbs hits," so PlayerActionController never has to know about
 * ResourceNode, resources, or gathering specifically. ResourceNode implements this
 * (see its applyHit()); anything else damageable later (a rock wall, a crate) can too.
 */
export interface ActionTarget {
    /** World position the player turns to face while acting on this. */
    readonly position: THREE.Vector3;
    /** Absorb one hit. Returns true once this target is fully depleted, which ends the action as 'completed'. */
    applyHit(damage: number): boolean;
}

export default class PlayerActionController extends Component {
    private currentAction?: ActionType;
    private currentTarget?: ActionTarget;
    /** Counts down to the next hit; reset by adding hitIntervalSec back (not assigning it) so a long frame doesn't silently discard accumulated progress. */
    private nextHitSec = 0;
    private resolveCurrent?: (result: ActionResult) => void;

    public get isBusy(): boolean {
        return this.currentAction !== undefined;
    }

    /** What the in-flight action is acting on, if any — lets a caller tell "the thing I left range of" apart from some other target (see AutoGatherController's exit handler). */
    public get target(): ActionTarget | undefined {
        return this.currentTarget;
    }

    /**
     * Starts `action` against `target`, hitting it every hitIntervalSec until it depletes
     * (resolves 'completed') or cancel() is called (resolves 'cancelled'). See this file's
     * own doc for the full sequence.
     *
     * Deliberately NOT declared `async` — the busy-guard below throws synchronously
     * (before any Promise even exists) rather than as a rejected Promise a caller could
     * forget to .catch(). The signature/call site both still read as ordinary async code
     * (`await controller.onPlayActionAnimation(...)`); only the reentrancy failure mode
     * differs, on purpose.
     */
    public onPlayActionAnimation(action: ActionType, target: ActionTarget): Promise<ActionResult> {
        if (this.isBusy) {
            throw new Error(`PlayerActionController: already playing ${this.currentAction}, can't start ${action}`);
        }

        const config = ACTION_CONFIG[action];
        console.log(`[action] start ${action} (trigger: ${config.animationTrigger}, ${config.damagePerHit} dmg every ${config.hitIntervalSec}s)`);

        this.currentAction = action;
        this.currentTarget = target;
        this.nextHitSec = config.hitIntervalSec;

        this.entity.getComponent(FacingComponent)?.faceToward(target.position);
        this.entity.getComponent(CharacterVisualComponent)?.character.playTrigger(config.animationTrigger);

        return new Promise<ActionResult>(resolve => {
            this.resolveCurrent = resolve;
        });
    }

    /** Ends an in-flight action without the target being depleted — the target keeps its remaining life. No-op if nothing is running. */
    public cancel(): void {
        if (!this.isBusy) {
            return;
        }

        console.log(`[action] cancel ${this.currentAction}`);
        this.finish('cancelled');
    }

    public update(delta: number): void {
        if (!this.isBusy) {
            return;
        }

        const config = ACTION_CONFIG[this.currentAction!];
        this.nextHitSec -= delta;

        if (this.nextHitSec > 0) {
            return;
        }

        this.nextHitSec += config.hitIntervalSec;

        // Cache the target: applyHit() can synchronously deplete it, which (for a
        // ResourceNode) unregisters its RigidBody and fires onTriggerExit — and that
        // handler may call cancel(), clearing currentTarget mid-call. See
        // AutoGatherController's exit handler for the guard that keeps that from
        // turning this completion into a cancellation.
        const target = this.currentTarget!;
        const depleted = target.applyHit(config.damagePerHit);

        if (depleted && this.isBusy) {
            console.log(`[action] complete ${this.currentAction}`);
            this.finish('completed');
        }
    }

    private finish(result: ActionResult): void {
        this.currentAction = undefined;
        this.currentTarget = undefined;

        this.entity.getComponent(FacingComponent)?.clearTarget();
        this.entity.getComponent(CharacterVisualComponent)?.character.playTrigger(ACTION_DONE_TRIGGER);

        const resolve = this.resolveCurrent;
        this.resolveCurrent = undefined;
        resolve?.(result);
    }

    /** In case the entity is destroyed (or pooled/reused) mid-action — never leaves a dangling Promise. */
    public destroy(): void {
        if (this.isBusy) {
            this.finish('cancelled');
        }
    }
}
