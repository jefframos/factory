import * as PIXI from 'pixi.js';
import EntityView from './EntityView'; // adjust the path to your EntityView class

export default class MoveableEntity extends PIXI.Container {
    public speed = 0.0;       // Multiplier, usually 0–1
    public maxSpeed = 200;    // Pixels per second

    private direction = new PIXI.Point(0, 0);
    private magnitude = 0;

    private viewContainer?: PIXI.Container;
    private targetScale = new PIXI.Point(1, 1);
    private flipLerpSpeed = 10;

    constructor() {
        super();
    }

    setCharacter(container: PIXI.Container) {
        this.addChild(container);
        this.viewContainer = container;
        this.targetScale.copyFrom(container.scale);
    }

    public setInput(direction: PIXI.Point, magnitude: number) {
        this.direction.copyFrom(direction);
        this.magnitude = magnitude;

        if (this.viewContainer && Math.abs(direction.x) > 0.01) {
            this.targetScale.x = Math.sign(direction.x) >= 0 ? Math.abs(this.targetScale.x) : -Math.abs(this.targetScale.x);
        }
    }

    public update(delta: number) {
        this.speed = this.maxSpeed * this.magnitude;
        this.x += this.direction.x * this.speed * delta;
        this.y += this.direction.y * this.speed * delta;
        this.zIndex = this.y
        if (this.viewContainer) {
            // Flip handling
            this.viewContainer.scale.x += (this.targetScale.x - this.viewContainer.scale.x) * Math.min(this.flipLerpSpeed * delta, 1);
            this.viewContainer.scale.y = this.targetScale.y;

            // Idle state check
            if (this.viewContainer instanceof EntityView) {
                this.viewContainer.update(delta)
                const isIdle = this.magnitude < 0.01;
                this.viewContainer.setIdleState(isIdle);
            }
        }
    }
}
