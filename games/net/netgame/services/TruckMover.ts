import { Body } from "matter-js";
import { TruckEntity, TruckPart } from "../truck/TruckEntity";

export class TruckMover {
    constructor(private truck: TruckEntity) { }

    /**
     * Helper to get a body from the truck parts map safely
     */
    private getPartBody(part: TruckPart): Body {
        const p = this.truck.getPart(part);
        if (!p) throw new Error(`Part ${part} not found in TruckEntity`);
        return p.body;
    }

    public moveForward(): void {
        const stats = this.truck.currentStats;
        const bw = this.getPartBody(TruckPart.BACK_WHEEL);
        const fw = this.getPartBody(TruckPart.FRONT_WHEEL);

        if (bw.angularVelocity < stats.speed) {
            bw.torque += stats.torque * bw.mass;
        }
        if (fw.angularVelocity < stats.speed) {
            fw.torque += stats.torque * fw.mass;
        }
    }

    public moveBackward(): void {
        const stats = this.truck.currentStats;
        const bw = this.getPartBody(TruckPart.BACK_WHEEL);
        const fw = this.getPartBody(TruckPart.FRONT_WHEEL);
        const targetSpeed = -stats.speed;

        if (bw.angularVelocity > targetSpeed) {
            bw.torque -= stats.torque * bw.mass;
        }
        if (fw.angularVelocity > targetSpeed) {
            fw.torque -= stats.torque * fw.mass;
        }
    }

    public applyDownforce(): void {
        if (!this.truck.isGrounded) return;

        const forceMagnitude = 0.05 * this.truck.body.mass;
        const angle = this.truck.body.angle;

        const forceVector = {
            x: Math.cos(angle + Math.PI / 2) * forceMagnitude,
            y: Math.sin(angle + Math.PI / 2) * forceMagnitude
        };

        Body.applyForce(this.truck.body, this.truck.body.position, forceVector);
    }

    public jump(): void {
        if (!this.truck.isGrounded) return;
        const jumpPower = -5;

        // Collect all relevant physics bodies using the Enum
        const bodiesToJump = [
            this.truck.body,
            this.getPartBody(TruckPart.BACK_WHEEL),
            this.getPartBody(TruckPart.FRONT_WHEEL)
        ];

        bodiesToJump.forEach(body => {
            Body.setVelocity(body, {
                x: body.velocity.x,
                y: jumpPower
            });
        });
    }

    public brake(): void {
        const bw = this.getPartBody(TruckPart.BACK_WHEEL);
        const fw = this.getPartBody(TruckPart.FRONT_WHEEL);

        Body.setAngularVelocity(bw, bw.angularVelocity * 0.8);
        Body.setAngularVelocity(fw, fw.angularVelocity * 0.8);
    }
}