import * as PIXI from "pixi.js";
import { JigsawPiece } from "./JigsawPiece";

let _clusterId = 0;
const RAD90 = Math.PI * 0.5;

export type QuarterTurns = 0 | 1 | 2 | 3;

export class JigsawCluster {
    public readonly id: number = ++_clusterId;
    public readonly container: PIXI.Container = new PIXI.Container();
    public readonly pieces: Set<JigsawPiece> = new Set();

    public rotationQ: QuarterTurns = 0;

    // If you want to block rotate during drags, your input system can set this.
    public isHeld: boolean = false;

    // Cache pivot center in local space (recomputed when cluster content changes)
    private _pivotLocal: PIXI.Point = new PIXI.Point(0, 0);

    public addPiece(piece: JigsawPiece): void {
        this.pieces.add(piece);
        piece.cluster = this;
        this.container.addChild(piece);

        this.rebuildPivotFromBounds();
    }

    /**
     * Rotate 90deg clockwise around the cluster's visual center,
     * keeping the cluster's world position stable (no "jump" on tap).
     */
    public rotateCW(): void {
        const parent = this.container.parent;
        if (!parent) {
            // Still rotate; can't preserve world center without a parent transform.
            this.rotationQ = (((this.rotationQ + 1) & 3) as QuarterTurns);
            this.container.rotation = this.rotationQ * RAD90;
            return;
        }

        // Ensure pivot is correct before rotating (especially after merges)
        this.rebuildPivotFromBounds();

        // Keep the same world position for the pivot point:
        // 1) measure world position of pivot BEFORE rotation
        const pivotWorldBefore = this.container.toGlobal(this._pivotLocal);

        // 2) apply rotation
        this.rotationQ = (((this.rotationQ + 1) & 3) as QuarterTurns);
        this.container.rotation = this.rotationQ * RAD90;

        // 3) measure world position of pivot AFTER rotation
        const pivotWorldAfter = this.container.toGlobal(this._pivotLocal);

        // 4) shift container so pivot stays in the same world place
        const dx = pivotWorldBefore.x - pivotWorldAfter.x;
        const dy = pivotWorldBefore.y - pivotWorldAfter.y;

        this.container.position.x += dx;
        this.container.position.y += dy;
    }

    /**
     * Recomputes a stable rotation center:
     * - Uses local bounds of container contents.
     * - Sets container.pivot to bounds center.
     * - Tracks pivot in _pivotLocal for world-stable rotation logic.
     *
     * Call after:
     * - add/remove piece
     * - merge clusters
     * - any operation that changes visuals/layout
     */
    public rebuildPivotFromBounds(): void {
        // Using getLocalBounds() is OK at cluster-size scales.
        // Avoid calling this every frame; only on structural changes.
        const b = this.container.getLocalBounds();

        const cx = b.x + b.width * 0.5;
        const cy = b.y + b.height * 0.5;

        this._pivotLocal.set(cx, cy);

        // Update pivot without changing visuals:
        // When you change pivot, the container's world transform changes.
        // So we preserve the pivot's world position similarly to rotateCW.
        const parent = this.container.parent;

        if (parent) {
            const before = this.container.toGlobal(this._pivotLocal);

            this.container.pivot.set(cx, cy);

            const after = this.container.toGlobal(this._pivotLocal);

            this.container.position.x += (before.x - after.x);
            this.container.position.y += (before.y - after.y);
        }
        else {
            // No parent: just set pivot; can't preserve world position.
            this.container.pivot.set(cx, cy);
        }
    }
}
