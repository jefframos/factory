import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { PhysicsBodyFactory } from "@core/phyisics/core/PhysicsBodyFactory";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import { Body, Vector } from "matter-js";

export class CollectibleEntity extends BasePhysicsEntity {
    public fixedUpdate(delta: number): void {
        //throw new Error("Method not implemented.");
    }
    public isCollected: boolean = false;
    private targetBody: Body | null = null;
    private flySpeed: number = 0.55; // Lerp speed
    public collectibleData!: any;

    public build(options: { x: number, y: number, data: any }) {
        this.collectibleData = options.data;

        // Create a circular sensor
        const desc = PhysicsBodyFactory.createCircle(options.x, options.y, 20, {
            isSensor: true,
            label: `collectible_${options.data.type}`
        });

        this.setBodyDescription(desc);
        this.setCollisionCategory(CollisionLayer.DEFAULT); // Or a specific COLLECTIBLE layer
    }

    public collect(picker: Body) {
        if (this.isCollected) return;
        this.isCollected = true;
        this.targetBody = picker;

        // Disable physics entirely so it doesn't trigger more collisions
        this.body.isSensor = true;
    }

    public update(delta: number): void {
        if (this.isCollected && this.targetBody && this.collectibleData.type === 'coin') {
            // Coin Flying Logic: Move towards the truck
            const targetPos = this.targetBody.position;
            const currentPos = this.body.position;

            const newX = currentPos.x + (targetPos.x - currentPos.x) * this.flySpeed;
            const newY = currentPos.y + (targetPos.y - currentPos.y) * this.flySpeed;

            Body.setPosition(this.body, { x: newX, y: newY });

            // Distance check to "finish" collection
            const dist = Vector.magnitude(Vector.sub(targetPos, currentPos));
            if (dist < 10) {
                this.view.visible = false;
                this.destroy(); // Return to pool or destroy
            }
        }
        this.syncView();
    }
}