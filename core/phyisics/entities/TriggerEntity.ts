import { CollisionLayer } from "../core/CollisionLayer";
import { PhysicsBodyFactory } from "../core/PhysicsBodyFactory";
import { BasePhysicsEntity } from "./BaseEntity";

export class TriggerEntity extends BasePhysicsEntity {

    public build(options: { w: number, h: number, layer: CollisionLayer }) {
        // 1. Create body via factory
        const desc = PhysicsBodyFactory.createRect(
            200, 200,
            options.w, options.h,
            { friction: 0.5, restitution: 0.6 }
        );

        // 2. Set the layer


        // 3. Initialize the base with this body
        this.setBodyDescription(desc);
        this.setCollisionCategory(
            options.layer
        );
        this.body.isSensor = true;
    }

    public fixedUpdate(delta: number) {
        // Add physics forces here if needed
    }

    public update(delta: number) {
        this.syncView();
    }

    public reset() {
        super.reset();
    }
}