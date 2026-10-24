// LevelSight.ts
//
// Line-of-sight queries against a level's walls. Guards can't see over or through anything in a wall,
// doors and windows included.

import type { LevelData } from '../data/LevelData';

interface Segment {
    ax: number;
    az: number;
    bx: number;
    bz: number;
}

const SIGHT_TOLERANCE = 0.35;

export class LevelSight {
    private readonly segments: Segment[] = [];

    public constructor(level: LevelData) {
        for (const wall of level.walls) {
            const count = wall.points.length - (wall.closed ? 0 : 1);
            for (let i = 0; i < count; i++) {
                const a = wall.points[i];
                const b = wall.points[(i + 1) % wall.points.length];
                this.segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
            }
        }
    }

    /** Distance from (ox, oz) along the unit direction (dx, dz) to the first blocking wall, capped at `max`. */
    public castRay(ox: number, oz: number, dx: number, dz: number, max: number): number {
        let nearest = max;
        for (const segment of this.segments) {
            const ex = segment.bx - segment.ax;
            const ez = segment.bz - segment.az;
            const denominator = dx * ez - dz * ex;
            if (Math.abs(denominator) < 1e-9) {
                continue;
            }
            const rx = segment.ax - ox;
            const rz = segment.az - oz;
            const t = (rx * ez - rz * ex) / denominator;
            const u = (rx * dz - rz * dx) / denominator;
            if (t < 0 || t >= nearest || u < 0 || u > 1) {
                continue;
            }
            nearest = t;
        }
        return nearest;
    }

    public hasLineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
        const dx = bx - ax;
        const dz = bz - az;
        const distance = Math.hypot(dx, dz);
        if (distance < 1e-4) {
            return true;
        }
        return this.castRay(ax, az, dx / distance, dz / distance, distance) >= distance - SIGHT_TOLERANCE;
    }
}
