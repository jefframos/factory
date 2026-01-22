import Pool from "@core/Pool";
import * as PIXI from "pixi.js";
import { EggGenerator } from "./entity/EggGenerator";
import { EntityGridView } from "./entity/EntityGridView";
import { EntityState, MergeAnimal } from "./entity/MergeAnimal";
import { MergeEgg } from "./entity/MergeEgg";
import { GridBaker } from "./GridBaker";
import { InputManager } from "./input/InputManager";
import GameStorage from "./storage/GameStorage";
import MergeHUD from "./ui/MergeHUD";

export class MergeMediator {
    private gridView: EntityGridView;
    private input: InputManager;
    private generator: EggGenerator;
    private baker: GridBaker;

    private activeEntity: MergeAnimal | MergeEgg | null = null;
    private wasFull: boolean = false;
    // Configurable limits
    public maxEntities: number = 10;

    constructor(
        private container: PIXI.Container,
        private inputBounds: PIXI.Rectangle,
        private walkBounds: PIXI.Rectangle,
        private hud: MergeHUD
    ) {
        this.gridView = new EntityGridView();
        this.container.addChild(this.gridView);

        // Initialize Baker for spawn positions
        this.baker = new GridBaker(this.walkBounds, 120);

        console.log(this.baker)

        this.generator = new EggGenerator(() => this.spawnEgg());

        this.input = new InputManager(
            this.container,
            this.inputBounds,
            this.gridView,
            (ent) => this.handleGrab(ent),
            (pos) => this.handleMove(pos),
            (pos) => this.handleRelease(pos)
        );

        this.hud.onSpeedUpRequested = () => this.generator.activateSpeedUp(50);
    }

    /**
     * Upgrade the capacity of the farm
     */
    public upgradeMaxEntities(amount: number): void {
        this.maxEntities += amount;
        console.log(`Capacity upgraded to: ${this.maxEntities}`);
    }

    private handleGrab(entity: any): void {
        if (entity instanceof MergeEgg) {
            this.hatchEgg(entity);
            return;
        }
        this.activeEntity = entity;
        if (this.activeEntity instanceof MergeAnimal) {
            this.activeEntity.state = EntityState.GRABBED;
        }
        if (this.activeEntity) this.gridView.addChild(this.activeEntity);
    }

    private handleMove(globalPos: PIXI.Point): void {
        if (this.activeEntity) {
            const localPos = this.gridView.toLocal(globalPos);
            const clampedX = Math.max(this.walkBounds.left, Math.min(localPos.x, this.walkBounds.right));
            const clampedY = Math.max(this.walkBounds.top, Math.min(localPos.y, this.walkBounds.bottom));
            this.activeEntity.position.set(clampedX, clampedY);
        }
    }

    private handleRelease(globalPos: PIXI.Point): void {
        if (!this.activeEntity) return;
        const checkPos = this.gridView.toGlobal(this.activeEntity.position);
        const target = this.gridView.getEntityAt(checkPos, this.activeEntity);

        if (this.activeEntity instanceof MergeAnimal && target instanceof MergeAnimal && target.level === this.activeEntity.level) {
            this.merge(this.activeEntity, target);
        } else if (this.activeEntity instanceof MergeAnimal) {
            this.activeEntity.state = EntityState.IDLE;
        }
        this.activeEntity = null;
    }

    private merge(source: MergeAnimal, target: MergeAnimal): void {
        const nextLevel = source.level + 1;
        const spawnPos = new PIXI.Point(target.x, target.y);

        this.recycleEntity(source);
        this.recycleEntity(target);
        this.spawnAnimal(nextLevel, spawnPos);

        GameStorage.instance.addMoney(nextLevel * 5);
    }

    private hatchEgg(egg: MergeEgg): void {
        const pos = new PIXI.Point(egg.x, egg.y);
        this.recycleEntity(egg);
        this.spawnAnimal(1, pos);
    }

    public spawnAnimal(level: number, pos: PIXI.Point): void {
        const animal = Pool.instance.getElement(MergeAnimal);
        animal.init(level);
        animal.position.copyFrom(pos);
        this.gridView.addEntity(animal);
    }

    public spawnEgg(): void {
        // CHECK CAPACITY:
        // We count total children in gridView (Animals + Eggs)
        if (this.gridView.children.length >= this.maxEntities) {
            console.warn("Board full! Cannot spawn egg.");
            return;
        }

        const egg = Pool.instance.getElement(MergeEgg);
        egg.init();

        // Get non-overlapping point from baker
        const spawnPos = this.baker.getNextPoint();
        egg.position.copyFrom(spawnPos);

        this.gridView.addEntity(egg);
    }

    private recycleEntity(entity: any): void {
        this.gridView.removeEntity(entity);
        if (entity.reset) entity.reset();
        Pool.instance.returnElement(entity);
    }

    public update(delta: number): void {
        // 1. Update logic and AI
        this.gridView.update(delta, this.walkBounds);
        this.generator.update(delta);

        // 2. Population Check & HUD Notification
        const currentCount = this.gridView.children.length;
        const isCurrentlyFull = currentCount >= this.maxEntities;

        // Sync HUD
        this.hud.updateEntityCount(currentCount, this.maxEntities);
        this.hud.setGeneratorFullState(isCurrentlyFull);

        // 3. Y-Sorting
        this.gridView.children.sort((a, b) => {
            if (a === this.activeEntity) return 1;
            if (b === this.activeEntity) return -1;
            return a.y - b.y;
        });

        // 4. Update HUD Progress (Only if not full)
        // If full, we might want to stop the progress bar or keep it at 100%
        const displayRatio = isCurrentlyFull ? 1 : this.generator.ratio;
        this.hud.updateProgress(displayRatio);
        this.hud.updateCoins(GameStorage.instance.coins);
    }
}