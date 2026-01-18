// JigsawClusterTweenUtils.ts
import * as PIXI from "pixi.js";
import { JigsawCluster, QuarterTurns } from "../JigsawCluster";

export type EasingFn = (t: number) => number;

export class JigsawClusterTweenUtils {
    // Simple easing defaults (no dependency on gsap)
    public static easeOutCubic(t: number): number {
        return 1 - Math.pow(1 - t, 3);
    }

    /**
     * Tween cluster rotation to target quarter turns (0..3) without changing the pivot's world position.
     *
     * - Works with any current rotation (not only exact quarter turns), but assumes your puzzle logic uses Q turns.
     * - Uses requestAnimationFrame; call returns a Promise.
     * - You can cancel via the returned handle.
     */
    public static tweenRotationQ(opts: {
        cluster: JigsawCluster;
        targetQ: QuarterTurns;
        durationMs?: number;
        easing?: EasingFn;
        // Optional: if true, will rotate the shortest way (may go CCW); if false, goes CW steps.
        shortestPath?: boolean;
    }): { promise: Promise<void>; cancel: () => void } {
        const cluster = opts.cluster;
        const container = cluster.container;

        const durationMs = Math.max(1, opts.durationMs ?? 120);
        const easing = opts.easing ?? JigsawClusterTweenUtils.easeOutCubic;
        const shortestPath = opts.shortestPath ?? true;

        // Ensure pivot is up-to-date before tweening
        cluster.rebuildPivotFromBounds();

        const pivotWorld = container.toGlobal(container.pivot.clone());

        // Current rotation in radians
        const startRot = container.rotation;

        // Target rotation in radians (quarter turns)
        const targetRotBase = (opts.targetQ & 3) * (Math.PI * 0.5);

        // Choose end rotation angle
        let endRot = targetRotBase;

        if (shortestPath) {
            // Normalize delta to [-PI, PI] range
            const twoPi = Math.PI * 2;
            let delta = ((endRot - startRot) % twoPi + twoPi) % twoPi; // [0,2pi)
            if (delta > Math.PI) {
                delta -= twoPi; // (-pi, pi]
            }
            endRot = startRot + delta;
        }
        else {
            // Force CW movement in quarter steps (only makes sense if start is exactly at a quarter)
            // If not exact quarter, we still move forward to target base in [0..2pi)
            const twoPi = Math.PI * 2;
            let startNorm = ((startRot % twoPi) + twoPi) % twoPi;
            let targetNorm = ((targetRotBase % twoPi) + twoPi) % twoPi;

            let delta = targetNorm - startNorm;
            if (delta < 0) {
                delta += twoPi;
            }

            endRot = startRot + delta;
        }

        let rafId = 0;
        let cancelled = false;

        const startTime = performance.now();

        const step = () => {
            if (cancelled) {
                return;
            }

            const now = performance.now();
            const t = Math.min(1, (now - startTime) / durationMs);
            const k = easing(t);

            // Update rotation
            container.rotation = startRot + (endRot - startRot) * k;

            // Reposition to keep pivotWorld fixed
            const pivotAfter = container.toGlobal(container.pivot.clone());
            container.position.x += (pivotWorld.x - pivotAfter.x);
            container.position.y += (pivotWorld.y - pivotAfter.y);

            if (t < 1) {
                rafId = requestAnimationFrame(step);
            }
            else {
                // Snap to exact quarter and update rotationQ
                cluster.rotationQ = (opts.targetQ & 3) as QuarterTurns;
                container.rotation = cluster.rotationQ * (Math.PI * 0.5);

                // One final correction so pivot is exact
                const pivotFinal = container.toGlobal(container.pivot.clone());
                container.position.x += (pivotWorld.x - pivotFinal.x);
                container.position.y += (pivotWorld.y - pivotFinal.y);

                resolve();
            }
        };

        let resolve!: () => void;
        const promise = new Promise<void>((r) => { resolve = r; });

        rafId = requestAnimationFrame(step);

        return {
            promise,
            cancel: () => {
                cancelled = true;
                if (rafId) {
                    cancelAnimationFrame(rafId);
                }
            },
        };
    }

    /**
     * Tween cluster translation in piecesLayer local space.
     * If you already use GSAP, you can replace this with gsap.to().
     */
    public static tweenTranslation(opts: {
        container: PIXI.Container;
        dx: number;
        dy: number;
        durationMs?: number;
        easing?: EasingFn;
    }): { promise: Promise<void>; cancel: () => void } {
        const c = opts.container;
        const durationMs = Math.max(1, opts.durationMs ?? 90);
        const easing = opts.easing ?? JigsawClusterTweenUtils.easeOutCubic;

        const sx = c.x;
        const sy = c.y;
        const ex = sx + opts.dx;
        const ey = sy + opts.dy;

        let rafId = 0;
        let cancelled = false;

        const startTime = performance.now();

        const step = () => {
            if (cancelled) {
                return;
            }

            const now = performance.now();
            const t = Math.min(1, (now - startTime) / durationMs);
            const k = easing(t);

            c.position.set(
                sx + (ex - sx) * k,
                sy + (ey - sy) * k
            );

            if (t < 1) {
                rafId = requestAnimationFrame(step);
            }
            else {
                resolve();
            }
        };

        let resolve!: () => void;
        const promise = new Promise<void>((r) => { resolve = r; });

        rafId = requestAnimationFrame(step);

        return {
            promise,
            cancel: () => {
                cancelled = true;
                if (rafId) {
                    cancelAnimationFrame(rafId);
                }
            },
        };
    }
}
