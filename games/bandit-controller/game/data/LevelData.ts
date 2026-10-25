import type { LevelStyles } from './WorldStyles';
// LevelData.ts
//
// Data-driven description of a path level. Level files live in games/bandit-controller/levels/*.json
// and are edited with the web editor (`npm run level`). levels/index.json defines the progression order.
// All coordinates are world units on the XZ plane; `revealAt` N means "hidden until waypoint N is reached"
// (0 = visible from the start).

export interface LevelPoint {
    x: number;
    z: number;
}

export interface LevelOpening {
    kind: 'door' | 'window' | 'gap';
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface LevelWall {
    closed: boolean;
    points: LevelPoint[];
    openings: LevelOpening[];
}

export interface LevelCollider {
    halfX: number;
    halfY: number;
    halfZ: number;
}

export interface LevelProp {
    /** Path relative to public/bandit-controller/models/, e.g. heist/vault/vault.gltf */
    model: string;
    x: number;
    z: number;
    rotationY: number;
    height: number;
    collider?: LevelCollider | null;
    revealAt: number;
}

export interface LevelLoot {
    /** Path relative to public/bandit-controller/models/, e.g. resources/Gold_Nuggets.gltf */
    model: string;
    x: number;
    z: number;
    amount: number;
    scale: number;
    revealAt: number;
}

export interface LevelGuard {
    /** Patrol points; a single point makes a stationary guard. */
    path: LevelPoint[];
    /** true = walk the points as a circuit, false = walk there and back. */
    loop: boolean;
    /** Walking speed in world units per second. */
    speed: number;
    /** Seconds spent standing at every patrol point. */
    pause: number;
    /** Cone opening angle in degrees. */
    fov: number;
    /** Cone length in world units. */
    range: number;
    /** Degrees the guard looks left and right while standing still (0 = stares straight ahead). */
    sweep: number;
    /** Starting heading in degrees for single-point guards (0 = +Z, 180 = -Z, the direction the player runs). */
    facing: number;
}

/** A wall-mounted security camera: a cone that sweeps around `facing`; being seen by it busts the player. */
export interface LevelSecurityCamera {
    x: number;
    z: number;
    /** Centre heading in degrees (0 = +Z, 180 = -Z, 90 = +X, 270 = -X). */
    facing: number;
    /** Degrees swept left and right of `facing` (0 = fixed). */
    sweep: number;
    /** Seconds for one full left-right-left sweep. */
    period: number;
    fov: number;
    range: number;
}

/** A floor hazard (spike plate) that cycles: safe, a short warning flash, then armed. Stepping on it while armed busts instantly. */
export interface LevelTrap {
    x: number;
    z: number;
    width: number;
    depth: number;
    /** Seconds for one full safe + armed cycle. */
    period: number;
    /** Seconds per cycle the spikes stay up (at the end of the cycle). */
    active: number;
    /** Seconds added to the level clock, to desynchronise several traps. */
    offset: number;
}

/** A hovering patrol drone: no vision cone, it spots anything inside a round light beneath it, and walks its route back and forth. */
export interface LevelDrone {
    path: LevelPoint[];
    speed: number;
    /** Radius of the light disc in world units. */
    radius: number;
}

/** A shared finish room: when enabled, every squad member must reach it and each lines up on its own spot inside. */
export interface LevelSharedGoal {
    x: number;
    z: number;
    width: number;
    depth: number;
    /** Defaults to true; false falls back to each member's own goal. */
    enabled?: boolean;
}

export interface LevelSquadMember {
    /** Key of CHARACTER_VIEWS (e.g. blue, purple, orange); also colours the member's route and goal. */
    view: string;
    start: LevelPoint;
    /** Checkpoints in order; the last one is this member's goal. */
    waypoints: LevelPoint[];
}

export interface LevelData {
    id: string;
    name: string;
    /** Shows a looping finger from the player to the goal until the player draws a path. */
    tutorial?: boolean;
    grid: { cell: number };
    /** `rects` (optional) are the actual floor pieces for non-rectangular houses; width/depth stay the overall bounds. */
    floor: { width: number; depth: number; rects?: { x: number; z: number; width: number; depth: number }[] };
    /** Named shared styles (see ui/worldstyles.json). */
    styles?: LevelStyles;
    start: LevelPoint;
    /** Checkpoints in order; the last one is the exit. */
    waypoints: LevelPoint[];
    /** Several characters that must each reach their own goal. Replaces start/waypoints for play when present. */
    squad?: LevelSquadMember[];
    sharedGoal?: LevelSharedGoal;
    entryPath?: { x: number; z: number; width: number; depth: number } | null;
    walls: LevelWall[];
    props: LevelProp[];
    loot: LevelLoot[];
    guards?: LevelGuard[];
    cameras?: LevelSecurityCamera[];
    traps?: LevelTrap[];
    drones?: LevelDrone[];
}

/** Shared finish areas replace final destination disks, but not intermediate checkpoints. */
export function shouldShowWaypointMarker(level: LevelData, waypointIndex: number, waypointCount: number): boolean {
    const sharedFinish = level.sharedGoal && level.sharedGoal.enabled !== false && (level.squad?.length ?? 0) > 1;
    return !sharedFinish || waypointIndex < waypointCount - 1;
}

export interface LevelDoor {
    x: number;
    z: number;
    halfWidth: number;
    alongX: boolean;
}

/** Door centres and their opening direction, shared by horizontal and vertical walls. */
export function levelDoors(level: LevelData): LevelDoor[] {
    const doors: LevelDoor[] = [];
    for (const wall of level.walls) {
        for (const opening of wall.openings) {
            if (opening.kind === 'door') {
                const alongX = opening.maxX - opening.minX >= opening.maxZ - opening.minZ;
                doors.push({
                    x: (opening.minX + opening.maxX) / 2,
                    z: (opening.minZ + opening.maxZ) / 2,
                    halfWidth: (alongX ? opening.maxX - opening.minX : opening.maxZ - opening.minZ) / 2,
                    alongX,
                });
            }
        }
    }
    return doors;
}

export interface LevelWindowPane {
    x: number;
    z: number;
    rotationY: number;
    width: number;
}

export function levelWindowPanes(level: LevelData): LevelWindowPane[] {
    const panes: LevelWindowPane[] = [];
    for (const wall of level.walls) {
        for (const opening of wall.openings) {
            if (opening.kind !== 'window') {
                continue;
            }
            const alongX = opening.maxX - opening.minX >= opening.maxZ - opening.minZ;
            panes.push({
                x: (opening.minX + opening.maxX) / 2,
                z: (opening.minZ + opening.maxZ) / 2,
                rotationY: alongX ? 0 : Math.PI / 2,
                width: alongX ? opening.maxX - opening.minX : opening.maxZ - opening.minZ,
            });
        }
    }
    return panes;
}
