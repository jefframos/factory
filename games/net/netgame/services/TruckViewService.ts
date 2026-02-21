import * as PIXI from "pixi.js";
import { CarEntity, CarPart } from "../truck/CarEntity";

export class TruckViewService {
    private spriteMap: Map<CarPart, PIXI.Sprite> = new Map();

    constructor(
        private truck: CarEntity,
        private worldContainer: PIXI.Container
    ) { }

    /**
     * Assigns a specific texture to a truck part
     */
    public setPartAsset(part: CarPart, texture: PIXI.Texture, anchor = { x: 0.5, y: 0.5 }, size = { width: 0, height: 0 }): void {
        // Remove old sprite if it exists
        if (this.spriteMap.has(part)) {
            const old = this.spriteMap.get(part)!;
            this.worldContainer.removeChild(old);
        }

        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(anchor.x, anchor.y);

        if (size.width) {
            sprite.width = size.width;
        }

        if (size.height) {
            sprite.height = size.height;
        }

        this.worldContainer.addChild(sprite);
        this.spriteMap.set(part, sprite);
    }

    /**
     * Updates sprite positions and rotations based on the truck's physical transforms
     */
    public update(): void {
        this.spriteMap.forEach((sprite, partType) => {
            const part = this.truck.getPart(partType);

            if (part) {
                // We use the transform object we built earlier
                sprite.position.x = part.transform.position.x;
                sprite.position.y = part.transform.position.y;
                sprite.rotation = part.transform.rotation;
            }
        });
    }

    /**
     * Clean up sprites when the truck is destroyed
     */
    public destroy(): void {
        this.spriteMap.forEach(sprite => {
            if (sprite.parent) sprite.parent.removeChild(sprite);
            sprite.destroy();
        });
        this.spriteMap.clear();
    }
}