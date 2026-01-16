import * as PIXI from 'pixi.js';

export class CameraComponent {
    public world: PIXI.Container;
    public target: PIXI.DisplayObject | null = null;

    public worldBounds = new PIXI.Rectangle(0, 0, 1000, 1000);
    public screenBounds = new PIXI.Rectangle(0, 0, 800, 600);

    public targetZoom = 1;
    private currentZoom = 1;

    private followPosition = new PIXI.Point();

    constructor(world: PIXI.Container) {
        this.world = world;
    }

    public update(delta: number) {
        if (!this.target) return;

        // Smooth zoom
        this.currentZoom += (this.targetZoom - this.currentZoom) * Math.min(delta * 10, 1);
        this.world.scale.set(this.currentZoom);

        // Smooth follow
        const lerp = (start: number, end: number, t: number) => start + (end - start) * t;
        const followSpeed = Math.min(delta * 5, 1); // Tune this multiplier to control snappiness

        this.followPosition.x = lerp(this.followPosition.x, this.target.x, followSpeed);
        this.followPosition.y = lerp(this.followPosition.y, this.target.y, followSpeed);

        const halfWidth = this.screenBounds.width / 2 / this.currentZoom;
        const halfHeight = this.screenBounds.height / 2 / this.currentZoom;

        let pivotX = this.followPosition.x;
        let pivotY = this.followPosition.y;

        // Clamp X
        if (this.screenBounds.width / this.currentZoom < this.worldBounds.width) {
            pivotX = Math.max(pivotX, halfWidth);
            pivotX = Math.min(pivotX, this.worldBounds.width - halfWidth);
        } else {
            pivotX = this.worldBounds.width / 2;
        }

        // Clamp Y
        if (this.screenBounds.height / this.currentZoom < this.worldBounds.height) {
            pivotY = Math.max(pivotY, halfHeight);
            pivotY = Math.min(pivotY, this.worldBounds.height - halfHeight);
        } else {
            pivotY = this.worldBounds.height / 2;
        }

        this.world.pivot.set(pivotX, pivotY);
    }

    public setWorldBounds(bounds: PIXI.Rectangle) {
        this.worldBounds.copyFrom(bounds);
    }

    public setScreenBounds(bounds: PIXI.Rectangle) {
        this.screenBounds.copyFrom(bounds);
        this.update(1);
    }
}
