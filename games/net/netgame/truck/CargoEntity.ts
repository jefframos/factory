
import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { PhysicsBodyFactory } from "@core/phyisics/core/PhysicsBodyFactory";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";

export interface ICargoOptions {
    x: number;
    y: number;
    width: number;
    height: number;
    layer?: CollisionLayer;
}

export class CargoEntity extends BasePhysicsEntity {

    public build(options: ICargoOptions): void {
        // Use your Factory to create the description (Body + Debug Graphics)
        const desc = PhysicsBodyFactory.createRect(
            options.x,
            options.y,
            options.width,
            options.height,
            {
                friction: 0.5,
                restitution: 0.2,
                density: 0.001,
                label: "cargo_item" // Useful for identification
            }
        );

        this.setBodyDescription(desc);

        // Set the collision layer correctly
        const layer = options.layer ?? CollisionLayer.CARGO;
        this.setCollisionCategory(
            layer,
            CollisionLayer.DEFAULT | CollisionLayer.PLAYER | CollisionLayer.CARGO
        );
    }

    public update(delta: number): void {
        this.syncView();
    }

    public fixedUpdate(delta: number): void {
        // Optional: Add logic if cargo should do something every physics tick
    }
}