import * as PIXI from "pixi.js";
import { HexGameMediator } from "./HexGameMediator";
import { HexPos, HexUtils } from "./HexTypes";
import { ClusterView } from "./cluster/ClusterView";

type AnchorCell = { q: number; r: number };

/**
 * Patched HexInputService
 * Fixes:
 * - Snap/highlight use the SAME anchor: the cluster's (0,0) tile center.
 * - Inverse mapping derived from HexUtils.offsetToPixel() (stepX/stepY/oddOffsetX).
 * - Optional: parity-aware cluster rendering while hovering.
 *
 * Requires (optional but strongly recommended):
 *   ClusterView.applyAnchorRowParity(parity: 0 | 1): void
 * so the rendered shape matches the absolute-row parity while hovering.
 */
export class HexInputService {
    private activePiece: ClusterView | null = null;
    private dragOffset: PIXI.Point = new PIXI.Point();
    private readonly HIT_RADIUS: number = 60;

    // Derived from HexUtils.offsetToPixel so snap math cannot drift.
    private stepX: number = 0;
    private stepY: number = 0;
    private oddRowOffsetX: number = 0;

    // Cluster anchor point in local space (tile (0,0) center).
    private static readonly CLUSTER_ANCHOR_LOCAL: PIXI.Point = new PIXI.Point(0, 0);

    constructor(private mediator: HexGameMediator) {
        const stage = this.mediator.Root;

        stage.eventMode = "static";
        stage.hitArea = new PIXI.Rectangle(-10000, -10000, 20000, 20000);

        stage.on("pointerdown", this.onPointerDown, this);
        stage.on("pointermove", this.onPointerMove, this);
        stage.on("pointerup", this.onPointerUp, this);
        stage.on("pointerupoutside", this.onPointerUp, this);

        this.cacheHexSteps();
    }

    private onPointerDown(e: PIXI.FederatedPointerEvent): void {
        let closest: ClusterView | null = null;
        let minDist = this.HIT_RADIUS;

        const targets = [
            ...this.mediator.Grid.children,
            ...this.mediator.Manager.children
        ];

        for (const child of targets) {
            if (!(child instanceof ClusterView)) {
                continue;
            }

            // visualCenter is fine for selection hit-test.
            const globalCenter = child.toGlobal(child.visualCenter);
            const dist = Math.hypot(e.global.x - globalCenter.x, e.global.y - globalCenter.y);

            if (dist < minDist) {
                minDist = dist;
                closest = child;
            }
        }

        if (!closest) {
            return;
        }

        this.activePiece = closest;

        // Clear occupancy if it was placed.
        this.mediator.Grid.removePiece(closest);

        // Reparent to drag layer (shared coords).
        const posInLayer = this.mediator.GameLayer.toLocal(this.activePiece.getGlobalPosition());
        this.mediator.GameLayer.addChild(this.activePiece);
        this.activePiece.position.copyFrom(posInLayer);

        // Match grid scale visually while dragging.
        const targetScale = this.mediator.Grid.scale.x;
        this.activePiece.scale.set(targetScale);

        // Drag offset from pointer -> piece origin.
        const mouseInLayer = this.mediator.GameLayer.toLocal(e.global);
        this.dragOffset.set(
            mouseInLayer.x - this.activePiece.x,
            mouseInLayer.y - this.activePiece.y
        );
    }

    private onPointerMove(e: PIXI.FederatedPointerEvent): void {
        if (!this.activePiece) {
            return;
        }

        const mouseInLayer = this.mediator.GameLayer.toLocal(e.global);
        this.activePiece.position.set(
            mouseInLayer.x - this.dragOffset.x,
            mouseInLayer.y - this.dragOffset.y
        );

        const grid = this.mediator.Grid;

        const anchor = this.getAnchorCellForActivePiece();
        const snapped = anchor ? this.buildSnappedCoords(anchor, this.activePiece.data.coords) : null;

        // Optional but recommended: update cluster rendering to match absolute row parity.
        // This prevents "different highlight patterns depending on row".
        if (anchor) {
            const parity = (anchor.r & 1) as 0 | 1;
            const anyPiece: any = this.activePiece as any;
            if (typeof anyPiece.applyAnchorRowParity === "function") {
                anyPiece.applyAnchorRowParity(parity);
            }
        }

        if (snapped && grid.canFit(snapped)) {
            grid.highlight(snapped, this.activePiece.data.color);
        } else {
            grid.clearPreview();
        }
    }

    private onPointerUp(e: PIXI.FederatedPointerEvent): void {
        if (!this.activePiece) {
            return;
        }

        const grid = this.mediator.Grid;

        const anchor = this.getAnchorCellForActivePiece();
        const snapped = anchor ? this.buildSnappedCoords(anchor, this.activePiece.data.coords) : null;

        if (anchor && snapped && grid.canFit(snapped)) {
            // Ensure final parity is applied (optional).
            const parity = (anchor.r & 1) as 0 | 1;
            const anyPiece: any = this.activePiece as any;
            if (typeof anyPiece.applyAnchorRowParity === "function") {
                anyPiece.applyAnchorRowParity(parity);
            }

            // Reparent into grid.
            grid.addChild(this.activePiece);

            // Reset scale because grid is already scaled.
            this.activePiece.scale.set(1);

            // Place using the anchor cell: piece local (0,0) tile aligns to offsetToPixel(anchor).
            const anchorPixel = HexUtils.offsetToPixel(anchor.q, anchor.r);
            this.activePiece.position.copyFrom(anchorPixel);

            grid.placePiece(this.activePiece, snapped);
        } else {
            this.mediator.returnToTray(this.activePiece);
        }

        grid.clearPreview();
        this.activePiece = null;
    }

    // ------------------------------------------------------------
    // Snap core (single source of truth)
    // ------------------------------------------------------------

    private getAnchorCellForActivePiece(): AnchorCell | null {
        if (!this.activePiece) {
            return null;
        }

        const grid = this.mediator.Grid;

        // Anchor to the cluster's (0,0) tile center in global space.
        const anchorGlobal = this.activePiece.toGlobal(HexInputService.CLUSTER_ANCHOR_LOCAL);

        // Convert to grid local space (pivot/scale handled internally by Pixi).
        const gridLocal = grid.toLocal(anchorGlobal);

        // Convert local pixel -> offset coords.
        return this.pixelToOffsetDerived(gridLocal.x, gridLocal.y);
    }

    private buildSnappedCoords(anchor: AnchorCell, relative: HexPos[]): HexPos[] {
        return relative.map(c => ({ q: anchor.q + c.q, r: anchor.r + c.r }));
    }

    /**
     * Inverse mapping derived from HexUtils.offsetToPixel so it always matches your rendering.
     */
    private pixelToOffsetDerived(x: number, y: number): AnchorCell {
        const size = HexUtils.HEX_SIZE;
        // Inverse Axial matrix math
        const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
        const r = (2 / 3 * y) / size;

        // Use hex rounding to find the nearest coordinate
        return this.hexRound(q, r);
    }

    private hexRound(q: number, r: number): AnchorCell {
        let s = -q - r;
        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(s);

        const qDiff = Math.abs(rq - q);
        const rDiff = Math.abs(rr - r);
        const sDiff = Math.abs(rs - s);

        if (qDiff > rDiff && qDiff > sDiff) {
            rq = -rr - rs;
        } else if (rDiff > sDiff) {
            rr = -rq - rs;
        }
        return { q: rq, r: rr };
    }

    private cacheHexSteps(): void {
        const p00 = HexUtils.offsetToPixel(0, 0);
        const p10 = HexUtils.offsetToPixel(1, 0);
        const p01 = HexUtils.offsetToPixel(0, 1);

        this.stepX = p10.x - p00.x;
        this.stepY = p01.y - p00.y;
        this.oddRowOffsetX = p01.x - p00.x;

        // Safety fallback (shouldn't happen if offsetToPixel is correct)
        if (this.stepX === 0) {
            this.stepX = HexUtils.WIDTH;
        }
        if (this.stepY === 0) {
            this.stepY = HexUtils.VERTICAL_SPACING;
        }
    }
}
