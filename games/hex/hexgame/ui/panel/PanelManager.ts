import { Game } from "@core/Game";
import { gsap } from "gsap"; // Assuming GSAP for tweens
import * as PIXI from "pixi.js";

export class PanelManager extends PIXI.Container {
    private static _instance: PanelManager;
    private dimmer: PIXI.Graphics;
    private currentPanel: PIXI.Container | null = null;
    private panels: Map<string, PIXI.Container> = new Map();
    private isTweening: boolean = false;

    private constructor() {
        super();
        this.dimmer = new PIXI.Graphics();
        this.dimmer.beginFill(0x000000, 0.8);
        // Use a massive rectangle to ensure coverage
        this.dimmer.drawRect(-5000, -5000, 10000, 10000);
        this.dimmer.alpha = 0;
        this.dimmer.interactive = false;
        this.addChild(this.dimmer);
        this.visible = false;
    }

    public static get instance(): PanelManager {
        if (!this._instance) this._instance = new PanelManager();
        return this._instance;
    }

    public openPanel(id: string, panelClass: new () => PIXI.Container): void {
        if (this.isTweening) return;

        if (!this.panels.has(id)) {
            this.panels.set(id, new panelClass());
        }

        this.currentPanel = this.panels.get(id)!;
        this.addChild(this.currentPanel);

        this.visible = true;
        this.dimmer.interactive = true;
        this.isTweening = true;

        gsap.to(this.dimmer, { alpha: 1, duration: 0.3 });

        this.currentPanel.x = Game.DESIGN_WIDTH / 2;
        this.currentPanel.y = -Game.DESIGN_HEIGHT; // Start completely off-screen

        gsap.to(this.currentPanel, {
            y: Game.DESIGN_HEIGHT / 2,
            duration: 0.5,
            ease: "back.out(1.2)",
            onComplete: () => { this.isTweening = false; }
        });
    }

    public closePanel(): void {
        if (!this.currentPanel || this.isTweening) return;
        this.isTweening = true;

        gsap.to(this.currentPanel, {
            y: Game.DESIGN_HEIGHT * 1.5,
            duration: 0.4,
            ease: "back.in(1.2)",
            onComplete: () => {
                if (this.currentPanel) this.removeChild(this.currentPanel);
                this.currentPanel = null;
                this.visible = false;
                this.dimmer.interactive = false;
                this.isTweening = false;
            }
        });

        gsap.to(this.dimmer, { alpha: 0, duration: 0.3 });
    }
}