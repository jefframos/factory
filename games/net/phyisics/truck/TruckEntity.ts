import { Bodies, Body, Constraint } from "matter-js";
import * as PIXI from "pixi.js";
import { BaseEntity } from "../BaseEntity";
import { CollisionLayer } from "../CollisionLayer";
import Physics from "../Physics";
import { PhysicsBodyFactory } from "../PhysicsBodyFactory";
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
    friction: 0.8,
    mass: 50,
    bounciness: 0.1,
    airFriction: 0.01,
    wheelFriction: 1.8,
    angularDamping: 0.1,
    suspensionStiffness: 0.8,
    suspensionDamping: 0.05
};

export class TruckEntity extends BaseEntity {
    private stats: ITruckStats = DEFAULT_TRUCK_STATS;
    private backWheel!: Body;
    private frontWheel!: Body;
    private backAxle!: Constraint;
    private frontAxle!: Constraint;
    private groundContactCount: number = 0;
    public cargo!: TruckCargoSystem;

    private backWheelGraphic!: PIXI.Graphics;
    private frontWheelGraphic!: PIXI.Graphics;

    private augments: ITruckAugmentations = {
        mass: 0,
        acceleration: 0,
        maxSpeed: 0,
        capacity: 0
    };

    /** * Getters for the TruckMover to access internals 
     */
    public get isGrounded(): boolean {
        return this.groundContactCount > 0;
    }
    public get backWheelBody(): Body { return this.backWheel; }
    public get frontWheelBody(): Body { return this.frontWheel; }
    public get currentStats() {
        return {
            speed: this.stats.wheelSpeed + (this.augments.maxSpeed || 0),
            torque: this.stats.wheelTorque + (this.augments.acceleration || 0)
        };
    }

    public build(options: { x: number, y: number, layer: CollisionLayer, stats?: Partial<ITruckStats> }) {
        if (options.stats) this.stats = { ...this.stats, ...options.stats };

        const truckGroup = Body.nextGroup(true);

        // Define Chassis Shapes
        const chassis = Bodies.rectangle(0, 0, 140, 20);
        const cabin = Bodies.rectangle(40, -28, 45, 36);
        const backWall = Bodies.rectangle(-65, -16, 10, 32);
        const innerWall = Bodies.rectangle(-10, -8, 10, 18);

        const desc = PhysicsBodyFactory.createComposite(
            options.x, options.y,
            [chassis, cabin, backWall, innerWall],
            {
                collisionFilter: { group: truckGroup },
                friction: this.stats.friction,
                restitution: this.stats.bounciness,
                frictionAir: this.stats.airFriction
            }
        );

        this.setBodyDescription(desc);
        Body.setMass(this.body, this.stats.mass);
        Body.setInertia(this.body, this.body.inertia * 3);

        // Create Wheels
        const wheelOptions = {
            collisionFilter: { group: truckGroup },
            friction: this.stats.wheelFriction,
            restitution: 0.4,
            density: 0.015,
            frictionAir: 0.01
        };

        this.backWheel = Bodies.circle(options.x - 45, options.y + 15, 18, { ...wheelOptions, slop: 0.5 });
        this.frontWheel = Bodies.circle(options.x + 45, options.y + 15, 18, { ...wheelOptions, slop: 0.5 });

        // Create Suspension
        const axleOptions = {
            bodyA: this.body,
            stiffness: this.stats.suspensionStiffness,
            damping: this.stats.suspensionDamping,
            length: 0
        };

        this.backAxle = Constraint.create({ ...axleOptions, bodyB: this.backWheel, pointA: { x: -45, y: 15 } });
        this.frontAxle = Constraint.create({ ...axleOptions, bodyB: this.frontWheel, pointA: { x: 45, y: 15 } });

        Physics.addBody(this.backWheel);
        Physics.addBody(this.frontWheel);
        Physics.addConstraint(this.backAxle);
        Physics.addConstraint(this.frontAxle);

        this.createWheelGraphics();

        // Cargo system needs the parent container to render cargo independently of truck rotation if needed
        this.cargo = new TruckCargoSystem(this.body, this.view.parent || this.view);

        this.setCollisionCategory(options.layer);

        this.setupGroundDetection(this.backWheel);
        this.setupGroundDetection(this.frontWheel);
    }

    private setupGroundDetection(wheel: Body): void {
        Physics.events.onStart(wheel, (otherBody) => {
            if (otherBody.collisionFilter.category === CollisionLayer.DEFAULT) {

                this.onCollisionStart(CollisionLayer.DEFAULT);
            }
        });

        Physics.events.onEnd(wheel, (otherBody) => {
            if (otherBody.collisionFilter.category === CollisionLayer.DEFAULT) {
                this.onCollisionEnd(CollisionLayer.DEFAULT);
            }
        });
    }

    // Call these from your global Physics collision events
    public onCollisionStart(otherLayer: number) {
        console.log('onCollisionStart')
        if (otherLayer === CollisionLayer.DEFAULT) {
            this.groundContactCount++;
        }
    }

    public onCollisionEnd(otherLayer: number) {
        if (otherLayer === CollisionLayer.DEFAULT) {
            this.groundContactCount = Math.max(0, this.groundContactCount - 1);
        }
    }

    public update(delta: number): void {
        this.syncView();
        this.syncWheels();
        this.cargo?.update(delta);
    }

    public fixedUpdate(delta: number): void {
        const stopThreshold = 0.001;
        const wheelDamping = 0.92;

        this.cargo?.fixedUpdate(delta);

        [this.backWheel, this.frontWheel].forEach(wheel => {
            if (Math.abs(wheel.angularVelocity) < stopThreshold) {
                Body.setAngularVelocity(wheel, 0);
                wheel.torque = 0;
            } else {
                Body.setAngularVelocity(wheel, wheel.angularVelocity * wheelDamping);
            }
        });
    }

    public updateStats(newAugments: ITruckAugmentations): void {
        this.augments.mass = (this.augments.mass || 0) + (newAugments.mass || 0);
        this.augments.acceleration = (this.augments.acceleration || 0) + (newAugments.acceleration || 0);
        this.augments.maxSpeed = (this.augments.maxSpeed || 0) + (newAugments.maxSpeed || 0);
        this.augments.capacity = (this.augments.capacity || 0) + (newAugments.capacity || 0);

        const totalMass = this.stats.mass + this.augments.mass;
        Body.setMass(this.body, totalMass);
    }

    public teleport(x: number, y: number) {
        const dx = x - this.body.position.x;
        const dy = y - this.body.position.y;

        Body.setPosition(this.body, { x, y });
        Body.setPosition(this.backWheel, {
            x: this.backWheel.position.x + dx,
            y: this.backWheel.position.y + dy
        });
        Body.setPosition(this.frontWheel, {
            x: this.frontWheel.position.x + dx,
            y: this.frontWheel.position.y + dy
        });
    }

    private createWheelGraphics(): void {
        const wheelRadius = 18;
        this.backWheelGraphic = new PIXI.Graphics().lineStyle(2, 0x00FF00).drawCircle(0, 0, wheelRadius).moveTo(0, 0).lineTo(wheelRadius, 0);
        this.frontWheelGraphic = new PIXI.Graphics().lineStyle(2, 0x00FF00).drawCircle(0, 0, wheelRadius).moveTo(0, 0).lineTo(wheelRadius, 0);
        this.view.addChild(this.backWheelGraphic, this.frontWheelGraphic);
    }

    private syncWheels(): void {
        const cPos = this.body.position;
        const cAngle = this.body.angle;

        [{ w: this.backWheel, g: this.backWheelGraphic }, { w: this.frontWheel, g: this.frontWheelGraphic }].forEach(pair => {
            const dx = pair.w.position.x - cPos.x;
            const dy = pair.w.position.y - cPos.y;
            const lx = dx * Math.cos(-cAngle) - dy * Math.sin(-cAngle);
            const ly = dx * Math.sin(-cAngle) + dy * Math.cos(-cAngle);
            pair.g.position.set(lx, ly);
            pair.g.rotation = pair.w.angle - cAngle;
        });
    }

    public destroy(): void {
        Physics.removeBody(this.backWheel);
        Physics.removeBody(this.frontWheel);
        Physics.removeConstraint(this.backAxle);
        Physics.removeConstraint(this.frontAxle);
        super.destroy();
    }
}