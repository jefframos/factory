import * as PIXI from "pixi.js";
import { WorldMapView } from "./WorldMapView";

export class WorldMapDragHandler {
    private view: WorldMapView;
    private isDragging: boolean = false;
    private lastPointerPos: PIXI.Point = new PIXI.Point();

    constructor(view: WorldMapView) {
        this.view = view;
        this.view.interactive = true;
        // Ensure the hitArea covers the whole screen
        this.view.hitArea = new PIXI.Rectangle(-5000, -5000, 10000, 10000);

        this.view.on("pointerdown", this.onDragStart, this);
        this.view.on("globalpointermove", this.onDragMove, this); // Use global move for better tracking
        this.view.on("pointerup", this.onDragEnd, this);
        this.view.on("pointerupoutside", this.onDragEnd, this);
    }

    private onDragStart(e: PIXI.FederatedPointerEvent): void {
        this.isDragging = true;
        this.lastPointerPos.copyFrom(e.global);
        this.view.startDragging();
    }

    private onDragMove(e: PIXI.FederatedPointerEvent): void {
        if (!this.isDragging) return;

        // Calculate how many screen pixels we moved
        const screenDx = e.global.x - this.lastPointerPos.x;
        const screenDy = e.global.y - this.lastPointerPos.y;

        // COMPENSATE FOR SCALE:
        // We divide by the worldTransform scale. If the map is shrunk, 
        // we need to move the container MORE pixels to keep up with the finger.
        const worldScaleX = this.view.worldTransform.a;
        const worldScaleY = this.view.worldTransform.d;

        const localDx = screenDx / worldScaleX;
        const localDy = screenDy / worldScaleY;

        // Apply the compensated movement
        this.view.applyManualMove(localDx, localDy);

        this.lastPointerPos.copyFrom(e.global);
    }

    private onDragEnd(): void {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.view.stopDragging();
    }
}