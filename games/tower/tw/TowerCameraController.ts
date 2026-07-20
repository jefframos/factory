// TowerCameraController.ts

import * as PIXI from 'pixi.js';

/**
 * Scrolls `worldContainer` vertically so the physics world can keep
 * growing upward forever while the visible window stays put. Physics
 * (Matter.js) coordinates are never rewritten — only this offset changes.
 */
export class TowerCameraController {
    private currentOffsetY = 0;
    private targetOffsetY = 0;
    private panning = false;

    public constructor(
        private readonly worldContainer: PIXI.Container,
        private readonly panSpeed: number,
    ) { }

    public toWorldY(screenY: number): number {
        return screenY - this.currentOffsetY;
    }

    public panTo(targetOffsetY: number): void {
        this.targetOffsetY = targetOffsetY;
        this.panning = true;
    }

    public isPanning(): boolean {
        return this.panning;
    }

    public getOffsetY(): number {
        return this.currentOffsetY;
    }

    public update(delta: number): void {
        if (this.panning) {
            const diff = this.targetOffsetY - this.currentOffsetY;
            const step = this.panSpeed * delta;

            if (Math.abs(diff) <= step) {
                this.currentOffsetY = this.targetOffsetY;
                this.panning = false;
            } else {
                this.currentOffsetY += Math.sign(diff) * step;
            }
        }

        this.worldContainer.y = this.currentOffsetY;
    }

    public reset(): void {
        this.currentOffsetY = 0;
        this.targetOffsetY = 0;
        this.panning = false;
        this.worldContainer.y = 0;
    }
}
