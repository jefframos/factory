// AnimationBoard.ts
//
// Minimal animation state machine. Drives an AnimatorController by name:
// each state IS an animation id, transitions crossfade into the next
// state's clip once their condition (or a fired trigger) is satisfied.

import type AnimatorController from './AnimatorController';

type Condition = (vars: Record<string, number | boolean>) => boolean;

interface Transition {
    from: string;
    to: string;
    duration: number;
    condition?: Condition;
    trigger?: string;
    /** Whether `to`'s clip loops once entered — default true (continuous locomotion states). A one-shot pose (jump takeoff, landing, roll, slide) should pass false so it plays through once and holds its last frame instead of restarting from frame 0 every time it reaches its own end. */
    loop: boolean;
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
     * required (a condition alone won't fire it). `loop` — see Transition's
     * own doc — defaults to true, matching every locomotion state's own
     * needs; pass false for a one-shot pose.
     */
    public registerTransition(
        from: string,
        to: string,
        duration: number,
        condition?: Condition,
        trigger?: string,
        loop: boolean = true,
    ): void {
        this.transitions.push({ from, to, duration, condition, trigger, loop });
    }

    /** Call once per frame — checks every registered transition off the current state (or 'any'), applies the first one whose trigger fired or condition passed, then clears all triggers regardless. */
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
            this.controller.mix(transition.to, 1, transition.duration, transition.loop);
            break;
        }

        this.triggers.clear();
    }
}
