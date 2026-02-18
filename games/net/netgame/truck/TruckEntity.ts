import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { BodyDescription, PhysicsBodyFactory } from "@core/phyisics/core/PhysicsBodyFactory";
import { PhysicsTransform } from "@core/phyisics/core/PhysicsTransform";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import Physics from "@core/phyisics/Physics";
import { Bodies, Body, Constraint } from "matter-js";
import * as PIXI from "pixi.js";
import { TruckCargoSystem } from "./TruckCargoSystem";

export interface ITruckAugmentations {
    mass?: number;
    acceleration?: number;
    maxSpeed?: number;
    capacity?: number;
}

export interface ITruckStats {
    wheelSpeed: number;
    wheelTorque: number;
    friction: number;
    mass: number;
    bounciness: number;
    airFriction: number;
    wheelFriction: number;
    angularDamping: number;
    suspensionStiffness: number;
    suspensionDamping: number;
}

export const DEFAULT_TRUCK_STATS: ITruckStats = {
    wheelSpeed: 5,
    wheelTorque: 0.1,
    friction: 1,
    mass: 50,
    bounciness: 0,
    airFriction: 0.01,
    wheelFriction: 1.8,
    angularDamping: 0.1,
    suspensionStiffness: 0.15, // Slightly increased for stability
    suspensionDamping: 0.3     // Increased to prevent "bouncing" loop
};

export enum TruckPart {
    CHASSIS = "chassis",
    FRONT_WHEEL = "front_wheel",
    BACK_WHEEL = "back_wheel"
}

export class TruckEntity extends BasePhysicsEntity {
    private stats: ITruckStats = DEFAULT_TRUCK_STATS;
    private augments: ITruckAugmentations = {
        mass: 0, acceleration: 0, maxSpeed: 0, capacity: 0
    };

    private parts = new Map<TruckPart, { body: Body; transform: PhysicsTransform }>();
    private groundContactCount: number = 0;
    public cargo!: TruckCargoSystem;

    public get isGrounded(): boolean { return this.groundContactCount > 0; }

    public get currentStats() {
        return {
            speed: this.stats.wheelSpeed + (this.augments.maxSpeed || 0),
            torque: this.stats.wheelTorque + (this.augments.acceleration || 0)
        };
    }

    public getPart(part: TruckPart) {
        return this.parts.get(part);
    }

    /**
     * Build the truck at a specific world position
     */
    public build(options: { layer: CollisionLayer, stats?: Partial<ITruckStats> }) {
        if (options.stats) this.stats = { ...this.stats, ...options.stats };

        const truckGroup = Body.nextGroup(true);

        // 1. Create Chassis Shapes (Local coordinates relative to center)
        const chassisParts = [
            Bodies.rectangle(0, 0, 140, 20),
            Bodies.rectangle(40, -28, 45, 36)
        ];

        const desc: BodyDescription = PhysicsBodyFactory.createComposite(0, 0, chassisParts, {
            collisionFilter: { group: truckGroup },
            friction: this.stats.friction,
            restitution: this.stats.bounciness,
        });

        this.setBodyDescription(desc);
        Body.setMass(this.body, this.stats.mass);
        Body.setInertia(this.body, this.body.inertia * 3);

        // Register Chassis
        this.parts.set(TruckPart.CHASSIS, {
            body: this.body,
            transform: new PhysicsTransform(this.body, desc.debugGraphic)
        });

        // 2. Add Wheels using local offsets
        // We pass the relative offset (-45, 15) and the world spawn point (options.x, options.y)
        this.addWheel(TruckPart.BACK_WHEEL, -45, 15, 0, 0, truckGroup);
        this.addWheel(TruckPart.FRONT_WHEEL, 45, 15, 0, 0, truckGroup);

        // 3. Systems setup
        this.cargo = new TruckCargoSystem(this.body, this.view.parent || this.view);
        this.setCollisionCategory(options.layer);
    }

    private addWheel(type: TruckPart, offsetX: number, offsetY: number, worldX: number, worldY: number, group: number) {
        // Place wheel in world space
        const wheelBody = Bodies.circle(worldX + offsetX, worldY + offsetY, 18, {
            collisionFilter: { group },
            friction: this.stats.wheelFriction,
            restitution: 0,
            slop: 0.01,
            density: 0.01
        });

        // Anchor is the exact offset used to place it relative to chassis center
        const axle = Constraint.create({
            bodyA: this.body,
            bodyB: wheelBody,
            pointA: { x: offsetX, y: offsetY },
            stiffness: this.stats.suspensionStiffness,
            damping: this.stats.suspensionDamping,
            length: 0
        });

        Physics.addBody(wheelBody);
        Physics.addConstraint(axle);

        // Visual Setup
        const graphic = new PIXI.Graphics().lineStyle(2, 0x00FF00).drawCircle(0, 0, 18).lineTo(18, 0);
        this.view.addChild(graphic);

        this.parts.set(type, {
            body: wheelBody,
            transform: new PhysicsTransform(wheelBody, graphic)
        });

        this.setupGroundDetection(wheelBody);
    }

    public teleport(x: number, y: number): void {
        const dx = x - this.body.position.x;
        const dy = y - this.body.position.y;

        // Move Chassis
        Body.setPosition(this.body, { x, y });
        Body.setVelocity(this.body, { x: 0, y: 0 });
        Body.setAngularVelocity(this.body, 0);

        // Move Wheels by relative delta
        this.parts.forEach((part, partType) => {
            if (partType === TruckPart.CHASSIS) return;
            const newPos = {
                x: part.body.position.x + dx,
                y: part.body.position.y + dy
            };
            Body.setPosition(part.body, newPos);
            Body.setVelocity(part.body, { x: 0, y: 0 });
            Body.setAngularVelocity(part.body, 0);
        });
    }

    public update(delta: number): void {
        this.syncView();
        this.syncPartGraphics();
        this.cargo?.update(delta);
    }

    private syncPartGraphics(): void {
        const truckPos = this.body.position;
        const truckAngle = this.body.angle;
        const cos = Math.cos(-truckAngle);
        const sin = Math.sin(-truckAngle);

        this.parts.forEach((data, partType) => {
            if (partType === TruckPart.CHASSIS) return;

            const { body, transform } = data;
            const dx = body.position.x - truckPos.x;
            const dy = body.position.y - truckPos.y;

            // Localize world coordinates for PIXI nested container
            const lx = dx * cos - dy * sin;
            const ly = dx * sin + dy * cos;

            if (transform.view) {
                transform.view.position.set(lx, ly);
                transform.view.rotation = body.angle - truckAngle;
            }
        });
    }

    public fixedUpdate(delta: number): void {
        const wheelDamping = 0.92;
        [TruckPart.BACK_WHEEL, TruckPart.FRONT_WHEEL].forEach(part => {
            const wheel = this.getPart(part)?.body;
            if (wheel) {
                Body.setAngularVelocity(wheel, wheel.angularVelocity * wheelDamping);
            }
        });
        this.cargo?.fixedUpdate(delta);
    }

    private setupGroundDetection(wheel: Body): void {
        Physics.events.onStart(wheel, (otherBody) => {
            if (otherBody.collisionFilter.category === CollisionLayer.DEFAULT) {
                this.groundContactCount++;
            }
        });

        Physics.events.onEnd(wheel, (otherBody) => {
            if (otherBody.collisionFilter.category === CollisionLayer.DEFAULT) {
                this.groundContactCount = Math.max(0, this.groundContactCount - 1);
            }
        });
    }

    public updateStats(newAugments: Partial<ITruckAugmentations>): void {
        this.augments.mass = (this.augments.mass || 0) + (newAugments.mass || 0);
        this.augments.acceleration = (this.augments.acceleration || 0) + (newAugments.acceleration || 0);
        this.augments.maxSpeed = (this.augments.maxSpeed || 0) + (newAugments.maxSpeed || 0);

        const totalMass = this.stats.mass + this.augments.mass;
        Body.setMass(this.body, totalMass);
        Body.setInertia(this.body, this.body.inertia * 3);
    }
}