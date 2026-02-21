import { CollisionLayer } from "@core/phyisics/core/CollisionLayer";
import { BodyDescription, PhysicsBodyFactory } from "@core/phyisics/core/PhysicsBodyFactory";
import { PhysicsTransform } from "@core/phyisics/core/PhysicsTransform";
import { BasePhysicsEntity } from "@core/phyisics/entities/BaseEntity";
import Physics from "@core/phyisics/Physics";
import { Bodies, Body, Constraint } from "matter-js";
import * as PIXI from "pixi.js";
import { CarCargoSystem } from "./CarCargoSystem";
import { CarRegistry } from "./CarRegistry";

export interface ICarAugmentations {
    mass?: number;
    acceleration?: number;
    maxSpeed?: number;
    capacity?: number;
}
export interface ICarPhysicsParts {
    chassis: {
        shapes: { x: number; y: number; w: number; h: number }[];
    };
    wheels: {
        radius: number;
        frontOffset: { x: number; y: number };
        backOffset: { x: number; y: number };
    };
}

export interface ICarStats {
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

export const DEFAULT_TRUCK_STATS: ICarStats = {
    wheelSpeed: 120,        // High cap — lets you actually build momentum down slopes
    wheelTorque: 0.18,      // Stronger push per frame, wind-up still comes from the curve
    friction: 0.001,
    mass: 100,
    bounciness: 0,
    airFriction: 0.01,
    wheelFriction: 6.0,     // Slightly higher — better grip = more speed transferred to chassis
    angularDamping: 0.005,  // Lower — chassis rotates more naturally in the air
    suspensionStiffness: 0.25,  // Stiffer — chassis stays planted, less bobbing
    suspensionDamping: 0.9      // High damping — kills the bounce loop dead
};

export const DEFAULT_CAR_PARTS: ICarPhysicsParts = {
    chassis: {
        shapes: [
            { x: 20, y: 0, w: 160, h: 20 },
            { x: 20, y: -28, w: 60, h: 36 }
        ]
    },
    wheels: {
        radius: 18,
        frontOffset: { x: 42, y: 15 },
        backOffset: { x: -42, y: 15 }
    }
};

export enum CarPart {
    CHASSIS = "chassis",
    FRONT_WHEEL = "front_wheel",
    BACK_WHEEL = "back_wheel"
}

export class CarEntity extends BasePhysicsEntity {
    private stats: ICarStats = DEFAULT_TRUCK_STATS;
    private augments: ICarAugmentations = {
        mass: 0, acceleration: 0, maxSpeed: 0, capacity: 0
    };

    private parts = new Map<CarPart, { body: Body; transform: PhysicsTransform }>();
    private groundContactCount: number = 0;
    public cargo!: CarCargoSystem;

    private constraints: Constraint[] = [];

    public get isGrounded(): boolean { return this.groundContactCount > 0; }

    public get currentStats() {
        return {
            speed: this.stats.wheelSpeed + (this.augments.maxSpeed || 0),
            torque: this.stats.wheelTorque + (this.augments.acceleration || 0)
        };
    }

    public getPart(part: CarPart) {
        return this.parts.get(part);
    }

    /**
     * Build the truck at a specific world position
     */
    public build(options: { layer: CollisionLayer, stats?: Partial<ICarStats>, physicsParts?: ICarPhysicsParts }) {
        this.destroyExistingParts();

        const config = options.physicsParts || DEFAULT_CAR_PARTS;
        if (options.stats) this.stats = { ...this.stats, ...options.stats };

        const truckGroup = Body.nextGroup(true);

        // 1. Create Chassis Shapes (Local coordinates relative to center)
        const chassisParts = config.chassis.shapes.map(s =>
            Bodies.rectangle(s.x, s.y, s.w, s.h, {
                chamfer: 1
            })
        );

        const desc: BodyDescription = PhysicsBodyFactory.createComposite(0, 0, chassisParts, {
            collisionFilter: { group: truckGroup },
            friction: this.stats.friction,
            restitution: this.stats.bounciness,
        });

        this.setBodyDescription(desc);
        Body.setMass(this.body, this.stats.mass);
        Body.setInertia(this.body, this.body.inertia * 3);

        // Register Chassis
        this.parts.set(CarPart.CHASSIS, {
            body: this.body,
            transform: new PhysicsTransform(this.body, desc.debugGraphic)
        });

        // 2. Add Wheels using local offsets
        // We pass the relative offset (-45, 15) and the world spawn point (options.x, options.y)
        this.addWheel(
            CarPart.BACK_WHEEL,
            config.wheels.backOffset,
            config.wheels.radius,
            truckGroup
        );
        this.addWheel(
            CarPart.FRONT_WHEEL,
            config.wheels.frontOffset,
            config.wheels.radius,
            truckGroup
        );


        const wheelBodies = [
            this.parts.get(CarPart.BACK_WHEEL)!.body,
            this.parts.get(CarPart.FRONT_WHEEL)!.body
        ];
        CarRegistry.register(this.body, wheelBodies);

        // 3. Systems setup
        this.cargo = new CarCargoSystem(this.body, this.view.parent || this.view);
        this.setCollisionCategory(options.layer);
    }

    private destroyExistingParts() {
        // Remove Constraints
        this.constraints.forEach(c => Physics.removeConstraint(c));
        this.constraints = [];

        // Remove Wheels and Graphics
        this.parts.forEach((part, type) => {
            if (part.transform.view) {
                this.view.removeChild(part.transform.view);
            }
            if (type !== CarPart.CHASSIS) {
                Physics.removeBody(part.body);
            }
        });

        this.parts.clear();
        this.groundContactCount = 0;
        // Note: BasePhysicsEntity usually handles its own main body cleanup 
        // through setBodyDescription, but ensure your factory supports replacement.
    }

    private addWheel(type: CarPart, offset: { x: number, y: number }, radius: number, group: number) {
        const worldX = this.body.position.x + offset.x;
        const worldY = this.body.position.y + offset.y;

        const wheelBody = Bodies.circle(worldX, worldY, radius, {
            collisionFilter: { group },
            friction: this.stats.wheelFriction,
            restitution: 0,
            slop: 0.01,
            density: 0.01
        });

        const axle = Constraint.create({
            bodyA: this.body,
            bodyB: wheelBody,
            pointA: { x: offset.x, y: offset.y },
            stiffness: this.stats.suspensionStiffness,
            damping: this.stats.suspensionDamping,
            length: 0
        });

        Physics.addBody(wheelBody);
        Physics.addConstraint(axle);
        this.constraints.push(axle);

        const graphic = new PIXI.Graphics()
            .lineStyle(2, 0x00FF00)
            .drawCircle(0, 0, radius)
            .lineTo(radius, 0);

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
            if (partType === CarPart.CHASSIS) return;
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
            if (partType === CarPart.CHASSIS) return;

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
        const wheelDamping = 0.99;

        [CarPart.BACK_WHEEL, CarPart.FRONT_WHEEL].forEach(part => {
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

    public updateStats(newAugments: Partial<ICarAugmentations>): void {
        this.augments.mass = (this.augments.mass || 0) + (newAugments.mass || 0);
        this.augments.acceleration = (this.augments.acceleration || 0) + (newAugments.acceleration || 0);
        this.augments.maxSpeed = (this.augments.maxSpeed || 0) + (newAugments.maxSpeed || 0);

        const totalMass = this.stats.mass + this.augments.mass;
        Body.setMass(this.body, totalMass);
        Body.setInertia(this.body, this.body.inertia * 3);
    }
}