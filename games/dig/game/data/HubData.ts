// HubData.ts
//
// The miner's hub room (levels/hub.json): floor rects, walls with openings (doorways out into the rock),
// decor props, the stations, the buildables (pieces the player buys to finish the hub) and the trophy tables
// (each shows one zone's finds: dark silhouettes until dug up, to tease what's out there). Edited in the
// level editor's 3D Hub tab (`npm run level`).

import data from '../../levels/hub.json';

export interface HubPoint {
    x: number;
    z: number;
}

export interface HubOpening {
    kind: 'door' | 'window' | 'gap';
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface HubWall {
    closed: boolean;
    points: HubPoint[];
    openings: HubOpening[];
}

export interface HubProp {
    /** Path under public/dig/models/. */
    model: string;
    x: number;
    z: number;
    rotationY: number;
    height: number;
    /** Extra stretch along the model's own width (x) and depth (z), on top of the height fit (1 = as modelled). */
    stretch?: { x: number; z: number };
    width?: number;
    elevation?: number;
    flat?: boolean;
    collider?: { halfX: number; halfY: number; halfZ: number } | null;
}

/** atm = sells the backpack and opens the upgrades; collection = the artifact totem; wardrobe = looks. */
export type StationKind = 'atm' | 'collection' | 'wardrobe';

export interface HubStation extends HubPoint {
    kind: StationKind;
    /** Turns the station (its model stands behind the pad, on the -Z side when 0). */
    rotationY?: number;
    /** Sizes the station's model (and pedestal); the pad stays the same. */
    scale?: number;
}

/**
 * A rectangle of the hub whose contents (anything placed inside it) stay hidden until `reveal` is met. Rules:
 * 'start' (always), 'firstUpgrade' / 'upgrade:<n>' (n tool upgrades bought), 'firstFind' (an artifact found),
 * 'firstBuild' (any buildable bought), 'built:<areaId>' (everything buildable in that area bought); several joined
 * with '|' = any of them. Things outside every area are always there. The first area containing a point owns it.
 */
export interface HubArea {
    id: string;
    name: string;
    x: number;
    z: number;
    width: number;
    depth: number;
    reveal: string;
}

/** The area owning (x, z), if any. */
export function hubAreaAt(x: number, z: number): HubArea | undefined {
    return HUB.areas?.find((a) => Math.abs(x - a.x) <= a.width / 2 && Math.abs(z - a.z) <= a.depth / 2);
}

/** A table in the trophy room showing one zone's finds along its long side. */
export interface HubTrophyTable extends HubProp {
    /** DIG.zones index whose finds stand on it. */
    zone: number;
}

/** An achievement's trophy decoration: in the hub once its last tier is claimed. */
export interface HubAchievementDecor extends HubProp {
    /** ui/dig.json achievements id. */
    achievement: string;
}

/** A piece of the hub the player buys: a see-through ghost with its price until bought, then the real thing. */
export interface HubBuildable extends HubProp {
    id: string;
    name: string;
    price: number;
}

export interface HubDesign {
    floor: { width: number; depth: number; rects?: { x: number; z: number; width: number; depth: number }[] };
    start: HubPoint;
    walls: HubWall[];
    props: HubProp[];
    stations: HubStation[];
    buildables?: HubBuildable[];
    trophyTables?: HubTrophyTable[];
    achievementDecor?: HubAchievementDecor[];
    areas?: HubArea[];
}

export const HUB: HubDesign = data as unknown as HubDesign;

/** Floor rects of the hub (the whole floor when it has none). */
export function hubRects(): { x: number; z: number; width: number; depth: number }[] {
    return HUB.floor.rects?.length ? HUB.floor.rects : [{ x: 0, z: 0, width: HUB.floor.width, depth: HUB.floor.depth }];
}
