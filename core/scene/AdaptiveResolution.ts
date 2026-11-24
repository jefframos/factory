// AdaptiveResolution.ts
//
// Lowers the 3D canvas's resolution while the device can't keep up (SetupThree.adaptive, off unless a game turns it on),
// and raises it again carefully. Fed a frame at a time (frame()); `scale` is the share of the full pixel ratio to draw at.
//
//   - Under SLOW_FPS over a window: a step down (STEPS).
//   - It only helps when the graphics card is what's slow. Two steps down that didn't raise the frame rate (a slow
//     processor, or a phone holding itself to 30 fps to save its battery): the resolution goes back up and stays.
//   - Over FAST_FPS for a while: a step up; if that turns out too much, it goes back down and isn't tried again.
//   - Started lower than the best (a phone): it climbs quickly while the frame rate stays up, so a fast one is sharp within
//     seconds and a slow one never had to stutter its way down.
//
// Long frames (a load, a tab switched away) are left out, and nothing is judged in the first seconds.

/** Shares of the full pixel ratio, best first. */
const STEPS = [1, 0.85, 0.7, 0.55, 0.45];
const SLOW_FPS = 45;
const FAST_FPS = 57;
/** Seconds judged at a time; nothing before this many seconds of frames; fast for this long before a step up. */
const WINDOW_SEC = 1.5;
const SETTLE_SEC = 4;
const RAISE_AFTER_SEC = 20;
/** Climbing from a lower start: settled and raised this soon instead. */
const CLIMB = { settle: 2, raiseAfter: 3 };
/** A step up that's slow again within this long was too much. */
const RAISE_TRIAL_SEC = 10;
/** A step down has helped if the frame rate rose by this much (a share). */
const HELPED = 1.07;
/** Frames longer than this aren't the drawing (a load, a hidden tab). */
const LONGEST_MS = 250;

/** The step a phone starts at (70%). */
export const PHONE_START = 2;
/** The steps as percents, for a debug panel's choice. */
export const RESOLUTION_STEPS: readonly number[] = STEPS;

export class AdaptiveResolution {
    /** A share forced instead of judging (a debug panel's); 0: none. */
    public forced = 0;
    private step: number;
    /** The best step it may go to (a raise that failed lowers it), and done judging (lowering doesn't help here). */
    private best = 0;
    private locked = false;
    /** Still climbing from a lower start. */
    private climbing: boolean;
    private last = 0;
    private settled = 0;
    private windowMs = 0;
    private frames = 0;
    private fastFor = 0;
    private sinceRaise = Infinity;
    /** Steps down in a row that didn't help, where they started, and the frame rate before the last one. */
    private useless = 0;
    private from = 0;
    private before = 0;

    /** `start`: the step to begin at (PHONE_START; 0: full). */
    public constructor(start = 0) {
        this.step = Math.min(start, STEPS.length - 1);
        this.climbing = this.step > 0;
    }

    /** The share of the full pixel ratio to draw at now. */
    public get scale(): number {
        return this.forced || STEPS[this.step];
    }

    /** A frame at `now` (performance.now()). True when `scale` changed. */
    public frame(now: number): boolean {
        const ms = now - this.last;
        this.last = now;
        if (this.forced || this.locked || ms <= 0 || ms > LONGEST_MS || document.hidden) return false;
        if (this.settled < (this.climbing ? CLIMB.settle : SETTLE_SEC)) {
            this.settled += ms / 1000;
            return false;
        }
        this.windowMs += ms;
        this.frames++;
        if (this.windowMs < WINDOW_SEC * 1000) return false;
        const fps = (this.frames * 1000) / this.windowMs;
        this.windowMs = 0;
        this.frames = 0;
        this.sinceRaise += WINDOW_SEC;
        return this.judge(fps);
    }

    private judge(fps: number): boolean {
        const old = this.step;
        if (this.before > 0) {
            // The window after a step down: did it help?
            if (fps >= this.before * HELPED) this.useless = 0;
            else this.useless++;
            this.before = 0;
        }
        if (this.useless >= 2) {
            this.step = this.from;
            this.locked = true;
        } else if (fps < SLOW_FPS) {
            this.fastFor = 0;
            this.climbing = false;
            if (this.sinceRaise <= RAISE_TRIAL_SEC) this.best = Math.min(STEPS.length - 1, this.step + 1);
            if (this.step < STEPS.length - 1) {
                if (this.useless === 0) this.from = this.step;
                this.before = fps;
                this.step++;
            }
        } else if (fps >= FAST_FPS) {
            this.fastFor += WINDOW_SEC;
            if (this.fastFor >= (this.climbing ? CLIMB.raiseAfter : RAISE_AFTER_SEC) && this.step > this.best) {
                this.step--;
                this.fastFor = 0;
                this.sinceRaise = 0;
                if (this.step <= this.best) this.climbing = false;
            }
        } else {
            this.fastFor = 0;
        }
        return this.step !== old;
    }
}
