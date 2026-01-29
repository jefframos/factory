import * as PIXI from "pixi.js";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { MergeInputMergeService } from "../services/MergeInputMergeService";
import { EntityGridView2 } from "./EntityGridView2";
import { EntityManagerGrid } from "./EntityManagerGrid";

export class MergeInputMergeGridService extends MergeInputMergeService {
    private startTileIndex: number = -1;

    public handleGrab(entity: any, localPos: PIXI.Point): void {
        if (!entity) return;

        const mgr = this.deps.entities as EntityManagerGrid;
        // Identify which slot the entity was sitting in
        this.startTileIndex = mgr.getSlotOfEntity(entity);

        // Flag for the sync logic (prevents jumping while dragging)
        (entity as any).isDragging = true;
        entity.zIndex = 1000000;

        super.handleGrab(entity, localPos);
    }

    public handleMove(globalPos: PIXI.Point, autoCollectCoins: boolean): void {
        const localPos = this.deps.gridView.toLocal(globalPos);
        const active = this.active;

        if (active) {
            // Smooth free-dragging like the old version
            this.deps.entities.setEntityPosition(active, localPos.x, localPos.y);
            this.updateMergeHighlight();
        }

        if (!autoCollectCoins) {
            this.deps.coins.checkCoinSwipe(localPos);
        }
    }

    public handleRelease(globalPos: PIXI.Point): void {
        if (!this.active) return;

        const mgr = this.deps.entities as EntityManagerGrid;
        const view = this.deps.gridView as EntityGridView2;
        const localPos = view.toLocal(globalPos);

        let targetIdx = -1;

        // 1. RADIUS CHECK (The "Old Way"): Use distance to find nearby matching entity
        const nearbyTarget = this.findMergeTargetFor(this.active as BlockMergeEntity);

        if (nearbyTarget) {
            // If we found a neighbor via radius, get their current slot
            targetIdx = mgr.getSlotOfEntity(nearbyTarget);
        } else {
            // 2. TILE CHECK (The "New Way"): Fallback to find an empty slot under the cursor
            const tile = view.getTileAt(globalPos);
            if (tile) {
                targetIdx = tile.data.index;
            }
        }

        // 3. FAIL: If no creature nearby and not over a tile, snap back
        if (targetIdx === -1) {
            this.snapBack();
            return;
        }

        const occupant = mgr.getOccupant(targetIdx);

        // 4. RESOLVE MERGE
        if (occupant && occupant !== this.active && occupant instanceof BlockMergeEntity && (this.active as any).level === occupant.level) {
            const mergeData = mgr.merge(this.active as BlockMergeEntity, occupant);

            if (mergeData && mergeData.mergeEntity) {
                // This triggers XP, missions, AND the onMergePerformed signal for FTUE
                this.finalizeMerge(mergeData.mergeEntity, mergeData.nextLevel);

                // Add tiny "cat dirty" cooldown from old service
                (this as any).setEntityDirty?.(mergeData.mergeEntity);
            }

            this.finalizeRelease();
            return;
        }

        // 5. RESOLVE SWAP OR MOVE
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
            active.isDragging = false;
            if (active.stopGrab) active.stopGrab();
        }

        this.deps.gridView.setActive(null);
        this.clearHighlight();

        (this as any).activeEntity = null;
        this.onActiveChanged.dispatch(null);
        this.onDirty.dispatch(); // Notifies FTUE to refresh tutorial hands
    }

    private snapBack(): void {
        if (this.active && this.startTileIndex !== -1) {
            (this.deps.entities as EntityManagerGrid).assignToTile(this.active, this.startTileIndex);
        }
        this.finalizeRelease();
    }
}