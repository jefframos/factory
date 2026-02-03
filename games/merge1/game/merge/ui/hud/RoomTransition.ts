// RoomTransition.ts
import { Game } from "@core/Game";
import * as PIXI from "pixi.js";

export class RoomTransition extends PIXI.Container {
    private bg: PIXI.Graphics = new PIXI.Graphics();
    private pattern: PIXI.TilingSprite;

    private active: boolean = false;
    private isWaiting: boolean = false;
    private progress: number = 0;
    private resolveCallback: (() => void) | null = null;



    constructor(texture: PIXI.Texture) {
        super();
        this.addChild(this.bg);



        this.pattern = new PIXI.TilingSprite(PIXI.Texture.from('merge1/images/non-preload/jiggy-pattern.png'), 128, 128);
        this.pattern.alpha = 0.15;
        this.addChild(this.pattern);

        this.interactive = true;
        this.visible = false;
    }

    public start(): Promise<void> {
        const { width, height } = Game.gameScreenData;

        this.bg.clear().beginFill(0x26C6DA).drawRect(0, 0, width, height).endFill();
        this.pattern.width = width;
        this.pattern.height = height;

        this.progress = 0;
        this.x = -width; // Start off-screen left
        this.visible = true;
        this.active = true;
        this.isWaiting = false;

        return new Promise((resolve) => {
            this.resolveCallback = resolve;
        });
    }

    public exit(): void {
        // Resume the movement
        this.isWaiting = false;
        this.active = true;
    }

    public update(delta: number): void {
        if (!this.active || this.isWaiting) return;

        const { width } = Game.gameScreenData;
        const speed = delta * 2;
        this.progress += speed;

        // Internal pattern texture movement
        this.pattern.tilePosition.x += 30 * delta;
        this.pattern.tilePosition.y += 30 * delta;

        // TOTAL PATH: From -width to +width
        // 0.0 progress = -width
        // 0.5 progress = 0 (Covered)
        // 1.0 progress = +width (Gone)

        const totalRange = width * 2;
        this.x = -width + (totalRange * Math.min(this.progress, 1));

        // CHECK: Are we at the halfway point (Screen covered)?
        if (this.progress >= 0.5 && this.resolveCallback) {
            this.x = 0; // Snap to center
            this.isWaiting = true; // Stop moving
            this.resolveCallback(); // Tell HUD to change the room
            this.resolveCallback = null;
        }

        // CHECK: Have we finished the whole movement?
        if (this.progress >= 1) {
            this.active = false;
            this.visible = false;
            this.x = -width;
        }
    }
}