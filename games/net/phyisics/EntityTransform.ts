import { Body } from "matter-js";
import { BaseEntity } from "./BaseEntity";

export class EntityTransform {
    constructor(private entity: BaseEntity) { }

    // Position
    public get position() {
        const body = this.entity.body;
        return {
            get x(): number { return body.position.x; },
            get y(): number { return body.position.y; },
            set x(val: number) { Body.setPosition(body, { x: val, y: body.position.y }); },
            set y(val: number) { Body.setPosition(body, { x: body.position.x, y: val }); }
        };
    }

    public setPosition(x: number, y: number) {
        Body.setPosition(this.entity.body, { x, y });
    }

    // Rotation (Radians)
    public get rotation(): number {
        return this.entity.body.angle;
    }

    public set rotation(value: number) {
        Body.setAngle(this.entity.body, value);
    }

    // Scale (Matter.js scales the actual collision body)
    public setScale(x: number, y: number = x) {
        Body.scale(this.entity.body, x, y);
        this.entity.view.scale.set(x, y);
    }
}