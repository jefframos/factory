// InputManager.ts
import * as PIXI from "pixi.js";
import { EntityGridView } from "../entity/EntityGridView";
import MergeAssets from "../MergeAssets";

export class InputManager {
    private hitGraphic: PIXI.Graphics;

    private activeEntity: any = null;
    private currentHoverTarget: any = null;

    // Tune this (UI feel): how close the pointer must be to “consider” a target.
    private readonly hoverRadiusPx: number = 45;

    constructor(
        private container: PIXI.Container,
        private interactionRect: PIXI.Rectangle,
        private gridView: EntityGridView,
        private onGrab: (entity: any, pos: PIXI.Point) => void,
        private onMove: (pos: PIXI.Point) => void,
        private onRelease: (pos: PIXI.Point) => void,
        private onOver: (target: any | null) => void,
        private onDown: (pos: PIXI.Point) => void
    ) {
        this.hitGraphic = new PIXI.Graphics();
        this.container.addChild(this.hitGraphic);
        this.setup();
        this.updateArea(this.interactionRect);
    }

    public cancelDrag(): void {
        this.activeEntity = null;
        this.currentHoverTarget = null;
        this.onOver(null);
    }

    private setup(): void {
        this.hitGraphic.interactive = true;

        this.hitGraphic.on("pointerdown", (e: PIXI.FederatedPointerEvent) => {
            // You can keep getEntityAt for click selection (box is fine for selecting),
            // or switch to getEntityNear here too if you want.
            this.onDown(e.global);
            const target = this.gridView.getEntityAt(e.global);
            if (target) {
                this.activeEntity = target;
                this.onGrab(target, e.global);
                MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Grab)
            }
        });

        this.hitGraphic.on("pointermove", (e: PIXI.FederatedPointerEvent) => {
            this.onMove(e.global);

            if (this.activeEntity) {
                const foundTarget = this.gridView.getEntityNear(e.global, this.hoverRadiusPx, this.activeEntity);

                if (foundTarget !== this.currentHoverTarget) {
                    this.currentHoverTarget = foundTarget;
                    this.onOver(this.currentHoverTarget);
                }
            }
        });

        const endInteraction = (e: PIXI.FederatedPointerEvent) => {
            if (this.activeEntity) {
                this.activeEntity = null;
                this.currentHoverTarget = null;
                this.onOver(null);
                this.onRelease(e.global);
                MergeAssets.tryToPlaySound(MergeAssets.Sounds.Game.Drop)
            }
        };

        this.hitGraphic.on("pointerup", endInteraction);
        this.hitGraphic.on("pointerupoutside", endInteraction);
    }

    public updateArea(newRect: PIXI.Rectangle): void {
        this.interactionRect = newRect;
        this.hitGraphic.clear();

        this.hitGraphic.beginFill(0xFF0000, 0.001);
        this.hitGraphic.drawShape(this.interactionRect);
        this.hitGraphic.endFill();

        this.hitGraphic.hitArea = this.interactionRect;
    }
}
