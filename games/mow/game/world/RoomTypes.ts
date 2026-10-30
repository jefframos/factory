// RoomTypes.ts
//
// The shapes pizza's room builders (PolyWallBuilder, CheckerFloorBuilder) take — the same definitions
// as pizza's WorldObjectRegistry/StoreViewTypes, kept here so dig doesn't carry pizza's store system.

/** World-space axis-aligned rect. */
export interface WorldRect {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface StoreWallOpening {
    kind: 'window' | 'door' | 'gap';
    rect: WorldRect;
    double?: boolean;
    high?: boolean;
    sliding?: boolean;
    /** Doors only: the opening goes the wall's full height. Wins over `high`. */
    fitToCeiling?: boolean;
    style?: string;
    /** Doors only: which way the door's front faces (world XZ unit vector). */
    facing?: { x: number; z: number };
}

export interface StoreWallPlacement {
    points: { x: number; z: number }[];
    closed: boolean;
    openings?: StoreWallOpening[];
    style?: string;
    setup?: string;
}

export interface StoreFloorPlacement {
    x: number;
    z: number;
    width: number;
    depth: number;
    rotationY: number;
    tileSize: number;
    style?: string;
}

export interface WallSetupConfig {
    name?: string;
    /** World units, from the floor up. */
    height: number;
    /** World units, centred on the drawn line. */
    thickness: number;
    doorHeight: number;
    tallDoorHeight: number;
    windowHeight: number;
}

export interface WallStyleConfig {
    name?: string;
    bottomColor: string;
    topColor: string;
    /** Where the bottom band ends, world units from the floor. */
    bottomHeight: number;
    bottomOpacity?: number;
    topOpacity?: number;
}

export interface FloorCheckerConfig {
    name?: string;
    colorA: string;
    colorB: string;
    /** Size of one checker square, in tiles. */
    scale: number;
}
