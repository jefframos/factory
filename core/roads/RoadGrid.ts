// RoadGrid.ts
//
// Roads painted on a grid of square tiles: a level keeps only which cells are road (RoadCells); the pieces and the
// way cars drive them both come from that.
//   solveRoads()   — each cell's piece and turn, from which of its four neighbours are road too: a kit (RoadKit) lists
//                    pieces by the sides they're open on (as modelled, unturned), and the first one that fits the
//                    cell's neighbours, turned in quarter turns, is used (so a kit lists its pieces in the order it
//                    prefers them). A cell can ask for one of its piece's variants (a crossing, a stop line …).
//   roadNetwork()  — a waypoint per cell, linked to the road cells next to it: what Traffic drives (no hand-made
//                    waypoints, never out of step with the road).
// Sides: n = -Z, e = +X, s = +Z, w = -X (three.js: a model's front faces +Z). A cell (i, j) is centred at
// (i * tile, j * tile). Plain data in, plain data out: the game and the editor share it.

export type RoadSide = 'n' | 'e' | 's' | 'w';

/** A cell: its column and row, and (optional) which of its piece's variants. */
export type RoadCell = [number, number] | [number, number, number];

/** The roads in a level: their cells. */
export interface RoadCells {
    cells: RoadCell[];
}

export interface RoadPieceDef {
    /** The sides it's open on, as modelled (unturned). */
    open: RoadSide[];
    /** The model, then its variants (a cell's third number picks one). */
    models: string[];
}

export interface RoadKit {
    /** A tile's size (world units): the models are this square. */
    tile: number;
    /** Pieces in order of preference; a cell gets the first that fits. */
    pieces: RoadPieceDef[];
}

export interface PlacedRoad {
    i: number;
    j: number;
    x: number;
    z: number;
    model: string;
    /** Turn about Y (radians, three.js: counter-clockwise seen from above). */
    rotationY: number;
    /** Variants the cell's piece has (the editor cycles through them). */
    variants: number;
}

const SIDES: RoadSide[] = ['n', 'e', 's', 'w'];
const STEP: Record<RoadSide, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
/** A quarter turn (rotationY + PI / 2) takes a side here. */
const QUARTER: Record<RoadSide, RoadSide> = { n: 'w', w: 's', s: 'e', e: 'n' };

export const roadCellKey = (i: number, j: number): string => `${i},${j}`;
/** A cell's waypoint id (roadNetwork()). */
export const roadWaypointId = (i: number, j: number): string => `r${i}_${j}`;

/** The cell (i, j) at world (x, z). */
export function roadCellAt(x: number, z: number, tile: number): [number, number] {
    return [Math.round(x / tile), Math.round(z / tile)];
}

/** The sides of (i, j) with road next to them. */
function openSides(i: number, j: number, cells: Set<string>): Set<RoadSide> {
    return new Set(SIDES.filter((side) => cells.has(roadCellKey(i + STEP[side][0], j + STEP[side][1]))));
}

/** The piece and quarter turns that fit `sides` exactly, else the nearest (most sides shared, none open to nothing). */
function fit(sides: Set<RoadSide>, kit: RoadKit): { piece: RoadPieceDef; turns: number } | undefined {
    let best: { piece: RoadPieceDef; turns: number; score: number } | undefined;
    for (const piece of kit.pieces) {
        for (let turns = 0; turns < 4; turns++) {
            const turned = piece.open.map((side) => {
                for (let k = 0; k < turns; k++) side = QUARTER[side];
                return side;
            });
            const shared = turned.filter((side) => sides.has(side)).length;
            if (shared === sides.size && turned.length === sides.size) return { piece, turns };
            // A lone cell, or a shape the kit lacks: the piece sharing the most sides, the fewest open to nothing.
            const score = shared * 10 - (turned.length - shared);
            if (!best || score > best.score) best = { piece, turns, score };
        }
    }
    return best;
}

export function solveRoads(roads: RoadCells | undefined, kit: RoadKit): PlacedRoad[] {
    if (!roads?.cells.length || !kit.pieces.length) return [];
    const cells = new Set(roads.cells.map(([i, j]) => roadCellKey(i, j)));
    const seen = new Set<string>();
    const out: PlacedRoad[] = [];
    for (const [i, j, variant = 0] of roads.cells) {
        const key = roadCellKey(i, j);
        if (seen.has(key)) continue;
        seen.add(key);
        const fitted = fit(openSides(i, j, cells), kit);
        if (!fitted) continue;
        const { models } = fitted.piece;
        out.push({
            i, j, x: i * kit.tile, z: j * kit.tile, model: models[((variant % models.length) + models.length) % models.length],
            rotationY: (fitted.turns * Math.PI) / 2, variants: models.length,
        });
    }
    return out;
}

/** A waypoint per road cell, linked (once each way) to the road cells beside it. */
export function roadNetwork(roads: RoadCells | undefined, tile: number): { waypoints: { id: string; x: number; z: number }[]; links: [string, string][] } {
    const cells = new Map<string, [number, number]>();
    for (const [i, j] of roads?.cells ?? []) cells.set(roadCellKey(i, j), [i, j]);
    const waypoints = [...cells.values()].map(([i, j]) => ({ id: roadWaypointId(i, j), x: i * tile, z: j * tile }));
    const links: [string, string][] = [];
    for (const [i, j] of cells.values()) {
        // East and south only: each link once.
        for (const side of ['e', 's'] as const) {
            const [di, dj] = STEP[side];
            if (cells.has(roadCellKey(i + di, j + dj))) links.push([roadWaypointId(i, j), roadWaypointId(i + di, j + dj)]);
        }
    }
    return { waypoints, links };
}
