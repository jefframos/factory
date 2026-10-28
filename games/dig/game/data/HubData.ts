// HubData.ts
//
// The miner's hub room (levels/hub.json): floor rects, walls with openings (doorways out into the rock),
// decor props and the stations. Same file format as bandit-controller's levels, so the level editor
// (`npm run level`) edits it.

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
    width?: number;
    elevation?: number;
    flat?: boolean;
    collider?: { halfX: number; halfY: number; halfZ: number } | null;
}

/** atm = sells the backpack and opens the upgrades; collection = the artifact totem; wardrobe = looks. */
export type StationKind = 'atm' | 'collection' | 'wardrobe';

export interface HubStation extends HubPoint {
    kind: StationKind;
}

export interface HubDesign {
    floor: { width: number; depth: number; rects?: { x: number; z: number; width: number; depth: number }[] };
    start: HubPoint;
    walls: HubWall[];
    props: HubProp[];
    stations: HubStation[];
}

export const HUB: HubDesign = data as unknown as HubDesign;

/** Floor rects of the hub (the whole floor when it has none). */
export function hubRects(): { x: number; z: number; width: number; depth: number }[] {
    return HUB.floor.rects?.length ? HUB.floor.rects : [{ x: 0, z: 0, width: HUB.floor.width, depth: HUB.floor.depth }];
}
