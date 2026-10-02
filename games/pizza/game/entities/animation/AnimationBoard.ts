// AnimationBoard.ts
//
// Minimal animation state machine — ported from another game's character
// controller (see ThirdPersonCharacter.ts's own header comment) with all of
// that game's engine dependencies stripped, just three.js-facing. Drives an
// AnimatorController by name: each state IS an animation id, transitions
// crossfade into the next state's clip once their condition (or a fired
// trigger) is satisfied.

import type AnimatorController from './AnimatorController';

type Condition = (vars: Record<string, number | boolean>) => boolean;

interface Transition {
    from: string;
    to: string;
    duration: number;
    condition?: Condition;
    trigger?: string;
    /** Fires once `from`'s one-shot clip has played to its end — see registerTransition()'s `whenFinished`. */
    whenFinished?: boolean;
}

const ANY_STATE = 'any';

export default class AnimatorBoard {
    private currentState: string;
    private readonly transitions: Transition[] = [];
    private readonly vars: Record<string, number | boolean> = {};
    private readonly triggers = new Set<string>();
    /** States whose clip plays once and holds its last frame instead of looping — see setOneShot(). */
    private readonly oneShotStates = new Set<string>();

    public constructor(initialState: string, private readonly controller: AnimatorController) {
        this.currentState = initialState;
        this.controller.play(initialState);
    }

    public getCurrentState(): string {
        return this.currentState;
    }

    public setVariable(name: string, value: number | boolean): void {
        this.vars[name] = value;
    }

    /** Consumed the instant a matching transition fires — see update(). Fire-and-forget, same as a trigger param in Unity's Animator. */
    public setTrigger(name: string): void {
        this.triggers.add(name);
    }

    /** Marks `state` as play-once: entering it plays its clip a single time and holds the last frame (no loop) — pair with a `whenFinished` transition out of it (e.g. standToSit -> sitting). */
    public setOneShot(state: string): void {
        this.oneShotStates.add(state);
    }

    /**
     * `from` may be 'any' to match regardless of the current state (e.g. a
     * jump interrupting whatever's playing). `trigger`, when given, is
     * required (a condition alone won't fire it) — same "either a fired
     * trigger, or a plain condition" split the original board used.
     * `whenFinished` fires the transition once `from` (a setOneShot() state)
     * has played its clip to the end — like Unity's "has exit time".
     */
    public registerTransition(
        from: string,
        to: string,
        duration: number,
        condition?: Condition,
        trigger?: string,
        whenFinished = false,
    ): void {
        this.transitions.push({ from, to, duration, condition, trigger, whenFinished });
    }

    /** Call once per frame — checks every registered transition off the current state (or 'any'), applies the first one whose trigger fired or condition passed, then clears all triggers regardless (matches "fire once, consumed next update" semantics). */
    public update(delta: number): void {
        for (const transition of this.transitions) {
            if (transition.from !== ANY_STATE && transition.from !== this.currentState) {
                continue;
            }

            const triggerFired = transition.trigger ? this.triggers.has(transition.trigger) : false;
            const conditionMet = transition.condition ? transition.condition(this.vars) : false;
            const finished = transition.whenFinished === true
                && transition.from === this.currentState
                && this.controller.isCurrentClipFinished();

            if (!triggerFired && !conditionMet && !finished) {
                continue;
            }

            this.currentState = transition.to;
            this.controller.mix(transition.to, 1, transition.duration, !this.oneShotStates.has(transition.to));
            break;
        }

        this.triggers.clear();
    }
}
