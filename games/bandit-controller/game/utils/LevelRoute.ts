import * as THREE from 'three';
import type { LevelDoor } from '../data/LevelData';

const DOOR_ASSIST_MARGIN = 0.6;
const DOOR_CLEARANCE = 1.3;
const DOOR_BLEND = 2.5;

export function doorCrossing(door: LevelDoor, start: THREE.Vector3, end: THREE.Vector3): number | undefined {
    const normal = door.alongX ? 'z' : 'x';
    const tangent = door.alongX ? 'x' : 'z';
    const delta = end[normal] - start[normal];
    if (Math.abs(delta) < 1e-8) {
        return undefined;
    }
    const t = (door[normal] - start[normal]) / delta;
    return t >= 0 && t <= 1
        && Math.abs(THREE.MathUtils.lerp(start[tangent], end[tangent], t) - door[tangent])
            <= door.halfWidth + DOOR_ASSIST_MARGIN
        ? t
        : undefined;
}

/** Door influence follows distance along the trace, never an entire world-space row. */
export function adjustRouteThroughDoors(route: readonly THREE.Vector3[], doors: readonly LevelDoor[]): THREE.Vector3[] {
    if (route.length < 2) {
        return route.map((point) => point.clone());
    }
    const distances = [0];
    const crossings: Array<{ door: LevelDoor; distance: number }> = [];
    for (let i = 1; i < route.length; i++) {
        const length = Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
        for (const door of doors) {
            const t = doorCrossing(door, route[i - 1], route[i]);
            if (t !== undefined) {
                crossings.push({ door, distance: distances[i - 1] + t * length });
            }
        }
        distances.push(distances[i - 1] + length);
    }

    const total = distances[distances.length - 1];
    const samples: THREE.Vector3[] = [];
    let segment = 1;
    for (let distance = 0; ; distance = Math.min(total, distance + 0.25)) {
        while (segment < route.length - 1 && distances[segment] < distance) {
            segment++;
        }
        const length = distances[segment] - distances[segment - 1];
        const t = length > 0 ? (distance - distances[segment - 1]) / length : 0;
        const point = route[segment - 1].clone().lerp(route[segment], t);
        // Preserve release/start positions, including short traces that begin inside a doorway.
        if (distance > 0 && distance < total) {
            for (const tangent of ['x', 'z'] as const) {
                let bestWeight = 0;
                let target = point[tangent];
                for (const crossing of crossings) {
                    if ((crossing.door.alongX ? 'x' : 'z') !== tangent) {
                        continue;
                    }
                    const alongRoute = Math.abs(distance - crossing.distance);
                    const blend = THREE.MathUtils.clamp(1 - (alongRoute - DOOR_CLEARANCE) / DOOR_BLEND, 0, 1);
                    const weight = blend * blend * (3 - 2 * blend);
                    if (weight > bestWeight) {
                        bestWeight = weight;
                        target = crossing.door[tangent];
                    }
                }
                point[tangent] = THREE.MathUtils.lerp(point[tangent], target, bestWeight);
            }
        }
        samples.push(point);
        if (distance >= total) {
            break;
        }
    }
    return samples;
}
