import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import { BoxEntity } from "@core/phyisics/entities/BoxEntity";
import { CircleEntity } from "@core/phyisics/entities/CircleEntity";
import { PolygonEntity } from "@core/phyisics/entities/PolygonEntity";
import Physics from "@core/phyisics/Physics";
import Pool from "@core/Pool";
import { Body } from "matter-js";
import { Signal } from "signals"; // Assuming you use a standard Signal library
import { LevelConfig, LevelSnapshot } from "../level/LevelTypes";
import { TruckEntity } from "../truck/TruckEntity";
import { EntitySceneService } from "./EntitySceneService";
import { ModifierService } from "./ModifierService";

export class LevelService {
    private spawnedEntities: Set<BasePhysicsEntity> = new Set();
    private currentLevelConfig: LevelConfig | null = null;

    // Signals
    public onLevelStarted: Signal = new Signal();
    public onLevelEnded: Signal = new Signal();

    // Timer State
    private elapsedTime: number = 0;
    private isRunning: boolean = false;

    constructor(
        private entitySceneService: EntitySceneService,
        private truck?: TruckEntity
    ) { }

    /**
     * Prepares the level: Spawns objects and teleports player.
     * The timer does NOT start here; it waits for the start_node sensor.
     */
    public buildLevel(config: LevelConfig): void {
        this.destroy();
        this.currentLevelConfig = config;
        this.resetTimer();

        config.objects.forEach(obj => {
            const entity = this.createEntity(obj);
            if (!entity) return;

            Body.setPosition(entity.body, { x: obj.x, y: obj.y });
            entity.isStatic = obj.isStatic ?? true;
            entity.body.label = obj.label || obj.type;

            if (obj.modifier) {
                ModifierService.register(entity, obj.modifier);
            }

            if (obj.label === 'start_node' || obj.label === 'finish_node') {
                this.setupLevelTriggers(entity, obj.label);
            }

            entity.syncView();
            this.entitySceneService.addEntity(entity);
            this.spawnedEntities.add(entity);
        });

        // Ensure player is in the correct starting position immediately
        this.preparePlayer();
    }

    private createEntity(obj: any): BasePhysicsEntity | null {
        const layer = obj.layer || CollisionLayer.DEFAULT;
        const debugColor = obj.debugColor || obj.color;

        switch (obj.type) {
            case 'box':
            case 'sensor':
                const box = Pool.instance.getElement(BoxEntity) as BoxEntity;
                box.build({ w: obj.width || 100, h: obj.height || 100, layer, debugColor });
                if (obj.type === 'sensor') box.body.isSensor = true;
                return box;

            case 'circle':
                const circle = Pool.instance.getElement(CircleEntity) as CircleEntity;
                circle.build({ radius: obj.radius || 30, layer, debugColor });
                return circle;

            case 'polygon':
                const poly = Pool.instance.getElement(PolygonEntity) as PolygonEntity;
                poly.build({ x: 0, y: 0, vertices: obj.vertices || [], layer, debugColor });
                return poly;

            default:
                console.warn(`LevelService: Unknown entity type "${obj.type}"`);
                return null;
        }
    }
    public getCurrentConfig(): LevelConfig | null {
        return this.currentLevelConfig;
    }
    /**
     * Positions the player and ensures physics are ready
     */
    private preparePlayer(): void {
        if (!this.currentLevelConfig) return;

        if (this.truck) {
            const spawn = this.currentLevelConfig.spawnPoint;
            this.truck.teleport(spawn.x, spawn.y);
            this.truck.reset(); // Zero out velocity and rotation
        }
    }

    private setupLevelTriggers(entity: BasePhysicsEntity, label: string): void {
        Physics.events.onStart(entity.body, () => {
            if (label === 'start_node' && !this.isRunning) {
                this.startLevel();
            } else if (label === 'finish_node' && this.isRunning) {
                this.endLevel();
            }
        });
    }

    private startLevel(): void {
        this.isRunning = true;
        this.elapsedTime = 0;

        // Dispatch Signal
        this.onLevelStarted.dispatch();
        console.log("Level Started!");
    }

    private endLevel(): void {
        this.isRunning = false;

        // Create the snapshot
        const snapshot: LevelSnapshot = {
            totalTime: this.elapsedTime,
            levelId: this.currentLevelConfig?.id || "unknown"
        };

        // Dispatch Signal with Snapshot
        this.onLevelEnded.dispatch(snapshot);
        console.log("Level Ended!", snapshot);
    }

    public update(delta: number): void {
        if (this.isRunning) {
            // Using delta in seconds (assuming 60fps)
            this.elapsedTime += delta;
        }
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