// Combo.ts
//
// Rush mode's combo meter (ui/mow.json `combo`): any cut starts it and keeps it alive; it ends `window` seconds after
// the last cut (or when end() is called: the bag filled). The longer it runs, the higher the multiplier (+`step`
// every `stepSec`, up to `max`); each cut's money x (multiplier - 1) goes into the pot, paid out when it ends.

import { ComboDef } from '../data/MowConfig';

export interface ComboEvents {
    /** The multiplier went up. */
    onStep(multiplier: number): void;
    /** It ended: the pot (rounded, may be 0) at the multiplier it reached. */
    onEnd(pot: number, multiplier: number): void;
}

export class Combo {
    public multiplier = 1;
    public pot = 0;
    public running = false;
    /** Seconds since the last cut, and of the combo so far. */
    private idle = 0;
    private age = 0;

    public constructor(private readonly def: ComboDef, private readonly events: ComboEvents) {}

    /** Cells were cut, worth `money` when sold. */
    public cut(money: number): void {
        if (!this.running) {
            this.running = true;
            this.age = 0;
        }
        this.idle = 0;
        this.pot += money * (this.multiplier - 1);
    }

    public update(delta: number): void {
        if (!this.running) return;
        this.idle += delta;
        if (this.idle > this.def.window) {
            this.end();
            return;
        }
        this.age += delta;
        const steps = Math.floor(this.age / this.def.stepSec);
        const multiplier = Math.min(this.def.max, 1 + steps * this.def.step);
        if (multiplier > this.multiplier) {
            this.multiplier = multiplier;
            this.events.onStep(multiplier);
        }
    }

    /** Time left before it ends (1 = just cut, 0 = ending). */
    public get timeShare(): number {
        return this.running ? Math.max(0, 1 - this.idle / this.def.window) : 0;
    }

    public end(): void {
        if (!this.running) return;
        const pot = Math.round(this.pot);
        const multiplier = this.multiplier;
        this.running = false;
        this.multiplier = 1;
        this.pot = 0;
        this.age = 0;
        this.events.onEnd(pot, multiplier);
    }
}
