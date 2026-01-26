import Pool from "@core/Pool";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { CoinGenerator } from "../core/CoinGenerator";
import { GridBaker } from "../core/GridBaker";
import { IEntityData } from "../data/MergeSaveTypes";
import { StaticData } from "../data/StaticData";
import { BlockMergeEntity } from "../entity/BlockMergeEntity";
import { EntityGridView } from "../entity/EntityGridView";
import { MergeEgg } from "../entity/MergeEgg";
import MergeAssets from "../MergeAssets";

export type EntityView = BlockMergeEntity | MergeEgg;

export interface IEntityLogic {
    data: IEntityData;
    generator: CoinGenerator | null;
}

export interface ImportEntitiesOptions {
    shufflePositions: boolean;
}

export class EntityManager {
    public readonly onEntitySpawned: Signal = new Signal();
    public readonly onEntityRemoved: Signal = new Signal();
    public readonly onEntityMoved: Signal = new Signal();
    public readonly onEggHatched: Signal = new Signal();
    public readonly onMerged: Signal = new Signal();
    public readonly onDirty: Signal = new Signal();

    public readonly entitiesByView: Map<PIXI.DisplayObject, IEntityLogic> = new Map();

    public constructor(
        private readonly gridView: EntityGridView,
        private readonly baker: GridBaker,
        private readonly walkBounds: PIXI.Rectangle,
        private readonly maxEntitiesGetter: () => number,
    ) { }

    public get size(): number {
        return this.entitiesByView.size;
    }

    public forEach(cb: (logic: IEntityLogic, view: PIXI.DisplayObject) => void): void {
        this.entitiesByView.forEach(cb);
    }

    public getLogic(view: PIXI.DisplayObject): IEntityLogic | undefined {
        return this.entitiesByView.get(view);
    }

    // -------------------------
    // Room support: export/import
    // -------------------------

    /**
     * Export all entities to save data.
     * Includes generator timer state (soft field: genTimer).
     */
    public exportEntities(): IEntityData[] {
        const list: IEntityData[] = [];
        this.entitiesByView.forEach((logic) => {
            const d: any = { ...logic.data };

            if (logic.generator) {
                // Persist generator progress so rooms can simulate offline / inactive catch-up accurately
                d.genTimer = (logic.generator as any).timer ?? 0;
            }

            list.push(d as IEntityData);
        });
        return list;
    }

    /**
     * Import entities from save data.
     * If shufflePositions is true, ignores saved x/y and assigns new baked positions.
     */
    public importEntities(list: IEntityData[], opts: ImportEntitiesOptions): void {
        // Clear current without spamming dirty/signals (room switching)
        this.clearAll({ silent: true });

        if (!list || list.length <= 0) {
            return;
        }

        for (let i = 0; i < list.length; i++) {
            const raw = list[i] as any;
            const data = { ...raw } as IEntityData;

            const pos = opts.shufflePositions
                ? this.baker.getNextPoint()
                : new PIXI.Point(data.x, data.y);

            data.x = pos.x;
            data.y = pos.y;

            if (data.type === "egg") {
                // spawnEgg(existingData) will not enforce max-cap and won't play sounds
                this.spawnEgg(data);
            } else {
                // animals
                this.spawnAnimal(data.level, pos, data);
            }
        }

        // Do one dirty dispatch at end (optional)
        this.onDirty.dispatch();
    }

    // -------------------------
    // Spawning
    // -------------------------

    public spawnAnimal(level: number, pos: PIXI.Point, existingData?: IEntityData): BlockMergeEntity {
        const animal = Pool.instance.getElement(BlockMergeEntity);

        const config = StaticData.getAnimalData(level);
        animal.init(level, config.spriteId, config.animationId);
        animal.position.copyFrom(pos);
        this.gridView.addEntity(animal);

        if (!existingData) {
            MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Yay);
        }

        const data: IEntityData = existingData ?? {
            id: Math.random().toString(36).substring(2, 9),
            type: "animal",
            level,
            x: pos.x,
            y: pos.y,
            lastCoinTimestamp: Date.now(),
            pendingCoins: 0
        };

        // Ensure saved data position matches the spawned pos
        data.x = pos.x;
        data.y = pos.y;

        const gen = new CoinGenerator(data.lastCoinTimestamp, config.spawnTimer);

        if (!existingData) {
            // New spawn -> quick first coin
            (gen as any).timer = 0.1;
        } else {
            // Restore generator progress if present
            const restoredTimer = (existingData as any).genTimer;
            if (typeof restoredTimer === "number" && isFinite(restoredTimer)) {
                (gen as any).timer = restoredTimer;
            }
        }

        this.entitiesByView.set(animal, { data, generator: gen });

        this.onEntitySpawned.dispatch(animal, data);
        this.onDirty.dispatch();

        return animal;
    }

    public spawnEgg(existingData?: IEntityData, merge?: Partial<IEntityData>): MergeEgg | null {
        if (!existingData && this.entitiesByView.size >= this.maxEntitiesGetter()) {
            return null;
        }

        if (!existingData) {
            MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Egg);
        }

        const egg = Pool.instance.getElement(MergeEgg);
        egg.init();

        const spawnPos = existingData
            ? new PIXI.Point(existingData.x, existingData.y)
            : this.baker.getNextPoint();

        egg.position.copyFrom(spawnPos);
        this.gridView.addEntity(egg);

        const data: IEntityData = existingData ?? {
            id: Math.random().toString(36).substring(2, 9),
            type: "egg",
            level: merge?.level ?? 1,
            x: spawnPos.x,
            y: spawnPos.y,
            lastCoinTimestamp: Date.now(),
            pendingCoins: 0
        };

        // Ensure saved data position matches the spawned pos
        data.x = spawnPos.x;
        data.y = spawnPos.y;

        this.entitiesByView.set(egg, { data, generator: null });

        this.onEntitySpawned.dispatch(egg, data);
        this.onDirty.dispatch();

        return egg;
    }

    // -------------------------
    // Movement / actions
    // -------------------------

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

    public hatchEgg(egg: MergeEgg): BlockMergeEntity {
        const logic = this.entitiesByView.get(egg);
        const level = logic?.data.level ?? 1;
        const pos = new PIXI.Point(egg.x, egg.y);

        const eggData = logic?.data;

        this.recycleEntity(egg);

        const spawned = this.spawnAnimal(level, pos);
        this.onEggHatched.dispatch(egg, spawned, level, eggData);
        this.onDirty.dispatch();

        return spawned;
    }

    public merge(source: BlockMergeEntity, target: BlockMergeEntity): { nextLevel: number; spawnPos: PIXI.Point; mergeEntity?: BlockMergeEntity } {
        const nextLevel = source.level + 1;
        const spawnPos = new PIXI.Point(target.x, target.y);

        const sourceData = this.entitiesByView.get(source)?.data;
        const targetData = this.entitiesByView.get(target)?.data;

        this.recycleEntity(source);
        this.recycleEntity(target);

        const mergeEntity = this.spawnAnimal(nextLevel, spawnPos);

        this.onMerged.dispatch(source, target, nextLevel, spawnPos, sourceData, targetData);
        this.onDirty.dispatch();

        return { nextLevel, spawnPos, mergeEntity };
    }

    // -------------------------
    // Recycle / clear
    // -------------------------

    public recycleEntity(view: EntityView): void {
        this.recycleEntityInternal(view, false);
    }

    public recycleEntitySilent(view: EntityView): void {
        this.recycleEntityInternal(view, true);
    }

    private recycleEntityInternal(view: EntityView, silent: boolean): void {
        const logic = this.entitiesByView.get(view);
        if (!logic) {
            return;
        }

        this.entitiesByView.delete(view);
        this.gridView.removeEntity(view);

        if ((view as any).reset) {
            (view as any).reset();
        }

        Pool.instance.returnElement(view);

        if (!silent) {
            this.onEntityRemoved.dispatch(view, logic.data);
            this.onDirty.dispatch();
        }
    }

    /**
     * Legacy API. Keeps behavior.
     */
    public serializeEntitiesForSave(): IEntityData[] {
        return this.exportEntities();
    }

    public clearAll(opts?: { silent?: boolean }): void {
        const silent = opts?.silent === true;

        const views: EntityView[] = [];
        this.entitiesByView.forEach((_logic, view) => {
            views.push(view as EntityView);
        });

        for (let i = 0; i < views.length; i++) {
            if (silent) {
                this.recycleEntitySilent(views[i]);
            } else {
                this.recycleEntity(views[i]);
            }
        }

        if (!silent) {
            this.onDirty.dispatch();
        }
    }

    public hasAnyAnimal(): boolean {
        let found = false;
        this.entitiesByView.forEach((logic) => {
            if (logic.data.type === "animal") {
                found = true;
            }
        });
        return found;
    }
}
