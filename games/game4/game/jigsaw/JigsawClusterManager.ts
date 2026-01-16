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
        deltaLocal: PIXI.Point; // piecesLayer local
        dist: number;
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

            // Apply snap (piecesLayer-local delta)
            activeCluster.container.position.x += best.deltaLocal.x;
            activeCluster.container.position.y += best.deltaLocal.y;

            const fromCluster = best.movingPiece.cluster;
            const toCluster = best.staticPiece.cluster;

            if (fromCluster !== toCluster) {
                const mergedCluster = this.mergeClusters(fromCluster, toCluster);

                // Signal: a connection happened
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
        console.group("Jigsaw Debug: findBestSnapCandidate");
        console.log("activeCluster.id:", activeCluster.id);
        console.log("activeCluster pieces:", activeCluster.pieces.size);

        if (activeCluster.pieces.size === 0) {
            console.warn("Cluster has zero pieces -> cannot snap.");
            console.groupEnd();
            return null;
        }

        let best: SnapCandidate | null = null;

        for (const movingPiece of activeCluster.pieces) {
            const c = movingPiece.definition.col;
            const r = movingPiece.definition.row;

            console.log("movingPiece:", movingPiece.definition.id, "col,row:", c, r);

            const leftKey = this.key(c - 1, r);
            const rightKey = this.key(c + 1, r);
            const topKey = this.key(c, r - 1);
            const bottomKey = this.key(c, r + 1);

            const left = this.pieceByKey.get(leftKey) ?? null;
            const right = this.pieceByKey.get(rightKey) ?? null;
            const top = this.pieceByKey.get(topKey) ?? null;
            const bottom = this.pieceByKey.get(bottomKey) ?? null;

            console.log("neighbor keys:", { leftKey, rightKey, topKey, bottomKey });
            console.log("neighbors found:", {
                left: !!left ? left.definition.id : null,
                right: !!right ? right.definition.id : null,
                top: !!top ? top.definition.id : null,
                bottom: !!bottom ? bottom.definition.id : null
            });

            // If all are null, your pieceByKey map doesn't contain expected keys.
            const neighbors: Array<["left" | "right" | "top" | "bottom", JigsawPiece | null]> =
                [
                    ["left", left],
                    ["right", right],
                    ["top", top],
                    ["bottom", bottom]
                ];

            for (const [dir, staticPiece] of neighbors) {
                if (!staticPiece) {
                    continue;
                }

                if (staticPiece.cluster === activeCluster) {
                    console.log("skip neighbor in same cluster:", dir, staticPiece.definition.id);
                    continue;
                }

                const candidate = this.computeCandidate(movingPiece, staticPiece, dir);

                if (!best || candidate!.dist < best.dist) {
                    best = candidate;
                }
            }
        }

        console.log("best:", best ? { dist: best.dist, moving: best.movingPiece.definition.id, static: best.staticPiece.definition.id } : null);
        console.groupEnd();

        return best;
    }


    private computeCandidate(movingPiece: JigsawPiece, staticPiece: JigsawPiece, dir: NeighborDir): SnapCandidate | null {
        const w = movingPiece.definition.pieceW;
        const h = movingPiece.definition.pieceH;

        // expected = (static -> moving) in solved state
        const expected = new PIXI.Point(0, 0);

        // IMPORTANT: dir means where static sits relative to moving
        switch (dir) {
            case "left": expected.set(+w, 0); break;  // static left => moving right
            case "right": expected.set(-w, 0); break;  // static right => moving left
            case "top": expected.set(0, +h); break;  // static above => moving below
            case "bottom": expected.set(0, -h); break;  // static below => moving above
        }

        const movingCoreG = movingPiece.getCoreOriginGlobal();
        const staticCoreG = staticPiece.getCoreOriginGlobal();

        const movingCoreL = this.piecesLayer.toLocal(movingCoreG);
        const staticCoreL = this.piecesLayer.toLocal(staticCoreG);

        const targetMovingCoreL = new PIXI.Point(
            staticCoreL.x + expected.x,
            staticCoreL.y + expected.y
        );

        const dx = targetMovingCoreL.x - movingCoreL.x;
        const dy = targetMovingCoreL.y - movingCoreL.y;

        return {
            movingPiece,
            staticPiece,
            deltaLocal: new PIXI.Point(dx, dy),
            dist: Math.hypot(dx, dy),
        };
    }



    private getIntendedNeighbors(piece: JigsawPiece): Array<[NeighborDir, JigsawPiece | null]> {
        const c = piece.definition.col;
        const r = piece.definition.row;

        return [
            ["left", this.pieceByKey.get(this.key(c - 1, r)) ?? null],
            ["right", this.pieceByKey.get(this.key(c + 1, r)) ?? null],
            ["top", this.pieceByKey.get(this.key(c, r - 1)) ?? null],
            ["bottom", this.pieceByKey.get(this.key(c, r + 1)) ?? null],
        ];
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

        return target;
    }



    private key(col: number, row: number): string {
        return `${col},${row}`;
    }
}
