/**
 * FloatBob — continuous sinusoidal Y offset for entities floating on water.
 *
 * Unlike WalkBob (which uses abs(sin) for a hop-on-ground feel), this uses
 * plain sin() so the entity drifts smoothly above and below its base Y —
 * a gentle buoyancy rather than discrete footsteps.
 *
 * Pass a phaseOffset in the constructor so multiple entities bob out of sync.
 */
export class FloatBob {
    private phase: number;

    private static readonly FREQUENCY = 1.4; // rad/s — one full bob every ~4.5 s
    private static readonly AMPLITUDE = 0.07; // world units up and down

    constructor(phaseOffset = 0) {
        this.phase = phaseOffset;
    }

    /**
     * Call once per frame. Returns a signed Y offset in world units.
     * @param delta frame time in seconds
     */
    update(delta: number): number {
        this.phase += delta * FloatBob.FREQUENCY;
        return Math.sin(this.phase) * FloatBob.AMPLITUDE;
    }

    reset(phaseOffset = 0): void {
        this.phase = phaseOffset;
    }
}
