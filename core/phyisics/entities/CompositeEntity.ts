import { Bodies } from "matter-js";
import { CollisionLayer } from "../core/CollisionLayer";
import { PhysicsBodyFactory } from "../core/PhysicsBodyFactory";
import { BasePhysicsEntity } from "./BaseEntity";

export class CompositeEntity extends BasePhysicsEntity {

    public build(options: { x: number, y: number, layer: CollisionLayer }) {
        // 1. Define individual parts (positions are relative to the final composite center)
        const head = Bodies.circle(0, -30, 20);
        const bodyPart = Bodies.rectangle(0, 10, 40, 60);
        const leftArm = Bodies.rectangle(-30, 0, 20, 10);
        const rightArm = Bodies.rectangle(30, 0, 20, 10);

        // 2. Use the factory to merge them
        const desc = PhysicsBodyFactory.createComposite(
            options.x,
            options.y,
            [head, bodyPart, leftArm, rightArm],
            { friction: 0.4 }
        );

        desc.body.collisionFilter.category = options.layer;

        this.setBodyDescription(desc);
    }

    public fixedUpdate(delta: number): void { }
    public update(delta: number): void {
        this.syncView();
    }
}