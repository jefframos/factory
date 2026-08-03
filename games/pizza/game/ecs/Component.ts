// Component.ts
//
// Base class for anything attached to an Entity (rigidbody, visual,
// controller, ...). A component reaches its own entity via `this.entity`,
// and other components on that same entity via `this.entity.getComponent()`
// — see Entity.ts. Lifecycle hooks, all optional, called by Entity/World in
// this order:
//
//   awake()        — once, the instant addComponent() attaches this to an
//                     entity, regardless of `enabled`. Siblings may not
//                     exist yet — self-contained setup only (build a mesh,
//                     register with a shared service via entity.world, ...).
//   start()        — once, right before this entity's first update()/
//                     fixedUpdate() tick, regardless of `enabled`. Every
//                     component this entity will have by then already
//                     exists, so this is the safe place to call
//                     entity.getComponent(Sibling).
//   onEnable()      \  fire when `enabled` flips, via the `enabled` setter
//   onDisable()     /  below — NOT called by awake()/start() themselves.
//   fixedUpdate()  — every fixed physics tick (World.fixedUpdate), only
//                     while enabled — anything touching
//                     RigidBody.velocity/position belongs here.
//   update()       — every render frame (World.update), only while enabled
//                     — animation, camera-relevant reads, cosmetic sync.
//   destroy()      — teardown: detach meshes, unregister from services.
//                     Must leave the component safe to garbage-collect (or,
//                     for the owning Entity, safe to pool/reuse).
//
// `enabled` lets a component be switched off without removing it — e.g.
// `entity.getComponent(PlayerMovementController).enabled = false` to freeze
// the player's movement while leaving the component (and its already-
// gathered input state) in place, ready to re-enable later.
import type Entity from './Entity';

export default abstract class Component {
    public entity!: Entity;

    private _enabled = true;

    public get enabled(): boolean {
        return this._enabled;
    }

    public set enabled(value: boolean) {
        if (value === this._enabled) {
            return;
        }
        this._enabled = value;
        if (value) {
            this.onEnable?.();
        } else {
            this.onDisable?.();
        }
    }

    public awake?(): void;
    public start?(): void;
    public onEnable?(): void;
    public onDisable?(): void;
    public update?(delta: number): void;
    public fixedUpdate?(delta: number): void;
    public destroy?(): void;
}
