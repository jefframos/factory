import * as PIXI from 'pixi.js';
import { Collider } from './Collider';

export class ColliderDebugHelper {
    /** Draws a visual shape matching the collider inside the given container */
    public static addDebugGraphics(collider: Collider, container: PIXI.Container, color = 0x00ff00, alpha = 0.3): PIXI.Graphics {
        const gfx = new PIXI.Graphics();
        gfx.name = '__colliderDebug';
        gfx.alpha = alpha;
        gfx.beginFill(color);

        if (collider.shape === 'circle') {
            gfx.drawCircle(0, 0, collider.radius);
            gfx.endFill();

            // Set position relative to container
            const pos = collider.position;
            if (collider.parent && collider.parent !== container) {
                const local = container.toLocal(collider.parent.toGlobal(pos));
                gfx.position.set(local.x, local.y);
            } else {
                gfx.position.set(pos.x, pos.y);
            }
        } else if (collider.shape === 'polygon') {
            //const pts = collider.points;
            const pts = collider.colliderShape ? collider.colliderShape.calcPoints : [];
            if (pts.length > 0) {
                gfx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) {
                    gfx.lineTo(pts[i].x, pts[i].y);
                }
                gfx.closePath();
                gfx.endFill();

                // Position the shape at the collider's local position
                const pos = collider.position;
                gfx.position.set(pos.x, pos.y);
                if (collider.parent && collider.parent !== container) {
                    const global = collider.parent.toGlobal(new PIXI.Point(pos.x, pos.y));
                    const local = container.toLocal(global);
                    gfx.position.set(local.x, local.y);
                }
            }
        }

        container.addChild(gfx);
        return gfx;
    }

    /** Removes previously drawn debug graphic */
    public static removeDebugGraphics(container: PIXI.Container): void {
        const child = container.getChildByName('__colliderDebug');
        if (child) {
            container.removeChild(child);
            child.destroy();
        }
    }
    static ensureClockwise(points: PIXI.Point[]): PIXI.Point[] {
        const area = this._signedArea(points);
        if (area < 0) {
            return points.slice().reverse(); // Return a new array reversed
        }
        return points;
    }

    /**
     * Creates a clockwise box polygon from (0, 0) with given width and height.
     */
    static createBoxPoints(width: number, height: number): PIXI.Point[] {
        return [
            new PIXI.Point(0, 0),
            new PIXI.Point(width, 0),
            new PIXI.Point(width, height),
            new PIXI.Point(0, height)
        ];
    }

    /**
     * Calculates the signed area to determine winding.
     * Negative: counter-clockwise, Positive: clockwise
     */
    private static _signedArea(points: PIXI.Point[]): number {
        let area = 0;
        const n = points.length;
        for (let i = 0; i < n; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % n];
            area += (p2.x - p1.x) * (p2.y + p1.y);
        }
        return area;
    }
}
