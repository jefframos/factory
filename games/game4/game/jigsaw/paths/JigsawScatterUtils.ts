// JigsawScatterUtils.ts
import * as PIXI from "pixi.js";

export type ScatterItem =
    {
        id?: number;
        width: number;
        height: number;
    };

export type ScatterPlacement =
    {
        x: number;
        y: number;
    };

type Candidate =
    {
        x: number;
        y: number;
        score: number;
    };

export class JigsawScatterUtils {
    private constructor() { }

    /**
     * Blue-noise-ish scatter using Mitchell's Best Candidate (Poisson-disk style in practice).
     *
     * Properties:
     * - Deterministic if you pass a seeded RNG.
     * - Produces well-spread points (no clumping) compared to pure random.
     * - Tries to respect item sizes by scoring candidates using scaled distance.
     *
     * Important:
     * - This does NOT do full rectangle packing. It is a "spread guarantee" placement.
     * - If the scatter rect is too small for the number/size of items, some overlap is inevitable.
     *
     * Returns positions for the TOP-LEFT corner of each item (so it fits within scatterRect).
     */
    public static computeBlueNoisePlacements(opts:
        {
            scatterRect: PIXI.Rectangle;
            items: ScatterItem[];

            /**
             * Number of candidate samples per item. Higher => better spread but slower.
             * Suggested: 10–40 for <200 items; 6–15 for many items.
             */
            candidatesPerItem?: number;

            /**
             * Minimum margin from scatterRect edges.
             */
            padding?: number;

            /**
             * Optional: bias toward avoiding overlap by increasing effective radius.
             * 1.0 = use item size as-is.
             * >1.0 increases separation.
             */
            separationMultiplier?: number;

            /**
             * If provided, placements are deterministic.
             */
            rng?: () => number;
        }): ScatterPlacement[] {
        const rect = opts.scatterRect;
        const items = opts.items;

        const k = Math.max(1, opts.candidatesPerItem ?? 20);
        const padding = Math.max(0, opts.padding ?? 0);
        const sepMul = Math.max(0.25, opts.separationMultiplier ?? 1.0);
        const rng = opts.rng ?? Math.random;

        if (items.length === 0) {
            return [];
        }

        // Precompute allowed ranges for each item
        const ranges = items.map((it) => {
            const w = Math.max(1, it.width);
            const h = Math.max(1, it.height);

            const minX = rect.x + padding;
            const minY = rect.y + padding;
            const maxX = rect.x + rect.width - padding - w;
            const maxY = rect.y + rect.height - padding - h;

            return {
                w,
                h,
                minX,
                minY,
                maxX,
                maxY,
            };
        });

        // If any item cannot fit, we still place it, clamped to min.
        const placements: ScatterPlacement[] = [];

        // We keep "centers" for scoring, and an effective radius per item
        const centers: PIXI.Point[] = [];
        const radii: number[] = [];

        for (let i = 0; i < items.length; i++) {
            const rr = ranges[i];

            const cxMin = rr.minX + rr.w * 0.5;
            const cyMin = rr.minY + rr.h * 0.5;
            const cxMax = rr.maxX + rr.w * 0.5;
            const cyMax = rr.maxY + rr.h * 0.5;

            // If it doesn't fit, collapse range to a single point.
            const hasRoomX = cxMax >= cxMin;
            const hasRoomY = cyMax >= cyMin;

            // Choose best candidate for this item
            const best = this.pickBestCandidate(
                centers,
                radii,
                {
                    cxMin,
                    cyMin,
                    cxMax: hasRoomX ? cxMax : cxMin,
                    cyMax: hasRoomY ? cyMax : cyMin,
                },
                this.computeRadiusForItem(rr.w, rr.h, sepMul),
                k,
                rng
            );

            // Convert chosen center to top-left
            const x = best.x - rr.w * 0.5;
            const y = best.y - rr.h * 0.5;

            placements.push({ x, y });

            centers.push(new PIXI.Point(best.x, best.y));
            radii.push(this.computeRadiusForItem(rr.w, rr.h, sepMul));
        }

        return placements;
    }

    /**
     * Mitchell's Best Candidate:
     * - sample k candidates uniformly
     * - score each by its minimum normalized distance to existing points
     * - pick the candidate with max score
     */
    private static pickBestCandidate(
        existingCenters: PIXI.Point[],
        existingRadii: number[],
        bounds:
            {
                cxMin: number;
                cyMin: number;
                cxMax: number;
                cyMax: number;
            },
        candidateRadius: number,
        k: number,
        rng: () => number
    ): { x: number; y: number } {
        // If first point: pick random center
        if (existingCenters.length === 0) {
            return {
                x: this.lerp(bounds.cxMin, bounds.cxMax, rng()),
                y: this.lerp(bounds.cyMin, bounds.cyMax, rng()),
            };
        }

        let best: Candidate | null = null;

        for (let i = 0; i < k; i++) {
            const x = this.lerp(bounds.cxMin, bounds.cxMax, rng());
            const y = this.lerp(bounds.cyMin, bounds.cyMax, rng());

            const score = this.scoreCandidate(
                x,
                y,
                candidateRadius,
                existingCenters,
                existingRadii
            );

            if (!best || score > best.score) {
                best = { x, y, score };
            }
        }

        // Fallback should never happen, but keep safe
        if (!best) {
            return {
                x: this.lerp(bounds.cxMin, bounds.cxMax, rng()),
                y: this.lerp(bounds.cyMin, bounds.cyMax, rng()),
            };
        }

        return { x: best.x, y: best.y };
    }

    /**
     * Candidate score = minimum distance to any existing center, normalized by combined radii.
     * Higher score => farther away => better "blue-noise" spacing.
     */
    private static scoreCandidate(
        x: number,
        y: number,
        r: number,
        centers: PIXI.Point[],
        radii: number[]
    ): number {
        let minNorm = Number.POSITIVE_INFINITY;

        for (let i = 0; i < centers.length; i++) {
            const c = centers[i];
            const dx = x - c.x;
            const dy = y - c.y;

            const dist = Math.hypot(dx, dy);

            // Normalize by combined radii (approximates rectangle size / desired separation)
            const denom = Math.max(1e-4, r + radii[i]);
            const norm = dist / denom;

            if (norm < minNorm) {
                minNorm = norm;
            }
        }

        return minNorm;
    }

    private static computeRadiusForItem(w: number, h: number, sepMul: number): number {
        // Use half-diagonal as a single "size" metric for spacing.
        const halfDiag = 0.5 * Math.hypot(w, h);
        return halfDiag * sepMul;
    }

    private static lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }

    /**
     * Optional deterministic RNG (Mulberry32) for repeatable scatter.
     */
    public static createSeededRng(seed: number): () => number {
        let t = seed >>> 0;

        return () => {
            t += 0x6D2B79F5;
            let x = t;

            x = Math.imul(x ^ (x >>> 15), x | 1);
            x ^= x + Math.imul(x ^ (x >>> 7), x | 61);

            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
    }
}
