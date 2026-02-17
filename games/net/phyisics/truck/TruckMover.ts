import { Body } from "matter-js";
import { TruckEntity } from "./TruckEntity";

export class TruckMover {
    private isGrounded: boolean = true; // Placeholder for future ground detection

    constructor(private truck: TruckEntity) { }

    public moveForward(): void {
        const stats = this.truck.currentStats;
        const bw = this.truck.backWheelBody;
        const fw = this.truck.frontWheelBody;

        if (bw.angularVelocity < stats.speed) {
            bw.torque += stats.torque * bw.mass;
        }
        if (fw.angularVelocity < stats.speed) {
            fw.torque += stats.torque * fw.mass;
        }
    }

    public moveBackward(): void {
        const stats = this.truck.currentStats;
        const bw = this.truck.backWheelBody;
        const fw = this.truck.frontWheelBody;
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

        // Force strength (adjust based on how "magnetic" you want it to feel)
        const forceMagnitude = 0.05 * this.truck.body.mass;

        // Get the angle of the truck (assuming it aligns with the slope)
        const angle = this.truck.body.angle;

        // Calculate the vector pointing "down" relative to the truck's floor
        // We use Math.PI / 2 to get a vector perpendicular to the chassis
        const forceVector = {
            x: Math.cos(angle + Math.PI / 2) * forceMagnitude,
            y: Math.sin(angle + Math.PI / 2) * forceMagnitude
        };

        // Apply to the chassis
        Body.applyForce(this.truck.body, this.truck.body.position, forceVector);
    }
    /**
     * Performs a small jump by applying upward velocity to all truck parts
     */
    public jump(): void {
        // You can tune this value. 
        // Negative Y is UP in Matter.js/PIXI
        if (!this.truck.isGrounded) return;
        const jumpPower = -5;

        // We apply the jump to the chassis and BOTH wheels
        // This prevents the suspension from "absorbing" the jump
        const bodiesToJump = [
            this.truck.body,
            this.truck.backWheelBody,
            this.truck.frontWheelBody
        ];

        bodiesToJump.forEach(body => {
            Body.setVelocity(body, {
                x: body.velocity.x,
                y: jumpPower
            });
        });
    }

    public brake(): void {
        const bw = this.truck.backWheelBody;
        const fw = this.truck.frontWheelBody;
        Body.setAngularVelocity(bw, bw.angularVelocity * 0.8);
        Body.setAngularVelocity(fw, fw.angularVelocity * 0.8);
    }
}