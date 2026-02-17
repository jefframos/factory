import Pool from '@core/Pool';
import { Body, Vector } from 'matter-js';
import { Container } from 'pixi.js';
import { EntityTransform } from './EntityTransform';
import Physics from './Physics';
import { BodyDescription } from './PhysicsBodyFactory';

export abstract class BaseEntity {
    public body!: Body;
    public view: Container = new Container();
    public transform: EntityTransform;

    constructor() {
        this.transform = new EntityTransform(this);
    }

    /** Velocity Getters/Setters */
    public get velocity(): Vector {
        return this.body.velocity;
    }

    public set velocity(v: Vector) {
        Body.setVelocity(this.body, v);
    }

    public get angularVelocity(): number {
        return this.body.angularVelocity;
    }

    public set angularVelocity(value: number) {
        Body.setAngularVelocity(this.body, value);
    }

    protected setBodyDescription(desc: BodyDescription): void {
        this.body = desc.body;
        this.view.addChild(desc.debugGraphic);
        Physics.addBody(this.body);
        this.syncView();
    }

    public abstract build(options?: any): void;
    public abstract update(delta: number): void;
    public abstract fixedUpdate(delta: number): void;

    public syncView(): void {
        if (!this.body) return;
        this.view.position.set(this.body.position.x, this.body.position.y);
        this.view.rotation = this.body.angle;
    }

    public reset() {
        if (this.body) {
            Body.setVelocity(this.body, { x: 0, y: 0 });
            Body.setAngularVelocity(this.body, 0);
            Body.setAngle(this.body, 0);
            this.body.force = { x: 0, y: 0 };
            this.body.torque = 0;
            this.view.scale.set(1, 1);
        }
    }
    public set isStatic(value: boolean) {
        Body.setStatic(this.body, value);
    }

    public get isStatic(): boolean {
        return this.body.isStatic;
    }
    public set bounciness(value: number) {
        this.body.restitution = value;
    }

    public get bounciness(): number {
        return this.body.restitution;
    }
    public set friction(value: number) {
        this.body.friction = value;
    }
    /**
     * Ensures all parts of a composite body share the same collision settings
     */
    public setCollisionCategory(category: number, mask: number = 0xFFFFFFFF): void {
        // We must apply to the parent AND all sub-parts
        const targets = this.body.parts || [this.body];

        targets.forEach(part => {
            part.collisionFilter.category = category;
            part.collisionFilter.mask = mask; // 0xFFFFFFFF means "hit everything"
        });
    }
    public destroy(): void {
        if (this.body) Physics.removeBody(this.body);
        this.reset();
        this.view.removeChildren();
        if (this.view.parent) this.view.parent.removeChild(this.view);
        Pool.instance.returnElement(this);
    }
}