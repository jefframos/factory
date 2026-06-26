/**
 * WalkBob — view-only walking animation component.
 *
 * Returns a world-unit Y offset to add to an entity's mesh position.
 * Uses abs(sin) so the curve has a brief "on ground" flat spot between
 * each hop, which reads as discrete footsteps rather than smooth floating.
 *
 * To detach: remove the field declaration, constructor call, and
 * the single update() call in the render loop. Nothing else to change.
 */
export class WalkBob {
    private phase = 0;
    private blend = 0;

    // ~3 hops / second at full blend
    private static readonly FREQUENCY  = 9;    // rad/s  (period = π/9 ≈ 0.35 s)
    private static readonly AMPLITUDE  = 0.18; // world units
    private static readonly BLEND_IN   = 10;   // ramp-up speed (start moving)
    private static readonly BLEND_OUT  = 7;    // ramp-down speed (stop moving)

    /**
     * Call once per frame. Returns Y offset in world units.
     * @param delta     frame time in seconds
     * @param isMoving  true while any movement input is active
     */
    update(delta: number, isMoving: boolean): number {
        this.blend = isMoving
            ? Math.min(1, this.blend + delta * WalkBob.BLEND_IN)
            : Math.max(0, this.blend - delta * WalkBob.BLEND_OUT);

        if (this.blend > 0) {
            this.phase += delta * WalkBob.FREQUENCY;
        }

        // abs(sin) creates a bouncing-ball arc: spends time near 0 (ground contact)
        // and rises quickly to the peak, giving a hop feel instead of a smooth wave.
        return Math.abs(Math.sin(this.phase)) * WalkBob.AMPLITUDE * this.blend;
    }

    /** Reset to rest instantly (e.g. on spawn or teleport). */
    reset(): void {
        this.phase = 0;
        this.blend = 0;
    }
}
