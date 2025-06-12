
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import Collider from '../../../../../core/collision/Collider';
import { ColliderDebugHelper } from '../../../../../core/collision/ColliderDebugHelper';
import { CollisionSystem } from '../../../../../core/collision/CollisionSystem';
import { Fonts } from '../../character/Types';

export class TriggerBox extends PIXI.Container {

    public readonly id: string;
    public readonly trigger: Collider;
    public readonly debugGraphics: PIXI.Graphics;

    public onCollide: Signal = new Signal();
    public onCollideEnter: Signal = new Signal();
    public onCollideExit: Signal = new Signal();

    private label: PIXI.BitmapText;

    public enable() {
        this.trigger.enabled = true;
        this.visible = true;
    }
    public disable() {
        this.trigger.enabled = false;
        this.visible = false;
    }
    constructor(id: string, size: number = 100, triggerRadius: number = 20, color: number = 0x66ccff) {
        super();
        this.id = id;

        this.label = new PIXI.BitmapText('0', {
            fontName: Fonts.MainFamily,
            fontSize: Fonts.Main.fontSize as number,
            align: 'center',
            letterSpacing: 2
        });

        this.label.anchor.set(0.5, 0.5);

        this.addChild(this.label);

        // Draw debug square (background)
        this.debugGraphics = new PIXI.Graphics();
        this.debugGraphics.beginFill(color, 0.2);
        this.debugGraphics.drawRect(0, 0, size, size);
        this.debugGraphics.endFill();
        //this.addChild(this.debugGraphics);

        // Create circular trigger at (0,0)
        this.trigger = new Collider({
            shape: 'circle',
            radius: triggerRadius,
            trigger: true,
            id: this.id,
            position: new PIXI.Point(0, 0),
            onCollide: (other: PIXI.Container | undefined) => {
                this.onCollide?.dispatch(this, other);
            },
            onCollideEnter: (other: PIXI.Container | undefined) => {
                this.onCollideEnter?.dispatch(this, other);
            },
            onCollideExit: (other: PIXI.Container | undefined) => {
                this.onCollideExit?.dispatch(this, other);
            }
        });

        // Register the trigger in the collision system
        CollisionSystem.addCollider(this.trigger);
    }

    updateAmount(currentAmount: number, upgradeThreshold: number) {
        this.label.text = `${currentAmount} / ${upgradeThreshold}`;
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
