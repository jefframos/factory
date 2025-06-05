import * as PIXI from 'pixi.js';
import * as SAT from 'sat';
import { Collider } from './Collider';
export type CollisionResponse = { response: SAT.Response, collider: Collider }
export class CollisionSystem {
    private static colliders: Collider[] = [];

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
    }

    /** Clear all colliders */
    public static clear(): void {
        this.colliders.length = 0;
    }

    /**
     * Check all colliders for overlap with a circle at `position` with given `radius`.
     * Returns the list of { response, collider } for all that collided.
     */
    public static checkCollisions(
        position: PIXI.Point,
        radius: number,
        source: PIXI.Container | undefined = undefined
    ): CollisionResponse[] {
        const results: CollisionResponse[] = [];

        for (const collider of this.colliders) {
            if (!collider.enabled) continue;

            const response = new SAT.Response();
            const collided = collider.checkCollisionWithCircle(position, radius, response);

            if (collided.a && collided.b) {
                results.push({ response, collider });
                collider.onCollide?.(source);
            }
        }

        return results;
    }
}
