import { Body, Constraint, Engine, World } from 'matter-js';
import { PhysicsEventManager } from './PhysicsEventManager';

export interface IPhysicsSettings {
    gravity?: { x: number; y: number };
    timeScale?: number;
    enableSleep?: boolean;
    positionIterations?: number;
    velocityIterations?: number;
}

export default class Physics {
    private static _engine: Engine;
    public static events: PhysicsEventManager
        ;
    public static get world(): World {
        return this._engine.world;
    }

    /**
     * Initialize the engine with optional settings
     */
    public static init(settings?: IPhysicsSettings): void {
        // Create engine with iteration/sleep settings
        this._engine = Engine.create({
            enableSleeping: settings?.enableSleep ?? true,
            positionIterations: settings?.positionIterations ?? 6,
            velocityIterations: settings?.velocityIterations ?? 4
        });

        this.events = new PhysicsEventManager(this._engine);
        // Apply Gravity
        if (settings?.gravity) {
            this._engine.gravity.x = settings.gravity.x;
            this._engine.gravity.y = settings.gravity.y;
        } else {
            this._engine.gravity.y = 1; // Default gravity
        }

        // Apply TimeScale
        this._engine.timing.timeScale = settings?.timeScale ?? 1;
    }

    public static fixedUpdate(delta: number): void {
        // Matter.js Engine.update(engine, deltaMs)
        Engine.update(this._engine, delta * 1000);
    }

    public static addBody(body: Body): void {
        World.add(this.world, body);
    }

    public static removeBody(body: Body): void {
        this.events.clear(body);
        World.remove(this.world, body);
    }

    public static addConstraint(constraint: Constraint): void {
        World.add(this.world, constraint);
    }

    public static removeConstraint(constraint: Constraint): void {
        World.remove(this.world, constraint);
    }
}