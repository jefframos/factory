import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import * as PIXI from 'pixi.js';

export class EntitySceneService {
    private entities: Set<BasePhysicsEntity> = new Set();
    private worldContainer: PIXI.Container;

    constructor(worldContainer: PIXI.Container) {
        this.worldContainer = worldContainer;
    }

    public addEntity<T extends BasePhysicsEntity>(entity: T): T {
        this.entities.add(entity);
        // Applying the debug alpha as per your original code
        entity.view.alpha = 0.2;
        this.worldContainer.addChild(entity.view);
        return entity;
    }

    public removeEntity(entity: BasePhysicsEntity): void {
        if (this.entities.has(entity)) {
            this.worldContainer.removeChild(entity.view);
            this.entities.delete(entity);
        }
    }

    public update(delta: number): void {
        for (const entity of this.entities) {
            entity.update(delta);
            entity.syncView();
        }
    }

    public fixedUpdate(delta: number): void {
        for (const entity of this.entities) {
            entity.fixedUpdate(delta);
        }
    }

    public destroy(): void {
        this.entities.forEach(e => e.destroy());
        this.entities.clear();
    }
}