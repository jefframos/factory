import * as PIXI from 'pixi.js';

export class HUDButton extends PIXI.Container {
    public isPressed: boolean = false;
    private bg: PIXI.Graphics;

    constructor(label: string, radius: number, color: number) {
        super();
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.alpha = 0.5;

        this.bg = new PIXI.Graphics()
            .beginFill(color)
            .drawCircle(0, 0, radius)
            .endFill();

        const text = new PIXI.Text(label, {
            fill: 0xffffff,
            fontSize: radius * 0.4,
            fontWeight: 'bold'
        });
        text.anchor.set(0.5);

        this.addChild(this.bg, text);

        this.on('pointerdown', () => this.handleState(true));
        this.on('pointerup', () => this.handleState(false));
        this.on('pointerupoutside', () => this.handleState(false));
    }

    private handleState(pressed: boolean): void {
        this.isPressed = pressed;
        this.alpha = pressed ? 1 : 0.5;
        this.scale.set(pressed ? 0.92 : 1.0);
    }
}