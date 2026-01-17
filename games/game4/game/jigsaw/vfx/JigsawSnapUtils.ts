// JigsawSnapUtils.ts
import gsap from "gsap";
import * as PIXI from "pixi.js";
import { JigsawCluster } from "./JigsawCluster";
import { JigsawPiece } from "./JigsawPiece";

export class JigsawSnapUtils {
    private constructor() { }

    public static findWinnerCluster(pieces: JigsawPiece[]): JigsawCluster | null {
        if (pieces.length === 0) {
            return null;
        }

        const counts = new Map<JigsawCluster, number>();

        for (const p of pieces) {
            counts.set(p.cluster, (counts.get(p.cluster) ?? 0) + 1);
        }

        let winner: JigsawCluster | null = null;
        let best = -1;

        for (const [c, count] of counts.entries()) {
            if (count > best) {
                best = count;
                winner = c;
            }
        }

        return winner;
    }

    public static findAnchorPieceInCluster(pieces: JigsawPiece[], cluster: JigsawCluster): JigsawPiece | null {
        let anchor: JigsawPiece | null = null;

        for (const p of pieces) {
            if (p.cluster !== cluster) {
                continue;
            }

            if (p.definition.row === 0 && p.definition.col === 0) {
                return p;
            }

            if (!anchor) {
                anchor = p;
            }
            else {
                const a = anchor.definition;
                const d = p.definition;

                if (d.row < a.row || (d.row === a.row && d.col < a.col)) {
                    anchor = p;
                }
            }
        }

        return anchor;
    }

    public static computeDesiredAnchorLocal(
        solvedOrigin: PIXI.IPointData,
        anchor: JigsawPiece
    ): PIXI.Point {
        const pieceW = anchor.definition.pieceW;
        const pieceH = anchor.definition.pieceH;

        return new PIXI.Point(
            solvedOrigin.x + anchor.definition.col * pieceW,
            solvedOrigin.y + anchor.definition.row * pieceH
        );
    }

    /**
     * Computes the final solved pose (rotation=0, x/y) for a cluster so that the anchor
     * piece aligns to desiredAnchorLocal in piecesLayer space.
     *
     * This does not mutate the cluster permanently; it temporarily normalizes rotation
     * to measure the correct delta, then restores.
     */
    public static computeSolvedPoseForCluster(
        piecesLayer: PIXI.Container,
        cluster: JigsawCluster,
        anchor: JigsawPiece,
        desiredAnchorLocal: PIXI.IPointData
    ): { rotation: number; x: number; y: number } {
        const c = cluster.container;

        // Ensure pivot is correct (important after merges)
        cluster.rebuildPivotFromBounds();

        const savedRotation = c.rotation;
        const savedQ = cluster.rotationQ;

        const savedX = c.position.x;
        const savedY = c.position.y;

        // Temporarily normalize to solved orientation
        c.rotation = 0;
        cluster.rotationQ = 0;

        const anchorGlobalAtRot0 = anchor.getGlobalPosition(new PIXI.Point(), false);
        const anchorLocalAtRot0 = piecesLayer.toLocal(anchorGlobalAtRot0);

        const dx = desiredAnchorLocal.x - anchorLocalAtRot0.x;
        const dy = desiredAnchorLocal.y - anchorLocalAtRot0.y;

        const finalX = c.position.x + dx;
        const finalY = c.position.y + dy;

        // Restore (no visible pop if caller restores immediately or computes before tween)
        c.rotation = savedRotation;
        cluster.rotationQ = savedQ;

        c.position.set(savedX, savedY);

        return { rotation: 0, x: finalX, y: finalY };
    }

    /**
     * Tweens a cluster to its solved pose:
     * - rotates to 0
     * - moves so anchor aligns to solved grid
     * - hard-normalizes rotationQ and position at end
     */
    public static async tweenClusterToSolvedPose(opts: {
        piecesLayer: PIXI.Container;
        pieces: JigsawPiece[];
        solvedOrigin: PIXI.IPointData;
        cluster?: JigsawCluster;                 // if omitted, picks winner (largest cluster)
        anchor?: JigsawPiece;                   // if omitted, picks top-left / smallest (row,col)
        duration?: number;
        ease?: string;
        killTweensForTarget?: boolean;          // default true
    }): Promise<{ cluster: JigsawCluster; anchor: JigsawPiece } | null> {
        const duration = opts.duration ?? 0.7;
        const ease = opts.ease ?? "power3.out";

        const cluster = opts.cluster ?? this.findWinnerCluster(opts.pieces);
        if (!cluster) {
            return null;
        }

        const anchor = opts.anchor ?? this.findAnchorPieceInCluster(opts.pieces, cluster);
        if (!anchor) {
            return null;
        }

        const desiredAnchorLocal = this.computeDesiredAnchorLocal(opts.solvedOrigin, anchor);

        const solvedPose = this.computeSolvedPoseForCluster(
            opts.piecesLayer,
            cluster,
            anchor,
            desiredAnchorLocal
        );

        const c = cluster.container;

        if (opts.killTweensForTarget !== false) {
            gsap.killTweensOf(c);
            gsap.killTweensOf(c.position);
        }

        await new Promise<void>((resolve) => {
            gsap.to(c, {
                rotation: solvedPose.rotation,
                duration,
                ease,
                overwrite: true,
            });

            gsap.to(c.position, {
                x: solvedPose.x,
                y: solvedPose.y,
                duration,
                ease,
                overwrite: true,
                onComplete: () => {
                    // Hard-normalize for logic and drift
                    c.rotation = 0;
                    cluster.rotationQ = 0;
                    c.position.set(solvedPose.x, solvedPose.y);

                    resolve();
                },
                onInterrupt: () => {
                    c.rotation = 0;
                    cluster.rotationQ = 0;
                    resolve();
                },
            });
        });

        return { cluster, anchor };
    }
}
