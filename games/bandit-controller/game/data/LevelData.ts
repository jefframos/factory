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
    kind: 'door' | 'window';
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

export interface LevelData {
    id: string;
    name: string;
    grid: { cell: number };
    floor: { width: number; depth: number; colorA: string; colorB: string; checkerScale: number };
    start: LevelPoint;
    /** Checkpoints in order; the last one is the exit. */
    waypoints: LevelPoint[];
    entryPath?: { x: number; z: number; width: number; depth: number } | null;
    walls: LevelWall[];
    props: LevelProp[];
    loot: LevelLoot[];
}

export interface LevelDoor {
    x: number;
    z: number;
    halfWidth: number;
}

/** Doors in horizontal walls (opening wider along X) — the only ones the path assist can steer through. */
export function levelDoors(level: LevelData): LevelDoor[] {
    const doors: LevelDoor[] = [];
    for (const wall of level.walls) {
        for (const opening of wall.openings) {
            if (opening.kind === 'door' && opening.maxX - opening.minX >= opening.maxZ - opening.minZ) {
                doors.push({
                    x: (opening.minX + opening.maxX) / 2,
                    z: (opening.minZ + opening.maxZ) / 2,
                    halfWidth: (opening.maxX - opening.minX) / 2,
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
