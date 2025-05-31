import * as PIXI from 'pixi.js';

export class CameraComponent {
    public world: PIXI.Container;
    public target: PIXI.DisplayObject | null = null;

    public worldBounds = new PIXI.Rectangle(0, 0, 1000, 1000);
    public screenBounds = new PIXI.Rectangle(0, 0, 800, 600);

    public targetZoom = 1;
    private currentZoom = 1;

    constructor(world: PIXI.Container) {
        this.world = world;
    }

    public update(delta: number) {
        if (!this.target) return;

        // Smooth zoom
        this.currentZoom += (this.targetZoom - this.currentZoom) * Math.min(delta * 10, 1);
        this.world.scale.set(this.currentZoom);

        const halfWidth = this.screenBounds.width / 2 / this.currentZoom;
        const halfHeight = this.screenBounds.height / 2 / this.currentZoom;

        let camX = -this.target.x + halfWidth;
        let camY = -this.target.y + halfHeight;

        // Clamp camera within world bounds
        camX = Math.min(camX, 0);
        camY = Math.min(camY, 0);
        camX = Math.max(camX, -this.worldBounds.width + this.screenBounds.width / this.currentZoom);
        camY = Math.max(camY, -this.worldBounds.height + this.screenBounds.height / this.currentZoom);

        this.world.position.set(camX + this.screenBounds.x, camY + this.screenBounds.y);
    }

    public setWorldBounds(bounds: PIXI.Rectangle) {
        this.worldBounds.copyFrom(bounds);
    }

    public setScreenBounds(bounds: PIXI.Rectangle) {
        this.screenBounds.copyFrom(bounds);
    }
}
