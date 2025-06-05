import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import Collider from './Collider';
import { ColliderDebugHelper } from './ColliderDebugHelper';
import { CollisionSystem } from './CollisionSystem';

export class TriggerBox extends PIXI.Container {
    public readonly id: string;
    public readonly trigger: Collider;
    public readonly debugGraphics: PIXI.Graphics;

    public onCollided: Signal = new Signal();

    constructor(id: string, size: number = 100, triggerRadius: number = 20, color: number = 0x66ccff) {
        super();
        this.id = id;

        // Draw debug square (background)
        this.debugGraphics = new PIXI.Graphics();
        this.debugGraphics.beginFill(color, 0.2);
        this.debugGraphics.drawRect(0, 0, size, size);
        this.debugGraphics.endFill();
        this.addChild(this.debugGraphics);

        // Create circular trigger at (0,0)
        this.trigger = new Collider({
            shape: 'circle',
            radius: triggerRadius,
            trigger: true,
            id: this.id,
            position: new PIXI.Point(0, 0),
            onCollide: (other: PIXI.Container | undefined) => {
                this.onCollided?.dispatch(this, other);
            }
        });

        // Register the trigger in the collision system
        CollisionSystem.addCollider(this.trigger);
    }

    setPosition(x: number, y: number) {
        this.x = x;
        this.y = y;

        this.trigger.setPosition(x, y)
        ColliderDebugHelper.addDebugGraphics(this.trigger, this.parent)
    }

    public destroy(options?: PIXI.IDestroyOptions | boolean): void {
        CollisionSystem.removeCollider(this.trigger);
        super.destroy(options);
    }
}
