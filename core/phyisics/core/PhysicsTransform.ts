import { Body } from "matter-js";
import * as PIXI from "pixi.js";
import { BasePhysicsEntity } from "../entities/BaseEntity";

export class PhysicsTransform {
    // This handles both a raw Body (wheels) or an Entity containing a body
    constructor(protected provider: Body | { body: Body }, public view?: PIXI.Container) { }

    /**
     * Internal helper to resolve the body reference dynamically
     */
    private get target(): Body {
        return (this.provider as any).body || this.provider;
    }

    public get position() {
        const body = this.target;
        return {
            get x() { return body.position.x; },
            get y() { return body.position.y; },
            set x(val: number) { Body.setPosition(body, { x: val, y: body.position.y }); },
            set y(val: number) { Body.setPosition(body, { x: body.position.x, y: val }); }
        };
    }

    public get rotation(): number {
        return this.target.angle;
    }

    public set rotation(value: number) {
        Body.setAngle(this.target, value);
    }

    /**
     * Scales both the physics body and the view simultaneously
     */
    public setScale(x: number, y: number = x) {
        Body.scale(this.target, x, y);
        if (this.view) {
            this.view.scale.set(x, y);
        }
    }
}

/**
 * For the main Entity, we pass the entity itself as the provider
 */
export class EntityTransform extends PhysicsTransform {
    constructor(entity: BasePhysicsEntity) {
        super(entity, entity.view);
    }
}