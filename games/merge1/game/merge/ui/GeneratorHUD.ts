import { gsap } from "gsap";
import * as PIXI from "pixi.js";

export default class GeneratorHUD extends PIXI.Container {
    private progressBar: PIXI.Graphics = new PIXI.Graphics();
    private progressBg: PIXI.Graphics = new PIXI.Graphics();
    private speedUpBtn: PIXI.Container = new PIXI.Container();
    private statusLabel: PIXI.Text;
    private btnLabel: PIXI.Text;
    private btnBg: PIXI.Graphics;

    private isFull: boolean = false;
    private readonly BAR_WIDTH = 200;
    private readonly BAR_HEIGHT = 15;

    public onSpeedUpRequested: () => void = () => { };

    constructor() {
        super();

        // 1. Background Bar
        this.progressBg.beginFill(0x000000, 0.5)
            .drawRoundedRect(0, 0, this.BAR_WIDTH, this.BAR_HEIGHT, 5);
        this.addChild(this.progressBg);
        this.addChild(this.progressBar);

        // 2. Status Label (Above the bar)
        this.statusLabel = new PIXI.Text("NEXT EGG", {
            fontSize: 12,
            fill: 0xffffff,
            fontWeight: 'bold'
        });
        this.statusLabel.anchor.set(0.5, 1);
        this.statusLabel.position.set(this.BAR_WIDTH / 2, -5);
        this.addChild(this.statusLabel);

        // 3. Speed up button
        this.btnBg = new PIXI.Graphics()
            .beginFill(0xffcc00)
            .drawRoundedRect(0, 0, 80, 30, 8);

        this.btnLabel = new PIXI.Text("SPEED", {
            fontSize: 14,
            fill: 0x000000,
            fontWeight: 'bold'
        });
        this.btnLabel.anchor.set(0.5);
        this.btnLabel.position.set(40, 15);

        this.speedUpBtn.addChild(this.btnBg, this.btnLabel);
        this.speedUpBtn.interactive = true;
        this.speedUpBtn.cursor = 'pointer';
        this.speedUpBtn.position.set(this.BAR_WIDTH + 10, -7);
        this.speedUpBtn.on("pointertap", () => this.onSpeedUpRequested());

        this.addChild(this.speedUpBtn);
    }

    public updateProgress(ratio: number): void {
        this.progressBar.clear();

        // Visual feedback: Red if stuck at 100%, Green if working
        const color = (this.isFull && ratio >= 0.99) ? 0xff4444 : 0x00ff00;

        this.progressBar.beginFill(color)
            .drawRoundedRect(0, 0, this.BAR_WIDTH * ratio, this.BAR_HEIGHT, 5);
    }

    public setFullState(isFull: boolean): void {
        if (this.isFull === isFull) return;
        this.isFull = isFull;

        if (isFull) {
            this.statusLabel.text = "BOARD FULL!";
            this.statusLabel.style.fill = 0xff4444;
            this.speedUpBtn.interactive = false;
            this.speedUpBtn.alpha = 0.5;

            // "Denied" shake effect
            gsap.to(this, { x: "+=3", duration: 0.05, repeat: 5, yoyo: true });
        } else {
            this.statusLabel.text = "NEXT EGG";
            this.statusLabel.style.fill = 0xffffff;
            this.speedUpBtn.interactive = true;
            this.speedUpBtn.alpha = 1;
        }
    }
}