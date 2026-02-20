import { Vector } from "matter-js";
import { CollisionLayer } from "../core/CollisionLayer";
import { PhysicsBodyFactory } from "../core/PhysicsBodyFactory";
import { BasePhysicsEntity } from "./BaseEntity";

export class PolygonEntity extends BasePhysicsEntity {

    /**
     * @param options { x, y, vertices, layer }
     * vertices should be an array of {x, y} points
     */
    public build(options: { x: number, y: number, vertices: Vector[], layer: CollisionLayer, debugColor?: number }) {
        const desc = PhysicsBodyFactory.createPolygon(
            options.x,
            options.y,
            options.vertices,
            {
                friction: 0.3,
                restitution: 0.2
            },
            options.debugColor
        );

        desc.body.collisionFilter.category = options.layer;

        this.setBodyDescription(desc);
    }

    public fixedUpdate(delta: number): void { }

    public update(delta: number): void {
        this.syncView();
    }
}