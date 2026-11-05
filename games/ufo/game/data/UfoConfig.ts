// UfoConfig.ts
//
// The game's settings (ui/ufo.json: the editor's UFO tab) and its levels (levels/*.json: the editor's Town tab, in the
// shape the shared world editor saves). `?city=<level>` plays another level, which is what the editor's ▶ Play opens.

import { RoadCells, RoadKit, roadNetwork, solveRoads } from 'core/roads/RoadGrid';
import type { Piece } from 'core/pieces/Pieces';
import data from '../../ui/ufo.json';
import saucers from '../../ui/saucers.json';
import areas from '../../ui/areas.json';

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

/**
 * A level of the standard mode: what to do against the clock, with other saucers about. `points`: reach a share of all the
 * points in the level. `all`: eat everything. `object`: swallow the level's goal (rivals leave it alone).
 */
export interface Mission {
    name: string;
    level: string;
    type: 'points' | 'all' | 'object';
    /** `points`: how many to reach. */
    points?: number;
    /** `points`, without `points`: the share of the level's points to reach (rivals eat too, so not near all). */
    share?: number;
    seconds: number;
    rivals: number;
    /** Coins for winning it. */
    reward?: number;
    /** The first thing a new player plays. */
    tutorial?: boolean;
}

/** A group of levels (ui/areas.json, the editor's Levels tab): a town shown on the home screen, and what's played. */
export interface Area {
    id: string;
    name: string;
    /** The level file shown as the island on the home screen. */
    miniature: string;
    /** Whether that island keeps its fence and the deck's pilings there (off by default; the level itself, played, keeps them). */
    miniaturePoles?: boolean;
    levels: Omit<Mission, 'name'>[];
}

/** A timed round: the biggest saucer when it's over wins. */
export interface LevelRound {
    seconds: number;
    /** How many computer-played saucers. */
    rivals: number;
}

export interface Level {
    name?: string;
    /** Without one, it's calm: it's over when its goal's eaten, or everything is. With one, the goal's a big bonus. */
    round?: LevelRound;
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
    /** How much radius makes one "size" on its bar: each one reached is a milestone. */
    sizeStep: number;
    /** How many times faster the player grows until it reaches its second size. */
    firstSizeBoost: number;
    /** An eat-everything level's won with this share of the town eaten: nobody has to hunt for the last flower. */
    completeShare: number;
}

/** The home screen's view of the miniature (the UFO tab). */
export interface HomeSettings {
    /** Show the island and saucer as smooth baked images over the live sea, not as live 3D. They don't swing then. */
    baked: boolean;
    /** How steeply it looks down: 90 is straight down. */
    pitchDeg: number;
    /** Which way round the player point it looks from: 0 is from the south, as in the editor's and the game's camera. */
    yawDeg: number;
    fov: number;
    /** How much of the screen's narrower side the island fills. */
    fill: number;
    /** How far below the middle of the screen the player point sits, as a share of the island's size. */
    drop: number;
    /** How far it swings round the player point (radians), and how fast. */
    drift: number;
    driftSpeed: number;
    /** The saucer's radius and height, as shares of the island's size. */
    ufoSize: number;
    ufoHeight: number;
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
    /** How much further back it sits in a round with rivals, to see them coming. */
    rivalsZoom: number;
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
    /** In the shop's specials for this many coins. Without one, it's a classic, unlocked at random. */
    price?: number;
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
    /** In the shop's specials for this many coins. Without one, it's a classic, unlocked at random. */
    price?: number;
    /** The whole alien moved, turned and sized in one go. */
    root?: SeatTransform;
    pieces: Piece[];
}

/** The saucer's looks (ui/saucers.json, the editor's Hangar tab): all of them, and the ones worn. Live: the debug panel swaps them. */
export const LOOKS = saucers as unknown as { ufo: string; alien: string; ufos: UfoStyle[]; aliens: AlienStyle[] };
export const currentUfo = (): UfoStyle => LOOKS.ufos.find((style) => style.id === LOOKS.ufo) ?? LOOKS.ufos[0];
export const currentAlien = (): AlienStyle => LOOKS.aliens.find((style) => style.id === LOOKS.alien) ?? LOOKS.aliens[0];

export interface RivalSettings {
    /** How fast they fly, as a share of the player's. */
    speed: number;
    /** After being eaten: how long until back, how much of their size they keep, how long they can't be eaten again. */
    respawnSeconds: number;
    respawnSize: number;
    protectSeconds: number;
    /** How many times bigger a saucer has to be to eat another: it flies higher by then. */
    eatMargin: number;
    /** Each rival's share of the player's size, in turn: most at or under it, one over it. They stop growing there. */
    ratios: number[];
    /** How much of its size the player comes back with. */
    playerKeeps: number;
    /** A rival over its cap (the player's shrunk): how fast it eases down (share of its size a second). */
    shrinkPerSecond: number;
    /** One rival at a time hunts the player for this long, then none for `restSeconds`; none for `afterEatenSeconds` after it's eaten. */
    huntSeconds: number;
    restSeconds: number;
    afterEatenSeconds: number;
    /** Holding still this long, the player isn't hunted. */
    stillSeconds: number;
    /** A hunter must have been on screen this long to eat the player. */
    seenSeconds: number;
    /** Those that could eat the player but aren't hunting stay this far off (past its radius). */
    keepAway: number;
    /** Rubber band: a rival under this share of its cap grows towards it on its own, this much of the gap a second. */
    floorShare: number;
    /** In a level to eat everything, the most of the player's size a rival gets (under what it takes to be eaten). */
    gentleShare: number;
    catchUp: number;
}

interface Design {
    ufo: UfoSettings;
    rivals: RivalSettings;
    saucer: SaucerSettings;
    people: PeopleSettings;
    camera: CameraSettings;
    home: HomeSettings;
    /** What plays on the home screen. */
    homeMusic: MusicDef;
    /** The start of a level: from high above down to the player, then the rivals fly out from round it. */
    intro: {
        hold: number;
        seconds: number;
        pitchDeg: number;
        /** How far back it starts, as a share of what it takes to see the whole island. */
        zoomOut: number;
        /** How far from the player the rivals wait. */
        gatherRadius: number;
        spreadSeconds: number;
    };
    /** Never running out of things to eat. */
    scarcity: {
        /** A rival off screen pretends to eat a thing, leaving it there; it's left alone this long after. */
        offscreenCooldown: number;
        /** Things come back after this long with the player eating nothing... */
        droughtSeconds: number;
        /** ...or when fewer than this are left that the player can eat... */
        minEatable: number;
        /** ...or if a share of the points left this big wouldn't reach the level's target. */
        riskShare: number;
        /** How many come back at a time, and how often at most. */
        batch: number;
        every: number;
    };
    /** All the saucers' stylised look (PopMaterial.ts). */
    saucerLook: { pop: boolean; saturation: number; brightness: number; shadow: number; rim: number; rimWidth: number; outline: number };
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
const MISSION_KEY = 'ufo.mission';

export const AREAS = areas.areas as Area[];

function savedMission(): number {
    try {
        return Math.max(0, Math.min(MISSIONS.length - 1, Number(window.localStorage.getItem(MISSION_KEY)) || 0));
    } catch {
        return 0;
    }
}

/** Every level of every area in play order, numbered through. */
const MISSIONS: Mission[] = AREAS.flatMap((area) => area.levels).map((level, i) => ({ ...level, name: `Level ${i + 1}` }));

const askedLevel = new URLSearchParams(window.location.search).get('city');
let missionIndex = savedMission();
/** The mission being played; null in competition (the level's `round`), which the address's `?city=` goes straight to. */
let mission: Mission | null = askedLevel ? null : MISSIONS[missionIndex];
/** The level being played. */
let levelName = askedLevel ?? mission?.level ?? 'town';

export const currentMission = (): Mission | null => mission;

/** The mission the player's up to, for the menu's button. */
export const missionUpTo = (): Mission => MISSIONS[missionIndex];

/** Plays that mission from now on (the caller builds a fresh scene). */
export function goToMission(index: number): void {
    missionIndex = ((index % MISSIONS.length) + MISSIONS.length) % MISSIONS.length;
    mission = MISSIONS[missionIndex];
    levelName = mission.level;
    try {
        window.localStorage.setItem(MISSION_KEY, String(missionIndex));
    } catch {
        // No storage: it starts from the first next time.
    }
}

/** Plays the tutorial from now on (the caller builds a fresh scene). */
export function goToTutorial(): void {
    mission = { ...(areas.tutorial as Omit<Mission, 'name'>), name: 'Tutorial', tutorial: true };
    levelName = mission.level;
}

/** Forgets which level the player's up to. */
export function eraseMissionSave(): void {
    try {
        window.localStorage.removeItem(MISSION_KEY);
    } catch {
        // No storage: nothing was kept.
    }
}

export const currentMissionIndex = (): number => missionIndex;

/** The area of the level the player's up to. */
export function currentArea(): Area {
    let left = missionIndex;
    for (const area of AREAS) {
        if (left < area.levels.length) return area;
        left -= area.levels.length;
    }
    return AREAS[0];
}

/** The town the home screen shows: the area's miniature. */
export function homeLevel(): Level {
    const area = currentArea();
    const file = LEVELS[levelPath(area.miniature)] ?? LEVELS[levelPath(missionUpTo().level)] ?? LEVELS[levelPath('town')];
    const level = withRoads(file.default);
    if (!level.island || area.miniaturePoles) return level;
    const { deck } = level.island;
    return { ...level, island: { ...level.island, fence: undefined, deck: deck && { ...deck, pilingSpacing: 0 } } };
}

/** Plays a level's competition round from now on: the first with rivals without a name (the caller builds a fresh scene). */
export function goToCompetition(file = competitionLevel()): void {
    mission = null;
    levelName = file;
}

function competitionLevel(): string {
    const found = Object.entries(LEVELS).find(([, { default: level }]) => (level.round?.rivals ?? 0) > 0);
    return found ? found[0].replace(/^.*\/(.+)\.json$/, '$1') : levelName;
}

/** What the competition's level is called. */
export const competitionName = (): string => LEVELS[levelPath(competitionLevel())]?.default.name ?? '';

export function currentLevel(): Level {
    return withRoads((LEVELS[levelPath(levelName)] ?? LEVELS[levelPath('town')]).default);
}

/** What a level's called. */
export const levelTitle = (file: string): string => LEVELS[levelPath(file)]?.default.name ?? '';

/** The level being played's file name. */
export const levelFile = (): string => levelName;

/** Whether the address asked for a level: straight into it, no menu (the editor's ▶ Play). */
export const levelInAddress = (): boolean => askedLevel !== null;

/** A level's soundtrack: its own, else the game's. */
export const musicOf = (level: Level): MusicDef => level.soundSettings?.music ?? DESIGN.music;

/** How high a saucer of this radius flies: what's taller blocks it. */
export const altitudeFor = (radius: number): number => Math.max(0.5, UFO.altitudeBase + UFO.altitudePerRadius * radius);
