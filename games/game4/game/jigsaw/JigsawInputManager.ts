import * as PIXI from "pixi.js";
import { JigsawCluster } from "./JigsawCluster";
import { JigsawClusterManager } from "./JigsawClusterManager";
import { JigsawPiece } from "./JigsawPiece";

export class JigsawInputManager {
    private readonly stage: PIXI.Container;
    private readonly piecesLayer: PIXI.Container;
    private readonly clusterManager: JigsawClusterManager;

    private activeCluster: JigsawCluster | null = null;
    private activePointerId: number | null = null;
    private dragOffset: PIXI.Point = new PIXI.Point();

    public constructor(
        stage: PIXI.Container,
        piecesLayer: PIXI.Container,
        clusterManager: JigsawClusterManager
    ) {
        this.stage = stage;
        this.piecesLayer = piecesLayer;
        this.clusterManager = clusterManager;
        this.clusterManager.enableDebug();

        (this.stage as any).eventMode = "static";
        (this.stage as any).hitArea = new PIXI.Rectangle(-100000, -100000, 200000, 200000);

        this.stage.on("pointerdown", this.onPointerDown, this);
        this.stage.on("pointermove", this.onPointerMove, this);
        this.stage.on("pointerup", this.onPointerUp, this);
        this.stage.on("pointerupoutside", this.onPointerUp, this);
        this.stage.on("pointercancel", this.onPointerUp, this);
    }

    public destroy(): void {
        this.stage.off("pointerdown", this.onPointerDown, this);
        this.stage.off("pointermove", this.onPointerMove, this);
        this.stage.off("pointerup", this.onPointerUp, this);
        this.stage.off("pointerupoutside", this.onPointerUp, this);
        this.stage.off("pointercancel", this.onPointerUp, this);

        this.activeCluster = null;
        this.activePointerId = null;
    }

    private onPointerDown(e: PIXI.FederatedPointerEvent): void {
        if (this.activeCluster) {
            return;
        }

        const pointerId = e.pointerId ?? 0;
        const global = e.global;

        const topPiece = this.findTopmostPieceAt(global);
        if (!topPiece) {
            return;
        }

        this.activeCluster = topPiece.cluster;
        this.activePointerId = pointerId;

        // Bring cluster to front
        this.piecesLayer.addChild(this.activeCluster.container);

        topPiece.notifySelected?.();

        // Offset between pointer and cluster container position (in piecesLayer space)
        const pLocal = this.piecesLayer.toLocal(global);
        this.dragOffset.set(pLocal.x - this.activeCluster.container.x, pLocal.y - this.activeCluster.container.y);
    }

    private onPointerMove(e: PIXI.FederatedPointerEvent): void {
        if (!this.activeCluster) {
            return;
        }

        const pointerId = e.pointerId ?? 0;
        if (this.activePointerId !== null && pointerId !== this.activePointerId) {
            return;
        }

        const global = e.global;
        const pLocal = this.piecesLayer.toLocal(global);

        this.activeCluster.container.position.set(
            pLocal.x - this.dragOffset.x,
            pLocal.y - this.dragOffset.y
        );
    }

    private onPointerUp(e: PIXI.FederatedPointerEvent): void {
        if (!this.activeCluster) {
            return;
        }

        const pointerId = e.pointerId ?? 0;
        if (this.activePointerId !== null && pointerId !== this.activePointerId) {
            return;
        }

        const releasedCluster = this.activeCluster;

        this.activeCluster = null;
        this.activePointerId = null;

        // Snap & merge on release
        this.clusterManager.trySnapAndMerge(releasedCluster);
    }

    private findTopmostPieceAt(global: PIXI.IPointData): JigsawPiece | null {
        // Search from topmost cluster to bottommost, and within cluster from topmost child.
        for (let i = this.piecesLayer.children.length - 1; i >= 0; i--) {
            const clusterContainer = this.piecesLayer.children[i] as PIXI.Container;

            for (let j = clusterContainer.children.length - 1; j >= 0; j--) {
                const child = clusterContainer.children[j];
                if (child instanceof JigsawPiece) {
                    if (child.hitTestGlobal(global)) {
                        return child;
                    }
                }
            }
        }

        return null;
    }
}
