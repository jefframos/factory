import * as PIXI from "pixi.js";

export class CameraService {
    private stage: PIXI.Container;
    private target: { x: number, y: number } | null = null;

    // How fast the camera catches up (0.1 = slow/smooth, 1.0 = instant)
    public lerpFactor: number = 0.1;

    private screenCenter = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
    };

    constructor(stage: PIXI.Container) {
        this.stage = stage;

        // Update screen center if window resizes
        window.addEventListener('resize', () => {
            this.screenCenter.x = window.innerWidth / 2;
            this.screenCenter.y = window.innerHeight / 2;
        });
    }

    public follow(target: { x: number, y: number }) {
        this.target = target;
    }

    public update(): void {
        if (!this.target) return;

        // Calculate where the stage needs to be to center the target
        const targetX = this.screenCenter.x - this.target.x;
        const targetY = this.screenCenter.y - this.target.y;

        // Smoothly interpolate current position to target position
        // Equation: Current + (Target - Current) * Factor
        this.stage.position.x += (targetX - this.stage.position.x) * this.lerpFactor;
        this.stage.position.y += (targetY - this.stage.position.y) * this.lerpFactor;
    }
}