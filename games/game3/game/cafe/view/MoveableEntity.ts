import * as PIXI from 'pixi.js';
import { CollisionSystem } from '../../../../../core/collision/CollisionSystem';
import EntityView from './EntityView';

export default class MoveableEntity extends PIXI.Container {
    public tag: string = "TEST"
    public speed = 0.0;
    public maxSpeed = 200;

    protected direction = new PIXI.Point(0, 0);
    protected magnitude = 0;

    protected viewContainer?: PIXI.Container;
    protected targetScale = new PIXI.Point(1, 1);
    protected flipLerpSpeed = 50;
    protected radius: number = 30;

    protected virtualPosition = new PIXI.Point(0, 0); // <-- new virtual position

    constructor(tag?: string) {
        super();
        this.virtualPosition.set(this.x, this.y);

        this.tag = tag ?? "";
    }

    setPosition(x: number, y: number) {
        this.x = x
        this.y = y
        this.virtualPosition.set(this.x, this.y);
    }

    setCharacter(container: PIXI.Container) {
        this.addChild(container);
        this.viewContainer = container;
        this.targetScale.copyFrom(container.scale);
        this.characterReady();
    }

    protected characterReady() {

    }

    public setInput(direction: PIXI.Point, magnitude: number) {
        this.direction.copyFrom(direction);
        this.magnitude = magnitude;

        if (this.viewContainer && Math.abs(direction.x) > 0.01) {
            this.targetScale.x = Math.sign(direction.x) >= 0 ? Math.abs(this.targetScale.x) : -Math.abs(this.targetScale.x);
        }
    }

    tryMove(dx: number, dy: number) {
        const testPos = new PIXI.Point();
        const radius = this.radius;

        // Check X
        testPos.set(this.virtualPosition.x + dx, this.virtualPosition.y);
        const collisionsX = CollisionSystem.checkCollisions(testPos, radius, this);

        const blockX = collisionsX.some(c => !c.collider.isTrigger);
        if (!blockX) {
            this.virtualPosition.x += dx;
        }

        // Check Y
        testPos.set(this.virtualPosition.x, this.virtualPosition.y + dy);
        const collisionsY = CollisionSystem.checkCollisions(testPos, radius, this);

        const blockY = collisionsY.some(c => !c.collider.isTrigger);
        if (!blockY) {
            this.virtualPosition.y += dy;
        }
    }


    applyVirtualPosition() {
        this.position.copyFrom(this.virtualPosition);
    }

    public update(delta: number) {
        this.speed = this.maxSpeed * this.magnitude;
        this.tryMove(this.direction.x * this.speed * delta, this.direction.y * this.speed * delta);
        this.applyVirtualPosition(); // Apply at end of update
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
}
