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
}

const ANY_STATE = 'any';

export default class AnimatorBoard {
    private currentState: string;
    private readonly transitions: Transition[] = [];
    private readonly vars: Record<string, number | boolean> = {};
    private readonly triggers = new Set<string>();

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

    /**
     * `from` may be 'any' to match regardless of the current state (e.g. a
     * jump interrupting whatever's playing). `trigger`, when given, is
     * required (a condition alone won't fire it) — same "either a fired
     * trigger, or a plain condition" split the original board used.
     */
    public registerTransition(
        from: string,
        to: string,
        duration: number,
        condition?: Condition,
        trigger?: string,
    ): void {
        this.transitions.push({ from, to, duration, condition, trigger });
    }

    /** Call once per frame — checks every registered transition off the current state (or 'any'), applies the first one whose trigger fired or condition passed, then clears all triggers regardless (matches "fire once, consumed next update" semantics). */
    public update(delta: number): void {
        for (const transition of this.transitions) {
            if (transition.from !== ANY_STATE && transition.from !== this.currentState) {
                continue;
            }

            const triggerFired = transition.trigger ? this.triggers.has(transition.trigger) : false;
            const conditionMet = transition.condition ? transition.condition(this.vars) : false;

            if (!triggerFired && !conditionMet) {
                continue;
            }

            this.currentState = transition.to;
            this.controller.mix(transition.to, 1, transition.duration);
            break;
        }

        this.triggers.clear();
    }
}
