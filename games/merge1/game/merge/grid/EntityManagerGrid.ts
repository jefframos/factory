import { Point } from "pixi.js";
import { IEntityData } from "../data/MergeSaveTypes";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { EntityGridView } from "../entity/EntityGridView";
import { MergeEgg } from "../entity/MergeEgg";
import { EntityManager, EntityView } from "../manager/EntityManager";
import { EntityGridView2 } from "./EntityGridView2";

export class EntityManagerGrid extends EntityManager {
    // Maps Tile Index -> Entity View
    private tileMap: Map<number, BlockMergeEntity | MergeEgg> = new Map();

    constructor(gridView: EntityGridView, baker: any, bounds: any, maxGetter: any) {
        super(gridView, baker, bounds, maxGetter);

        const view = this.gridView as EntityGridView2;
        // Listen to the new signal
        view.onGridRebuilt.add(() => this.syncEntitiesToTiles());
    }
    public getBoardState(): (BlockMergeEntity | MergeEgg | null)[] {
        const max = this.maxEntitiesGetter();
        const board = new Array(max).fill(null);

        this.tileMap.forEach((entity, index) => {
            board[index] = entity;
        });

        return board;
    }
    public getTileIndexAt(x: number, y: number): number {
        const view = this.gridView as EntityGridView2;

        // Use the method we added to the GridView to find the tile via collision
        const tile = view.getTileAt(new Point(x, y));

        return tile ? tile.data.index : -1;
    }
    public getSlotOfEntity(entity: any): number {
        for (const [slotIndex, ent] of this.tileMap.entries()) {
            if (ent === entity) return slotIndex;
        }
        return -1;
    }
    public update(delta: number): void {
        super.update(delta);
        // Keep entities synced if the grid expands/shifts
        const view = this.gridView as EntityGridView2;
        if (view.tiles.length !== this.maxEntitiesGetter()) {
            view.rebuildGrid();
            this.syncEntitiesToTiles();
        }
    }

    private syncEntitiesToTiles(): void {
        const view = this.gridView as EntityGridView2;

        // Use a snapshot of entries to safely iterate
        const currentOccupants = Array.from(this.tileMap.entries());

        for (const [slotIndex, entity] of currentOccupants) {
            const tile = view.tiles[slotIndex];
            if (tile) {
                if ((entity as any).isDragging && !(entity instanceof MergeEgg)) continue;
                // Force the entity to the new centered tile position
                entity.position.set(tile.x, tile.y);
                entity.zIndex = tile.y;
                // Update the logical data so saving/loading is accurate
                const logic = this.getLogic(entity);
                if (logic) {
                    logic.data.x = tile.x;
                    logic.data.y = tile.y;
                }
            }
        }
    }

    public setEntityPosition(view: EntityView, x: number, y: number): void {
        const clampedX = Math.max(this.walkBounds.left, Math.min(x, this.walkBounds.right));
        const clampedY = Math.max(this.walkBounds.top, Math.min(y, this.walkBounds.bottom));

        view.position.set(clampedX, clampedY);


        const logic = this.entitiesByView.get(view);
        if (logic) {
            logic.data.x = clampedX;
            logic.data.y = clampedY;
            this.onEntityMoved.dispatch(view, logic.data);
            this.onDirty.dispatch();
        }
    }

    public getOccupant(index: number): BlockMergeEntity | MergeEgg | undefined {
        return this.tileMap.get(index);
    }

    public getFirstEmptyIndex(): number {
        const max = this.maxEntitiesGetter();
        const view = this.gridView as EntityGridView2;

        // If the view hasn't built the tiles yet, force it
        if (view.tiles.length < max) {
            view.rebuildGrid();
        }

        for (let i = 0; i < max; i++) {
            if (!this.tileMap.has(i)) return i;
        }
        return -1;
    }


    public getRandomEmptyIndex(): number {
        const max = this.maxEntitiesGetter();
        const view = this.gridView as EntityGridView2;

        // Ensure the grid is built to match the max capacity
        if (view.tiles.length < max) {
            view.rebuildGrid();
        }

        const emptyIndices: number[] = [];

        // 1. Collect all indices that don't have an entity
        for (let i = 0; i < max; i++) {
            if (!this.tileMap.has(i)) {
                emptyIndices.push(i);
            }
        }

        // 2. If no slots are empty, return -1
        if (emptyIndices.length === 0) {
            return -1;
        }

        // 3. Pick a random index from the pool of empty slots
        const randomIndex = Math.floor(Math.random() * emptyIndices.length);
        return emptyIndices[randomIndex];
    }

    /**
     * Overridden to handle Slot-based positioning from saved data
     */
    public spawnAnimal(level: number, pos?: Point, existingData?: IEntityData): BlockMergeEntity {
        const animal = super.spawnAnimal(level, pos, existingData);
        animal.walkSpeed = 0; // Disable free roaming

        // Priority 1: Use slot from saved data
        // Priority 2: Calculate slot from position (for hatches/merges)
        // Priority 3: Find first empty slot
        let targetSlot = (existingData as any)?.slot;

        if (targetSlot === undefined && pos) {
            const view = this.gridView as EntityGridView2;
            const tile = view.getTileAt(pos);
            targetSlot = tile ? tile.data.index : -1;
        }

        if (targetSlot === undefined || targetSlot === -1) {
            targetSlot = this.getFirstEmptyIndex();
        }

        if (targetSlot !== -1) {
            this.assignToTile(animal, targetSlot);
        }

        return animal;
    }

    /**
     * Overridden to handle Slot-based positioning for Eggs
     */
    public spawnEgg(existingData?: IEntityData, merge?: Partial<IEntityData>, force: boolean = false): MergeEgg | null {
        const egg = super.spawnEgg(existingData, merge, force);
        if (!egg) return null;

        let targetSlot = (existingData as any)?.slot;

        if (targetSlot === undefined) {
            targetSlot = this.getRandomEmptyIndex();
        }

        if (targetSlot !== -1) {
            this.assignToTile(egg, targetSlot);
        }

        return egg;
    }

    public assignToTile(entity: any, tileIndex: number): void {
        const view = this.gridView as EntityGridView2;
        const tile = view.tiles[tileIndex];
        if (!tile) return;

        // Clean up old references
        this.tileMap.forEach((ent, idx) => {
            if (ent === entity) this.tileMap.delete(idx);
        });

        this.tileMap.set(tileIndex, entity);

        // IGNORE saved X/Y - force to Tile center
        entity.position.set(tile.x, tile.y);
        entity.zIndex = tile.y;

        const logic = this.getLogic(entity);
        if (logic) {
            logic.data.x = tile.x;
            logic.data.y = tile.y;
            (logic.data as any).slot = tileIndex; // Inject slot into save data
        }
    }

    public recycleEntity(view: any): void {
        this.tileMap.forEach((ent, idx) => {
            if (ent === view) this.tileMap.delete(idx);
        });
        super.recycleEntity(view);
    }

    public swap(idxA: number, idxB: number): void {
        const entA = this.tileMap.get(idxA);
        const entB = this.tileMap.get(idxB);
        if (entA) this.assignToTile(entA, idxB);
        if (entB) this.assignToTile(entB, idxA);
    }

    // --- Overrides for Hatch/Merge to maintain slot integrity ---

    public hatchEgg(egg: MergeEgg): BlockMergeEntity {
        let slot = -1;
        for (const [s, ent] of this.tileMap.entries()) {
            if (ent === egg) { slot = s; break; }
        }
        const spawned = super.hatchEgg(egg);
        if (slot !== -1) this.assignToTile(spawned, slot);
        return spawned;
    }

    public merge(source: BlockMergeEntity, target: BlockMergeEntity): any {
        let slot = -1;
        for (const [s, ent] of this.tileMap.entries()) {
            if (ent === target) { slot = s; break; }
        }
        const result = super.merge(source, target);
        if (slot !== -1 && result.mergeEntity) {
            this.assignToTile(result.mergeEntity, slot);
        }
        return result;
    }
}