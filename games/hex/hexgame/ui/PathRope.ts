// PathRope.ts
import * as PIXI from "pixi.js";
import { Point, SplineUtils } from "../mapEditor/SplineUtils";

export interface PathRopeOptions {
    texture: PIXI.Texture;

    // How many interpolated points per segment in Catmull-Rom
    segmentPoints?: number; // default 25

    // Catmull tension (0.5 = your default)
    tension?: number; // default 0.5

    // If set, resample to evenly spaced points (recommended for rope)
    // Example: 10..20 depending on world scale
    spacing?: number; // default undefined (no resample)

    // Optional display tuning
    alpha?: number; // default 1
    tint?: number;  // default 0xFFFFFF

    // If true, rope uses uvs that stretch across the whole rope (default SimpleRope behaviour)
    // Leave it alone unless you want custom tiling.
}

export class PathRope extends PIXI.Container {
    private readonly opts: Required<Omit<PathRopeOptions, "spacing">> & Pick<PathRopeOptions, "spacing">;

    private rope: PIXI.SimpleRope | null = null;
    private ropePoints: PIXI.Point[] = [];

    private lastHash: string = "";

    constructor(options: PathRopeOptions) {
        super();

        this.opts = {
            texture: options.texture,
            segmentPoints: options.segmentPoints ?? 25,
            tension: options.tension ?? 0.5,
            alpha: options.alpha ?? 1,
            tint: options.tint ?? 0xffffff,
            spacing: options.spacing
        };
    }
    public setSampledPoints(points: Point[]): void {
        const hash = this.hashPoints(points);
        if (hash === this.lastHash) return;
        this.lastHash = hash;

        if (!points || points.length < 2) {
            this.clearRope();
            return;
        }

        let spline = points;
        if (this.opts.spacing && this.opts.spacing > 0) {
            spline = SplineUtils.getEvenlySpacedPoints(spline, this.opts.spacing);
        }

        // Check if the number of points changed before syncing
        const lengthChanged = this.ropePoints.length !== spline.length;

        this.syncRopePoints(spline);

        // If length changed, we MUST re-create the rope to rebuild geometry
        if (lengthChanged && this.rope) {
            this.rope.destroy();
            this.rope = null;
        }

        if (!this.rope) {
            this.rope = new PIXI.SimpleRope(this.opts.texture, this.ropePoints);
            this.rope.alpha = this.opts.alpha;
            this.rope.tint = this.opts.tint;
            this.addChild(this.rope);
        } else {
            // Just updating positions of existing points
            (this.rope as any).geometry?.getBuffer('aVertexPosition')?.update();
        }
    }

    /**
     * Update rope to match the given CONTROL points (not the sampled spline).
     * Call this whenever your map points change.
     */
    public setControlPoints(control: PIXI.Point[]): void {
        const hash = this.hashPoints(control);
        if (hash === this.lastHash) {
            return;
        }
        this.lastHash = hash;

        if (!control || control.length < 2) {
            this.clearRope();
            return;
        }

        // 1) Build spline samples
        let spline = SplineUtils.generateCatmullRomSpline(
            control,
            this.opts.segmentPoints,
            this.opts.tension
        );

        // 2) Optional resample to evenly spaced points (prevents "bunching")
        if (this.opts.spacing && this.opts.spacing > 0) {
            spline = SplineUtils.getEvenlySpacedPoints(spline, this.opts.spacing);
        }

        // 3) Convert to PIXI.Point array (reuse objects to reduce GC)
        this.syncRopePoints(spline);

        // 4) Create or update rope
        if (!this.rope) {
            this.rope = new PIXI.SimpleRope(this.opts.texture, this.ropePoints);
            this.rope.alpha = this.opts.alpha;
            this.rope.tint = this.opts.tint;
            this.addChild(this.rope);
        } else {
            // In Pixi v7, SimpleRope keeps reference to points array.
            // Updating point objects is enough; then mark geometry dirty.
            (this.rope as any).geometry?.invalidate?.();
        }
    }

    public setAlpha(a: number): void {
        this.opts.alpha = a;
        if (this.rope) this.rope.alpha = a;
    }

    public setTint(tint: number): void {
        this.opts.tint = tint;
        if (this.rope) this.rope.tint = tint;
    }

    public clearRope(): void {
        if (this.rope) {
            this.rope.destroy({ children: true });
            this.rope = null;
        }
        this.ropePoints.length = 0;
        this.lastHash = "";
    }

    // ---------------- internals ----------------

    private syncRopePoints(spline: Point[]): void {
        const needed = spline.length;

        // Grow pool if needed
        while (this.ropePoints.length < needed) {
            this.ropePoints.push(new PIXI.Point());
        }

        // Shrink logically (don’t destroy, just stop using extras)
        this.ropePoints.length = needed;

        for (let i = 0; i < needed; i++) {
            this.ropePoints[i].set(spline[i].x, spline[i].y);
        }
    }

    private hashPoints(points: Point[]): string {
        // Fast-ish hash; stable enough to avoid rebuilding when unchanged.
        // If you update points frequently and want more speed, replace with an int hash.
        let s = "";
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            // rounding prevents hash spam from tiny float jitter
            s += `${(p.x * 1000) | 0},${(p.y * 1000) | 0};`;
        }
        return s;
    }
}
