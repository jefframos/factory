// World.ts
//
// Sits between a scene and its Entities. Owns the PhysicsWorld and the
// list of live entities; the scene's job shrinks to building/spawning
// entities once and forwarding its own two lifecycle calls here:
//
//   scene.update(delta)      -> world.update(delta)
//   scene.fixedUpdate(delta) -> world.fixedUpdate(delta)
//
// world.fixedUpdate() runs every entity's fixedUpdate() (so e.g.
// PlayerMovementController can turn input into RigidBody.velocity) and
// THEN steps physics — so velocity set this tick is what actually gets
// integrated this tick, not the previous one. That ordering lived as
// hand-written scene code before; now it's the World's job once, for every
// entity, instead of every scene re-deriving it.
//
// Two ways to get an entity into a World, for two different shapes of
// entity:
//   spawn()/despawn() — for a generic, POOLED Entity (see Entity.ts's own
//     doc for why) — the caller adds whatever components it needs after
//     spawn() returns, same as PizzaScene's setupGround()/setupTestBox().
//   add()/remove() — for a dedicated Entity SUBCLASS with its own
//     constructor (e.g. MainPlayer) that self-configures via its own
//     awake() override. Not pooled — Pool.getElement(Entity) can only ever
//     construct a bare Entity, and a purpose-built singleton like the
//     player has no real reuse case anyway (see PizzaScene).
// Both call entity.awake() exactly once, right after wiring `entity.world`.

import Pool from 'core/Pool';
import Entity from './Entity';
import PhysicsWorld from '../physics/PhysicsWorld';

export default class World {
    public readonly physics = new PhysicsWorld();

    private readonly entities: Entity[] = [];

    public spawn(): Entity {
        const entity = Pool.instance.getElement(Entity);
        return this.activate(entity);
    }

    /** Tears the entity's components down (detaching visuals, unregistering from physics, ...) and returns the now-blank shell to the pool for reuse — see Entity.destroy(). */
    public despawn(entity: Entity): void {
        this.deactivate(entity);
        entity.destroy();
        Pool.instance.returnElement(entity);
    }

    /** Adopts an already-constructed Entity subclass instance (see this class's own doc) — for anything with its own constructor args that isn't meant to be pooled. */
    public add<T extends Entity>(entity: T): T {
        return this.activate(entity);
    }

    /** Counterpart to add() — tears the entity's components down, same as despawn(), but does NOT return it to the pool (it was never drawn from one). */
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
