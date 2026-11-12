// RestaurantLayout.ts
//
// The restaurant's layout: levels/restaurant.json, in core/rooms' format (Dig's hub.json shape), edited in the
// restaurant's editor (`npm run editor`): floors, walls with their windows and doors (sliding glass doors open as
// customers come and go), and props, each limited to the stages it's there for (`from` / `until`: 0 the food truck, 1
// the small diner, 2 the diner, 3 the restaurant). Plus the restaurant's own:
//   - `stages`: their names;
//   - `customer`: the customers' way in (from outside, just in through the door; then the station's own spot);
//   - `stations`: where the food's made. A station (the burger one now; pizza, baking... later) is its pieces, each with a
//     role — counters, the cooktop, the pan, the plate, where a served plate goes, where the customer stands, the
//     ingredient piles, decoration — placed from the station's spot (x, z), and its camera shots: `order` (the customer
//     over the counter) and `bench` (the work top), each a position, a target and a field of view, framed for a
//     720 x 1080 screen.

import * as THREE from 'three';
import layoutJson from '../../levels/restaurant.json';
import { Room, RoomLayout, StageRange, shownAt } from 'core/rooms/Room';
import { kitchenModel } from './Models';
import type { Piece } from '../data/Recipes';

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

export interface StationLayout extends StageRange {
    id: string;
    kind: 'burger';
    name?: string;
    x: number;
    z: number;
    pieces: StationPiece[];
    cameras: { order: CameraShot; bench: CameraShot };
}

export interface RestaurantLayout extends RoomLayout {
    name: string;
    stages: string[];
    customer: { outside: Point; inside: Point };
    stations: StationLayout[];
}

export const LAYOUT_DATA = layoutJson as unknown as RestaurantLayout;

/** The screen the camera shots are framed for (wider shows more; narrower pulls back to keep the width). */
export const SHOT_ASPECT = 720 / 1080;

const toVector = ({ x, z }: Point): THREE.Vector3 => new THREE.Vector3(x, 0, z);

/** The customers' way in: from outside, in through the door (then to the station's customer spot). */
export const CUSTOMER_PATH = {
    outside: toVector(LAYOUT_DATA.customer.outside),
    inside: toVector(LAYOUT_DATA.customer.inside),
};

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
