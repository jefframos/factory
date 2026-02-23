import { Game } from '@core/Game';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { HUDButton } from "./HUDButton";
import { LayoutUpdater } from "./LayoutUpdater";

export class GameplayHUD extends PIXI.Container {
    public onAccelerate = new Signal();
    public onReverse = new Signal();
    public onJump = new Signal();
    public onRespawn = new Signal();
    // New signals for air rotation
    public onRotateLeft = new Signal();
    public onRotateRight = new Signal();

    private btnGo!: HUDButton;
    private btnRev!: HUDButton;
    private btnJump!: HUDButton;
    private btnRespawn!: HUDButton;
    // New buttons
    private btnRotLeft!: HUDButton;
    private btnRotRight!: HUDButton;

    private layout: LayoutUpdater = new LayoutUpdater();

    constructor() {
        super();
        this.init();
    }

    private init(): void {
        // 1. Instantiate Buttons
        this.btnGo = new HUDButton("GO", 60, 0x44FF44);
        this.btnRev = new HUDButton("REV", 40, 0xFF4444);
        this.btnJump = new HUDButton("JUMP", 50, 0xFFD700);
        this.btnRespawn = new HUDButton("RESET", 40, 0x666666);

        // Rotation buttons (Bottom Left)
        this.btnRotLeft = new HUDButton("↺", 50, 0x00AAFF);
        this.btnRotRight = new HUDButton("↻", 50, 0x00AAFF);

        // 2. Define Anchors
        const bottomRight = { x: 1, y: 1 };
        const bottomLeft = { x: 0, y: 1 };
        const middleRight = { x: 1, y: 0.5 };

        // 3. Register with LayoutUpdater
        // Drive Cluster (Bottom Right)
        this.layout.register(this.btnGo, bottomRight, { x: -110, y: -190 });
        this.layout.register(this.btnRev, bottomRight, { x: -230, y: -90 });
        this.layout.register(this.btnJump, bottomRight, { x: -250, y: -210 });

        // Rotation Cluster (Bottom Left)
        this.layout.register(this.btnRotLeft, bottomLeft, { x: 100, y: -100 });
        this.layout.register(this.btnRotRight, bottomLeft, { x: 220, y: -100 });

        // Utility (Middle Right)
        this.layout.register(this.btnRespawn, middleRight, { x: -100, y: 0 });

        // 4. Setup Event Triggers (Single pulse)
        this.btnJump.on('pointerdown', () => this.onJump.dispatch());
        this.btnRespawn.on('pointerdown', () => this.onRespawn.dispatch());

        this.addChild(
            this.btnGo, this.btnRev, this.btnJump,
            this.btnRespawn, this.btnRotLeft, this.btnRotRight
        );
    }

    public update(): void {
        this.x = Game.overlayScreenData.topLeft.x;
        this.y = Game.overlayScreenData.topLeft.y;
        this.layout.update();

        // 5. Dispatch continuous input signals (Holding state)
        if (this.btnGo.isPressed) this.onAccelerate.dispatch();
        if (this.btnRev.isPressed) this.onReverse.dispatch();

        // Air Rotation Holding
        if (this.btnRotLeft.isPressed) this.onRotateLeft.dispatch();
        if (this.btnRotRight.isPressed) this.onRotateRight.dispatch();
    }
}