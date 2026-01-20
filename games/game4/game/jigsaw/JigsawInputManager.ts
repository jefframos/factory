import PlatformHandler from "@core/platforms/PlatformHandler";
import { DropShadowFilter } from "@pixi/filter-drop-shadow";
import * as PIXI from "pixi.js";
import Assets from "./Assets";
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

    private _enabled: boolean = true;
    private _safeRect?: PIXI.Rectangle;

    // Drag “lift” + shadow
    private _liftY: number = -10;
    private _dragShadow: DropShadowFilter;
    private _savedFilters: WeakMap<PIXI.Container, PIXI.Filter[] | null> = new WeakMap();

    // If true, clamp includes shadow bounds. Usually causes “sticky” edges; default false.
    private _clampIncludesShadow: boolean = false;


    private _downTimeMs: number = 0;
    private _downGlobal: PIXI.Point = new PIXI.Point();
    private _lastGlobal: PIXI.Point = new PIXI.Point();

    private _dragging: boolean = false;

    private _tapMaxMs: number = 260;
    private _tapMaxMovePx: number = 8;
    private _dragStartPx: number = 12;


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

        // Create ONE filter instance and reuse it (important for perf/GC).
        this._dragShadow = new DropShadowFilter({
            alpha: 0.35,
            blur: 3,          // keep small; blur cost grows quickly with bounds
            color: 0x000000,
            offset: { x: 0, y: 8 }, // “floating” shadow
            quality: 2,        // keep low (1–3). Higher costs more.
        });

        // If your game uses high resolution, don’t crank filter resolution.
        // this._dragShadow.resolution = 1;

        this.stage.on("pointerdown", this.onPointerDown, this);
        this.stage.on("pointermove", this.onPointerMove, this);
        this.stage.on("pointerup", this.onPointerUp, this);
        this.stage.on("pointerupoutside", this.onPointerUp, this);
        this.stage.on("pointercancel", this.onPointerUp, this);
    }

    public setEnabled(enabled: boolean): void {
        if (this._enabled === enabled) {
            return;
        }

        this._enabled = enabled;

        if (!enabled) {
            // Cancel drag and clean visuals if needed
            if (this.activeCluster) {
                this.endDragVisuals(this.activeCluster);
            }
            this.activeCluster = null;
            this.activePointerId = null;
        }
    }

    public setSafeAreaRect(rect?: PIXI.Rectangle): void {
        this._safeRect = rect ? rect.clone() : undefined;
        if (this._safeRect) {
            this.clampAllClustersToSafeRect();
        }
    }

    public destroy(): void {
        this.stage.off("pointerdown", this.onPointerDown, this);
        this.stage.off("pointermove", this.onPointerMove, this);
        this.stage.off("pointerup", this.onPointerUp, this);
        this.stage.off("pointerupoutside", this.onPointerUp, this);
        this.stage.off("pointercancel", this.onPointerUp, this);

        if (this.activeCluster) {
            this.endDragVisuals(this.activeCluster);
        }

        this.activeCluster = null;
        this.activePointerId = null;
    }

    private onPointerDown(e: PIXI.FederatedPointerEvent): void {
        if (!this._enabled || this.activeCluster) {
            return;
        }

        PlatformHandler.instance.platform.gameplayStart();


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


        // Tap/drag tracking
        this._downTimeMs = performance.now();
        this._downGlobal.copyFrom(global);
        this._lastGlobal.copyFrom(global);
        this._dragging = false;

        // Do NOT lift/apply shadow yet.
        // Do NOT compute dragOffset yet.
    }


    private onPointerMove(e: PIXI.FederatedPointerEvent): void {
        if (!this._enabled || !this.activeCluster) {
            return;
        }

        const pointerId = e.pointerId ?? 0;
        if (this.activePointerId !== null && pointerId !== this.activePointerId) {
            return;
        }

        const global = e.global;

        const dx0 = global.x - this._downGlobal.x;
        const dy0 = global.y - this._downGlobal.y;
        const dist0 = Math.hypot(dx0, dy0);

        if (!this._dragging) {
            if (dist0 < this._dragStartPx) {
                // Still a tap candidate; do not move cluster.
                return;
            }

            // Drag begins now
            this._dragging = true;

            // Start visuals only when a real drag starts
            this.beginDragVisuals(this.activeCluster);

            Assets.tryToPlaySound(Assets.Sounds.UI.Hold)


            // Compute drag offset at drag start, not on pointer down
            const pLocal = this.piecesLayer.toLocal(global);
            this.dragOffset.set(
                pLocal.x - this.activeCluster.container.x,
                pLocal.y - this.activeCluster.container.y
            );
        }

        const pLocal = this.piecesLayer.toLocal(global);

        this.activeCluster.container.position.set(
            pLocal.x - this.dragOffset.x,
            pLocal.y - this.dragOffset.y
        );

        if (this._safeRect) {
            this.clampClusterToSafeRect(this.activeCluster.container, this._safeRect);
        }

        this._lastGlobal.copyFrom(global);
    }


    private async onPointerUp(e: PIXI.FederatedPointerEvent): Promise<void> {
        if (!this._enabled || !this.activeCluster) {
            return;
        }

        const pointerId = e.pointerId ?? 0;
        if (this.activePointerId !== null && pointerId !== this.activePointerId) {
            return;
        }

        const releasedCluster = this.activeCluster;

        const elapsed = performance.now() - this._downTimeMs;
        const dx = e.global.x - this._downGlobal.x;
        const dy = e.global.y - this._downGlobal.y;
        const dist = Math.hypot(dx, dy);

        const isTap =
            !this._dragging &&
            elapsed <= this._tapMaxMs &&
            dist <= this._tapMaxMovePx;

        if (this._dragging) {
            this.endDragVisuals(releasedCluster);
        }

        this.activeCluster = null;
        this.activePointerId = null;

        if (isTap) {
            // Tweened rotation (no translation)
            await releasedCluster.rotateCW_Tween(140);

            if (this._safeRect) {
                this.clampClusterToSafeRect(releasedCluster.container, this._safeRect);
            }

            // IMPORTANT: await, because snap/merge is async now
            await this.clusterManager.trySnapAndMerge(releasedCluster);

            if (this._safeRect) {
                this.clampAllClustersToSafeRect();
            }

            return;
        } else {
            Assets.tryToPlaySound(Assets.Sounds.UI.Drop)

        }

        // Drag release => snap/merge only
        await this.clusterManager.trySnapAndMerge(releasedCluster);

        if (this._safeRect) {
            this.clampAllClustersToSafeRect();
        }
    }



    private beginDragVisuals(cluster: JigsawCluster): void {
        const c = cluster.container;

        // Lift
        c.y += this._liftY;

        // Save and apply filter
        if (!this._savedFilters.has(c)) {
            this._savedFilters.set(c, (c.filters as PIXI.Filter[] | null) ?? null);
        }

        const existing = (c.filters as PIXI.Filter[] | null) ?? null;

        // If you already have filters on clusters, append; otherwise set to [shadow]
        c.filters = existing && existing.length > 0
            ? [...existing, this._dragShadow]
            : [this._dragShadow];

        // Important: shadow needs padding or it may get clipped.
        // Pixi uses filter padding; drop shadow filter exposes `padding` via Filter base.
        // Keep it small (depends on blur/offset).
        (this._dragShadow as any).padding = 16;
    }

    private endDragVisuals(cluster: JigsawCluster): void {
        const c = cluster.container;

        // Unlift (only if we lifted)
        c.y -= this._liftY;

        // Restore previous filters
        const prev = this._savedFilters.get(c);
        if (prev === undefined) {
            // No record; just remove drag shadow if present
            const cur = (c.filters as PIXI.Filter[] | null) ?? null;
            if (cur) {
                c.filters = cur.filter((f) => f !== this._dragShadow);
            }
        } else {
            c.filters = prev;
            this._savedFilters.delete(c);
        }
    }

    private clampAllClustersToSafeRect(): void {
        if (!this._safeRect) {
            return;
        }

        for (const child of this.piecesLayer.children) {
            if (child instanceof PIXI.Container) {
                this.clampClusterToSafeRect(child, this._safeRect);
            }
        }
    }

    private clampClusterToSafeRect(clusterContainer: PIXI.Container, safeRect: PIXI.Rectangle): void {
        // If you include shadow in bounds, clamping can feel “sticky” at edges.
        // Default: clamp based on content bounds without the drop shadow.
        const bounds = this._clampIncludesShadow
            ? clusterContainer.getBounds()
            : this.getBoundsIgnoringDragShadow(clusterContainer);

        const tlLocal = this.piecesLayer.toLocal(new PIXI.Point(bounds.x, bounds.y));
        const brLocal = this.piecesLayer.toLocal(new PIXI.Point(bounds.x + bounds.width, bounds.y + bounds.height));

        const minX = safeRect.x;
        const minY = safeRect.y;
        const maxX = safeRect.x + safeRect.width;
        const maxY = safeRect.y + safeRect.height;

        const overflowLeft = minX - tlLocal.x;
        const overflowTop = minY - tlLocal.y;
        const overflowRight = brLocal.x - maxX;
        const overflowBottom = brLocal.y - maxY;

        let dx = 0;
        let dy = 0;

        if (overflowLeft > 0) dx += overflowLeft;
        if (overflowRight > 0) dx -= overflowRight;
        if (overflowTop > 0) dy += overflowTop;
        if (overflowBottom > 0) dy -= overflowBottom;

        if (dx !== 0 || dy !== 0) {
            clusterContainer.position.set(clusterContainer.x + dx, clusterContainer.y + dy);
        }
    }

    private getBoundsIgnoringDragShadow(container: PIXI.Container): PIXI.Rectangle {
        const cur = (container.filters as PIXI.Filter[] | null) ?? null;
        if (!cur || cur.length === 0) {
            return container.getBounds();
        }

        // Temporarily remove the drag shadow filter only (leave other filters intact)
        const withoutShadow = cur.filter((f) => f !== this._dragShadow);
        if (withoutShadow.length === cur.length) {
            return container.getBounds();
        }

        container.filters = withoutShadow.length > 0 ? withoutShadow : null;
        const b = container.getBounds();
        container.filters = cur;

        return b;
    }

    private findTopmostPieceAt(global: PIXI.IPointData): JigsawPiece | null {
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
