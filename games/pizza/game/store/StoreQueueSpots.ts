// StoreQueueSpots.ts
//
// Lays out WHERE each queue index of every StoreLine in a store stands,
// fitted to the store's nav grid (StoreNavGrid). The queue order itself
// never changes here — see StoreLine.ts. Two styles (StoreConfig.waitStyle):
//
//   - 'line':    the classic straight line (spot 0 at the target, then
//                spotSpacing apart along the line's direction), each spot
//                snapped onto a walkable cell if it landed on an obstacle.
//   - 'cluster': spot 0 stays the straight line's front spot (where the
//                front client picks/pays). The rest are walkable cells
//                gathered around it, preferring the line's direction and
//                staying close, at least spotSpacing apart. Spots are handed
//                out round-robin across ALL lines — every line takes its
//                next-best spot in turn — so neighbouring storages share the
//                floor instead of one line swallowing the space in front of
//                another, and no two lines' spots ever overlap.
//
// A line with its own front spot from the map (StoreLine.straight — e.g. the
// cashier's "clientPoint") is always laid out straight, first, and the
// clustered lines keep clear of its spots.

import * as THREE from 'three';
import StoreNavGrid from './nav/StoreNavGrid';
import StoreLine from './StoreLine';

export type StoreWaitStyle = 'line' | 'cluster';

/** How far out (in spotSpacings) a cluster looks for spots. */
const CLUSTER_REACH_SPACINGS = 5;
/**
 * Cost per world unit of sideways offset, relative to 1 per unit along the line's direction. A
 * bit above 1 makes a fan behind the target (straight back first, then diagonals) rather than a
 * sideways row that runs into the next shelf's queue.
 */
const LATERAL_COST = 1.3;
/** Extra cost for a spot behind the target's front edge (on the far side of the shelf). */
const BEHIND_COST = 50;

export function layoutQueueSpots(
    grid: StoreNavGrid,
    lines: readonly StoreLine<unknown>[],
    style: StoreWaitStyle,
    spotsPerLine: number,
): void {
    const count = Math.max(1, spotsPerLine);
    const straightLines = style === 'line' ? lines : lines.filter(line => line.straight);
    const taken: THREE.Vector3[] = [];
    for (const line of straightLines) {
        const spots: THREE.Vector3[] = [];
        for (let i = 0; i < count; i++) {
            spots.push(i === 0 ? line.firstSpot.clone() : grid.snapToWalkable(line.lineSpot(i)));
        }
        line.setSpots(spots);
        taken.push(...spots);
    }
    if (style === 'line') {
        return;
    }
    lines = lines.filter(line => !line.straight);

    taken.push(...lines.map(line => line.firstSpot.clone()));
    const spotsByLine: THREE.Vector3[][] = lines.map(line => [line.firstSpot.clone()]);
    const candidatesByLine = lines.map(line => rankCandidates(grid, line));
    const cursor = lines.map(() => 0);

    for (let round = 1; round < count; round++) {
        lines.forEach((line, lineIndex) => {
            const candidates = candidatesByLine[lineIndex];
            const minDistSq = line.spacing * line.spacing;
            let chosen: THREE.Vector3 | undefined;
            while (cursor[lineIndex] < candidates.length) {
                const candidate = candidates[cursor[lineIndex]++];
                if (taken.every(spot => spot.distanceToSquared(candidate) >= minDistSq)) {
                    chosen = candidate;
                    break;
                }
            }
            // Out of room: continue the straight line (may overlap, but never leaves anyone spotless).
            const spot = chosen ?? grid.snapToWalkable(line.lineSpot(round));
            taken.push(spot);
            spotsByLine[lineIndex].push(spot);
        });
    }

    lines.forEach((line, lineIndex) => line.setSpots(spotsByLine[lineIndex]));
}

/** Walkable cells near a line's front spot, best (closest, in front, along its direction) first. */
function rankCandidates(grid: StoreNavGrid, line: StoreLine<unknown>): THREE.Vector3[] {
    const origin = line.firstSpot;
    const dir = line.direction;
    // How far the front spot sits in front of the target, along the line's direction — anything
    // less than that is beside/behind the shelf.
    const frontOffset = (origin.x - line.target.x) * dir.x + (origin.z - line.target.z) * dir.z;
    const scored = grid.walkableCellsNear(origin.x, origin.z, line.spacing * CLUSTER_REACH_SPACINGS).map(cell => {
        const dx = cell.x - origin.x;
        const dz = cell.z - origin.z;
        const along = dx * dir.x + dz * dir.z;
        const lateral = Math.abs(dx * dir.z - dz * dir.x);
        const fromTarget = (cell.x - line.target.x) * dir.x + (cell.z - line.target.z) * dir.z;
        const cost = Math.abs(along) + lateral * LATERAL_COST + (fromTarget < frontOffset * 0.5 ? BEHIND_COST : 0);
        return { cell, cost };
    });
    scored.sort((a, b) => a.cost - b.cost);
    return scored.map(entry => entry.cell);
}
