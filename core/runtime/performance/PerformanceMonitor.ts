// PerformanceMonitor.ts
//
// Minimal frame-rate sampler for core/debug's DebugOverlay (its launcher pill shows the average
// FPS). The debug folder came from another engine whose PerformanceMonitor is much bigger; this
// keeps only what DebugOverlay reads — getAverageFps() — measured with requestAnimationFrame, so
// it needs no hook into Game's loop. Starts sampling on first use.

/** Frames averaged over (about a second at 60 fps). */
const SAMPLE_COUNT = 60;

export class PerformanceMonitor {
    private static _instance?: PerformanceMonitor;

    public static get instance(): PerformanceMonitor {
        PerformanceMonitor._instance ??= new PerformanceMonitor();
        return PerformanceMonitor._instance;
    }

    private readonly frameMs: number[] = [];
    private lastTime = 0;

    private constructor() {
        const tick = (now: number): void => {
            if (this.lastTime > 0) {
                this.frameMs.push(now - this.lastTime);
                if (this.frameMs.length > SAMPLE_COUNT) {
                    this.frameMs.shift();
                }
            }
            this.lastTime = now;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    /** Average frames per second over the last SAMPLE_COUNT frames (0 until the first two frames). */
    public getAverageFps(): number {
        if (this.frameMs.length === 0) {
            return 0;
        }
        const averageMs = this.frameMs.reduce((sum, ms) => sum + ms, 0) / this.frameMs.length;
        return averageMs > 0 ? 1000 / averageMs : 0;
    }
}
