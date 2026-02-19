import { Game } from "@core/Game";
import * as PIXI from "pixi.js";

export class CameraService {
    private stage: PIXI.Container;
    private target: { x: number, y: number } | null = null;

    // The desired offset from the screen center (e.g., {x: 0, y: -100} to look "up")
    public offset = { x: 0, y: 0 };

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

    public follow(target: { x: number, y: number }) {
        this.target = target;
    }

    /**
     * Snap the camera to a world position, accounting for offset
     */
    public teleport(worldPos: { x: number, y: number }): void {
        const targetX = this.screenCenter.x - worldPos.x + this.offset.x;
        const targetY = this.screenCenter.y - worldPos.y + this.offset.y;

        this.stage.position.x = targetX;
        this.stage.position.y = targetY;
    }

    public update(): void {
        if (!this.target) return;

        // Formula: ScreenCenter - WorldPosition + Offset
        const targetX = this.screenCenter.x - this.target.x + this.offset.x;
        const targetY = this.screenCenter.y - this.target.y + this.offset.y;

        // Smoothly interpolate current position to target position
        this.stage.position.x += (targetX - this.stage.position.x) * this.lerpFactor;
        this.stage.position.y += (targetY - this.stage.position.y) * this.lerpFactor;
    }
}