import * as PIXI from 'pixi.js';
import * as SAT from 'sat';
import Collider from './Collider';

export type CollisionResponse = { response: SAT.Response; collider: Collider };

export class CollisionSystem {
    private static colliders: Collider[] = [];
    private static activeCollisions: Map<any, Set<Collider>> = new Map();

    /** Add a collider to the system */
    public static addCollider(collider: Collider): void {
        if (!this.colliders.includes(collider)) {
            this.colliders.push(collider);
        }
    }

    /** Remove a collider from the system */
    public static removeCollider(collider: Collider): void {
        const index = this.colliders.indexOf(collider);
        if (index !== -1) {
            this.colliders.splice(index, 1);
        }
        for (const set of this.activeCollisions.values()) {
            set.delete(collider);
        }
    }

    /** Clear all colliders and tracked collisions */
    public static clear(): void {
        this.colliders.length = 0;
        this.activeCollisions.clear();
    }

    /**
     * Check all colliders for overlap with a circle at `position` with given `radius`.
     * Triggers onCollide, onCollideEnter, onCollideExit.
     */
    public static checkCollisions(
        position: PIXI.Point,
        radius: number,
        source: PIXI.Container | undefined = undefined
    ): CollisionResponse[] {
        const results: CollisionResponse[] = [];
        const collidedThisFrame = new Set<Collider>();

        for (const collider of this.colliders) {
            if (!collider.enabled) continue;

            const response = new SAT.Response();
            const collided = collider.checkCollisionWithCircle(position, radius, response);

            if (collided.a && collided.b) {
                results.push({ response, collider });
                collidedThisFrame.add(collider);

                const previous = this.activeCollisions.get(source);
                if (!previous || !previous.has(collider)) {
                    collider.onCollideEnter?.(source);
                }

                collider.onCollide?.(source);
            }
        }

        // Handle exited collisions
        const previousColliders = this.activeCollisions.get(source) ?? new Set<Collider>();
        for (const oldCollider of previousColliders) {
            if (!collidedThisFrame.has(oldCollider)) {
                oldCollider.onCollideExit?.(source);
            }
        }

        this.activeCollisions.set(source, collidedThisFrame);
        return results;
    }
}
