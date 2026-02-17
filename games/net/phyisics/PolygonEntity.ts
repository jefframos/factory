import { Vector } from "matter-js";
import { BaseEntity } from "./BaseEntity";
import { CollisionLayer } from "./CollisionLayer";
import { PhysicsBodyFactory } from "./PhysicsBodyFactory";

export class PolygonEntity extends BaseEntity {

    /**
     * @param options { x, y, vertices, layer }
     * vertices should be an array of {x, y} points
     */
    public build(options: { x: number, y: number, vertices: Vector[], layer: CollisionLayer }) {
        const desc = PhysicsBodyFactory.createPolygon(
            options.x,
            options.y,
            options.vertices,
            {
                friction: 0.3,
                restitution: 0.2
            }
        );

        desc.body.collisionFilter.category = options.layer;

        this.setBodyDescription(desc);
    }

    public fixedUpdate(delta: number): void { }

    public update(delta: number): void {
        this.syncView();
    }
}