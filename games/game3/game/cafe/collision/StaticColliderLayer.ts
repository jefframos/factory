import { TiledLayer } from '@core/tiled/ExtractTiledFile';
import * as PIXI from 'pixi.js';
import { Collider, ColliderOptions } from './Collider';
import { ColliderDebugHelper } from './ColliderDebugHelper';
import { CollisionSystem } from './CollisionSystem';



export class StaticColliderLayer {
    private colliders: Collider[] = [];

    constructor(layerData: TiledLayer, parentContainer?: PIXI.Container, debug: boolean = false) {
        if (layerData.objects) {
            for (const obj of layerData.objects) {
                if (!obj.visible || !obj.polygon) continue;

                const points = obj.polygon.map(p => new PIXI.Point(p.x, p.y));
                const clockwisePoints = points//ColliderDebugHelper.ensureClockwise([...points]);


                const reversedPoints = points.slice().reverse();

                const colliderOptions: ColliderOptions = {
                    shape: 'polygon',
                    points: reversedPoints,
                    position: { x: obj.x, y: obj.y },
                    //  parent: parentContainer
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
