import { TiledLayer } from '@core/tiled/ExtractTiledFile';
import * as PIXI from 'pixi.js';
import Collider, { ColliderOptions } from './Collider';
import { ColliderDebugHelper } from './ColliderDebugHelper';
import { CollisionSystem } from './CollisionSystem';



export class StaticColliderLayer {
    private colliders: Collider[] = [];

    constructor(layerData: TiledLayer, parentContainer?: PIXI.Container, debug: boolean = false) {
        if (layerData.objects) {
            for (const obj of layerData.objects) {
                if (!obj.visible || !obj.polygon) continue;

                const points = obj.polygon.map(p => new PIXI.Point(p.x, p.y));
                // Reverse the points to match the expected order for SAT polygons
                // This is necessary because Tiled exports polygons in a clockwise order,
                // but SAT expects them in a counter-clockwise order for correct collision detection.
                const reversedPoints = points.slice().reverse();

                const colliderOptions: ColliderOptions = {
                    shape: 'polygon',
                    points: reversedPoints,
                    position: { x: obj.x, y: obj.y },
                };
                const collider = new Collider(colliderOptions);
                CollisionSystem.addCollider(collider);
                this.colliders.push(collider);

                if (debug && parentContainer) {
                    ColliderDebugHelper.addDebugGraphics(collider, parentContainer)
                }
            }
        }
    }

    public getColliders(): Collider[] {
        return this.colliders;
    }

    public destroy() {
        for (const collider of this.colliders) {
            CollisionSystem.removeCollider(collider);
        }
        this.colliders.length = 0;
    }
}
