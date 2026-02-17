import { Vector } from "matter-js";
import { BaseEntity } from "./BaseEntity";
import { CollisionLayer } from "./CollisionLayer";
import { PhysicsBodyFactory } from "./PhysicsBodyFactory";

export class SplineEntity extends BaseEntity {

    public build(options: {
        points: Vector[],
        segmentsPerPoint: number,
        thickness: number,
        layer: CollisionLayer
    }) {
        // 1. Generate smooth points using Catmull-Rom
        const smoothPoints = this.getSplinePoints(options.points, options.segmentsPerPoint);

        // 2. Create a "thick" ribbon by offsetting the spline points downwards
        // Matter-js needs a closed polygon to calculate mass/inertia correctly
        const vertices = [];
        // Top edge (the smooth surface)
        for (let p of smoothPoints) vertices.push({ x: p.x, y: p.y });
        // Bottom edge (to give it thickness)
        for (let i = smoothPoints.length - 1; i >= 0; i--) {
            vertices.push({ x: smoothPoints[i].x, y: smoothPoints[i].y + options.thickness });
        }

        // 3. Create the body
        // Note: fromVertices usually centers the body, we must account for that
        const desc = PhysicsBodyFactory.createPolygonFromVertices(
            0, 0, // Initial center, will be offset by vertices
            vertices,
            {
                isStatic: true,
                friction: 0.8,
                label: "ground"
            }
        );

        this.setBodyDescription(desc);
        this.setCollisionCategory(options.layer);
    }

    /**
     * Catmull-Rom Spline interpolation
     */
    private getSplinePoints(points: Vector[], segments: number): Vector[] {
        const spline: Vector[] = [];

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i === 0 ? i : i - 1];
            const p1 = points[i];
            const p2 = points[i + 1];
            const p3 = points[i + 2 === points.length ? i + 1 : i + 2];

            for (let t = 0; t < 1; t += 1 / segments) {
                const t2 = t * t;
                const t3 = t2 * t;

                const x = 0.5 * (
                    (2 * p1.x) +
                    (-p0.x + p2.x) * t +
                    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
                );

                const y = 0.5 * (
                    (2 * p1.y) +
                    (-p0.y + p2.y) * t +
                    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
                );

                spline.push({ x, y });
            }
        }
        spline.push(points[points.length - 1]);
        return spline;
    }

    public update(delta: number): void {
        this.syncView();
    }

    public fixedUpdate(delta: number): void { }
}