// Entity.ts
//
// A minimal, Unity-flavored game object: a world Transform (a plain
// THREE.Group other code can parent into the scene) plus a bag of
// Components (rigidbody, visual, controller, ...). Components reach their
// own entity via `component.entity`, reach shared services (physics, ...)
// via `component.entity.world`, and reach sibling components via
// `entity.getComponent(SomeComponentClass)`.
//
// awake() is the entity-level counterpart to Component.awake() — override
// it in a dedicated Entity subclass to self-configure: call
// this.addComponent(...) for everything that type needs, right there.

import * as THREE from 'three';
import Component from './Component';
import type World from './World';

type ComponentClass<T extends Component> = new (...args: never[]) => T;

export default class Entity {
    /** This entity's world transform — add to a THREE.Scene to make it render. */
    public readonly transform: THREE.Group = new THREE.Group();

    /** Set by World.spawn()/add() — lets components reach shared services, e.g. RigidBody registering itself with `entity.world.physics`. */
    public world?: World;

    private readonly components: Component[] = [];
    /** Components that have already had start() called — see runPendingStarts(). */
    private readonly startedComponents = new Set<Component>();

    /** Override in a subclass to self-configure — see this file's own doc. */
    public awake(): void {
        // Overridden by subclasses that need to self-configure.
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

    private runPendingStarts(): void {
        for (const component of this.components) {
            if (!this.startedComponents.has(component)) {
                this.startedComponents.add(component);
                component.start?.();
            }
        }
    }

    /** Tears every component down and blanks this entity back to a fresh state. */
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
