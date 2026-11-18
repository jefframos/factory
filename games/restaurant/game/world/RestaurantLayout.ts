// RestaurantLayout.ts
//
// The restaurant's layout: levels/restaurant.json, in core/rooms' format (Dig's hub.json shape), edited in the
// restaurant's editor (`npm run editor`): floors, walls with their windows and doors (sliding glass doors open as
// customers come and go), and props, each limited to the stages it's there for (`from` / `until`: 0 the food truck, 1
// the small diner, 2 the diner, 3 the restaurant). Plus the restaurant's own:
//   - `stages`: their names;
//   - `customer`: the customers' way in (from the street, outside the door, just in through it; then the station's own
//     spot). Each station can have its own (`customer` on it: the food truck's and the diner's doors aren't the same);
//     the level's is the fallback;
//   - `stations`: where the food's made. A station (the burger one now; pizza, baking... later) is its pieces, each with a
//     role — counters, the cooktop, the pan, the plate, where a served plate goes, where the customer stands, the
//     ingredient piles, decoration — placed from the station's spot (x, z), and its camera shots: `order` (the customer
//     over the counter) and `bench` (the work top), each a position, a target and a field of view, framed for a
//     720 x 1080 screen.
//   - `seats`: where seated customers sit (a stage served 'seated': settings.json stages[].service) — each a spot, the way
//     they face (toward their table), their sitting height, and `plate`: where their plate goes on the table (it stays
//     there, dirty, until the player clears it).
//   - the street round it (core/town, UFO's city pieces; settings.json town: the kit, the cars, the people's look):
//     `roads` (road cells on the kit's tile grid), `traffic.count` (cars driving them), `lawns` (grass polygons) and
//     `people` (areas, each filled with `count` people wandering about). Each can be limited to stages too.

import * as THREE from 'three';
import layoutJson from '../../levels/restaurant.json';
import prefabsJson from '../../levels/prefabs.json';
import { LayoutOpening, LayoutProp, Room, RoomLayout, StageRange, shownAt } from 'core/rooms/Room';
import { kitchenModel } from './Models';
import { blockModels, blockProps } from './CityBlocks';
import type { BlockFill } from '../../web/public/cityfill.js';
import type { Piece } from '../data/Recipes';
import type { RoadCells } from 'core/roads/RoadGrid';
import type { LawnShape } from 'core/town/Ground';
import type { CrowdArea, CrowdPaths } from 'core/town/Crowd';

type Point = { x: number; z: number };
type Point3 = { x: number; y: number; z: number };

export type PieceRole = 'counter' | 'stove' | 'pan' | 'plate' | 'served' | 'customer' | 'pile' | 'piles' | 'decor';

export interface StationPiece {
    role: PieceRole;
    /** The model (counters, the cooktop, decoration). */
    model?: string;
    /** A pile's ingredient. */
    piece?: Piece;
    /**
     * `piles`: a grid of piles, one for each thing the stage's kitchen has (buns, patties, the stage's toppings), round
     * this spot: `columns` across, `gapX` / `gapZ` apart (Kitchen.ts pileGrid).
     */
    columns?: number;
    gapX?: number;
    gapZ?: number;
    x: number;
    z: number;
    rotationY?: number;
}

export interface CameraShot {
    position: Point3;
    target: Point3;
    /** Vertical field of view (degrees). */
    fov: number;
}

/** The customers' way in: where they come from (`start`, off in the street), outside the door, just in. */
export interface WayIn {
    start?: Point;
    outside: Point;
    inside: Point;
}

export interface StationLayout extends StageRange {
    id: string;
    kind: 'burger';
    name?: string;
    x: number;
    z: number;
    pieces: StationPiece[];
    cameras: { order: CameraShot; bench: CameraShot };
    /** Its customers' way in (unset: the level's `customer`). */
    customer?: WayIn;
}

/** A seat for a seated customer: where they sit, facing `rotationY` (toward their table), at `height` (the seat's top), and
 *  where their plate goes (`plate`: on the table in front; `y` its top). */
export interface SeatLayout extends StageRange {
    id?: string;
    /** The editor's group it moves with (its table's); the game ignores it. */
    group?: string;
    x: number;
    z: number;
    rotationY: number;
    height?: number;
    plate: { x: number; z: number; y?: number };
}

export interface RestaurantLayout extends RoomLayout {
    name: string;
    stages: string[];
    /** The customers' way in, for a station without its own. */
    customer: WayIn;
    stations: StationLayout[];
    seats?: SeatLayout[];
    /** Prefabs placed (levels/prefabs.json: stations, table sets): unfolded into props and seats when it's read. */
    instances?: PrefabInstance[];
    /** The street: road cells, the cars on them, lawns, and areas of people (all optional). */
    /** Road cells; `origin`: where cell (0, 0)'s middle is (the grid lines up with the rest of the street). */
    roads?: RoadCells & { origin?: { x: number; z: number } };
    traffic?: { count: number };
    /** Lawns; one with `buildings` is a city block, filled with buildings along its sides (CityBlocks.ts). */
    lawns?: (LawnShape & StageRange & { buildings?: BlockFill; water?: boolean })[];
    /** People: areas they wander, and walkers on paths (waypoints, links; they wait at the kerb for cars). */
    people?: { areas: (CrowdArea & StageRange)[]; paths?: CrowdPaths };
}

/**
 * A prefab (levels/prefabs.json, shared by every level): a station or a table set made once — its props and seats,
 * placed round its own middle (its front: +z) — and placed in a level as many times as wanted (`instances`: which one,
 * where, turned how, at which stages). Editing it (the editor: unpack one, change it, save it as the prefab again)
 * changes it everywhere. What a station has on it (its ingredients) isn't in it: that's the stage's (settings.json), laid
 * out in the station's grids — the same prefab shows more at a bigger stage.
 */
export interface PrefabDef {
    name?: string;
    props: LayoutProp[];
    seats?: SeatLayout[];
}

export interface PrefabInstance extends StageRange {
    prefab: string;
    x: number;
    z: number;
    rotationY?: number;
}

/** `layout` with its prefab instances unfolded into plain props and seats (turned, moved, at the instance's stages). */
export function expandPrefabs<T extends RoomLayout & { seats?: SeatLayout[]; instances?: PrefabInstance[] }>(layout: T, prefabs: Record<string, PrefabDef>): T {
    const props = [...layout.props];
    const seats = [...(layout.seats ?? [])];
    for (const instance of layout.instances ?? []) {
        const prefab = prefabs[instance.prefab];
        if (!prefab) {
            console.warn(`[Restaurant] no prefab "${instance.prefab}"`);
            continue;
        }
        const turn = instance.rotationY ?? 0;
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        // Turned round y as three.js turns things (rotation.y), then moved to the instance's spot.
        const place = (x: number, z: number) => ({ x: instance.x + x * cos + z * sin, z: instance.z - x * sin + z * cos });
        const range = { ...(instance.from !== undefined ? { from: instance.from } : {}), ...(instance.until !== undefined ? { until: instance.until } : {}) };
        for (const prop of prefab.props) props.push({ ...prop, ...place(prop.x, prop.z), rotationY: (prop.rotationY ?? 0) + turn, ...range });
        for (const seat of prefab.seats ?? []) {
            seats.push({ ...seat, ...place(seat.x, seat.z), rotationY: seat.rotationY + turn, plate: { ...seat.plate, ...place(seat.plate.x, seat.plate.z) }, ...range });
        }
    }
    return { ...layout, props, seats };
}

export const PREFABS = (prefabsJson as unknown as { prefabs: Record<string, PrefabDef> }).prefabs ?? {};
/** The level, its prefab instances unfolded (everything below — the room, the stations, the seats — reads this). */
export const LAYOUT_DATA = expandPrefabs(layoutJson as unknown as RestaurantLayout, PREFABS);

/** The screen the camera shots are framed for (wider shows more; narrower pulls back to keep the width). */
export const SHOT_ASPECT = 720 / 1080;

const toVector = ({ x, z }: Point): THREE.Vector3 => new THREE.Vector3(x, 0, z);

/** Without a start point, customers come from this far on past "outside" (away from the door). */
const START_DISTANCE = 6;

export interface CustomerPath {
    start: THREE.Vector3;
    outside: THREE.Vector3;
    inside: THREE.Vector3;
}

/**
 * The customers' way in at stage `stage` (its station's own, else the level's): from their start (off in the street), to
 * outside the door, in through it (then to the station's customer spot).
 */
export function customerPath(stage: number): CustomerPath {
    const station = LAYOUT_DATA.stations.find((s) => shownAt(s, stage, LAYOUT_DATA.areas ?? []));
    const way = station?.customer ?? LAYOUT_DATA.customer;
    const outside = toVector(way.outside);
    const inside = toVector(way.inside);
    const start = way.start ? toVector(way.start) : outside.clone().addScaledVector(outside.clone().sub(inside).setY(0).normalize(), START_DISTANCE);
    return { start, outside, inside };
}

/** The station of `kind` at stage `stage`. */
export function stationAt(stage: number, kind: StationLayout['kind'] = 'burger'): StationLayout {
    const station = LAYOUT_DATA.stations.find((s) => s.kind === kind && shownAt(s, stage, LAYOUT_DATA.areas ?? []));
    if (!station) throw new Error(`No ${kind} station at stage ${stage}`);
    return station;
}

/** The models stage `stage`'s props and stations use (to load before building it). */
export function roomModels(stage: number): string[] {
    return [...new Set([...propAndPieceModels(stage), ...blockModels(stage)])];
}

function propAndPieceModels(stage: number): string[] {
    const areas = LAYOUT_DATA.areas ?? [];
    const props = LAYOUT_DATA.props.filter((p) => shownAt(p, stage, areas)).map((p) => p.model);
    const pieces = LAYOUT_DATA.stations.filter((s) => shownAt(s, stage, areas)).flatMap((s) => s.pieces.map((p) => p.model ?? ''));
    return [...new Set([...props, ...pieces].filter(Boolean))];
}

/** The room at `stage` (its models loaded: roomModels). */
/** The room at `stage` (its models loaded: roomModels), its city blocks filled with buildings (CityBlocks.ts). */
export const buildRoom = (stage: number, extra?: { wall: number; opening: LayoutOpening }[]): Room => {
    // `extra`: openings cut for this build only (the phone orders' window behind the pizza station), wall by its index.
    const walls = extra?.length
        ? LAYOUT_DATA.walls.map((wall, i) => {
            const cut = extra.filter((e) => e.wall === i).map((e) => e.opening);
            return cut.length ? { ...wall, openings: [...(wall.openings ?? []), ...cut] } : wall;
        })
        : LAYOUT_DATA.walls;
    return new Room({ ...LAYOUT_DATA, walls, props: [...LAYOUT_DATA.props, ...blockProps(stage)] }, stage, { instantiate: (model) => kitchenModel(model) });
};

/**
 * Where a ray along the floor from `from` (going `direction`) first meets a wall shown at `stage`: the wall's index, the
 * point, the side it's on (the segment's direction); null if it meets none within `reach`.
 */
export function wallAhead(stage: number, from: Point, direction: Point, reach = 12): { wall: number; at: Point; along: Point } | null {
    let best: { wall: number; at: Point; along: Point; t: number } | null = null;
    LAYOUT_DATA.walls.forEach((wall, i) => {
        if (!shownAt(wall, stage, LAYOUT_DATA.areas ?? [])) return;
        const points = wall.points;
        const count = wall.closed ? points.length : points.length - 1;
        for (let k = 0; k < count; k++) {
            const a = points[k];
            const b = points[(k + 1) % points.length];
            const ex = b.x - a.x, ez = b.z - a.z;
            const denominator = direction.x * ez - direction.z * ex;
            if (Math.abs(denominator) < 1e-6) continue;
            const t = ((a.x - from.x) * ez - (a.z - from.z) * ex) / denominator;
            const u = ((a.x - from.x) * direction.z - (a.z - from.z) * direction.x) / denominator;
            if (t <= 0 || t > reach || u < 0 || u > 1) continue;
            if (!best || t < best.t) {
                const length = Math.hypot(ex, ez) || 1;
                best = { wall: i, at: { x: from.x + direction.x * t, z: from.z + direction.z * t }, along: { x: ex / length, z: ez / length }, t };
            }
        }
    });
    const found = best as { wall: number; at: Point; along: Point; t: number } | null;
    return found ? { wall: found.wall, at: found.at, along: found.along } : null;
}

/** The ice cream machine's model (KayKit's, imported from the library): a prop of it makes the ice cream station. */
export const ICE_CREAM_MACHINE = /icecream[-_]machine/i;

/** Whether stage `stage`'s room has the ice cream machine (its customers can order ice cream). */
export function hasIceCreamMachine(stage: number): boolean {
    return LAYOUT_DATA.props.some((p) => ICE_CREAM_MACHINE.test(p.model) && shownAt(p, stage, LAYOUT_DATA.areas ?? []));
}

/**
 * The pizza oven's model (KayKit's pizza_oven): a prop of it makes the pizza station. The pizza's made on the prop whose
 * id is PIZZA_BOARD (a cutting board, say); without one, on a board beside the oven (world/Pizza.ts).
 */
export const PIZZA_OVEN = /pizza[-_]?oven/i;
export const PIZZA_BOARD = 'pizzaBoard';

/** Whether stage `stage`'s room has a pizza oven (its customers can order pizza). */
export function hasPizzaOven(stage: number): boolean {
    return LAYOUT_DATA.props.some((p) => PIZZA_OVEN.test(p.model) && shownAt(p, stage, LAYOUT_DATA.areas ?? []));
}

/**
 * The sundae bar: the prop whose id is SUNDAE_FREEZER (any model — a big table, say — as big as the freezer it's drawn
 * as: the game builds the freezer there, its six tubs set in its top) and the one whose id is SUNDAE_BAR (where the cones,
 * bowls, sauces and toppings are and the sundae's made: world/Sundae.ts).
 */
export const SUNDAE_FREEZER = 'sundaeFreezer';
export const SUNDAE_BAR = 'sundaeBar';

/** Whether stage `stage`'s room has the sundae bar (both its props). */
export function hasSundaeBar(stage: number): boolean {
    const shown = (id: string) => LAYOUT_DATA.props.some((p) => p.id === id && shownAt(p, stage, LAYOUT_DATA.areas ?? []));
    return shown(SUNDAE_FREEZER) && shown(SUNDAE_BAR);
}

/** The seats at `stage` (the first `limit` of them, if given: a stage's first day can use fewer). */
export function seatsAt(stage: number, limit?: number): SeatLayout[] {
    const seats = (LAYOUT_DATA.seats ?? []).filter((s) => shownAt(s, stage, LAYOUT_DATA.areas ?? []));
    return limit !== undefined ? seats.slice(0, limit) : seats;
}
