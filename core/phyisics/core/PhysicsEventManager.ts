import { Body, Engine, Events, IEventCollision, Pair } from 'matter-js';

export type CollisionCallback = (otherBody: Body, pair: Pair) => void;

export class PhysicsEventManager {
    private startListeners = new Map<number, CollisionCallback[]>();
    private activeListeners = new Map<number, CollisionCallback[]>();
    private endListeners = new Map<number, CollisionCallback[]>();

    constructor(engine: Engine) {
        // We use arrow functions here in the constructor too 
        // to ensure 'process' keeps its context.
        Events.on(engine, 'collisionStart', (e) => this.process(e, this.startListeners));
        Events.on(engine, 'collisionActive', (e) => this.process(e, this.activeListeners));
        Events.on(engine, 'collisionEnd', (e) => this.process(e, this.endListeners));
    }
    private getRootBody(body: Body): Body {
        let root = body;
        while (root.parent && root.parent !== root) { root = root.parent; }
        return root;
    }

    // private process(event: IEventCollision<Engine>, registry: Map<number, CollisionCallback[]>) {
    //     event.pairs.forEach(pair => {
    //         const callbacksA = registry.get(pair.bodyA.id);
    //         if (callbacksA) callbacksA.forEach(cb => cb(pair.bodyB, pair));

    //         const callbacksB = registry.get(pair.bodyB.id);
    //         if (callbacksB) callbacksB.forEach(cb => cb(pair.bodyA, pair));
    //     });
    // }



    private process(event: IEventCollision<Engine>, registry: Map<number, CollisionCallback[]>,): void {
        for (const pair of event.pairs) {
            const bodyA = this.getRootBody(pair.bodyA); const bodyB = this.getRootBody(pair.bodyB);
            // Copy arrays because a callback may call clear() while dispatching.      
            const callbacksA = registry.get(bodyA.id)?.slice();
            const callbacksB = registry.get(bodyB.id)?.slice();
            callbacksA?.forEach(callback => callback(bodyB, pair));
            callbacksB?.forEach(callback => callback(bodyA, pair));
        }
    }
    private addListener(registry: Map<number, CollisionCallback[]>, body: Body, callback: CollisionCallback,): void {
        const root = this.getRootBody(body); const callbacks = registry.get(root.id) ?? [];
        callbacks.push(callback); registry.set(root.id, callbacks);
    }
    public clear = (body: Body): void => {
        const root = this.getRootBody(body);
        this.startListeners.delete(root.id); this.activeListeners.delete(root.id); this.endListeners.delete(root.id);
    };


    // --- CHANGED TO ARROW FUNCTIONS BELOW ---
    // This ensures 'this' always refers to the PhysicsEventManager instance

    public onStart = (body: Body, callback: CollisionCallback) => {
        this.addListener(this.startListeners, body, callback);
    }

    public onActive = (body: Body, callback: CollisionCallback) => {
        this.addListener(this.activeListeners, body, callback);
    }

    public onEnd = (body: Body, callback: CollisionCallback) => {
        this.addListener(this.endListeners, body, callback);
    }

    // private addListener(map: Map<number, CollisionCallback[]>, body: Body, callback: CollisionCallback) {
    //     if (!map.has(body.id)) {
    //         map.set(body.id, []);
    //     }
    //     map.get(body.id)!.push(callback);
    // }

    // public clear = (body: Body) => {
    //     this.startListeners.delete(body.id);
    //     this.activeListeners.delete(body.id);
    //     this.endListeners.delete(body.id);
    // }
}