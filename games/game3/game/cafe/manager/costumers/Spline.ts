import * as PIXI from 'pixi.js';

export class Spline {
    private points: PIXI.Point[] = [];

    constructor(points: PIXI.Point[]) {
        if (points.length < 2) {
            throw new Error("Spline requires at least 2 points.");
        }
        this.points = points;
    }

    /** Evaluate the spline at t (0 to 1) */
    public getPointAt(t: number): PIXI.Point {
        const p = this.points;
        const l = p.length;

        const scaledT = t * (l - 1);
        const i = Math.floor(scaledT);
        const localT = scaledT - i;

        const p0 = p[Math.max(0, i - 1)];
        const p1 = p[i];
        const p2 = p[Math.min(i + 1, l - 1)];
        const p3 = p[Math.min(i + 2, l - 1)];

        return this.catmullRom(p0, p1, p2, p3, localT);
    }

    /** Get evenly spaced samples along the spline */
    public getEvenPoints(count: number): PIXI.Point[] {
        const result: PIXI.Point[] = [];
        for (let i = 0; i < count; i++) {
            const t = i / (count - 1); // even spacing between 0 and 1
            result.push(this.getPointAt(t));
        }
        return result;
    }

    /** Catmull-Rom spline function */
    private catmullRom(p0: PIXI.Point, p1: PIXI.Point, p2: PIXI.Point, p3: PIXI.Point, t: number): PIXI.Point {
        const t2 = t * t;
        const t3 = t2 * t;

        const x = 0.5 * (
            2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        );

        const y = 0.5 * (
            2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        );

        return new PIXI.Point(x, y);
    }
}
