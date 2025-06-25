import * as PIXI from 'pixi.js';
import EntityView from '../../view/EntityView';
import MoveableEntity from '../../view/MoveableEntity';

export class CustomerEntity extends MoveableEntity {
    public id: number = -1;
    public state: 'queue' | 'waiting' | 'ready' = 'queue';

    public speed = 100; // pixels per second
    private targetPosition: PIXI.Point = new PIXI.Point();

    public get isAtTarget(): boolean {
        const dx = this.targetPosition.x - this.x;
        const dy = this.targetPosition.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= 0.5;
    }

    constructor() {
        super();

        // add some variety
        this.scale.set(0.9 + Math.random() * 0.2);
        this.position.x += (Math.random() - 0.5) * 10;
        this.speed *= (Math.random() * 0.01 + 0.99)
    }

    public positionTo(x: number, y: number): void {
        this.position.set(x, y);
    }


    public moveTo(x: number, y: number): void {
        this.targetPosition.set(x, y);
    }

    public update(delta: number): void {
        const dx = this.targetPosition.x - this.x;
        const dy = this.targetPosition.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let direction = new PIXI.Point(0, 0);
        if (dist > 0.5) {
            const vx = (dx / dist) * this.speed * delta;
            const vy = (dy / dist) * this.speed * delta;

            this.x += vx;
            this.y += vy;

            direction.set(dx / dist, dy / dist);
        } else {
            this.x = this.targetPosition.x;
            this.y = this.targetPosition.y;
        }

        this.setInput(direction, dist);

        this.zIndex = this.y;
        if (this.viewContainer) {
            this.viewContainer.scale.x += (this.targetScale.x - this.viewContainer.scale.x) * Math.min(this.flipLerpSpeed * delta, 1);
            this.viewContainer.scale.y = this.targetScale.y;

            if (this.viewContainer instanceof EntityView) {
                this.viewContainer.update(delta);
                const isIdle = this.magnitude < 0.01;
                this.viewContainer.setIdleState(isIdle);
            }
        }
    }

    public setWaiting(): void {
        this.state = 'waiting';
    }

    public setQueue(): void {
        this.state = 'queue';
    }

    public setReady(): void {
        this.state = 'ready';
    }
}
