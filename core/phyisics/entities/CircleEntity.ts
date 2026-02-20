import { CollisionLayer } from "../core/CollisionLayer";
import { PhysicsBodyFactory } from "../core/PhysicsBodyFactory";
import { BasePhysicsEntity } from "./BaseEntity";

export class CircleEntity extends BasePhysicsEntity {

    /**
     * @param options { x, y, radius, layer }
     */
    public build(options: { x?: number, y?: number, radius: number, layer: CollisionLayer, debugColor?: number }) {
        // Create the body and debug view via factory
        const desc = PhysicsBodyFactory.createCircle(
            options.x ?? 0,
            options.y ?? 0,
            options.radius,
            {
                restitution: 0.8, // Bouncy by default
                friction: 0.1
            },
            options.debugColor
        );

        desc.body.collisionFilter.category = options.layer;

        // Initialize BaseEntity with these physics properties
        this.setBodyDescription(desc);
    }

    public fixedUpdate(delta: number): void {
        // Custom logic like applying constant force or checking bounds
    }

    public update(delta: number): void {
        this.syncView();
    }
}