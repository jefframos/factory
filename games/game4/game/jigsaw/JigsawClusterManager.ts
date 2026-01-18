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

    public dispose(): void {
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

    /**
     * Async snap+merge:
     * - Keeps rotation DISCRETE (stable): uses setClusterRotationQ (instant quarter-turns)
     * - Tweens translation only (safe)
     *
     * IMPORTANT: Callers should `await` this.
     */
    public async trySnapAndMerge(activeCluster: JigsawCluster): Promise<void> {
        if ((activeCluster as any).__snapping) {
            return;
        }
        (activeCluster as any).__snapping = true;

        try {
            for (let i = 0; i < this.snapIterations; i++) {
                const best = this.findBestSnapCandidate(activeCluster);
                if (!best || best.dist > this.snapDistance) {
                    break;
                }

                // 1) Rotate instantly to target quarter (stable logic)
                this.setClusterRotationQ(activeCluster, best.targetRotationQ);

                // 2) Tween translation in piecesLayer-local (safe)
                if (Math.abs(best.deltaLocal.x) > 0.001 || Math.abs(best.deltaLocal.y) > 0.001) {
                    await this.tweenContainerByLocalDelta(activeCluster.container, best.deltaLocal, 90);
                }

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

                    // Critical: continue on the surviving cluster
                    activeCluster = mergedCluster;
                }
            }
        }
        finally {
            (activeCluster as any).__snapping = false;
        }
    }

    /**
     * Original (sync) version kept for reference if you need it.
     */
    public trySnapAndMergeSync(activeCluster: JigsawCluster): void {
        for (let i = 0; i < this.snapIterations; i++) {
            const best = this.findBestSnapCandidate(activeCluster);
            if (!best || best.dist > this.snapDistance) {
                break;
            }

            this.setClusterRotationQ(activeCluster, best.targetRotationQ);

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

                this.clusterCount = Math.max(1, this.clusterCount - 1);

                if (!this.completed && this.clusterCount === 1 && this.totalPieces > 0) {
                    this.completed = true;
                    this.signals.onPuzzleCompleted.dispatch({
                        finalCluster: mergedCluster,
                        totalPieces: this.totalPieces,
                    });
                }

                activeCluster = mergedCluster;
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

                // Align active rotation to static cluster rotation
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
            case "left":
                {
                    expected.set(+w, 0);
                    break;
                }
            case "right":
                {
                    expected.set(-w, 0);
                    break;
                }
            case "top":
                {
                    expected.set(0, +h);
                    break;
                }
            case "bottom":
                {
                    expected.set(0, -h);
                    break;
                }
        }

        // Under rotation, the expected translation rotates with the cluster.
        const expectedRot = this.rotateVecByQ_CW(expected, targetRotationQ);

        const activeCluster = movingPiece.cluster;
        const activeContainer = activeCluster.container;

        // Global positions of moving/static cores (current state)
        const movingCoreG_now = movingPiece.getCoreOriginGlobal();
        const staticCoreG = staticPiece.getCoreOriginGlobal();

        // Convert static core to piecesLayer local (stable)
        const staticCoreL = this.piecesLayer.toLocal(staticCoreG);

        const currentQ = activeCluster.rotationQ;
        let movingCoreL: PIXI.Point;

        if (currentQ === targetRotationQ) {
            movingCoreL = this.piecesLayer.toLocal(movingCoreG_now);
        }
        else {
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

    private rotateVecByQ_CW(v: PIXI.Point, q: number): PIXI.Point {
        const qq = q & 3;

        if (qq === 0) {
            return new PIXI.Point(v.x, v.y);
        }

        // 90° CW
        if (qq === 1) {
            return new PIXI.Point(v.y, -v.x);
        }

        // 180°
        if (qq === 2) {
            return new PIXI.Point(-v.x, -v.y);
        }

        // 270° CW
        return new PIXI.Point(-v.y, v.x);
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

        // Preserve each piece world position when reparenting.
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

        while (cluster.rotationQ !== qq) {
            cluster.rotateCW();
        }
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
        const pivotWorld = clusterContainer.toGlobal(clusterContainer.pivot.clone());

        const from = fromQ & 3;
        const to = toQ & 3;
        const dq = (to - from) & 3;

        const x = pointGlobal.x - pivotWorld.x;
        const y = pointGlobal.y - pivotWorld.y;

        let rx = x;
        let ry = y;

        if (dq === 1) {
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

        return new PIXI.Point(pivotWorld.x + rx, pivotWorld.y + ry);
    }

    // ---------- Tweens (translation only) ----------

    private async tweenContainerByLocalDelta(
        container: PIXI.Container,
        deltaLocal: PIXI.Point,
        durationMs: number = 90
    ): Promise<void> {
        const sx = container.x;
        const sy = container.y;
        const ex = sx + deltaLocal.x;
        const ey = sy + deltaLocal.y;

        const easeOutCubic = (t: number) => {
            return 1 - Math.pow(1 - t, 3);
        };

        await this.rafTween(durationMs, (t01) => {
            const k = easeOutCubic(t01);

            container.position.set(
                sx + (ex - sx) * k,
                sy + (ey - sy) * k
            );
        });
    }

    private rafTween(durationMs: number, onUpdate: (t01: number) => void): Promise<void> {
        const d = Math.max(1, durationMs);

        return new Promise<void>((resolve) => {
            const start = performance.now();

            const tick = () => {
                const now = performance.now();
                const t = Math.min(1, (now - start) / d);

                onUpdate(t);

                if (t < 1) {
                    requestAnimationFrame(tick);
                }
                else {
                    resolve();
                }
            };

            requestAnimationFrame(tick);
        });
    }

    private key(col: number, row: number): string {
        return `${col},${row}`;
    }
}
