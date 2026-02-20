import { Game } from "@core/Game";
import * as PIXI from "pixi.js";

export class EditorCameraService {
    private isDragging: boolean = false;
    private lastMousePos: PIXI.Point = new PIXI.Point();

    public zoom: number = 1;
    private minZoom: number = 0.1;
    private maxZoom: number = 5;
    private zoomSpeed: number = 0.1;

    constructor(private container: PIXI.Container) {
        this.initEvents();
        this.recenter();
    }

    private initEvents(): void {
        // We use the window or app stage to capture events globally
        window.addEventListener("mousedown", this.onMouseDown);
        window.addEventListener("mousemove", this.onMouseMove);
        window.addEventListener("mouseup", this.onMouseUp);
        window.addEventListener("wheel", this.onWheel, { passive: false });
    }

    private onMouseDown = (e: MouseEvent): void => {
        // Button 1 is the Middle Mouse Button (Scroll Click)
        if (e.button === 1) {
            this.isDragging = true;
            this.lastMousePos.set(e.clientX, e.clientY);
            // Prevent auto-scroll behavior in some browsers
            e.preventDefault();
        }
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.isDragging) return;

        const dx = e.clientX - this.lastMousePos.x;
        const dy = e.clientY - this.lastMousePos.y;

        // ADJUST FOR ZOOM: 
        // We divide the movement by the current scale so the map 
        // moves exactly with the mouse cursor.
        this.container.x += dx;
        this.container.y += dy;

        this.lastMousePos.set(e.clientX, e.clientY);
    };

    private onMouseUp = (e: MouseEvent): void => {
        if (e.button === 1) this.isDragging = false;
    };

    private onWheel = (e: WheelEvent): void => {
        e.preventDefault();

        const delta = e.deltaY > 0 ? -this.zoomSpeed : this.zoomSpeed;
        const oldZoom = this.zoom;

        this.zoom = Math.min(Math.max(this.zoom + delta, this.minZoom), this.maxZoom);

        // Apply scale to container
        this.container.scale.set(this.zoom);

        // OPTIONAL: Zoom towards mouse position
        // If you want simple center-zoom, just leave the scale.set
    };

    /**
     * Resets the camera to the center of the design resolution
     */
    public recenter(): void {
        this.zoom = 1;
        this.container.scale.set(1);
        this.container.position.set(
            Game.DESIGN_WIDTH / 2,
            Game.DESIGN_HEIGHT / 2
        );
        this.isDragging = false;
    }

    public update(): void {
        // Logic for smooth lerping could go here if you want "weighted" dragging
    }

    public destroy(): void {
        window.removeEventListener("mousedown", this.onMouseDown);
        window.removeEventListener("mousemove", this.onMouseMove);
        window.removeEventListener("mouseup", this.onMouseUp);
        window.removeEventListener("wheel", this.onWheel);
    }
}