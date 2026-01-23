import * as PIXI from "pixi.js";
import { MergeAnimal } from "./MergeAnimal";
import { MergeEgg } from "./MergeEgg";

export class EntityGridView extends PIXI.Container {
    private entities: (MergeAnimal | MergeEgg)[] = [];

    public addEntity(entity: any): void {
        this.entities.push(entity);
        this.addChild(entity);
    }

    public removeEntity(entity: any): void {
        const index = this.entities.indexOf(entity);
        if (index > -1) {
            this.entities.splice(index, 1);
            this.removeChild(entity);
        }
    }

    // Raycasting logic for the Input class
    public getEntityAt(globalPos: PIXI.Point, ignore?: any): any {
        const hits: any[] = [];

        // 1. Collect all valid candidates under the point
        for (let i = 0; i < this.entities.length; i++) {
            const ent = this.entities[i];

            // Skip ignored entity or invisible ones
            if (ent === ignore || !ent.visible) continue;

            // Check if the point is inside the entity bounds
            if (ent.getBounds().contains(globalPos.x, globalPos.y)) {
                hits.push(ent);
            }
        }

        if (hits.length === 0) return null;
        if (hits.length === 1) return hits[0];

        // 2. Sort candidates based on your priority rules
        hits.sort((a, b) => {
            const aIsEgg = a instanceof MergeEgg;
            const bIsEgg = b instanceof MergeEgg;

            // Rule 1: Priority for MergeEgg
            if (aIsEgg && !bIsEgg) return -1; // a comes first
            if (!aIsEgg && bIsEgg) return 1;  // b comes first

            // Rule 2: If both are same type (both eggs or both animals), 
            // get the one "lower" on the screen (highest Y value)
            return b.y - a.y;
        });

        return hits[0];
    }

    public update(delta: number, bounds: PIXI.Rectangle): void {
        this.entities.forEach(ent => ent.update(delta, bounds));
    }
}