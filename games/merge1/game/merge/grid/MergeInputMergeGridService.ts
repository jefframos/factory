import * as PIXI from "pixi.js";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { MergeInputMergeService } from "../services/MergeInputMergeService";
import { EntityManagerGrid } from "./EntityManagerGrid";

export class MergeInputMergeGridService extends MergeInputMergeService {
    private startTileIndex: number = -1;

    public handleGrab(entity: any, localPos: PIXI.Point): void {
        if (!entity) return;

        // Use a helper to find the index in the map instead of checking the grid pixels
        const mgr = this.deps.entities as EntityManagerGrid;
        this.startTileIndex = mgr.getSlotOfEntity(entity);

        if (entity) {
            entity.isDragging = true;
            entity.zIndex = 10000;
        }

        super.handleGrab(entity, localPos);
    }

    public handleMove(globalPos: PIXI.Point, autoCollectCoins: boolean): void {
        const localPos = this.deps.gridView.toLocal(globalPos);

        // Accessing the private activeEntity from base class via cast
        const active = (this as any).activeEntity;

        if (active) {
            // Simply update the visual position during drag
            this.deps.entities.setEntityPosition(active, localPos.x, localPos.y);

            // This updates the visual "glow" on potential merge targets
            this.updateMergeHighlight();
        }

        if (!autoCollectCoins) {
            this.deps.coins.checkCoinSwipe(localPos);
        }
    }

    public handleRelease(globalPos: PIXI.Point): void {
        if (!this.active) return;

        const mgr = this.deps.entities as EntityManagerGrid;
        const targetTile = this.deps.gridView.getTileAt(globalPos);

        if (!targetTile) {
            this.snapBack();
            return;
        }

        const targetIdx = targetTile.data.index;
        const occupant = mgr.getOccupant(targetIdx);

        // 2. Logic: Merge
        if (occupant && occupant !== this.active && occupant instanceof BlockMergeEntity && this.active instanceof BlockMergeEntity) {
            if (occupant.level === this.active.level) {
                // Perform the merge
                const mergeData = mgr.merge(this.active, occupant);


                if (mergeData) {
                    this.finalizeMerge(mergeData.mergeEntity, mergeData.nextLevel)
                }

                this.finalizeRelease();
                return;
            }
        }

        // 3. Logic: Swap or Move
        if (occupant && occupant !== this.active) {
            mgr.swap(this.startTileIndex, targetIdx);
        } else {
            mgr.assignToTile(this.active, targetIdx);
        }

        this.finalizeRelease();
    }

    private finalizeRelease(): void {
        const active = this.active as any;

        if (active) {
            active.isDragging = false; // --- CLEAR THE FLAG ---
            if (active.stopGrab) active.stopGrab();
        }



        this.deps.gridView.setActive(null);
        this.clearHighlight();

        // Sync back to the base class private state
        (this as any).activeEntity = null;
        this.onActiveChanged.dispatch(null);
        this.onDirty.dispatch();
    }

    private snapBack(): void {
        console.log('SNAP BACK', this.active, this.startTileIndex)
        if (this.active && this.startTileIndex !== -1) {
            (this.deps.entities as EntityManagerGrid).assignToTile(this.active, this.startTileIndex);
        }
        this.finalizeRelease();
    }
}