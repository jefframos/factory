// World.ts
//
// Sits between a scene and its Entities. Owns the PhysicsWorld and the
// list of live entities; the scene's job shrinks to building/spawning
// entities once and forwarding its own two lifecycle calls here:
//
//   scene.update(delta)      -> world.update(delta)
//   scene.fixedUpdate(delta) -> world.fixedUpdate(delta)
//
// world.fixedUpdate() runs every entity's fixedUpdate() (so e.g. a
// movement controller can turn input into RigidBody.velocity) and THEN
// steps physics — so velocity set this tick is what actually gets
// integrated this tick.

import Pool from 'core/Pool';
import Entity from './Entity';
import PhysicsWorld from 'core/physics/PhysicsWorld';
import type { WorldSettings } from 'core/physics/WorldSettings';

export default class World {
    public readonly physics: PhysicsWorld;

    private readonly entities: Entity[] = [];

    /** `physicsSettings` is forwarded to the owned PhysicsWorld — pass a game's own live-tunable settings object here to keep dev-GUI edits in sync with what physics actually reads. Defaults to PhysicsWorld's own defaults otherwise. */
    public constructor(physicsSettings?: WorldSettings) {
        this.physics = new PhysicsWorld(physicsSettings);
    }

    public spawn(): Entity {
        const entity = Pool.instance.getElement(Entity);
        return this.activate(entity);
    }

    public despawn(entity: Entity): void {
        this.deactivate(entity);
        entity.destroy();
        Pool.instance.returnElement(entity);
    }

    /** Adopts an already-constructed Entity subclass instance — for anything with its own constructor args that isn't meant to be pooled. */
    public add<T extends Entity>(entity: T): T {
        return this.activate(entity);
    }

    public remove(entity: Entity): void {
        this.deactivate(entity);
        entity.destroy();
    }

    public update(delta: number): void {
        for (const entity of this.entities) {
            entity.update(delta);
        }
    }

    public fixedUpdate(delta: number): void {
        for (const entity of this.entities) {
            entity.fixedUpdate(delta);
        }
        this.physics.step(delta);
    }

    private activate<T extends Entity>(entity: T): T {
        entity.world = this;
        this.entities.push(entity);
        entity.awake();
        return entity;
    }

    private deactivate(entity: Entity): void {
        const index = this.entities.indexOf(entity);
        if (index !== -1) {
            this.entities.splice(index, 1);
        }
    }
}
