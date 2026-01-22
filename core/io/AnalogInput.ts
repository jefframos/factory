import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

export default class AnalogInput {
    public onMove: Signal<{ direction: PIXI.Point; magnitude: number }> = new Signal();

    private container: PIXI.Container;
    private bg: PIXI.DisplayObject;
    private knob: PIXI.DisplayObject;
    private radius: number;
    private center = new PIXI.Point();
    private active = false;

    constructor(
        container: PIXI.Container,
        options?: {
            radius?: number;
            backgroundTexture?: PIXI.Texture;
            knobTexture?: PIXI.Texture;
        }
    ) {
        this.container = container;
        this.radius = options?.radius ?? 50;

        // Background
        if (options?.backgroundTexture) {
            const sprite = new PIXI.Sprite(options.backgroundTexture);
            sprite.anchor.set(0.5);
            sprite.visible = false;
            sprite.width = sprite.height = this.radius * 2;
            this.bg = sprite;
        } else {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0x000000, 0.3);
            graphics.drawCircle(0, 0, this.radius);
            graphics.endFill();
            graphics.visible = false;
            this.bg = graphics;
        }
        this.container.addChild(this.bg);

        // Knob
        if (options?.knobTexture) {
            const sprite = new PIXI.Sprite(options.knobTexture);
            sprite.anchor.set(0.5);
            sprite.visible = false;
            sprite.width = sprite.height = this.radius * 0.8;
            this.knob = sprite;
        } else {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0xffffff, 0.6);
            graphics.drawCircle(0, 0, 20);
            graphics.endFill();
            graphics.visible = false;
            this.knob = graphics;
        }
        this.container.addChild(this.knob);

        this.container.eventMode = 'static';
        this.container.on('pointerdown', this.onPointerDown);
        this.container.on('pointerup', this.onPointerUp);
        this.container.on('pointerupoutside', this.onPointerUp);
        this.container.on('pointermove', this.onPointerMove);
    }

    private onPointerDown = (e: PIXI.FederatedPointerEvent) => {
        const globalPos = new PIXI.Point(e.global.x, e.global.y);
        const local = this.container.toLocal(globalPos);

        this.active = true;
        this.center.copyFrom(local);
        this.bg.position.copyFrom(this.center);
        this.knob.position.copyFrom(this.center);
        this.bg.visible = true;
        this.knob.visible = true;
    };

    private onPointerMove = (e: PIXI.FederatedPointerEvent) => {
        if (!this.active) return;

        const globalPos = new PIXI.Point(e.global.x, e.global.y);
        const local = this.container.toLocal(globalPos);

        const dx = local.x - this.center.x;
        const dy = local.y - this.center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        const clampedDist = Math.min(this.radius, dist);
        const norm = clampedDist / this.radius;
        const direction = new PIXI.Point(Math.cos(angle), Math.sin(angle));

        this.knob.position.set(
            this.center.x + direction.x * clampedDist,
            this.center.y + direction.y * clampedDist
        );

        this.onMove.dispatch({ direction, magnitude: norm });
    };

    private onPointerUp = () => {
        this.active = false;
        this.bg.visible = false;
        this.knob.visible = false;
        this.onMove.dispatch({ direction: new PIXI.Point(0, 0), magnitude: 0 });
    };

    public destroy() {
        this.container.off('pointerdown', this.onPointerDown);
        this.container.off('pointerup', this.onPointerUp);
        this.container.off('pointerupoutside', this.onPointerUp);
        this.container.off('pointermove', this.onPointerMove);
        this.bg.destroy();
        this.knob.destroy();
    }
}
