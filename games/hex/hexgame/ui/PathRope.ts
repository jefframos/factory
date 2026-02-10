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

    tileScale?: number;
    textureScale?: number;
    // If true, rope uses uvs that stretch across the whole rope (default SimpleRope behaviour)
    // Leave it alone unless you want custom tiling.
}

export class PathRope extends PIXI.Container {
    private readonly opts: Required<Omit<PathRopeOptions, "spacing">> & Pick<PathRopeOptions, "spacing">;

    private rope: PIXI.SimpleRope | null = null;
    private ropePoints: PIXI.Point[] = [];

    private uvOffset: number = 0;
    public velocity: number = 0;

    private lastHash: string = "";

    constructor(options: PathRopeOptions) {
        super();

        this.opts = {
            texture: options.texture,
            segmentPoints: options.segmentPoints ?? 25,
            tension: options.tension ?? 0.5,
            alpha: options.alpha ?? 1,
            tint: options.tint ?? 0xffffff,
            spacing: options.spacing,
            tileScale: options.tileScale || 1,
            textureScale: options.textureScale || 1,
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

        const lengthChanged = this.ropePoints.length !== spline.length;
        this.syncRopePoints(spline);

        if (lengthChanged && this.rope) {
            this.rope.destroy();
            this.rope = null;
        }

        if (!this.rope) {
            // Ensure wrap mode is set before creating the rope
            this.opts.texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
            this.rope = new PIXI.SimpleRope(this.opts.texture, this.ropePoints, this.opts.textureScale);
            this.rope.alpha = this.opts.alpha;
            this.rope.tint = this.opts.tint;
            this.addChild(this.rope);
        } else {
            (this.rope as any).geometry?.getBuffer('aVertexPosition')?.update();
        }

        // MANDATORY: Update tiling every time points change
        if (this.opts.tileScale) {
            this.updateTiling();
        }
    }
    public update(delta: number): void {
        if (this.velocity === 0 || !this.rope) return;

        // Update the offset based on velocity
        this.uvOffset -= (this.velocity * delta) / this.opts.tileScale;

        // Wrap the offset to keep it within a reasonable range (0 to 1)
        // This prevents floating point precision issues over long play sessions
        this.uvOffset %= 1;

        // Refresh the UVs
        this.updateTiling();
    }
    private updateTiling(): void {
        if (!this.rope || !this.opts.tileScale) return;

        const geometry = this.rope.geometry;
        const uvs = geometry.getBuffer('aTextureCoord').data as Float32Array;
        const points = this.ropePoints;

        let totalDistance = 0;

        // Apply the offset to the starting point
        uvs[0] = this.uvOffset;
        uvs[1] = 0;
        uvs[2] = this.uvOffset;
        uvs[3] = 1;

        for (let i = 1; i < points.length; i++) {
            const p1 = points[i - 1];
            const p2 = points[i];

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            totalDistance += dist;

            // Include uvOffset in the calculation for all points
            const u = (totalDistance / this.opts.tileScale) + this.uvOffset;

            const index = i * 4;
            uvs[index] = u;
            uvs[index + 1] = 0;
            uvs[index + 2] = u;
            uvs[index + 3] = 1;
        }

        geometry.getBuffer('aTextureCoord').update();
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
            this.opts.texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
            this.rope.tint = this.opts.tint;
            this.addChild(this.rope);
        } else {
            // In Pixi v7, SimpleRope keeps reference to points array.
            // Updating point objects is enough; then mark geometry dirty.
            (this.rope as any).geometry?.invalidate?.();
        }

        if (this.opts.tileScale) {
            this.updateTiling();
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
