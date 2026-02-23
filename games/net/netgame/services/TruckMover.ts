import { Body } from "matter-js";
import { CarEntity, CarPart } from "../truck/CarEntity";

export class TruckMover {
    constructor(private truck: CarEntity) { }

    private getPartBody(part: CarPart): Body {
        const p = this.truck.getPart(part);
        if (!p) throw new Error(`Part ${part} not found`);
        return p.body;
    }

    public moveForward(): void {
        const { speed, torque } = this.truck.currentStats;
        this.applyWheelTorque(speed, torque);
    }

    public moveBackward(): void {
        const { speed, torque } = this.truck.currentStats;
        this.applyWheelTorque(-speed, torque);
    }

    /**
     * Acceleration curve:
     * - When far from target speed: full torque (fast wind-up)
     * - When close to target speed: tapers off (smooth top-end, hard to over-spin)
     * - When OVER target speed (e.g. rolling down a slope): apply NO torque at all,
     *   so gravity-gained speed is fully preserved for big jumps.
     */
    private applyWheelTorque(targetSpeed: number, torque: number): void {
        const bw = this.getPartBody(CarPart.BACK_WHEEL);
        const fw = this.getPartBody(CarPart.FRONT_WHEEL);

        for (const wheel of [bw, fw]) {
            const current = wheel.angularVelocity;
            const diff = targetSpeed - current;

            // Already at or past target (slope bonus) — don't fight it
            if (Math.sign(diff) !== Math.sign(targetSpeed) && Math.abs(current) >= Math.abs(targetSpeed)) {
                continue;
            }

            // Taper torque as we approach target speed — gives wind-up feel
            // Factor goes from 1.0 (far away) down to ~0.1 (nearly at cap)
            const factor = Math.min(1.0, Math.abs(diff) / (Math.abs(targetSpeed) * 0.3));
            wheel.torque += Math.sign(diff) * torque * wheel.mass * factor;
        }
    }

    /**
     * Downforce keeps the chassis pressed into the ground on slopes
     * so wheels maintain contact and keep pushing.
     */
    public applyDownforce(): void {
        if (!this.truck.isGrounded) return;

        const forceMagnitude = 0.08 * this.truck.body.mass;
        const angle = this.truck.body.angle;

        Body.applyForce(this.truck.body, this.truck.body.position, {
            x: Math.cos(angle + Math.PI / 2) * forceMagnitude,
            y: Math.sin(angle + Math.PI / 2) * forceMagnitude
        });
    }

    /**
     * Jump sets velocity on all bodies at once so the suspension
     * doesn't immediately dampen the impulse before liftoff.
     */
    public jump(): void {
        if (!this.truck.isGrounded) return;

        const jumpPower = -7; // Stronger — high speed + good jump = big air
        const bodies = [
            this.truck.body,
            this.getPartBody(CarPart.BACK_WHEEL),
            this.getPartBody(CarPart.FRONT_WHEEL)
        ];

        bodies.forEach(body => {
            Body.setVelocity(body, { x: body.velocity.x, y: jumpPower });
        });
    }

    public rotateForward(): void {
        this.applyAirRotation(1);
    }

    /**
     * Tilts the truck nose-up (counter-clockwise)
     */
    public rotateBackward(): void {
        this.applyAirRotation(-1);
    }

    /**
     * Applies rotational torque to the chassis.
     * @param direction 1 for forward (CW), -1 for backward (CCW)
     */
    private applyAirRotation(direction: number): void {
        // We usually only want rotation in the air, or with reduced power on ground
        // but for arcade feel, we'll allow it anytime or check !isGrounded
        const rotationPower = 0.1; // Adjust this for "snappiness"
        const chassis = this.truck.body;

        // Apply torque proportional to mass so heavier trucks don't feel "stiff"
        chassis.torque += direction * rotationPower * chassis.mass;

        // Optional: Dampen existing angular velocity if trying to rotate the opposite way
        // This makes the controls feel more responsive/snappy.
        if (Math.sign(chassis.angularVelocity) !== Math.sign(direction)) {
            Body.setAngularVelocity(chassis, chassis.angularVelocity * 0.95);
        }
    }

    public brake(): void {
        const bw = this.getPartBody(CarPart.BACK_WHEEL);
        const fw = this.getPartBody(CarPart.FRONT_WHEEL);

        // Stronger brake multiplier — 0.8 felt sluggish
        Body.setAngularVelocity(bw, bw.angularVelocity * 0.6);
        Body.setAngularVelocity(fw, fw.angularVelocity * 0.6);
    }
}