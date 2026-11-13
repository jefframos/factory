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
import { Room, RoomLayout, StageRange, shownAt } from 'core/rooms/Room';
import { kitchenModel } from './Models';
import type { Piece } from '../data/Recipes';
import type { RoadCells } from 'core/roads/RoadGrid';
import type { LawnShape } from 'core/town/Ground';
import type { CrowdArea, CrowdPaths } from 'core/town/Crowd';

type Point = { x: number; z: number };
type Point3 = { x: number; y: number; z: number };

export type PieceRole = 'counter' | 'stove' | 'pan' | 'plate' | 'served' | 'customer' | 'pile' | 'decor';

export interface StationPiece {
    role: PieceRole;
    /** The model (counters, the cooktop, decoration). */
    model?: string;
    /** A pile's ingredient. */
    piece?: Piece;
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
    /** The street: road cells, the cars on them, lawns, and areas of people (all optional). */
    /** Road cells; `origin`: where cell (0, 0)'s middle is (the grid lines up with the rest of the street). */
    roads?: RoadCells & { origin?: { x: number; z: number } };
    traffic?: { count: number };
    lawns?: (LawnShape & StageRange)[];
    /** People: areas they wander, and walkers on paths (waypoints, links; they wait at the kerb for cars). */
    people?: { areas: (CrowdArea & StageRange)[]; paths?: CrowdPaths };
}

export const LAYOUT_DATA = layoutJson as unknown as RestaurantLayout;

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
    const areas = LAYOUT_DATA.areas ?? [];
    const props = LAYOUT_DATA.props.filter((p) => shownAt(p, stage, areas)).map((p) => p.model);
    const pieces = LAYOUT_DATA.stations.filter((s) => shownAt(s, stage, areas)).flatMap((s) => s.pieces.map((p) => p.model ?? ''));
    return [...new Set([...props, ...pieces].filter(Boolean))];
}

/** The room at `stage` (its models loaded: roomModels). */
export const buildRoom = (stage: number): Room => new Room(LAYOUT_DATA, stage, { instantiate: (model) => kitchenModel(model) });

/** The ice cream machine's model (KayKit's, imported from the library): a prop of it makes the ice cream station. */
export const ICE_CREAM_MACHINE = /icecream[-_]machine/i;

/** Whether stage `stage`'s room has the ice cream machine (its customers can order ice cream). */
export function hasIceCreamMachine(stage: number): boolean {
    return LAYOUT_DATA.props.some((p) => ICE_CREAM_MACHINE.test(p.model) && shownAt(p, stage, LAYOUT_DATA.areas ?? []));
}

/** The seats at `stage` (the first `limit` of them, if given: a stage's first day can use fewer). */
export function seatsAt(stage: number, limit?: number): SeatLayout[] {
    const seats = (LAYOUT_DATA.seats ?? []).filter((s) => shownAt(s, stage, LAYOUT_DATA.areas ?? []));
    return limit !== undefined ? seats.slice(0, limit) : seats;
}
