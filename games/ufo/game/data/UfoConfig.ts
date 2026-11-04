// UfoConfig.ts
//
// The game's settings (ui/ufo.json: the editor's UFO tab) and its levels (levels/*.json: the editor's Town tab, in the
// shape the shared world editor saves). `?city=<level>` plays another level, which is what the editor's ▶ Play opens.

import { RoadCells, RoadKit, roadNetwork, solveRoads } from 'core/roads/RoadGrid';
import data from '../../ui/ufo.json';

export interface Point {
    x: number;
    z: number;
}

export interface Prop {
    model: string;
    x: number;
    z: number;
    rotationY: number;
    height: number;
    elevation?: number;
    stretch?: { x: number; z: number };
    collider?: { halfX: number; halfZ: number } | null;
}

export interface Pavement extends Point {
    id: string;
    width: number;
    depth: number;
    color: string;
}

export interface Island {
    water: string;
    waterLevel: number;
    margin: number;
    sideColor: string;
    sideDepth: number;
    outline?: Point[];
    cornerRadius?: number;
    deck?: { width: number; color: string };
    fence?: { color: string; height: number; inset: number; spacing: number };
}

export interface ColliderCube extends Point {
    width: number;
    depth: number;
    solid?: boolean;
    /** How tall it is, for flying over it (`SOLID_CUBE_HEIGHT` without one). */
    height?: number;
}

export interface Traffic {
    waypoints: (Point & { id: string })[];
    links: [string, string][];
    cars: { at: string; model?: string }[];
}

/** Where people hang around: cast on what's under it, roofs included. */
export interface PeopleArea extends Point {
    width: number;
    depth: number;
    count: number;
}

/** The level's people: wander areas, and the street paths walkers follow. */
export interface LevelPeople {
    areas?: PeopleArea[];
    waypoints?: (Point & { id: string })[];
    links?: [string, string][];
    walkers?: number;
}

export interface Level {
    name?: string;
    ground: Point & { width: number; depth: number; color: string };
    island?: Island;
    start: Point;
    pavements: Pavement[];
    props: Prop[];
    colliders?: ColliderCube[];
    traffic?: Traffic;
    roads?: RoadCells;
    people?: LevelPeople;
}

export interface UfoSettings {
    startRadius: number;
    speed: number;
    speedPerRadius: number;
    accel: number;
    altitudeBase: number;
    altitudePerRadius: number;
    growth: number;
    valuePower: number;
    growSpeed: number;
    collideShare: number;
}

export interface CameraSettings {
    pitchDeg: number;
    fov: number;
    distance: number;
    perAltitude: number;
    followSpeed: number;
    zoomSpeed: number;
    /** The world's curve: how far it drops per unit² from the camera's focus. */
    bend: number;
}

export interface TrafficSettings {
    models: string[];
    speed: number;
    accel: number;
    brake: number;
    length: number;
    lane: number;
    tile: number;
    roadY: number;
    gap: number;
}

/** The colours a person's parts are drawn from. */
export interface PeoplePalette {
    skin: string[];
    top: string[];
    bottom: string[];
    shoes: string[];
    hair: string[];
}

export interface PeopleSettings {
    models: string[];
    /** Their walk and idle. */
    animations: string;
    palette: PeoplePalette;
    count: number;
    speed: number;
    height: number;
    /** How far away they pick their next spot. */
    wander: number;
    /** How long they stand around between walks (seconds). */
    pauseMin: number;
    pauseMax: number;
}

interface Design {
    ufo: UfoSettings;
    people: PeopleSettings;
    camera: CameraSettings;
    traffic: TrafficSettings;
    roadKit?: RoadKit & { elevation: number; roadY: number };
}

export const DESIGN = data as unknown as Design;
/** Live: the debug panel changes them while playing. */
export const UFO = DESIGN.ufo;
export const CAMERA = DESIGN.camera;

export const MODEL_BASE = './ufo/models/';
/** Props lower than this are ground (road tiles): flown over, never eaten. */
export const FLAT_HEIGHT = 0.3;
/** A solid collider cube with no height of its own: taller than the saucer flies for most of the game. */
export const SOLID_CUBE_HEIGHT = 12;
/** A prop at least this wide each way (its collider's half size) is something people can stand on: a building, not a tree. */
export const ROOF_MIN_HALF = 1.5;

const LEVELS = import.meta.glob<{ default: Level }>('../../levels/*.json', { eager: true });

/** A level with its road cells laid: their pieces as flat props, their network as the traffic's. */
function withRoads(level: Level): Level {
    const kit = DESIGN.roadKit;
    if (!level.roads?.cells.length || !kit) return level;
    const pieces: Prop[] = solveRoads(level.roads, kit).map((road) => ({
        model: road.model, x: road.x, z: road.z, rotationY: road.rotationY, height: 0.2, elevation: kit.elevation, collider: null,
    }));
    return { ...level, props: [...pieces, ...level.props], traffic: { ...roadNetwork(level.roads, kit.tile), cars: level.traffic?.cars ?? [] } };
}

/** The level asked for in the address (`?city=`), else the town. */
export function currentLevel(): Level {
    const name = new URLSearchParams(window.location.search).get('city') ?? 'town';
    return withRoads((LEVELS[`../../levels/${name}.json`] ?? LEVELS['../../levels/town.json']).default);
}

/** How high a saucer of this radius flies: what's taller blocks it. */
export const altitudeFor = (radius: number): number => Math.max(0.5, UFO.altitudeBase + UFO.altitudePerRadius * radius);
