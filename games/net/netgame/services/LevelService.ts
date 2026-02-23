import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import { BoxEntity } from "@core/phyisics/entities/BoxEntity";
import { CircleEntity } from "@core/phyisics/entities/CircleEntity";
import { PolygonEntity } from "@core/phyisics/entities/PolygonEntity";
import Physics from "@core/phyisics/Physics";
import Pool from "@core/Pool";
import { Body, Vector } from "matter-js";
import { Signal } from "signals";
import { LevelConfig, LevelSnapshot } from "../level/LevelTypes";
import { CarEntity } from "../truck/CarEntity";
import { EntitySceneService } from "./EntitySceneService";
import { ModifierService } from "./ModifierService";

export class LevelService {
    private spawnedEntities: Set<BasePhysicsEntity> = new Set();
    private currentLevelConfig: LevelConfig | null = null;

    // Checkpoint system
    private lastSafePoint: Vector = { x: 0, y: 0 };
    private hasDeadzone: boolean = false;

    // Signals
    public onLevelBuilt: Signal = new Signal();
    public onLevelStarted: Signal = new Signal();
    public onLevelEnded: Signal = new Signal();

    private elapsedTime: number = 0;
    private isRunning: boolean = false;

    constructor(
        private entitySceneService: EntitySceneService,
        private truck?: CarEntity
    ) { }

    public buildLevel(config: LevelConfig): void {
        this.destroy();
        this.currentLevelConfig = config;
        this.resetTimer();
        this.hasDeadzone = false;

        config.objects.forEach(obj => {
            const entity = this.createEntity(obj);
            if (!entity) return;

            Body.setPosition(entity.body, { x: obj.x, y: obj.y });
            entity.isStatic = obj.isStatic ?? true;
            entity.body.label = obj.label || obj.type;

            if (obj.modifier) {
                ModifierService.register(entity, obj.modifier);
            }

            // Handle specific node logic
            this.handleNodeLogic(entity, obj);

            entity.syncView();
            this.entitySceneService.addEntity(entity);
            this.spawnedEntities.add(entity);
        });

        // Fail-safe: Create a massive deadzone if none exists
        if (!this.hasDeadzone) {
            this.createGlobalDeadzone();
        }

        this.onLevelBuilt.dispatch(this.currentLevelConfig);

        // Immediate start logic
        this.preparePlayer();
        this.startLevel();
    }

    private handleNodeLogic(entity: BasePhysicsEntity, obj: any): void {
        const label = entity.body.label;

        if (label === 'start_node') {
            // Start node is just a coordinate reference and the first safe point
            this.lastSafePoint = { x: obj.x, y: obj.y };
            entity.body.isSensor = true; // Ensure it doesn't block the player
        }

        if (label === 'safe_point') {
            entity.body.isSensor = true;
            Physics.events.onStart(entity.body, () => {
                this.lastSafePoint = { x: obj.x, y: obj.y };
                console.log("Checkpoint reached:", this.lastSafePoint);
            });
        }

        if (label === 'deadzone') {
            this.hasDeadzone = true;
            Physics.events.onStart(entity.body, () => this.respawnPlayer());
        }

        if (label === 'finish_node') {
            Physics.events.onStart(entity.body, () => {
                if (this.isRunning) this.endLevel();
            });
        }
    }

    private createGlobalDeadzone(): void {
        console.warn("LevelService: No deadzone found. Creating global fallback deadzone.");
        const box = Pool.instance.getElement(BoxEntity) as BoxEntity;
        // Make it very wide and positioned very low
        box.build({ w: 50000, h: 200, layer: CollisionLayer.DEFAULT, debugColor: 0xff0000 });
        box.body.isSensor = true;
        box.body.label = 'deadzone';

        // Position it significantly below the "action"
        Body.setPosition(box.body, { x: -1000, y: 500 });

        Physics.events.onStart(box.body, () => this.respawnPlayer());

        this.entitySceneService.addEntity(box);
        this.spawnedEntities.add(box);
    }

    public respawnPlayer(): Vector {
        if (!this.truck) return this.lastSafePoint;
        console.log("respawnPlayer:", this.lastSafePoint);
        this.truck.teleport(this.lastSafePoint.x, this.lastSafePoint.y);
        this.truck.reset(); // Stop all movement/physics forces

        return this.lastSafePoint
    }

    private preparePlayer(): void {
        if (this.truck && this.lastSafePoint) {
            this.truck.teleport(this.lastSafePoint.x, this.lastSafePoint.y);
            this.truck.reset();
        }
    }

    public startLevel(): void {
        this.isRunning = true;
        this.elapsedTime = 0;
        this.onLevelStarted.dispatch(this.currentLevelConfig);
    }

    // ... createEntity, endLevel, update, destroy remain similar but use standard logic ...

    private createEntity(obj: any): BasePhysicsEntity | null {
        const layer = obj.layer || CollisionLayer.DEFAULT;
        const debugColor = obj.debugColor || obj.color;

        switch (obj.type) {
            case 'box':
            case 'sensor':
            case 'deadzone':
            case 'safe_point':
                const box = Pool.instance.getElement(BoxEntity) as BoxEntity;
                box.build({ w: obj.width || 100, h: obj.height || 100, layer, debugColor });
                if (obj.type !== 'box') box.body.isSensor = true;
                return box;
            case 'circle':
                const circle = Pool.instance.getElement(CircleEntity) as CircleEntity;
                circle.build({ radius: obj.radius || 30, layer, debugColor });
                return circle;
            case 'polygon':
                const poly = Pool.instance.getElement(PolygonEntity) as PolygonEntity;
                console.log(obj)
                poly.build({ x: obj.x, y: obj.y, vertices: obj.vertices || [], layer, debugColor });
                return poly;
            default:
                return null;
        }
    }

    private endLevel(): void {
        this.isRunning = false;
        const snapshot: LevelSnapshot = {
            totalTime: this.elapsedTime,
            levelId: this.currentLevelConfig?.id || "unknown"
        };
        this.onLevelEnded.dispatch(snapshot);
    }

    public update(delta: number): void {
        if (this.isRunning) this.elapsedTime += delta;
    }

    private resetTimer(): void {
        this.isRunning = false;
        this.elapsedTime = 0;
    }

    public destroy(): void {
        this.spawnedEntities.forEach(entity => {
            Physics.events.clear(entity.body);
            entity.destroy();
        });
        this.spawnedEntities.clear();
        this.resetTimer();
    }
}