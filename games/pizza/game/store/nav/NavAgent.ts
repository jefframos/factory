// NavAgent.ts
//
// Walks one character along StoreNavGrid paths — the movement half of a
// StoreClient, kept separate so any future walker (a waiter, a seated
// diner getting up, ...) can reuse it. Owns nothing visual: it moves the
// `position` it's handed and reports which way it's heading, and the owner
// feeds that into CharacterBody for the walk animation.
//
// Each update():
//   1. (re)plans when the goal moved, the grid changed (rebuilt), every
//      REPLAN_SEC while walking (so it notices someone who just stopped in
//      the way), or when it got stuck. Standing neighbours add cost to the
//      cells around them, so paths bend around people waiting in line.
//   2. heads for the next waypoint, adding a separation push away from
//      nearby neighbours (stronger from standing ones), faded out close to
//      the final goal so arrival still lands exactly on the spot.
//   3. only takes a step that stays on walkable cells (tries the unsteered
//      direction, then each axis alone, to slide along obstacles). Standing
//      inside an obstacle's margin (a pick-up spot hugging a shelf), it only
//      walks straight along the path — which steps out the nearest way (see
//      StoreNavGrid.findPath()) — never steered or slid deeper in. Only the
//      final hop may end inside a margin (a goal hugging an obstacle).
// No path / off the grid / stuck for a while -> walks straight (fail-open:
// a client may clip something, but never freezes forever).

import * as THREE from 'three';
import StoreNavGrid from './StoreNavGrid';

/** Anything an agent steers around — other clients, the player. */
export interface NavNeighbor {
    readonly position: THREE.Vector3;
    /** Standing neighbours are routed around (path cost) as well as pushed away from. */
    isNavMoving(): boolean;
}

export interface NavAgentOptions {
    /** World units — personal space, also how far standing neighbours make cells costly. */
    radius: number;
    /** World units per second. */
    speed: number;
}

const ARRIVAL_EPSILON = 0.05;
/** Goal moves smaller than this don't trigger a replan. */
const GOAL_CHANGE_EPSILON = 0.15;
const REPLAN_SEC = 1.25;
/** Separation reaches this far (in radii) from a neighbour. */
const SEPARATION_RANGE_RADII = 3;
const SEPARATION_WEIGHT = 3;
/** A neighbour counts as "ahead" when the direction to it is within ~60 degrees of the heading. */
const AHEAD_DOT = 0.5;
const PASS_RIGHT_WEIGHT = 0.8;
const STANDING_SEPARATION_BOOST = 1.6;
/** Separation fades out within this distance of the final goal, so arrival lands exactly on the spot. Kept short: goals (queue/browse/wander spots) are already spaced beyond separation range, and a longer fade let two clients arriving at neighbouring spots walk into each other. */
const SEPARATION_FADE_DISTANCE = 0.35;
/** Path cost added to cells near a standing neighbour. */
const STANDING_CELL_COST = 6;
/** Checked once per STUCK_CHECK_SEC: moving less than this fraction of speed x time = stuck. */
const STUCK_CHECK_SEC = 0.75;
const STUCK_PROGRESS_FRACTION = 0.2;
/** After this many stuck checks in a row, stop respecting the grid until the next waypoint (each check also replans first). */
const STUCK_LIMIT = 5;

export default class NavAgent {
    public moveDirX = 0;
    public moveDirZ = 0;
    public isMoving = false;

    private readonly position: THREE.Vector3;
    private readonly getGrid: () => StoreNavGrid | undefined;
    private readonly radius: number;
    private speed: number;

    private readonly goal = new THREE.Vector3();
    private hasGoal = false;
    private arrived = true;
    private readonly path: THREE.Vector3[] = [];
    private pathIndex = 0;
    private plannedGrid?: StoreNavGrid;
    private needsPlan = false;
    private replanTimerSec = 0;
    private stuckTimerSec = 0;
    private stuckCount = 0;
    private ignoreGrid = false;
    private readonly stuckFrom = new THREE.Vector3();
    private neighbors: readonly NavNeighbor[] = [];

    public constructor(position: THREE.Vector3, getGrid: () => StoreNavGrid | undefined, options: NavAgentOptions) {
        this.position = position;
        this.getGrid = getGrid;
        this.radius = options.radius;
        this.speed = options.speed;
    }

    /** Walk to `point`. A goal within GOAL_CHANGE_EPSILON of the current one is ignored (no replan, arrival kept). */
    public setGoal(point: THREE.Vector3): void {
        if (this.hasGoal && this.goal.distanceTo(point) <= GOAL_CHANGE_EPSILON) {
            return;
        }
        this.goal.copy(point);
        this.hasGoal = true;
        this.arrived = false;
        this.needsPlan = true;
    }

    /** Changes the walk speed (world units per second) — e.g. a store worker levelling up. */
    public setSpeed(speed: number): void {
        this.speed = speed;
    }

    /** Stand still and forget the goal. */
    public stop(): void {
        this.hasGoal = false;
        this.arrived = true;
        this.isMoving = false;
        this.path.length = 0;
    }

    /** True once standing on the current goal (and while there's no goal at all). */
    public hasArrived(): boolean {
        return this.arrived;
    }

    public getGoal(): THREE.Vector3 | undefined {
        return this.hasGoal ? this.goal : undefined;
    }

    /** The remaining waypoints (debug drawing). */
    public getRemainingPath(): readonly THREE.Vector3[] {
        return this.path.slice(this.pathIndex);
    }

    /** One movement step. `neighbors` may include the owner itself — it's skipped by identity. */
    public update(delta: number, neighbors: readonly NavNeighbor[]): void {
        this.neighbors = neighbors;
        if (!this.hasGoal || this.arrived) {
            this.isMoving = false;
            return;
        }

        const grid = this.getGrid();
        this.replanTimerSec -= delta;
        if (this.needsPlan || grid !== this.plannedGrid || this.replanTimerSec <= 0) {
            this.plan(grid);
        }

        const step = this.speed * delta;
        let target = this.path[this.pathIndex] ?? this.goal;
        let distance = Math.hypot(target.x - this.position.x, target.z - this.position.z);
        // Within one step of a waypoint: move on to the next one this same frame (no stop-start at corners).
        while (distance <= Math.max(ARRIVAL_EPSILON, step) && this.pathIndex < this.path.length - 1) {
            this.pathIndex++;
            this.ignoreGrid = false;
            target = this.path[this.pathIndex];
            distance = Math.hypot(target.x - this.position.x, target.z - this.position.z);
        }
        if (this.pathIndex >= this.path.length - 1 && distance <= Math.max(ARRIVAL_EPSILON, step)) {
            this.position.x = this.goal.x;
            this.position.z = this.goal.z;
            this.arrived = true;
            this.isMoving = false;
            return;
        }

        const dirX = (target.x - this.position.x) / distance;
        const dirZ = (target.z - this.position.z) / distance;
        const [sepX, sepZ] = this.separation(dirX, dirZ);
        const fade = Math.min(1, this.position.distanceTo(this.goal) / SEPARATION_FADE_DISTANCE);
        let steerX = dirX + sepX * SEPARATION_WEIGHT * fade;
        let steerZ = dirZ + sepZ * SEPARATION_WEIGHT * fade;
        const steerLength = Math.hypot(steerX, steerZ);
        if (steerLength > 1e-4) {
            steerX /= steerLength;
            steerZ /= steerLength;
        } else {
            steerX = dirX;
            steerZ = dirZ;
        }

        // Steered step, else straight at the waypoint, else slide along one axis. If none fits, stay
        // put this frame — the stuck check replans, and eventually stops respecting the grid.
        const stride = Math.min(step, distance);
        const finalHop = this.pathIndex >= this.path.length - 1;
        if (grid && !this.ignoreGrid && !grid.isWalkableAt(this.position.x, this.position.z)) {
            // Inside an obstacle's margin: straight along the path only (it leads out the nearest way).
            this.move(dirX, dirZ, stride);
        } else {
            void (this.tryStep(grid, steerX, steerZ, stride, finalHop) || this.tryStep(grid, dirX, dirZ, stride, finalHop)
                || this.tryStep(grid, Math.sign(dirX), 0, stride * Math.abs(dirX), finalHop) || this.tryStep(grid, 0, Math.sign(dirZ), stride * Math.abs(dirZ), finalHop));
        }
        this.isMoving = true;
        this.updateStuck(delta);
    }

    private plan(grid: StoreNavGrid | undefined): void {
        this.needsPlan = false;
        this.plannedGrid = grid;
        this.replanTimerSec = REPLAN_SEC;
        this.pathIndex = 0;
        if (!grid || !grid.findPath(this.position, this.goal, this.path, this.standingCost)) {
            // No grid / no path: walk straight at the goal.
            this.path.length = 0;
            this.path.push(this.goal.clone());
        }
    }

    /** Cells near someone standing still cost more, so paths bend around people waiting. */
    private readonly standingCost = (x: number, z: number): number => {
        const reach = this.radius * 2.2;
        let cost = 0;
        for (const neighbor of this.neighbors) {
            if (neighbor.position === this.position || neighbor.isNavMoving()) {
                continue;
            }
            const dx = neighbor.position.x - x;
            const dz = neighbor.position.z - z;
            if (dx * dx + dz * dz < reach * reach) {
                cost += STANDING_CELL_COST;
            }
        }
        return cost;
    };

    /**
     * Push away from nearby neighbours, plus — for one roughly ahead — a sidestep to the right of
     * the heading (dirX, dirZ), so two clients meeting head-on both pass on the same side instead
     * of mirroring each other into a deadlock.
     */
    private separation(dirX: number, dirZ: number): [number, number] {
        const range = this.radius * SEPARATION_RANGE_RADII;
        let pushX = 0;
        let pushZ = 0;
        for (const neighbor of this.neighbors) {
            if (neighbor.position === this.position) {
                continue;
            }
            const dx = this.position.x - neighbor.position.x;
            const dz = this.position.z - neighbor.position.z;
            const distance = Math.hypot(dx, dz);
            if (distance >= range) {
                continue;
            }
            if (distance < 1e-4) {
                // Exactly on top of each other: any sideways nudge breaks the tie.
                pushX += -dirZ;
                pushZ += dirX;
                continue;
            }
            const closeness = (range - distance) / range;
            const weight = closeness * closeness * (neighbor.isNavMoving() ? 1 : STANDING_SEPARATION_BOOST);
            pushX += (dx / distance) * weight;
            pushZ += (dz / distance) * weight;
            // Neighbour in front (toward it = -d): sidestep right of the heading.
            const ahead = -(dx * dirX + dz * dirZ) / distance;
            if (ahead > AHEAD_DOT) {
                pushX += -dirZ * weight * PASS_RIGHT_WEIGHT * ahead;
                pushZ += dirX * weight * PASS_RIGHT_WEIGHT * ahead;
            }
        }
        return [pushX, pushZ];
    }

    /**
     * Moves `stride` along (dirX, dirZ) if the landing point is walkable — or the grid is being
     * ignored, or this is the final hop onto a goal that itself sits in an obstacle's margin (a
     * pick-up spot hugging a shelf, reached from its nearest walkable cell).
     */
    private tryStep(grid: StoreNavGrid | undefined, dirX: number, dirZ: number, stride: number, finalHop: boolean): boolean {
        if (stride <= 0 || (dirX === 0 && dirZ === 0)) {
            return false;
        }
        const nextX = this.position.x + dirX * stride;
        const nextZ = this.position.z + dirZ * stride;
        const free = !grid || this.ignoreGrid || grid.isWalkableAt(nextX, nextZ)
            || (finalHop && !grid.isWalkableAt(this.goal.x, this.goal.z));
        if (!free) {
            return false;
        }
        this.move(dirX, dirZ, stride);
        return true;
    }

    private move(dirX: number, dirZ: number, stride: number): void {
        if (stride <= 0 || (dirX === 0 && dirZ === 0)) {
            return;
        }
        this.position.x += dirX * stride;
        this.position.z += dirZ * stride;
        this.moveDirX = dirX;
        this.moveDirZ = dirZ;
    }

    private updateStuck(delta: number): void {
        this.stuckTimerSec += delta;
        if (this.stuckTimerSec < STUCK_CHECK_SEC) {
            return;
        }
        const progress = this.position.distanceTo(this.stuckFrom);
        this.stuckFrom.copy(this.position);
        this.stuckTimerSec = 0;
        if (progress >= this.speed * STUCK_CHECK_SEC * STUCK_PROGRESS_FRACTION) {
            this.stuckCount = 0;
            return;
        }
        this.stuckCount++;
        this.needsPlan = true;
        if (this.stuckCount >= STUCK_LIMIT) {
            this.ignoreGrid = true;
            this.stuckCount = 0;
        }
    }
}
