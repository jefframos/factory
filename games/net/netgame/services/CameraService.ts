import { Game } from "@core/Game";
import * as PIXI from "pixi.js";

export class CameraService {
    private stage: PIXI.Container;
    private target: { x: number, y: number } | null = null;

    // How fast the camera catches up (0.1 = slow/smooth, 1.0 = instant)
    public lerpFactor: number = 0.1;

    private screenCenter = {
        x: Game.DESIGN_WIDTH / 2,
        y: Game.DESIGN_HEIGHT / 2
    };

    constructor(stage: PIXI.Container) {
        this.stage = stage;

        window.addEventListener('resize', () => {
            this.screenCenter.x = Game.DESIGN_WIDTH / 2;
            this.screenCenter.y = Game.DESIGN_HEIGHT / 2;
        });
    }

    /**
     * Sets the object for the camera to follow
     */
    public follow(target: { x: number, y: number }) {
        this.target = target;
    }

    /**
     * Instantly snaps the camera to a specific world position
     * @param worldPos The coordinates in the game world to center on
     */
    public teleport(worldPos: { x: number, y: number }): void {
        // We calculate the required stage position to center this world point
        const targetX = this.screenCenter.x - worldPos.x;
        const targetY = this.screenCenter.y - worldPos.y;

        // Apply immediately without lerping
        this.stage.position.x = targetX;
        this.stage.position.y = targetY;
    }

    public update(): void {
        if (!this.target) return;

        // Calculate where the stage needs to be to center the target
        const targetX = this.screenCenter.x - this.target.x;
        const targetY = this.screenCenter.y - this.target.y;

        // Smoothly interpolate current position to target position
        // Equation: $Current + (Target - Current) * Factor$
        this.stage.position.x += (targetX - this.stage.position.x) * this.lerpFactor;
        this.stage.position.y += (targetY - this.stage.position.y) * this.lerpFactor;
    }
}