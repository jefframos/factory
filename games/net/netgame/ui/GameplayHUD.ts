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

    private btnGo!: HUDButton;
    private btnRev!: HUDButton;
    private btnJump!: HUDButton;
    private btnRespawn!: HUDButton;

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

        // 2. Register with LayoutUpdater (Ergonomic Cluster)
        const bottomRight = { x: 1, y: 1 };
        const bottomLeft = { x: 0, y: 1 };

        this.layout.register(this.btnGo, bottomRight, { x: -110, y: -190 });
        this.layout.register(this.btnRev, bottomRight, { x: -230, y: -90 });
        this.layout.register(this.btnJump, bottomRight, { x: -250, y: -210 });
        this.layout.register(this.btnRespawn, bottomLeft, { x: 100, y: -100 });

        // 3. Setup Triggers
        this.btnJump.on('pointerdown', () => this.onJump.dispatch());
        this.btnRespawn.on('pointerdown', () => this.onRespawn.dispatch());

        this.addChild(this.btnGo, this.btnRev, this.btnJump, this.btnRespawn);
    }

    public update(): void {
        // Sync layout if resolution changed

        this.x = Game.overlayScreenData.topLeft.x
        this.y = Game.overlayScreenData.topLeft.y
        this.layout.update();

        // Dispatch continuous input signals
        if (this.btnGo.isPressed) this.onAccelerate.dispatch();
        if (this.btnRev.isPressed) this.onReverse.dispatch();
    }
}