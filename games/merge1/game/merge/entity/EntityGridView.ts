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
        const localPos = this.toLocal(globalPos);
        // Reverse loop to pick the one on top
        for (let i = this.entities.length - 1; i >= 0; i--) {
            const ent = this.entities[i];
            if (ent === ignore) continue;
            //console.log(ent)
            if (ent.getBounds().contains(globalPos.x, globalPos.y)) {
                return ent;
            }
        }
        return null;
    }

    public update(delta: number, bounds: PIXI.Rectangle): void {
        this.entities.forEach(ent => ent.update(delta, bounds));
    }
}