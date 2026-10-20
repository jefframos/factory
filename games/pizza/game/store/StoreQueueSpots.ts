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
//
// Every spot stays where clients are allowed (`isAllowed` — inside the store,
// not in a section that isn't built yet) AND in sight of the spot before it, so
// a line never steps through a wall. A straight line that would break either
// rule BENDS instead: from the last good spot, each next spot is the nearest
// allowed walkable cell in sight of it, at least spotSpacing from every spot
// already taken — a long cashier line snakes through the store rather than
// running out through a wall (snapping a spot beyond the wall to the nearest
// walkable cell used to put it on the far side, outside the store).

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
/** How far (in spotSpacings) a bending line looks for its next spot. */
const BEND_REACH_SPACINGS = 3;
/**
 * When no spot a full spacing from the others is in reach, the search relaxes in these steps
 * (spacing factor, reach in spacings) before the last resort — so spots get tighter, never shared.
 */
const RELAX_STEPS: readonly [number, number][] = [[1, BEND_REACH_SPACINGS], [0.75, 6], [0.5, 12]];
/** Last resort: any allowed cell this far (world units) from every taken spot. */
const MIN_SPOT_GAP = 0.8;
const LAST_RESORT_REACH = 40;

export function layoutQueueSpots(
    grid: StoreNavGrid,
    lines: readonly StoreLine<unknown>[],
    style: StoreWaitStyle,
    spotsPerLine: number,
    /** Where a straight line's next step may land — see this file's own doc. Unset = anywhere walkable. */
    isAllowed: (x: number, z: number) => boolean = () => true,
    /**
     * Stricter: where a SEARCHED spot may go (a bend, a cluster spot, a relaxed fallback) — the
     * store's client area. Searching for "the nearest free cell" otherwise finds cells just past a
     * doorway, inside the store's rect but outside its walls. Unset = isAllowed.
     */
    isClientArea: (x: number, z: number) => boolean = isAllowed,
): void {
    const count = Math.max(1, spotsPerLine);
    const stepAllowed = (spot: THREE.Vector3): boolean => grid.isWalkableAt(spot.x, spot.z) && isAllowed(spot.x, spot.z);
    const allowed = (spot: THREE.Vector3): boolean => stepAllowed(spot) && isClientArea(spot.x, spot.z);
    const straightLines = style === 'line' ? lines : lines.filter(line => line.straight);
    const taken: THREE.Vector3[] = [];
    for (const line of straightLines) {
        const spots: THREE.Vector3[] = [line.firstSpot.clone()];
        taken.push(spots[0]);
        let bending = false;
        for (let i = 1; i < count; i++) {
            const previous = spots[spots.length - 1];
            let spot: THREE.Vector3 | undefined;
            if (!bending) {
                const straight = grid.snapToWalkable(line.lineSpot(i));
                if (stepAllowed(straight) && inSight(grid, previous, straight) && isFree(straight, taken, line.spacing * 0.9)) {
                    spot = straight;
                } else {
                    bending = true;
                }
            }
            spot ??= freeSpot(grid, previous, line.spacing, taken, allowed);
            spots.push(spot);
            taken.push(spot);
        }
        line.setSpots(spots);
    }
    if (style === 'line') {
        return;
    }
    lines = lines.filter(line => !line.straight);

    taken.push(...lines.map(line => line.firstSpot.clone()));
    const spotsByLine: THREE.Vector3[][] = lines.map(line => [line.firstSpot.clone()]);
    // Only cells inside the store, in sight of the front spot (not through a wall).
    const candidatesByLine = lines.map(line => rankCandidates(grid, line)
        .filter(cell => allowed(cell) && inSight(grid, line.firstSpot, cell)));
    const cursor = lines.map(() => 0);

    for (let round = 1; round < count; round++) {
        lines.forEach((line, lineIndex) => {
            const candidates = candidatesByLine[lineIndex];
            let chosen: THREE.Vector3 | undefined;
            while (cursor[lineIndex] < candidates.length) {
                const candidate = candidates[cursor[lineIndex]++];
                if (isFree(candidate, taken, line.spacing)) {
                    chosen = candidate;
                    break;
                }
            }
            // Out of ranked candidates: the nearest free spot to this line's last one (relaxing the
            // spacing if it must) — never a spot someone else already has.
            const previous = spotsByLine[lineIndex][spotsByLine[lineIndex].length - 1];
            const spot = chosen ?? freeSpot(grid, previous, line.spacing, taken, allowed);
            taken.push(spot);
            spotsByLine[lineIndex].push(spot);
        });
    }

    lines.forEach((line, lineIndex) => line.setSpots(spotsByLine[lineIndex]));
}

function isFree(spot: THREE.Vector3, taken: readonly THREE.Vector3[], minDist: number): boolean {
    const minDistSq = minDist * minDist;
    return taken.every(other => other.distanceToSquared(spot) >= minDistSq);
}

/**
 * Can a client walk straight from `from` to `to`? Like StoreNavGrid.hasLineOfSight() with no end
 * slack, EXCEPT the blocked stretch right at `from` is ignored: a front spot (where a client
 * picks / pays) often sits just inside a shelf's or counter's grown margin, and a check that
 * failed there rejected every spot of the line — every client then got the SAME spot, couldn't
 * reach it for the others crowding it, and circled forever (the "stuck clients" bug).
 */
function inSight(grid: StoreNavGrid, from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-6) {
        return true;
    }
    const step = grid.cellSize * 0.5;
    let leftStart = grid.isWalkableAt(from.x, from.z);
    for (let d = step; d <= length; d += step) {
        const walkable = grid.isWalkableAt(from.x + (dx * d) / length, from.z + (dz * d) / length);
        if (!leftStart) {
            leftStart = walkable;
            continue;
        }
        if (!walkable) {
            return false;
        }
    }
    return true;
}

/**
 * The allowed walkable cell nearest `from` that's in sight of it and clear of every taken spot —
 * relaxing spacing and reach step by step (RELAX_STEPS), then any free allowed cell in the store.
 * Always returns a spot nobody else has (unless the whole store is full, then one MIN_SPOT_GAP-ish
 * off `from`).
 */
function freeSpot(
    grid: StoreNavGrid,
    from: THREE.Vector3,
    spacing: number,
    taken: readonly THREE.Vector3[],
    allowed: (spot: THREE.Vector3) => boolean,
): THREE.Vector3 {
    for (const [factor, reach] of RELAX_STEPS) {
        const spot = nearestFree(grid, from, spacing * reach, (cell) => isFree(cell, taken, spacing * factor) && inSight(grid, from, cell), allowed);
        if (spot) {
            return spot;
        }
    }
    return nearestFree(grid, from, LAST_RESORT_REACH, cell => isFree(cell, taken, MIN_SPOT_GAP), allowed)
        ?? from.clone().add(new THREE.Vector3(MIN_SPOT_GAP, 0, 0));
}

function nearestFree(
    grid: StoreNavGrid,
    from: THREE.Vector3,
    reach: number,
    accept: (cell: THREE.Vector3) => boolean,
    allowed: (spot: THREE.Vector3) => boolean,
): THREE.Vector3 | undefined {
    let best: THREE.Vector3 | undefined;
    let bestDistSq = Infinity;
    for (const cell of grid.walkableCellsNear(from.x, from.z, reach)) {
        const distSq = cell.distanceToSquared(from);
        if (distSq >= bestDistSq || !allowed(cell) || !accept(cell)) {
            continue;
        }
        bestDistSq = distSq;
        best = cell;
    }
    return best;
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
