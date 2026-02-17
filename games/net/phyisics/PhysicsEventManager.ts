import { Body, Events, IEventCollision } from 'matter-js';

export type CollisionCallback = (otherBody: Body, pair: Matter.Pair) => void;

export class PhysicsEventManager {
    // Maps BodyID -> Callback List
    private startListeners = new Map<number, CollisionCallback[]>();
    private endListeners = new Map<number, CollisionCallback[]>();

    constructor(engine: Matter.Engine) {
        // Global Matter.js listeners
        Events.on(engine, 'collisionStart', (e) => this.process(e, this.startListeners));
        Events.on(engine, 'collisionEnd', (e) => this.process(e, this.endListeners));
    }

    private process(event: IEventCollision<Matter.Engine>, registry: Map<number, CollisionCallback[]>) {
        event.pairs.forEach(pair => {
            registry.get(pair.bodyA.id)?.forEach(cb => cb(pair.bodyB, pair));
            registry.get(pair.bodyB.id)?.forEach(cb => cb(pair.bodyA, pair));
        });
    }

    public onStart(body: Body, callback: CollisionCallback) {
        if (!this.startListeners.has(body.id)) this.startListeners.set(body.id, []);
        this.startListeners.get(body.id)!.push(callback);
    }

    public onEnd(body: Body, callback: CollisionCallback) {
        if (!this.endListeners.has(body.id)) this.endListeners.set(body.id, []);
        this.endListeners.get(body.id)!.push(callback);
    }

    /** Clean up all events for a specific body */
    public clear(body: Body) {
        this.startListeners.delete(body.id);
        this.endListeners.delete(body.id);
    }
}