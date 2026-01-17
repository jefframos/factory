// JigsawClusterManager.ts
import * as PIXI from "pixi.js";
import { JigsawCluster } from "./JigsawCluster";
import { JigsawPiece } from "./JigsawPiece";
import { JigsawSignals } from "./JigsawSignals";

type NeighborDir = "left" | "right" | "top" | "bottom";

type SnapCandidate =
    {
        movingPiece: JigsawPiece;
        staticPiece: JigsawPiece;
        deltaLocal: PIXI.Point;          // piecesLayer local translation to apply to active cluster
        dist: number;
        targetRotationQ: 0 | 1 | 2 | 3;  // rotation the active cluster should be in for this snap
    };

export class JigsawClusterManager {
    private readonly piecesLayer: PIXI.Container;
    private readonly pieceByKey: Map<string, JigsawPiece> = new Map();

    public readonly signals: JigsawSignals = new JigsawSignals();

    private totalPieces: number = 0;
    private clusterCount: number = 0;
    private completed: boolean = false;

    public snapDistance: number = 28;
    public snapIterations: number = 8;

    public debug: boolean = false;
    private debugGfx?: PIXI.Graphics;

    public constructor(piecesLayer: PIXI.Container) {
        this.piecesLayer = piecesLayer;
    }

    public dispose() {
        this.pieceByKey.clear();
    }
    public resetCompletionState(): void {
        this.completed = false;
    }

    public registerPieces(pieces: JigsawPiece[]): void {
        this.pieceByKey.clear();

        for (const p of pieces) {
            this.pieceByKey.set(this.key(p.definition.col, p.definition.row), p);
        }

        this.totalPieces = pieces.length;
        this.completed = false;
    }

    public createInitialClusters(pieces: JigsawPiece[]): JigsawCluster[] {
        const clusters: JigsawCluster[] = [];

        for (const p of pieces) {
            const c = new JigsawCluster();
            p.position.set(0, 0);
            c.addPiece(p);

            clusters.push(c);
            this.piecesLayer.addChild(c.container);
        }

        this.clusterCount = clusters.length; // 1 per piece initially
        this.completed = (this.clusterCount === 1 && this.totalPieces > 0);

        return clusters;
    }

    public enableDebug(): void {
        if (!this.debugGfx) {
            this.debugGfx = new PIXI.Graphics();
            this.piecesLayer.addChild(this.debugGfx);
        }

        this.debug = true;
    }

    public disableDebug(): void {
        this.debug = false;

        if (this.debugGfx) {
            this.debugGfx.clear();
        }
    }

    public trySnapAndMerge(activeCluster: JigsawCluster): void {
        for (let i = 0; i < this.snapIterations; i++) {
            const best = this.findBestSnapCandidate(activeCluster);
            if (!best || best.dist > this.snapDistance) {
                break;
            }

            // Rotate first (keeps world position stable)
            this.setClusterRotationQ(activeCluster, best.targetRotationQ);

            // Apply snap translation (piecesLayer-local delta)
            activeCluster.container.position.x += best.deltaLocal.x;
            activeCluster.container.position.y += best.deltaLocal.y;

            const fromCluster = best.movingPiece.cluster;
            const toCluster = best.staticPiece.cluster;

            if (fromCluster !== toCluster) {
                const mergedCluster = this.mergeClusters(fromCluster, toCluster);

                this.signals.onPieceConnected.dispatch({
                    movingPiece: best.movingPiece,
                    staticPiece: best.staticPiece,
                    fromCluster,
                    toCluster,
                    mergedCluster,
                });

                // Update cluster count and completion
                this.clusterCount = Math.max(1, this.clusterCount - 1);

                if (!this.completed && this.clusterCount === 1 && this.totalPieces > 0) {
                    this.completed = true;
                    this.signals.onPuzzleCompleted.dispatch({
                        finalCluster: mergedCluster,
                        totalPieces: this.totalPieces,
                    });
                }
            }
        }
    }

    private findBestSnapCandidate(activeCluster: JigsawCluster): SnapCandidate | null {
        if (activeCluster.pieces.size === 0) {
            return null;
        }

        let best: SnapCandidate | null = null;

        for (const movingPiece of activeCluster.pieces) {
            const c = movingPiece.definition.col;
            const r = movingPiece.definition.row;

            const leftKey = this.key(c - 1, r);
            const rightKey = this.key(c + 1, r);
            const topKey = this.key(c, r - 1);
            const bottomKey = this.key(c, r + 1);

            const neighbors: Array<[NeighborDir, JigsawPiece | null]> =
                [
                    ["left", this.pieceByKey.get(leftKey) ?? null],
                    ["right", this.pieceByKey.get(rightKey) ?? null],
                    ["top", this.pieceByKey.get(topKey) ?? null],
                    ["bottom", this.pieceByKey.get(bottomKey) ?? null],
                ];

            for (const [dir, staticPiece] of neighbors) {
                if (!staticPiece) {
                    continue;
                }

                if (staticPiece.cluster === activeCluster) {
                    continue;
                }

                // Try matching by rotating the active cluster to the static cluster's rotation.
                // This enables "magnet rotated clusters": active will rotate into alignment on snap.
                const targetRotationQ = staticPiece.cluster.rotationQ;

                const candidate = this.computeCandidate(movingPiece, staticPiece, dir, targetRotationQ);
                if (!candidate) {
                    continue;
                }

                if (!best || candidate.dist < best.dist) {
                    best = candidate;
                }
            }
        }

        return best;
    }

    private computeCandidate(
        movingPiece: JigsawPiece,
        staticPiece: JigsawPiece,
        dir: NeighborDir,
        targetRotationQ: 0 | 1 | 2 | 3
    ): SnapCandidate | null {
        const w = movingPiece.definition.pieceW;
        const h = movingPiece.definition.pieceH;

        // expected = (static -> moving) in solved state (unrotated)
        const expected = new PIXI.Point(0, 0);

        // dir means where static sits relative to moving (in solved grid)
        switch (dir) {
            case "left": expected.set(+w, 0); break;     // static left  => moving right
            case "right": expected.set(-w, 0); break;    // static right => moving left
            case "top": expected.set(0, +h); break;      // static above => moving below
            case "bottom": expected.set(0, -h); break;   // static below => moving above
        }

        // Under rotation, the expected translation rotates with the cluster.
        const expectedRot = this.rotateVecByQ(expected, targetRotationQ);

        // We need the moving piece "core origin" expressed in piecesLayer space
        // AFTER applying the target rotation to the moving cluster, but WITHOUT committing it.
        //
        // Approach:
        // - use a small rotation-delta transform around active cluster pivot in world space
        // - then compute the projected moving core position in piecesLayer
        //
        // This avoids temporarily mutating scene graph / risking visible flicker.

        const activeCluster = movingPiece.cluster;
        const activeContainer = activeCluster.container;

        // Global positions of moving/static cores (current state)
        const movingCoreG_now = movingPiece.getCoreOriginGlobal();
        const staticCoreG = staticPiece.getCoreOriginGlobal();

        // Convert static core to piecesLayer local (stable)
        const staticCoreL = this.piecesLayer.toLocal(staticCoreG);

        // If target rotation equals current, we can use existing movingCore directly
        const currentQ = activeCluster.rotationQ;
        let movingCoreL: PIXI.Point;

        if (currentQ === targetRotationQ) {
            movingCoreL = this.piecesLayer.toLocal(movingCoreG_now);
        }
        else {
            // Project moving core position as if cluster rotated from currentQ -> targetRotationQ
            const projected = this.projectPointUnderClusterQuarterTurn(
                activeContainer,
                movingCoreG_now,
                currentQ,
                targetRotationQ
            );

            movingCoreL = this.piecesLayer.toLocal(projected);
        }

        const targetMovingCoreL = new PIXI.Point(
            staticCoreL.x + expectedRot.x,
            staticCoreL.y + expectedRot.y
        );

        const dx = targetMovingCoreL.x - movingCoreL.x;
        const dy = targetMovingCoreL.y - movingCoreL.y;

        return {
            movingPiece,
            staticPiece,
            deltaLocal: new PIXI.Point(dx, dy),
            dist: Math.hypot(dx, dy),
            targetRotationQ,
        };
    }

    private mergeClusters(a: JigsawCluster, b: JigsawCluster): JigsawCluster {
        let target = a;
        let source = b;

        // Merge smaller into larger
        if (b.pieces.size > a.pieces.size) {
            target = b;
            source = a;
        }

        if (target === source) {
            return target;
        }

        // Assumption for clean merge:
        // source has already been snapped so that its transform aligns with target in world space.
        // We still preserve each piece world position when reparenting.

        for (const piece of source.pieces) {
            const worldPos = new PIXI.Point();
            (piece as any).getGlobalPosition(worldPos);

            source.container.removeChild(piece);
            target.container.addChild(piece);

            const local = target.container.toLocal(worldPos);
            piece.position.set(local.x, local.y);

            piece.cluster = target;
            target.pieces.add(piece);
        }

        source.pieces.clear();

        if (source.container.parent) {
            source.container.parent.removeChild(source.container);
        }

        // Important for stable future rotations
        target.rebuildPivotFromBounds();

        return target;
    }

    private setClusterRotationQ(cluster: JigsawCluster, q: 0 | 1 | 2 | 3): void {
        const qq = (q & 3) as 0 | 1 | 2 | 3;

        if (cluster.rotationQ === qq) {
            return;
        }

        // Rotate CW until we reach desired q (since rotateCW preserves world pivot)
        // This keeps your "no jump" guarantee.
        while (cluster.rotationQ !== qq) {
            cluster.rotateCW();
        }
    }

    private rotateVecByQ(v: PIXI.Point, q: number): PIXI.Point {
        const qq = q & 3;

        if (qq === 0) {
            return new PIXI.Point(v.x, v.y);
        }

        if (qq === 1) {
            return new PIXI.Point(-v.y, v.x);
        }

        if (qq === 2) {
            return new PIXI.Point(-v.x, -v.y);
        }

        // qq === 3
        return new PIXI.Point(v.y, -v.x);
    }

    /**
     * Projects a global point as if `clusterContainer` were rotated from fromQ to toQ
     * around the cluster's pivot (in world space), without mutating the scene graph.
     */
    private projectPointUnderClusterQuarterTurn(
        clusterContainer: PIXI.Container,
        pointGlobal: PIXI.IPointData,
        fromQ: number,
        toQ: number
    ): PIXI.Point {
        // Get pivot in local space, then to global (world pivot point)
        const pivotLocal = clusterContainer.pivot;
        const pivotWorld = clusterContainer.toGlobal(new PIXI.Point(pivotLocal.x, pivotLocal.y));

        const from = fromQ & 3;
        const to = toQ & 3;

        // We need delta rotation in quarter turns (CW)
        let dq = (to - from) & 3;

        // Convert point to pivot-relative
        const x = pointGlobal.x - pivotWorld.x;
        const y = pointGlobal.y - pivotWorld.y;

        let rx = x;
        let ry = y;

        // Apply dq * 90deg CW
        if (dq === 1) {
            // (x, y) -> (y, -x) for CW 90? In screen coords with y down:
            // Using standard math with y down is tricky; however Pixi rotation uses
            // standard +rotation = clockwise? Actually Pixi uses radians with
            // positive rotation = clockwise in screen coords (y down).
            // Empirically, for Pixi, 90deg CW corresponds to (x, y)->(y, -x).
            rx = y;
            ry = -x;
        }
        else if (dq === 2) {
            rx = -x;
            ry = -y;
        }
        else if (dq === 3) {
            rx = -y;
            ry = x;
        }

        return new PIXI.Point(
            pivotWorld.x + rx,
            pivotWorld.y + ry
        );
    }

    private key(col: number, row: number): string {
        return `${col},${row}`;
    }
}
