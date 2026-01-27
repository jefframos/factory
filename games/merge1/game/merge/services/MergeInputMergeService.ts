// services/MergeInputMergeService.ts
import PlatformHandler from "@core/platforms/PlatformHandler";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { InGameProgress } from "../data/InGameProgress";
import { ProgressionStats } from "../data/ProgressionStats";
import { StaticData } from "../data/StaticData";
import { BaseMergeEntity } from "../entity/BaseMergeEntity";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { EntityGridView } from "../entity/EntityGridView";
import { MergeEgg } from "../entity/MergeEgg";
import { CoinManager } from "../manager/CoinManager";
import { EntityManager } from "../manager/EntityManager";
import { MissionManager } from "../missions/MissionManager";

export type MergeInputEntity = BlockMergeEntity | MergeEgg;

export interface MergeInputMergeServiceDeps {
    gridView: EntityGridView;
    entities: EntityManager;
    coins: CoinManager;

    // External policy hooks (mediator supplies these)
    isUiBlocked: () => boolean;

    // Tuning
    mergeRadiusPx?: number;
    eggHoverRadiusPx?: number;

    // If you want to disable instant grab coin later, keep it configurable
    instantCollectCoinOnGrab?: boolean;
}

export class MergeInputMergeService {
    public readonly onDirty: Signal = new Signal(); // dispatch() -> e.g. set ftueDirty
    public readonly onActiveChanged: Signal = new Signal(); // dispatch(active: MergeInputEntity | null)
    public readonly onMergePerformed: Signal = new Signal(); // dispatch(nextLevel: number)
    public readonly onEggHatchedByInput: Signal = new Signal(); // dispatch(level: number)

    private readonly mergeRadiusPx: number;
    private readonly eggHoverRadiusPx: number;
    private readonly instantCollectOnGrab: boolean;

    private activeEntity: MergeInputEntity | null = null;
    private currentHighlightedEntity: BlockMergeEntity | null = null;

    private dirtyCats: Map<MergeInputEntity, number> = new Map();

    public constructor(private readonly deps: MergeInputMergeServiceDeps) {
        this.mergeRadiusPx = deps.mergeRadiusPx ?? 90;
        this.eggHoverRadiusPx = deps.eggHoverRadiusPx ?? 60;
        this.instantCollectOnGrab = deps.instantCollectCoinOnGrab ?? true;
    }

    public get isDragging(): boolean {
        return this.activeEntity != null;
    }

    public get active(): MergeInputEntity | null {
        return this.activeEntity;
    }

    // -------------------------
    // Input handlers (wire from InputManager)
    // -------------------------

    public handleGrab(entity: any, _localPos: PIXI.Point): void {
        if (this.deps.isUiBlocked()) {
            return;
        }

        PlatformHandler.instance.platform.gameplayStart();

        // Hatch egg only when not currently dragging anything.
        if (!this.activeEntity && entity instanceof MergeEgg) {
            this.deps.gridView.setActive(null);
            const spawned = this.deps.entities.hatchEgg(entity);
            this.onEggHatchedByInput.dispatch(spawned.level);
            this.onDirty.dispatch();
            return;
        }

        this.activeEntity = entity as MergeInputEntity;
        this.onActiveChanged.dispatch(this.activeEntity);

        MissionManager.instance.reportCreatureTapped(1);

        if (this.activeEntity) {
            this.deps.gridView.addChild(this.activeEntity);
            (this.activeEntity as any)?.startGrab?.();

            // Bring to front
            this.deps.gridView.setActive(this.activeEntity);

            // Optional: instant pickup coin on grab (your current behavior)
            if (this.instantCollectOnGrab && this.activeEntity instanceof BlockMergeEntity) {
                const data = this.deps.entities.entitiesByView.get(this.activeEntity);
                if (data) {
                    const offset = (this.activeEntity as BaseMergeEntity)?.coinOffset ?? new PIXI.Point();
                    const config = StaticData.getAnimalData(data.data.level);

                    const coin = this.deps.coins.dropCoin(
                        (this.activeEntity as any).x + offset.x,
                        (this.activeEntity as any).y + offset.y,
                        data.data.level,
                        data.data.id,
                        false
                    );

                    // Auto-collect (does not decrement pendingCoins in your CoinManager)
                    this.deps.coins.collectCoin(coin, true);
                }
            }
        }

        this.updateMergeHighlight();
    }

    public handleDown(globalPos: PIXI.Point, autoCollectCoins: boolean): void {
        const localPos = this.deps.gridView.toLocal(globalPos);
        if (!autoCollectCoins) {
            this.deps.coins.checkCoinSwipe(localPos);
        }
    }

    public handleMove(globalPos: PIXI.Point, autoCollectCoins: boolean): void {
        const localPos = this.deps.gridView.toLocal(globalPos);

        if (this.activeEntity) {
            this.deps.entities.setEntityPosition(this.activeEntity as any, localPos.x, localPos.y);
            this.updateMergeHighlight();

            const merged = this.tryMergeOnRelease();
            if (merged) {
                this.deps.gridView.setActive(null);
                this.activeEntity = merged;
                this.onActiveChanged.dispatch(null);
                this.onDirty.dispatch();
                return;
            }
        }

        if (!autoCollectCoins) {
            this.deps.coins.checkCoinSwipe(localPos);
        }

        // Hover hatch only when NOT dragging
        if (!this.activeEntity) {
            this.checkEggHover(localPos);
        }
    }

    public handleRelease(_globalPos: PIXI.Point): void {
        if (!this.activeEntity) {
            return;
        }

        const merged = this.tryMergeOnRelease();
        if (merged) {
            this.deps.gridView.setActive(null);
            this.activeEntity = null;
            this.onActiveChanged.dispatch(null);
            this.onDirty.dispatch();
            return;
        }

        (this.activeEntity as any)?.stopGrab?.();

        this.clearHighlight();
        this.deps.gridView.setActive(null);
        this.activeEntity = null;
        this.onActiveChanged.dispatch(null);
    }

    public handleHover(_target: any | null): void {
        // Minimal: clear when not dragging
        if (!this.activeEntity) {
            this.clearHighlight();
        }


    }

    // -------------------------
    // Public API
    // -------------------------

    public updateMergeHighlight(): void {
        if (!(this.activeEntity instanceof BlockMergeEntity)) {
            this.clearHighlight();
            return;
        }

        const source = this.activeEntity;
        const target = this.findMergeTargetFor(source);

        if (this.currentHighlightedEntity && this.currentHighlightedEntity !== target) {
            this.currentHighlightedEntity.setHighlight(false);
            this.currentHighlightedEntity = null;
        }

        if (target && this.currentHighlightedEntity !== target) {
            target.setHighlight(true);
            this.currentHighlightedEntity = target;
        }
    }

    public clearState(): void {
        // Use during room switching if needed
        this.clearHighlight();
        this.activeEntity = null;
        this.onActiveChanged.dispatch(null);
        this.deps.gridView.setActive(null);
    }
    public update(delta: number) {
        for (const [entity, timeLeft] of this.dirtyCats) {
            // 1. Calculate the new time
            const updatedTime = timeLeft - delta;

            if (updatedTime <= 0) {
                // 2. Remove the entity if time is up
                this.dirtyCats.delete(entity);

                // Optional: Trigger any "cleanup" logic for the entity here
                // entity.cleanUp(); 
            } else {
                // 3. Update the map with the new value
                this.dirtyCats.set(entity, updatedTime);
            }
        }
    }

    private setEntityDirty(entity: BlockMergeEntity) {
        this.dirtyCats.set(entity, 0.25);
    }
    // -------------------------
    // Merge logic
    // -------------------------

    private tryMergeOnRelease(): BlockMergeEntity | undefined {
        if (!(this.activeEntity instanceof BlockMergeEntity)) {
            this.clearHighlight();
            return;
        }

        if (this.dirtyCats.get(this.activeEntity)) {
            return;
        }
        const source = this.activeEntity;
        const target = this.findMergeTargetFor(source);

        if (!target) {
            this.clearHighlight();
            return;
        }

        this.clearHighlight();

        const mergeData = this.deps.entities.merge(source, target);

        MissionManager.instance.reportMergeDone(1);
        ProgressionStats.instance.recordMerge(mergeData.nextLevel);
        InGameProgress.instance.addXP(mergeData.nextLevel);
        InGameProgress.instance.reportMergeLevel(mergeData.nextLevel);

        this.onMergePerformed.dispatch(mergeData.nextLevel);

        if (mergeData.mergeEntity) {
            this.setEntityDirty(mergeData.mergeEntity)
        }

        return mergeData.mergeEntity;
    }

    private findMergeTargetFor(source: BlockMergeEntity): BlockMergeEntity | null {
        let best: BlockMergeEntity | null = null;
        let bestD2 = Number.POSITIVE_INFINITY;

        const maxD2 = this.mergeRadiusPx * this.mergeRadiusPx;

        this.deps.entities.forEach((_logic, view) => {
            if (!(view instanceof BlockMergeEntity)) {
                return;
            }

            const target = view;

            if (target === source) {
                return;
            }

            if (target.level !== source.level) {
                return;
            }

            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const d2 = dx * dx + dy * dy;

            if (d2 > maxD2) {
                return;
            }

            if (d2 < bestD2) {
                bestD2 = d2;
                best = target;
            }
        });

        return best;
    }

    private clearHighlight(): void {
        if (this.currentHighlightedEntity) {
            this.currentHighlightedEntity.setHighlight(false);
            this.currentHighlightedEntity = null;
        }
    }

    // -------------------------
    // Egg hover hatch
    // -------------------------

    private checkEggHover(localPos: PIXI.Point): void {
        if (this.activeEntity) {
            return;
        }

        const r2 = this.eggHoverRadiusPx * this.eggHoverRadiusPx;
        const toHatch: MergeEgg[] = [];

        this.deps.entities.forEach((_logic, view) => {
            if (!(view instanceof MergeEgg)) {
                return;
            }

            const dx = view.x - localPos.x;
            const dy = view.y - localPos.y;

            if ((dx * dx + dy * dy) <= r2) {
                toHatch.push(view);
            }
        });

        for (let i = 0; i < toHatch.length; i++) {
            const spawned = this.deps.entities.hatchEgg(toHatch[i]);
            this.onEggHatchedByInput.dispatch(spawned.level);
            this.onDirty.dispatch();
        }
    }
}
