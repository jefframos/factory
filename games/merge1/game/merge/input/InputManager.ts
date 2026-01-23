import * as PIXI from "pixi.js";
import { EntityGridView } from "../entity/EntityGridView";

export class InputManager {
    private hitGraphic: PIXI.Graphics;

    // Logic state to prevent flickering
    private activeEntity: any = null;
    private currentHoverTarget: any = null;

    constructor(
        private container: PIXI.Container,
        private interactionRect: PIXI.Rectangle,
        private gridView: EntityGridView,
        private onGrab: (entity: any) => void,
        private onMove: (pos: PIXI.Point) => void,
        private onRelease: (pos: PIXI.Point) => void,
        private onOver: (target: any | null) => void // Highlight callback
    ) {
        this.hitGraphic = new PIXI.Graphics();
        this.container.addChild(this.hitGraphic);
        this.setup();
        this.updateArea(this.interactionRect);
    }

    private setup(): void {
        this.hitGraphic.interactive = true;

        this.hitGraphic.on("pointerdown", (e: PIXI.FederatedPointerEvent) => {
            const target = this.gridView.getEntityAt(e.global);
            if (target) {
                this.activeEntity = target;
                this.onGrab(target);
            }
        });

        this.hitGraphic.on("pointermove", (e: PIXI.FederatedPointerEvent) => {
            // 1. Always trigger the move logic for the dragged item
            this.onMove(e.global);

            // 2. Only check for hover if we are actually dragging something
            if (this.activeEntity) {
                // We pass this.activeEntity to the grid so it knows to skip the item in our hand
                const foundTarget = this.gridView.getEntityAt(e.global, this.activeEntity);

                // 3. STATE CHECK: Only trigger callback if the target is DIFFERENT
                // This prevents the flickering caused by repeated calls to the same object
                if (foundTarget !== this.currentHoverTarget) {
                    this.currentHoverTarget = foundTarget;
                    this.onOver(this.currentHoverTarget);
                }
            }
        });

        // Handle both standard release and releasing outside the window
        const endInteraction = (e: PIXI.FederatedPointerEvent) => {
            if (this.activeEntity) {
                this.activeEntity = null;
                this.currentHoverTarget = null;
                this.onOver(null); // Clear highlights on release
                this.onRelease(e.global);
            }
        };

        this.hitGraphic.on("pointerup", endInteraction);
        this.hitGraphic.on("pointerupoutside", endInteraction);
    }

    /**
     * Updates the interactive zone. 
     * Use this if the screen resizes or the game area changes.
     */
    public updateArea(newRect: PIXI.Rectangle): void {
        this.interactionRect = newRect;
        this.hitGraphic.clear();

        // Use a tiny alpha so it's invisible to players but detectable by PIXI
        this.hitGraphic.beginFill(0xFF0000, 0.001);
        this.hitGraphic.drawShape(this.interactionRect);
        this.hitGraphic.endFill();

        // Ensure the hitArea matches the geometry for optimization
        this.hitGraphic.hitArea = this.interactionRect;
    }
}