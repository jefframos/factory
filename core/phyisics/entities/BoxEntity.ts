import { CollisionLayer } from "../core/CollisionLayer";
import { PhysicsBodyFactory } from "../core/PhysicsBodyFactory";
import { BasePhysicsEntity } from "./BaseEntity";

export class BoxEntity extends BasePhysicsEntity {

    public build(options: { w: number, h: number, layer: CollisionLayer, debugColor?: number }) {
        // 1. Create body via factory
        const desc = PhysicsBodyFactory.createRect(
            0, 0,
            options.w, options.h,
            { friction: 0.5, restitution: 0.6 },
            options.debugColor
        );

        this.setBodyDescription(desc);
        this.setCollisionCategory(
            options.layer
        );
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