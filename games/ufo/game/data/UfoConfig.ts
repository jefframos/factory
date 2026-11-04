// UfoConfig.ts
//
// The game's settings (ui/ufo.json: the editor's UFO tab) and its levels (levels/*.json: the editor's Town tab, in the
// shape the shared world editor saves). `?city=<level>` plays another level, which is what the editor's ▶ Play opens.

import { RoadCells, RoadKit, roadNetwork, solveRoads } from 'core/roads/RoadGrid';
import type { Piece } from 'core/pieces/Pieces';
import data from '../../ui/ufo.json';
import saucers from '../../ui/saucers.json';

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
    deck?: { width: number; color: string; pilingColor?: string; pilingSpacing?: number };
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

/** What finishes a level: eating this one prop. It's far too big to fit the usual way, so it has a size of its own to reach. */
export interface LevelGoal {
    model: string;
    /** How big the saucer has to be to eat it (its radius). */
    radius: number;
    name: string;
}

/** A looping sound over a box on the ground (SpatialAudio.ts). */
export interface SoundZone extends Point {
    id: string;
    /** The file in raw-assets/audio, without its extension. */
    sound: string;
    width: number;
    depth: number;
    /** How far out from its edges it fades to nothing. */
    fade: number;
    volume: number;
}

/** A soundtrack: a file in raw-assets/audio, without its extension, and its volume (0-1). */
export interface MusicDef {
    sound: string;
    volume: number;
}

export interface SoundSettings {
    /** Each car's engine: `volume` within `near` of it, nothing from `far`. */
    cars: { volume: number; near: number; far: number };
    /** This level's soundtrack, instead of ui/ufo.json's. */
    music?: MusicDef;
}

export interface Level {
    name?: string;
    /** The level (file name) after this one. */
    next?: string;
    /** Without one, a level's finished when everything's eaten. */
    goal?: LevelGoal;
    ground: Point & { width: number; depth: number; color: string };
    island?: Island;
    start: Point;
    pavements: Pavement[];
    props: Prop[];
    colliders?: ColliderCube[];
    traffic?: Traffic;
    roads?: RoadCells;
    people?: LevelPeople;
    sounds?: SoundZone[];
    soundSettings?: SoundSettings;
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
    /** How far past the shore it can fly. */
    waterMargin: number;
}

export interface CameraSettings {
    pitchDeg: number;
    /** It looks down more steeply as the saucer grows: this pitch, once it's `endPitchRadius` wide. */
    endPitchDeg: number;
    endPitchRadius: number;
    fov: number;
    distance: number;
    perAltitude: number;
    /** It pulls back further when the saucer would take more than this share of the screen's narrower side. */
    maxShare: number;
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

export interface SaucerSettings {
    model: string;
    /** Its base colour textures (tools/build-saucer.mjs), for the styles to choose from. */
    skins: string[];
}

/** A transform, in saucer units (the disc's radius is 1). */
export type SeatTransform = Pick<Piece, 'x' | 'y' | 'z' | 'rx' | 'ry' | 'rz' | 'sx' | 'sy' | 'sz'>;

export interface UfoStyle {
    id: string;
    name: string;
    skin: string;
    domeColor: string;
    domeOpacity: number;
    /** Its side and bottom guns; off without this. */
    guns?: boolean;
    seat: SeatTransform;
    pieces: Piece[];
}

export interface AlienStyle {
    id: string;
    name: string;
    /** The whole alien moved, turned and sized in one go. */
    root?: SeatTransform;
    pieces: Piece[];
}

/** The saucer's looks (ui/saucers.json, the editor's Hangar tab): all of them, and the ones worn. Live: the debug panel swaps them. */
export const LOOKS = saucers as unknown as { ufo: string; alien: string; ufos: UfoStyle[]; aliens: AlienStyle[] };
export const currentUfo = (): UfoStyle => LOOKS.ufos.find((style) => style.id === LOOKS.ufo) ?? LOOKS.ufos[0];
export const currentAlien = (): AlienStyle => LOOKS.aliens.find((style) => style.id === LOOKS.alien) ?? LOOKS.aliens[0];

interface Design {
    ufo: UfoSettings;
    saucer: SaucerSettings;
    people: PeopleSettings;
    camera: CameraSettings;
    traffic: TrafficSettings;
    roadKit?: RoadKit & { elevation: number; roadY: number };
    music: MusicDef;
}

export const DESIGN = data as unknown as Design;
/** Live: the debug panel changes them while playing. */
export const UFO = DESIGN.ufo;
export const CAMERA = DESIGN.camera;
export const SAUCER = DESIGN.saucer;

export const MODEL_BASE = './ufo/models/';
export const SAUCER_TEXTURE_BASE = './ufo/images/non-preload/saucer/';
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

const levelPath = (name: string) => `../../levels/${name}.json`;

/** The level being played: at first the one asked for in the address (`?city=`), else the town. */
let levelName = new URLSearchParams(window.location.search).get('city') ?? 'town';

export function currentLevel(): Level {
    return withRoads((LEVELS[levelPath(levelName)] ?? LEVELS[levelPath('town')]).default);
}

/** The level after this one (this one again if its `next` isn't a level). */
function nextLevelFile(): string {
    const next = LEVELS[levelPath(levelName)]?.default.next;
    return next && LEVELS[levelPath(next)] ? next : levelName;
}

/** What the next level's called, for the transition to it. */
export const nextLevelName = (): string => LEVELS[levelPath(nextLevelFile())]?.default.name ?? '';

/** On to the next level (the caller builds a fresh scene). */
export function goToNextLevel(): void {
    levelName = nextLevelFile();
}

/** A level's soundtrack: its own, else the game's. */
export const musicOf = (level: Level): MusicDef => level.soundSettings?.music ?? DESIGN.music;

/** How high a saucer of this radius flies: what's taller blocks it. */
export const altitudeFor = (radius: number): number => Math.max(0.5, UFO.altitudeBase + UFO.altitudePerRadius * radius);
