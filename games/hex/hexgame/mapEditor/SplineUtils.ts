export interface Point {
    x: number;
    y: number;
}

export class SplineUtils {
    /**
     * Generates points along a Catmull-Rom spline through the given control points.
     * @param controlPoints - Array of points to interpolate through
     * @param segmentPoints - Number of interpolated points per segment (default: 20)
     * @param tension - Spline tension (0 = straight, 0.5 = default, 1 = tight)
     * @returns Array of interpolated points along the spline
     */
    public static generateCatmullRomSpline(
        controlPoints: Point[],
        segmentPoints: number = 20,
        tension: number = 0.5
    ): Point[] {
        if (controlPoints.length < 2) {
            return [...controlPoints];
        }

        if (controlPoints.length === 2) {
            // Simple linear interpolation for 2 points
            const result: Point[] = [];
            const p0 = controlPoints[0];
            const p1 = controlPoints[1];

            for (let i = 0; i <= segmentPoints; i++) {
                const t = i / segmentPoints;
                result.push({
                    x: p0.x + (p1.x - p0.x) * t,
                    y: p0.y + (p1.y - p0.y) * t
                });
            }
            return result;
        }

        const points: Point[] = [];
        const alpha = tension;

        // Generate spline for each segment
        for (let i = 0; i < controlPoints.length - 1; i++) {
            // Get the 4 control points for this segment (with padding for edges)
            const p0 = i > 0 ? controlPoints[i - 1] : controlPoints[i];
            const p1 = controlPoints[i];
            const p2 = controlPoints[i + 1];
            const p3 = i + 2 < controlPoints.length ? controlPoints[i + 2] : controlPoints[i + 1];

            // Interpolate segment
            for (let t = 0; t < segmentPoints; t++) {
                const u = t / segmentPoints;
                const point = this.catmullRomPoint(p0, p1, p2, p3, u, alpha);
                points.push(point);
            }
        }

        // Add the final point
        points.push({ ...controlPoints[controlPoints.length - 1] });

        return points;
    }
    public static getEvenlySpacedPoints(splinePoints: Point[], spacing: number): Point[] {
        if (splinePoints.length < 2) return [...splinePoints];
        if (spacing <= 0) return [...splinePoints];

        const result: Point[] = [splinePoints[0]];
        let distFromLast = 0;

        for (let i = 1; i < splinePoints.length; i++) {
            const p1 = splinePoints[i - 1];
            const p2 = splinePoints[i];

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const segLen = Math.sqrt(dx * dx + dy * dy);

            if (segLen <= 1e-6) {
                continue;
            }

            distFromLast += segLen;

            while (distFromLast >= spacing) {
                const overshoot = distFromLast - spacing;
                const ratio = (segLen - overshoot) / segLen;

                const x = p1.x + dx * ratio;
                const y = p1.y + dy * ratio;

                // guard: never go past p2
                result.push({ x, y });

                distFromLast = overshoot;
            }
        }

        // Always end exactly at the final spline point (no extrapolation)
        const last = splinePoints[splinePoints.length - 1];
        const lastOut = result[result.length - 1];
        if (!lastOut || lastOut.x !== last.x || lastOut.y !== last.y) {
            result.push({ x: last.x, y: last.y });
        }

        return result;
    }

    public static staticgetDistanceToSegment(p: Point, a: Point, b: Point): { dist: number, pos: Point } {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        if (l2 === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), pos: a };

        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
        t = Math.max(0, Math.min(1, t));

        const pos = { x: a.x + t * dx, y: a.y + t * dy };
        const dist = Math.hypot(p.x - pos.x, p.y - pos.y);
        return { dist, pos };
    }
    /**
     * Calculate a single point on a Catmull-Rom spline
     */
    private static catmullRomPoint(
        p0: Point,
        p1: Point,
        p2: Point,
        p3: Point,
        t: number,
        alpha: number
    ): Point {
        const t2 = t * t;
        const t3 = t2 * t;

        const v0 = (p2.x - p0.x) * alpha;
        const v1 = (p3.x - p1.x) * alpha;
        const w0 = (p2.y - p0.y) * alpha;
        const w1 = (p3.y - p1.y) * alpha;

        const x =
            (2 * p1.x - 2 * p2.x + v0 + v1) * t3 +
            (-3 * p1.x + 3 * p2.x - 2 * v0 - v1) * t2 +
            v0 * t +
            p1.x;

        const y =
            (2 * p1.y - 2 * p2.y + w0 + w1) * t3 +
            (-3 * p1.y + 3 * p2.y - 2 * w0 - w1) * t2 +
            w0 * t +
            p1.y;

        return { x, y };
    }

    /**
     * Calculate the total length of a spline
     */
    public static calculateSplineLength(points: Point[]): number {
        let length = 0;
        for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[i - 1].x;
            const dy = points[i].y - points[i - 1].y;
            length += Math.sqrt(dx * dx + dy * dy);
        }
        return length;
    }

    /**
     * Get evenly spaced points along a spline by distance
     */
    public static getEvenlySpacedPointsOld(
        splinePoints: Point[],
        spacing: number
    ): Point[] {
        if (splinePoints.length < 2) return [...splinePoints];

        const result: Point[] = [splinePoints[0]];
        let currentDistance = 0;
        let targetDistance = spacing;

        for (let i = 1; i < splinePoints.length; i++) {
            const p1 = splinePoints[i - 1];
            const p2 = splinePoints[i];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const segmentLength = Math.sqrt(dx * dx + dy * dy);

            currentDistance += segmentLength;

            while (currentDistance >= targetDistance && targetDistance > 0) {
                const excess = currentDistance - targetDistance;
                const ratio = (segmentLength - excess) / segmentLength;

                result.push({
                    x: p1.x + dx * ratio,
                    y: p1.y + dy * ratio
                });

                targetDistance += spacing;
            }
        }

        return result;
    }
}
