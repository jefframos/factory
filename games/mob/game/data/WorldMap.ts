// WorldMap.ts
//
// The world map the main screen shows (ui/worldmap.json, made in the editor's World map tab): hexagon tiles (KayKit's
// Medieval Hexagon pack: public/mob/models/hexa/<model>.gltf), each at axial (q, r) with maybe something standing on
// it (`decor`: a building, trees, a mountain...), turned `rot` sixths of a turn, and maybe given to an area (a zone of
// ui/zones.json): an area's tiles are a group, all shown as that area is. A tile with no area is scenery: it shows
// once an area next to it is reached.
//
// What each tile shows (tileStates): its area's state, all of its tiles alike —
//   done     — its area's beaten (in colour);
//   current  — the area being played (in colour; the main screen outlines it, with its pin and progress over it);
//   next     — the area after it (grey; its padlock over it);
//   open     — an area further on that can be picked anyway (every level unlocked: grey);
//   scenery  — no area, next to a tile of an area that's reached (done, being played, or open);
//   hidden   — anything else.

import worldFile from '../../ui/worldmap.json';
import { ZONES, areaStates } from './MobLevels';
import { ZoneConfig } from './LevelList';

export interface HexTile {
    q: number;
    r: number;
    /** The ground: the pack's tile (its file name, no .gltf). */
    model: string;
    /** What stands on it, if anything (one of the pack's buildings, nature or props). */
    decor?: string;
    /** Sixths of a turn. */
    rot?: number;
    /** The area (zone id) it belongs to; none: scenery. */
    zone?: string;
    /** How far it's raised (the ground and what's on it), and what's on it raised on top of that (world units). */
    y?: number;
    decorY?: number;
    /** Its colour changed on top of the map's (`ColourShift`): hue turned (degrees, added), saturation and brightness
     *  (times, multiplied). A grass tile turned yellow for a desert, grey-white for snow. */
    hue?: number;
    saturation?: number;
    brightness?: number;
}

/** A colour change: the hue turned (degrees), the saturation and brightness times (1: as it is). */
export interface ColourShift { hue: number; saturation: number; brightness: number }

/** A tile's colour change: the map's and its own together. */
export function tileShift(tile: HexTile, map: WorldMapFile = WORLD_MAP): ColourShift {
    return {
        hue: (map.hue ?? 0) + (tile.hue ?? 0),
        saturation: (map.saturation ?? 1) * (tile.saturation ?? 1),
        brightness: (map.brightness ?? 1) * (tile.brightness ?? 1),
    };
}

/** The map: its tiles, and how far all of it is raised out of the sea (world units). */
export interface WorldMapFile {
    tiles: HexTile[];
    lift?: number;
    /** The whole map's colour change (each tile's own goes on top). */
    hue?: number;
    saturation?: number;
    brightness?: number;
}

export const WORLD_MAP: WorldMapFile = worldFile as WorldMapFile;

/** The pack's hexagons are pointy-topped, 2 across their flat sides (their top at y 0): where (q, r) is on the ground. */
export const HEX = { width: 2, rowStep: Math.sqrt(3) / 2 };
/** Where the pack's models are, under the game's models folder. */
export const HEX_MODELS = 'hexa/';
export function hexToWorld(q: number, r: number): { x: number; z: number } {
    return { x: (q + r / 2) * HEX.width, z: r * HEX.rowStep * HEX.width };
}

/** The six tiles round (q, r). */
const NEIGHBOURS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const neighbours = (q: number, r: number): [number, number][] => NEIGHBOURS.map(([dq, dr]) => [q + dq, r + dr]);

export type TileState = 'done' | 'current' | 'next' | 'open' | 'scenery' | 'hidden';

export interface TileView {
    tile: HexTile;
    state: TileState;
}

/** An area as the map shows it: its tiles (in the map's order), its number, state, and how far through it the player is. */
export interface AreaMark {
    zone: ZoneConfig;
    number: number;
    state: 'done' | 'current' | 'next' | 'open';
    done: number;
    total: number;
    tiles: HexTile[];
}

/**
 * The areas the map shows, with battle `index` the next to beat and `furthest` the furthest that can be picked: those
 * beaten, the one being played, the next one, and any further that can be picked (every level unlocked). Each with its
 * tiles; an area with none on the map isn't here.
 */
export function areaMarks(index: number, furthest: number, map: WorldMapFile = WORLD_MAP): AreaMark[] {
    const areas = areaStates(index, furthest);
    const currentAt = areas.findIndex((area) => area.state === 'current');
    const next = areas.slice(currentAt + 1).find((area) => area.state === 'locked' || area.state === 'open')?.zone.id;
    const marks: AreaMark[] = [];
    areas.forEach((area, i) => {
        const tiles = map.tiles.filter((tile) => tile.zone === area.zone.id);
        if (!tiles.length) return;
        const state = area.zone.id === next ? 'next' : area.state === 'locked' ? null : area.state;
        if (!state) return;
        marks.push({ zone: area.zone, number: i + 1, state, done: area.done, total: area.total, tiles });
    });
    return marks;
}

/**
 * Every tile and what it shows: an area's tiles all show as their area is (beaten, being played: in colour; the next,
 * or further ones that can be picked: grey); others are hidden. Scenery (no area) shows beside an area that's reached.
 */
export function tileStates(index: number, furthest: number, map: WorldMapFile = WORLD_MAP, everything = false): TileView[] {
    const stateOf = new Map(areaMarks(index, furthest, map).map((mark) => [mark.zone.id, mark.state]));
    const known = new Set(ZONES.map((zone) => zone.id));
    const views = map.tiles.map((tile): TileView => {
        if (!tile.zone || !known.has(tile.zone)) return { tile, state: 'scenery' };
        return { tile, state: stateOf.get(tile.zone) ?? 'hidden' };
    });
    const at = new Map(views.map((view) => [`${view.tile.q},${view.tile.r}`, view]));
    const reached = (view: TileView | undefined) => !!view && (view.state === 'done' || view.state === 'current' || view.state === 'open');
    // `everything` (the editor's whole-map preview): the scenery far from any area too.
    for (const view of views) {
        if (everything || view.state !== 'scenery') continue;
        if (!neighbours(view.tile.q, view.tile.r).some(([q, r]) => reached(at.get(`${q},${r}`)))) view.state = 'hidden';
    }
    return views;
}

/** The tile at world (x, z), as axial (q, r): the nearest hexagon. */
export function worldToHex(x: number, z: number): [number, number] {
    const r = z / (HEX.rowStep * HEX.width);
    const q = x / HEX.width - r / 2;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(-q - r);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - (-q - r));
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return [rq, rr];
}
