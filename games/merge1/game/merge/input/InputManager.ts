import * as PIXI from "pixi.js";
import { EntityGridView } from "../entity/EntityGridView";

export class InputManager {
    private hitGraphic: PIXI.Graphics;

    constructor(
        private container: PIXI.Container, // Pass the container here
        private interactionRect: PIXI.Rectangle,
        private gridView: EntityGridView,
        private onGrab: (entity: any) => void,
        private onMove: (pos: PIXI.Point) => void,
        private onRelease: (pos: PIXI.Point) => void
    ) {
        this.hitGraphic = new PIXI.Graphics();
        this.container.addChild(this.hitGraphic); // Must be added to scene
        this.setup();
        this.updateArea(this.interactionRect);
    }

    private setup(): void {
        this.hitGraphic.interactive = true;
        // Optimization: Use a hitArea so PIXI doesn't have to check the geometry
        this.hitGraphic.on("pointerdown", (e) => {
            console.log(e.global)
            const target = this.gridView.getEntityAt(e.global);
            if (target) this.onGrab(target);
        });

        this.hitGraphic.on("pointermove", (e) => this.onMove(e.global));
        this.hitGraphic.on("pointerup", (e) => this.onRelease(e.global));
        this.hitGraphic.on("pointerupoutside", (e) => this.onRelease(e.global));
    }

    /**
     * Call this whenever your scene bounds change
     */
    public updateArea(newRect: PIXI.Rectangle): void {
        this.interactionRect = newRect;
        this.hitGraphic.clear();
        // Draw the shape to define the interactive hit zone
        // Using alpha 0 so it is invisible but still clickable
        this.hitGraphic.beginFill(0xFF0000, 0.15);
        this.hitGraphic.drawShape(this.interactionRect);
        this.hitGraphic.endFill();
    }
}