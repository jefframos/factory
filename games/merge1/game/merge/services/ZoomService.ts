import * as PIXI from "pixi.js";

export class ZoomService {
    private targetScale: number = 1;
    private currentScale: number = 1;
    private startScale: number = 1;

    private zoomTimer: number = 0;
    private zoomDuration: number = 0;
    private isZooming: boolean = false;

    constructor(private readonly container: PIXI.Container) {
        this.currentScale = container.scale.x;
        this.targetScale = this.currentScale;
    }

    /**
     * Smoothly transitions the zoom level
     * @param scale The target scale (e.g., 1.5 for 150%)
     * @param duration Seconds for the transition
     */
    public setZoom(scale: number, duration: number = 0.5): void {
        this.targetScale = scale;
        this.startScale = this.currentScale;
        this.zoomDuration = duration;
        this.zoomTimer = 0;

        if (duration <= 0) {
            this.applyScale(scale);
        } else {
            this.isZooming = true;
        }
    }

    private applyScale(s: number): void {
        this.currentScale = s;
        this.container.scale.set(s);
    }

    public update(dt: number): void {
        if (!this.isZooming) return;

        this.zoomTimer += dt;
        const progress = Math.min(this.zoomTimer / this.zoomDuration, 1);

        // Simple Ease-Out Quad formula: f(t) = t * (2 - t)
        const ease = progress * (2 - progress);

        const nextScale = this.startScale + (this.targetScale - this.startScale) * ease;
        this.applyScale(nextScale);

        if (progress >= 1) {
            this.isZooming = false;
        }
    }

    public get scale(): number {
        return this.currentScale;
    }
}