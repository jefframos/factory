// Entity.ts
//
// A minimal, Unity-flavored game object: a world Transform (a plain
// THREE.Group other code can parent into the scene) plus a bag of
// Components (rigidbody, visual, controller, ...). Components reach their
// own entity via `component.entity`, reach shared services (physics, ...)
// via `component.entity.world`, and reach sibling components via
// `entity.getComponent(SomeComponentClass)`.
//
// Entities are normally created via World.spawn() rather than `new
// Entity()` directly — that's what wires up `entity.world` and makes
// pooling (see core/Pool.ts) work: World.despawn() calls destroy() (which
// tears down every component and blanks the transform) and hands the now-
// empty shell back to the pool instead of letting it get garbage
// collected, so a type that spawns/despawns a lot (bullets, pickups, ...)
// doesn't churn allocations. `new Entity()` with zero args is what makes
// Pool.getElement(Entity) able to construct one when the pool is empty.
//
// awake() is the entity-level counterpart to Component.awake() — override
// it in a dedicated Entity subclass (see MainPlayer.ts) to self-configure:
// call this.addComponent(...) for everything that type needs, right there,
// instead of making whatever spawns it know the type's internals. World
// calls it once, right after wiring `entity.world`, for both spawn() and
// add() — a generic Entity's base implementation is a no-op, so nothing
// changes for callers (like PizzaScene's setupGround()/setupTestBox()) that
// still add components themselves after spawn() returns.

import * as THREE from 'three';
import Component from './Component';
import type World from './World';

type ComponentClass<T extends Component> = new (...args: never[]) => T;

export default class Entity {
    /** This entity's world transform — add to a THREE.Scene to make it render; every component's own visuals should parent onto this (see CharacterVisualComponent/BoxVisualComponent). */
    public readonly transform: THREE.Group = new THREE.Group();

    /** Set by World.spawn() — lets components reach shared services, e.g. RigidBody registering itself with `entity.world.physics`. Undefined for an entity built with a bare `new Entity()` outside a World (fine for standalone/test use — anything gated on `world` just no-ops). */
    public world?: World;

    private readonly components: Component[] = [];
    /** Components that have already had start() called — see runPendingStarts(). A Set (not a flag on Component) because components can be added at any time, not just before the entity's first tick. */
    private readonly startedComponents = new Set<Component>();

    /** Override in a subclass to self-configure — see this file's own doc. Base implementation is a no-op; called once by World right after spawn()/add(), before anything else runs on this entity. */
    public awake(): void {
        // Overridden by subclasses that need to self-configure — see MainPlayer.ts.
    }

    public addComponent<T extends Component>(component: T): T {
        component.entity = this;
        this.components.push(component);
        component.awake?.();
        return component;
    }

    /** Returns the first component that's an instance of `type`, e.g. `entity.getComponent(RigidBody)`. */
    public getComponent<T extends Component>(type: ComponentClass<T>): T | undefined {
        return this.components.find((component): component is T => component instanceof type);
    }

    public update(delta: number): void {
        this.runPendingStarts();
        for (const component of this.components) {
            if (component.enabled) {
                component.update?.(delta);
            }
        }
    }

    public fixedUpdate(delta: number): void {
        this.runPendingStarts();
        for (const component of this.components) {
            if (component.enabled) {
                component.fixedUpdate?.(delta);
            }
        }
    }

    /** Calls start() on any component that doesn't have it yet — every component present before the entity's first tick starts together then; a component added later (e.g. once an async asset load resolves) gets its start() on the very next tick, before its own first update()/fixedUpdate(). */
    private runPendingStarts(): void {
        for (const component of this.components) {
            if (!this.startedComponents.has(component)) {
                this.startedComponents.add(component);
                component.start?.();
            }
        }
    }

    /**
     * Tears every component down and blanks this entity back to a fresh
     * state — safe to either drop (GC) or hand to Pool.returnElement() for
     * reuse. Normally called via World.despawn(), not directly.
     */
    public destroy(): void {
        for (const component of this.components) {
            component.destroy?.();
        }
        this.components.length = 0;
        this.startedComponents.clear();

        this.transform.clear();
        this.transform.position.set(0, 0, 0);
        this.transform.rotation.set(0, 0, 0);
        this.transform.scale.set(1, 1, 1);
        this.transform.removeFromParent();

        this.world = undefined;
    }
}
