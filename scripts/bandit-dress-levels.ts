// bandit-dress-levels.ts
//
// Dresses every Bandit Controller campaign level with its world's furniture pack (the sets approved in
// the debug "Showcase Levels"). Each floor rect is given a room type for its world (living room,
// kitchen, teller office, slot floor...); walls are lined with that room's pieces facing into the
// room, and big rooms get one centre set (rug + table, slot island, roped exhibit...). Nothing is
// placed on doors, windows, checkpoints, loot, guard patrols, cameras, traps or the vault, and a piece
// is only kept if every checkpoint and loot stays reachable on the game's own nav grid with extra
// clearance. Seeded by level id, and it replaces only its own props, so re-running is safe.
//
//   npm run dress:bandit [-- --dry] [-- w4-06 w5-04]

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { LevelData, LevelPoint, LevelProp } from '../games/bandit-controller/game/data/LevelData';
import { NavGrid, NavBox, NavRegion } from '../games/bandit-controller/game/utils/NavGrid';
import { vaultSafe } from '../games/bandit-controller/game/data/LevelData';
import { PolyWallBuilder } from '../games/pizza/game/builders/PolyWallBuilder';

const GAME = path.resolve(__dirname, '../games/bandit-controller');
const LEVELS = path.join(GAME, 'levels');
const MODELS = path.join(GAME, 'raw-assets', 'models');
const DRY = process.argv.includes('--dry');
const ONLY = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

const UNITS_PER_METER = 1.7;
const D = 'heist/decor';
/** Props this script owns (replaced on every run); the old mini-market dressing is retired too. */
const OWNED = [`${D}/`, 'heist/mini-market/'];
const COLLIDER_SHRINK = 0.9;
/** Floor coverings: drawn as thin decals in game so routes and goal markers stay on top. */
const FLAT_MODELS = /\/(rug-[^/]*|floor-01|landingpad-small)\.glb$/;
/** Placement keeps routes wider than the game's own 0.55 so drawn paths never feel cramped. */
const PLACE_CLEARANCE = 0.85;
const GAME_CLEARANCE = 0.55;
const MAX_PROPS = 34;
/** Same anchor piece at most this often per level, so rooms don't fill with clones. */
const MAX_PER_MODEL = 4;
/** Rooms with a shorter side than this get the theme's small-room kit (bathroom, closet...). */
const SMALL_ROOM = 6.5;

// ── Kits ──────────────────────────────────────────────────────────────────────────────────────
// Heights in meters (the scale approved in the showcases); `width` sizes flat things by footprint.

interface Part {
    model: string;
    h?: number;
    width?: number;
    elev?: number;
    /** Not solid: no collider, may sit on anything (rugs, items on tables). */
    soft?: boolean;
    dx?: number;
    dz?: number;
    deg?: number;
}

/** A wall piece: the first part stands against the wall facing the room; the rest are relative to it (dz = into the room). */
interface WallItem {
    parts: Part[];
    weight?: number;
}

interface RoomKit {
    wall: WallItem[];
    /** Centre sets, parts placed relative to the set centre (unrotated). */
    centre?: Part[][];
    /** Gap range between wall pieces, in units. */
    gap?: [number, number];
}

interface Theme {
    rooms: RoomKit[];
    /** Used for rooms whose short side is under SMALL_ROOM units. */
    small: RoomKit;
}

const one = (model: string, h: number, extra: Partial<Part> = {}, weight = 1): WallItem => ({ parts: [{ model, h, ...extra }], weight });
const withChair = (desk: string, deskH: number, chair: string, chairH: number, out: number): WallItem => ({
    parts: [{ model: desk, h: deskH }, { model: chair, h: chairH, dz: out, deg: 180 }],
    weight: 1.4,
});
const onTop = (base: string, baseH: number, top: string, topH: number, extra: Partial<Part> = {}): WallItem => ({
    parts: [{ model: base, h: baseH, ...extra }, { model: top, h: topH, elev: baseH, soft: true }],
});
const palletWith = (stack: string): WallItem => ({
    parts: [{ model: `${D}/kaykit/pallet-wood.glb`, width: 1.4 }, { model: `${D}/kaykit/${stack}.glb`, h: 0.55, elev: 0.25, soft: true }],
    weight: 1.5,
});
const plinth = (item: string, h: number): WallItem => ({
    parts: [{ model: `${D}/kaykit/primitive-cube-small.glb`, h: 0.9 }, { model: `${D}/${item}`, h, elev: 0.9, soft: true }],
    weight: 1.4,
});
/** Rope posts at the corners of a w x d rectangle (units), ropes between them, around `inside`. */
const roped = (w: number, d: number, inside: Part[]): Part[] => {
    const hx = w / 2;
    const hz = d / 2;
    const rope = (len: number) => len / UNITS_PER_METER - 0.15;
    return [
        ...inside,
        ...[[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]].map(([dx, dz]) => ({ model: `${D}/casino/fence-07.glb`, h: 1.0, dx, dz })),
        { model: `${D}/casino/fence-09.glb`, width: rope(w), elev: 0.55, soft: true, dz: -hz },
        { model: `${D}/casino/fence-09.glb`, width: rope(w), elev: 0.55, soft: true, dz: hz },
        { model: `${D}/casino/fence-09.glb`, width: rope(d), elev: 0.55, soft: true, dx: -hx, deg: 90 },
        { model: `${D}/casino/fence-09.glb`, width: rope(d), elev: 0.55, soft: true, dx: hx, deg: 90 },
    ];
};
const ring = (model: string, h: number, radius: number, count = 4): Part[] => Array.from({ length: count }, (_, i) => {
    const deg = (i * 360) / count;
    const a = (deg * Math.PI) / 180;
    return { model, h, dx: Math.sin(a) * radius, dz: Math.cos(a) * radius, deg: deg + 180 };
});

const HOUSE: Theme = {
    rooms: [
        { // living room
            wall: [one(`${D}/cute/couch-08.glb`, 1.15, {}, 1.5), one(`${D}/cute/armchair-18.glb`, 1.2), one(`${D}/kaykit/shelf-b-large-decorated.glb`, 1.05),
                one(`${D}/kaykit/lamp-standing.glb`, 2.1, {}, 0.6), one(`${D}/cute/plants-19.glb`, 1.6, {}, 0.8), one(`${D}/cute/clock-03.glb`, 2.4, {}, 0.5)],
            centre: [[{ model: `${D}/kaykit/rug-rectangle-stripes-a.glb`, width: 3.9, deg: 90, soft: true }, { model: `${D}/cute/coffee-table-03.glb`, h: 0.6 },
                { model: `${D}/cute/armchair-18.glb`, h: 1.2, dz: -3.4 }, { model: `${D}/cute/armchair-18.glb`, h: 1.2, dz: 3.4, deg: 180 }]],
        },
        { // kitchen
            wall: [{ parts: [{ model: `${D}/kaykit/kitchencounter-straight-a-decorated.glb`, h: 1.25 }, { model: `${D}/kaykit/kitchencounter-sink.glb`, h: 1.25, dx: 2.2 },
                { model: `${D}/kaykit/kitchencounter-straight-a-decorated.glb`, h: 1.25, dx: 4.4 }], weight: 1.6 },
                one(`${D}/cute/fridge-01.glb`, 2.3), one(`${D}/cute/plants-15.glb`, 1.4, {}, 0.6)],
            centre: [[{ model: `${D}/cute/kitchen-table-09.glb`, h: 1.0 }, { model: `${D}/kaykit/chair-a-wood.glb`, h: 1.2, dx: -1.1, dz: 2.2, deg: 180 },
                { model: `${D}/kaykit/chair-a-wood.glb`, h: 1.2, dx: 1.1, dz: 2.2, deg: 180 }, { model: `${D}/kaykit/chair-a-wood.glb`, h: 1.2, dx: -1.1, dz: -2.2 },
                { model: `${D}/kaykit/chair-a-wood.glb`, h: 1.2, dx: 1.1, dz: -2.2 }]],
        },
        { // bedroom
            wall: [{ parts: [{ model: `${D}/cute/bed-02.glb`, width: 2.8 }, { model: `${D}/cute/nightstand-02.glb`, h: 0.75, dx: -2.9, dz: -1.4 },
                { model: `${D}/cute/nightstand-02.glb`, h: 0.75, dx: 2.9, dz: -1.4 }], weight: 1.6 },
                one(`${D}/cute/closet-01.glb`, 2.4), one(`${D}/kaykit/lamp-standing.glb`, 2.1, {}, 0.5), one(`${D}/cute/plants-15.glb`, 1.4, {}, 0.6)],
            centre: [[{ model: `${D}/kaykit/rug-oval-a.glb`, width: 2.8, soft: true }]],
        },
    ],
    small: { // bathroom
        wall: [one(`${D}/cute/bath-03.glb`, 0, { width: 2.4 }, 1.3), one(`${D}/cute/toilet-03.glb`, 1.05), one(`${D}/cute/wash-basin-07.glb`, 1.25), one(`${D}/cute/plants-15.glb`, 1.4, {}, 0.5)],
    },
};

const BANK: Theme = {
    rooms: [
        { // lobby
            wall: [one(`${D}/casino/couch-05.glb`, 0.9, {}, 1.3), one(`${D}/casino/armchair-02.glb`, 0.95), one(`${D}/casino/atm-01.glb`, 1.8), one(`${D}/casino/atm-03.glb`, 1.8),
                one(`${D}/casino/flower-03.glb`, 1.3, {}, 0.8)],
            centre: [roped(5.2, 2.8, []), [{ model: `${D}/kaykit/rug-rectangle-a.glb`, width: 3, deg: 90, soft: true },
                { model: `${D}/casino/armchair-02.glb`, h: 0.95, dz: -2.4 }, { model: `${D}/casino/armchair-02.glb`, h: 0.95, dz: 2.4, deg: 180 }]],
        },
        { // tellers / offices
            wall: [withChair(`${D}/kaykit/desk-large-decorated.glb`, 1.0, `${D}/casino/chair-office-01.glb`, 1.3, 2.4),
                one(`${D}/kaykit/cabinet-medium-decorated.glb`, 1.0), one(`${D}/casino/flower-03.glb`, 1.3, {}, 0.6)],
            centre: [[{ model: `${D}/kaykit/desk-large-decorated.glb`, h: 1.0, dx: -1.9, deg: 180 }, { model: `${D}/kaykit/desk-large-decorated.glb`, h: 1.0, dx: 1.9, deg: 180 },
                { model: `${D}/casino/chair-office-01.glb`, h: 1.3, dx: -1.9, dz: -2.4, deg: 180 }, { model: `${D}/casino/chair-office-01.glb`, h: 1.3, dx: 1.9, dz: -2.4, deg: 180 }]],
        },
        { // cash room
            wall: [one(`${D}/casino/safe-box-01.glb`, 1.4, {}, 1.3), onTop(`${D}/kaykit/table-medium-long.glb`, 0.8, `${D}/casino/cash-machine-01.glb`, 0.35),
                one(`${D}/kaykit/cabinet-medium-decorated.glb`, 1.0), one(`${D}/casino/flower-03.glb`, 1.3, {}, 0.5)],
        },
    ],
    small: { wall: [one(`${D}/casino/safe-box-01.glb`, 1.4), one(`${D}/kaykit/cabinet-medium-decorated.glb`, 1.0), one(`${D}/casino/flower-03.glb`, 1.3)] },
};

const MINT: Theme = {
    rooms: [
        { // loading dock
            wall: [palletWith('gold-bars-stack-large'), palletWith('silver-bars-stack-large'), one(`${D}/kaykit/containers-crate-large.glb`, 1.0),
                one(`${D}/kaykit/containers-box-medium.glb`, 0.5, {}, 0.6), one(`${D}/kaykit/workbench-decorated.glb`, 0.95), one(`${D}/kaykit/locker-decorated.glb`, 1.9, {}, 0.6)],
            centre: [[-1.3, 1.3].flatMap((dx) => [-1.3, 1.3].flatMap((dz) => palletWith(dx < 0 ? 'gold-bars-stack-large' : 'silver-bars-stack-large').parts.map((p) => ({ ...p, dx, dz }))))],
        },
        { // counting room
            wall: [onTop(`${D}/kaykit/table-medium-long.glb`, 0.8, `${D}/kaykit/money-bills-stack-large.glb`, 0.3), onTop(`${D}/kaykit/table-medium-long.glb`, 0.8, `${D}/casino/cash-machine-01.glb`, 0.35),
                one(`${D}/kaykit/locker-decorated.glb`, 1.9), one(`${D}/kaykit/money-pile-large.glb`, 0.9), one(`${D}/kaykit/pallet-wood-covered-a.glb`, 0, { width: 1.5 }, 0.6)],
            centre: [[{ model: `${D}/kaykit/table-medium-long.glb`, h: 0.8, dz: -1.8 }, { model: `${D}/kaykit/table-medium-long.glb`, h: 0.8, dz: 1.8 },
                { model: `${D}/kaykit/money-bills-stack-large.glb`, h: 0.3, elev: 0.8, soft: true, dx: -1, dz: -1.8 }, { model: `${D}/casino/cash-machine-01.glb`, h: 0.35, elev: 0.8, soft: true, dx: 1, dz: 1.8 }]],
        },
        { // bullion store
            wall: [palletWith('gold-bars-stack-large'), palletWith('gold-bars-stack-large'), palletWith('silver-bars-stack-large'),
                one(`${D}/casino/safe-box-01.glb`, 1.4), one(`${D}/kaykit/money-pile-large.glb`, 0.9)],
            centre: [[-2.6, 0, 2.6].flatMap((dx) => palletWith('gold-bars-stack-large').parts.map((p) => ({ ...p, dx })))],
        },
    ],
    small: { wall: [palletWith('gold-bars-stack-large'), one(`${D}/casino/safe-box-01.glb`, 1.4), one(`${D}/kaykit/money-pile-large.glb`, 0.9)] },
};

const MUSEUM: Theme = {
    rooms: [
        { // painting gallery
            wall: [one(`${D}/kaykit/pictureframe-standing-a.glb`, 1.6, {}, 1.4), one(`${D}/kaykit/pictureframe-standing-b.glb`, 1.6, {}, 1.4),
                one(`${D}/casino/column-17.glb`, 2.6, {}, 0.6), one(`${D}/cute/plants-19.glb`, 1.3, {}, 0.6)],
            centre: [[{ model: `${D}/casino/couch-05.glb`, h: 1.1, deg: 90 }]],
        },
        { // artifact hall
            wall: [plinth('mixed/idol-a.glb', 0.7), plinth('mixed/idol-b.glb', 0.7), plinth('mixed/guitar-a.glb', 1.0), plinth('kaykit/gems-chest.glb', 0.6),
                one(`${D}/kaykit/pillar-b.glb`, 2.4, {}, 0.5)],
            centre: [roped(3.6, 5.4, [{ model: `${D}/kaykit/rug-rectangle-b.glb`, width: 3, deg: 90, soft: true }, { model: `${D}/kaykit/coffin-decorated.glb`, width: 1.9 }])],
        },
        { // big exhibit
            wall: [one(`${D}/kaykit/shrine-candles.glb`, 0.9), plinth('mixed/idol-a.glb', 0.7), one(`${D}/casino/column-17.glb`, 2.6, {}, 0.6), one(`${D}/cute/plants-19.glb`, 1.3, {}, 0.5)],
            centre: [roped(6.4, 4.4, [{ model: `${D}/kaykit/rug-rectangle-b.glb`, width: 4, soft: true }, { model: `${D}/castle/siege-catapult.glb`, h: 1.8, deg: 90 }])],
        },
    ],
    small: { wall: [plinth('mixed/idol-b.glb', 0.7), one(`${D}/kaykit/pictureframe-standing-a.glb`, 1.6), one(`${D}/cute/plants-19.glb`, 1.3)] },
};

const slotWithChair = (model: string): WallItem => ({ parts: [{ model, h: 1.9 }, { model: `${D}/casino/chair-06.glb`, h: 0.9, dz: 1.6, deg: 180 }], weight: 1.5 });
const slotIsland: Part[] = [-1.8, -0.6, 0.6, 1.8].flatMap((dx, i) => [
    { model: `${D}/casino/${i % 2 ? 'slot-machine-01' : 'slot-machine-02'}.glb`, h: 1.9, dx, dz: 0.6 },
    { model: `${D}/casino/chair-06.glb`, h: 0.9, dx, dz: 2.2 },
    { model: `${D}/casino/${i % 2 ? 'slot-machine-02' : 'slot-machine-01'}.glb`, h: 1.9, dx, dz: -0.6, deg: 180 },
    { model: `${D}/casino/chair-06.glb`, h: 0.9, dx, dz: -2.2, deg: 180 },
]);
const CASINO: Theme = {
    rooms: [
        { // slot floor
            wall: [slotWithChair(`${D}/casino/slot-machine-aquarium-01.glb`), slotWithChair(`${D}/casino/slot-machine-01.glb`), slotWithChair(`${D}/casino/slot-machine-02.glb`),
                one(`${D}/casino/flower-03.glb`, 1.3, {}, 0.4)],
            centre: [slotIsland],
            gap: [0.1, 0.9],
        },
        { // lounge + cashier
            wall: [one(`${D}/casino/couch-05.glb`, 0.9, {}, 1.2), one(`${D}/casino/armchair-02.glb`, 0.95), one(`${D}/casino/atm-01.glb`, 1.8),
                one(`${D}/casino/neon-sign-01.glb`, 1.3, { elev: 0.4 }, 0.7), onTop(`${D}/casino/table-06.glb`, 0.95, `${D}/casino/cash-machine-01.glb`, 0.35),
                one(`${D}/casino/column-17.glb`, 2.6, {}, 0.5), one(`${D}/casino/flower-03.glb`, 1.3, {}, 0.6)],
            centre: [[{ model: `${D}/casino/floor-01.glb`, width: 4.5, elev: 0.01, soft: true }, { model: `${D}/casino/table-01.glb`, h: 0.6 },
                { model: `${D}/casino/fruits-01.glb`, h: 0.25, elev: 0.6, soft: true }, { model: `${D}/casino/armchair-02.glb`, h: 0.95, dz: -2.4 },
                { model: `${D}/casino/armchair-02.glb`, h: 0.95, dz: 2.4, deg: 180 }]],
        },
        { // card tables
            wall: [one(`${D}/casino/couch-05.glb`, 0.9), one(`${D}/casino/flower-03.glb`, 1.3), slotWithChair(`${D}/casino/slot-machine-aquarium-01.glb`),
                one(`${D}/casino/column-17.glb`, 2.6, {}, 0.5)],
            centre: [[{ model: `${D}/casino/tablecloth-01.glb`, width: 1.8 }, ...ring(`${D}/casino/chair-06.glb`, 0.9, 2.3)]],
        },
    ],
    small: { wall: [slotWithChair(`${D}/casino/slot-machine-01.glb`), one(`${D}/casino/flower-03.glb`, 1.3), one(`${D}/casino/atm-01.glb`, 1.8)], gap: [0.1, 0.9] },
};

const FORTRESS: Theme = {
    rooms: [
        { // training yard
            wall: [one(`${D}/kaykit/target-stand-a-decorated.glb`, 1.6), one(`${D}/kaykit/haybale.glb`, 0.7), one(`${D}/kaykit/barrel-a.glb`, 0.9),
                one(`${D}/kaykit/containers-crate-medium-wood.glb`, 0.6), one(`${D}/kaykit/lantern-standing.glb`, 1.3, {}, 0.6), one(`${D}/castle/rocks-small.glb`, 0.4, {}, 0.4)],
            centre: [[{ model: `${D}/kaykit/haybale.glb`, h: 0.7, dx: -1.2 }, { model: `${D}/kaykit/haybale.glb`, h: 0.7, dx: 1.2, deg: 20 },
                { model: `${D}/kaykit/barrel-a.glb`, h: 0.9, dz: 1.6 }]],
        },
        { // armory
            wall: [one(`${D}/kaykit/weaponrack-decorated.glb`, 1.7, {}, 1.6), one(`${D}/kaykit/ammo-box.glb`, 0.4), one(`${D}/kaykit/food-barrel-fish.glb`, 0.9),
                one(`${D}/kaykit/wood-log-stack.glb`, 0.9)],
        },
        { // siege hall
            wall: [one(`${D}/castle/flag-banner-long.glb`, 2.2, { soft: true }, 0.8), one(`${D}/castle/tree-log.glb`, 0.5), one(`${D}/kaykit/barrel-a.glb`, 0.9),
                one(`${D}/castle/siege-ballista.glb`, 1.6, {}, 0.8)],
            centre: [[{ model: `${D}/castle/siege-catapult.glb`, h: 2.0 }], [{ model: `${D}/castle/siege-ballista.glb`, h: 1.6 }]],
        },
    ],
    small: { wall: [one(`${D}/kaykit/weaponrack-decorated.glb`, 1.7), one(`${D}/kaykit/barrel-a.glb`, 0.9), one(`${D}/kaykit/ammo-box.glb`, 0.4)] },
};

const LAB: Theme = {
    rooms: [
        { // offices
            wall: [withChair(`${D}/kaykit/desk-decorated.glb`, 1.15, `${D}/kaykit/chair-desk-a.glb`, 1.35, 2.3), one(`${D}/kaykit/locker-decorated.glb`, 1.9)],
            centre: [[{ model: `${D}/kaykit/desk-decorated.glb`, h: 1.15, dz: -1.1, deg: 180 }, { model: `${D}/kaykit/desk-decorated.glb`, h: 1.15, dz: 1.1 },
                { model: `${D}/kaykit/chair-desk-a.glb`, h: 1.35, dz: -3.2 }, { model: `${D}/kaykit/chair-desk-a.glb`, h: 1.35, dz: 3.2, deg: 180 }]],
        },
        { // workshop
            wall: [one(`${D}/kaykit/workbench-decorated.glb`, 0.95, {}, 1.4), one(`${D}/kaykit/table-medium-decorated.glb`, 0.8), one(`${D}/kaykit/barrel-c.glb`, 0.9),
                one(`${D}/kaykit/fuel-a-barrels.glb`, 1.0)],
            centre: [[{ model: `${D}/kaykit/table-medium-decorated.glb`, h: 0.8 }, { model: `${D}/kaykit/barrel-c.glb`, h: 0.9, dx: 2.2 }, { model: `${D}/kaykit/barrel-c.glb`, h: 0.9, dx: -2.2 }]],
        },
        { // containment
            wall: [one(`${D}/kaykit/water-storage.glb`, 0.9), one(`${D}/kaykit/containers-a.glb`, 0.8), one(`${D}/kaykit/containers-c.glb`, 0.8),
                onTop(`${D}/kaykit/table-medium-decorated.glb`, 0.8, `${D}/kaykit/gem-large.glb`, 0.5)],
            centre: [[{ model: `${D}/kaykit/gems-pile-large.glb`, h: 0.8 }, ...[[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]].map(([dx, dz]) => ({ model: `${D}/kaykit/lights.glb`, h: 1.6, dx, dz }))]],
        },
    ],
    small: { wall: [one(`${D}/kaykit/locker-decorated.glb`, 1.9), one(`${D}/kaykit/barrel-c.glb`, 0.9), one(`${D}/kaykit/water-storage.glb`, 0.9)] },
};

const STATION: Theme = {
    rooms: [
        { // hangar
            wall: [one(`${D}/kaykit/cargo-a-stacked.glb`, 1.4, {}, 1.3), one(`${D}/kaykit/cargodepot-a.glb`, 1.4), one(`${D}/kaykit/fuel-b-barrels.glb`, 1.0), one(`${D}/kaykit/lights.glb`, 1.6, {}, 0.5)],
            centre: [[{ model: `${D}/kaykit/landingpad-small.glb`, width: 2.6, soft: true }]],
        },
        { // hydroponics
            wall: [one(`${D}/kaykit/space-farm-small.glb`, 0.6, {}, 1.6), one(`${D}/kaykit/water-storage.glb`, 0.9), one(`${D}/kaykit/lights.glb`, 1.6, {}, 0.4)],
            centre: [[-1.3, 1.3].flatMap((dx) => [-1.3, 1.3].map((dz) => ({ model: `${D}/kaykit/space-farm-small.glb`, h: 0.6, dx, dz })))],
            gap: [0.2, 1.2],
        },
        { // cargo hold
            wall: [one(`${D}/kaykit/containers-b.glb`, 0.9), one(`${D}/kaykit/containers-d.glb`, 0.9), one(`${D}/kaykit/cargo-b-packed.glb`, 1.0),
                one(`${D}/kaykit/locker.glb`, 1.9), one(`${D}/kaykit/solarpanel.glb`, 0.9, {}, 0.6)],
            centre: [[{ model: `${D}/kaykit/cargo-a-stacked.glb`, h: 1.4, dx: -0.9 }, { model: `${D}/kaykit/cargo-b-packed.glb`, h: 1.0, dx: 0.9 }]],
        },
    ],
    small: { wall: [one(`${D}/kaykit/locker.glb`, 1.9), one(`${D}/kaykit/cargo-b-packed.glb`, 1.0), one(`${D}/kaykit/fuel-b-barrels.glb`, 1.0)] },
};

const THEME_BY_WORLD: Record<string, Theme> = {
    'tutorial': HOUSE, 'world-1': BANK, 'world-2': MINT, 'world-3': MUSEUM, 'world-4': CASINO,
    'world-5': FORTRESS, 'world-6': LAB, 'world-7': STATION, 'world-8': HOUSE,
};

// ── Geometry helpers ──────────────────────────────────────────────────────────────────────────

interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
const rectAround = (x: number, z: number, hx: number, hz: number): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
const grow = (r: Rect, by: number): Rect => ({ minX: r.minX - by, maxX: r.maxX + by, minZ: r.minZ - by, maxZ: r.maxZ + by });
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const contains = (r: Rect, x: number, z: number) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
const round = (v: number) => Math.round(v * 100) / 100;
const hash = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
function rng(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const ratioCache = new Map<string, { w: number; d: number }>();
async function ratios(model: string): Promise<{ w: number; d: number }> {
    if (!ratioCache.has(model)) {
        const raw = model.replace(/^heist\//, 'heist{m}/');
        const document = await io.read(path.join(MODELS, raw));
        const { min, max } = getBounds(document.getRoot().getDefaultScene()!);
        const h = Math.max(max[1] - min[1], 1e-4);
        ratioCache.set(model, { w: (max[0] - min[0]) / h, d: (max[2] - min[2]) / h });
    }
    return ratioCache.get(model)!;
}

interface Placed { prop: LevelProp; rect: Rect; soft: boolean }

/** A part at world position/rotation → the level prop and its footprint. */
async function realise(part: Part, x: number, z: number, deg: number): Promise<Placed> {
    const { w, d } = await ratios(part.model);
    const turned = Math.round((((deg % 180) + 180) % 180)) === 90;
    let height = (part.h ?? 0) * UNITS_PER_METER;
    const prop: LevelProp = { model: part.model, x: round(x), z: round(z), rotationY: round((deg * Math.PI) / 180), height: round(height), revealAt: 0 };
    if (part.width) {
        prop.width = round(part.width * UNITS_PER_METER);
        height = prop.width / Math.max(w, d);
        prop.height = round(height);
    }
    if (part.elev) {
        prop.elevation = round(part.elev * UNITS_PER_METER);
    }
    if (FLAT_MODELS.test(part.model)) {
        prop.flat = true;
    }
    const hx = ((turned ? d : w) * height) / 2;
    const hz = ((turned ? w : d) * height) / 2;
    prop.collider = part.soft ? null : { halfX: round(hx * COLLIDER_SHRINK), halfY: round(height / 2 + (prop.elevation ?? 0) / 2), halfZ: round(hz * COLLIDER_SHRINK) };
    return { prop, rect: rectAround(x, z, hx, hz), soft: Boolean(part.soft) };
}

/** Rotates a local offset (dx = along, dz = out) by a facing in degrees (0 = +Z). */
function local(dx: number, dz: number, deg: number): [number, number] {
    const a = (deg * Math.PI) / 180;
    return [dx * Math.cos(a) + dz * Math.sin(a), -dx * Math.sin(a) + dz * Math.cos(a)];
}

// ── Dressing ──────────────────────────────────────────────────────────────────────────────────

const worlds: { worlds: { id: string; levels: string[]; styles?: { wall?: string } }[] } = JSON.parse(fs.readFileSync(path.join(LEVELS, 'worlds.json'), 'utf8'));
const wallStyles: { wall: Record<string, { height: number; thickness: number }> } = JSON.parse(fs.readFileSync(path.join(GAME, 'ui', 'worldstyles.json'), 'utf8'));

async function dress(level: LevelData, worldId: string): Promise<{ count: number; clearance: number }> {
    const theme = THEME_BY_WORLD[worldId];
    const random = rng(hash(level.id));
    const world = worlds.worlds.find((w) => w.id === worldId);
    const style = wallStyles.wall[world?.styles?.wall ?? level.styles?.wall ?? 'wallStyle1'];
    const wallBoxes: NavBox[] = level.walls.flatMap((wall) => PolyWallBuilder.colliderBoxes({
        ...wall, openings: wall.openings.map((o) => ({ kind: o.kind, rect: o })),
    } as never, { ...style, doorHeight: 4, tallDoorHeight: 5.5, windowHeight: 1.5 } as never) as NavBox[]);

    level.props = level.props.filter((prop) => !OWNED.some((prefix) => prop.model.startsWith(prefix)));
    const kept: NavBox[] = level.props.filter((p) => p.collider).map((p) => ({ x: p.x, z: p.z, halfX: p.collider!.halfX, halfZ: p.collider!.halfZ }));
    const floorRects = (level.floor.rects?.length ? level.floor.rects : [{ x: 0, z: 0, width: level.floor.width, depth: level.floor.depth }]);
    const rooms = floorRects.map((r) => rectAround(r.x, r.z, r.width / 2, r.depth / 2));
    const vault = level.vault ? rectAround(level.vault.x, level.vault.z, level.vault.width / 2, level.vault.depth / 2) : undefined;
    const safe = level.vault ? vaultSafe(level.vault) : undefined;
    const regions: NavRegion[] = [...floorRects, ...(level.entryPath ? [level.entryPath] : [])];

    // Keep-out zones.
    const blocked: Rect[] = [];
    const softBlocked: Rect[] = [];
    if (vault) blocked.push(grow(vault, 0.4));
    if (level.entryPath) blocked.push(rectAround(level.entryPath.x, level.entryPath.z, level.entryPath.width / 2, level.entryPath.depth / 2));
    for (const wall of level.walls) {
        for (const o of wall.openings) {
            const alongX = o.maxX - o.minX >= o.maxZ - o.minZ;
            const reach = o.kind === 'window' ? 0.9 : 2.2;
            const zone: Rect = alongX
                ? { minX: o.minX - 0.6, maxX: o.maxX + 0.6, minZ: o.minZ - reach, maxZ: o.maxZ + reach }
                : { minX: o.minX - reach, maxX: o.maxX + reach, minZ: o.minZ - 0.6, maxZ: o.maxZ + 0.6 };
            blocked.push(zone);
            softBlocked.push(zone);
        }
    }
    const members = level.squad?.length ? level.squad : [{ start: level.start, waypoints: level.waypoints }];
    const keyPoints: LevelPoint[] = members.flatMap((m) => [m.start, ...m.waypoints]);
    for (const p of keyPoints) blocked.push(rectAround(p.x, p.z, 1.6, 1.6));
    for (const l of level.loot) blocked.push(rectAround(l.x, l.z, 1.1, 1.1));
    for (const c of level.cameras ?? []) blocked.push(rectAround(c.x, c.z, 1.2, 1.2));
    for (const t of level.traps ?? []) {
        const zone = rectAround(t.x, t.z, t.width / 2 + 0.8, t.depth / 2 + 0.8);
        blocked.push(zone);
        softBlocked.push(zone);
    }
    if (level.sharedGoal && level.sharedGoal.enabled !== false) {
        blocked.push(rectAround(level.sharedGoal.x, level.sharedGoal.z, level.sharedGoal.width / 2 + 0.6, level.sharedGoal.depth / 2 + 0.6));
    }
    const guardLines: LevelPoint[][] = [
        ...(level.guards ?? []).map((g) => (g.loop && g.path.length > 2 ? [...g.path, g.path[0]] : g.path)),
        ...(level.drones ?? []).map((d) => d.path),
    ];
    const nearGuard = (r: Rect) => guardLines.some((line) => line.some((p, i) => {
        const q = line[Math.max(0, i - 1)];
        const steps = Math.max(1, Math.ceil(Math.hypot(p.x - q.x, p.z - q.z) / 0.3));
        for (let s = 0; s <= steps; s++) {
            if (contains(grow(r, 1.15), q.x + ((p.x - q.x) * s) / steps, q.z + ((p.z - q.z) * s) / steps)) return true;
        }
        return false;
    }));

    const insideFloor = (r: Rect) => [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]]
        .every(([x, z]) => rooms.some((room) => contains(room, x, z)) && !(vault && contains(vault, x, z)));
    const placed: Placed[] = [];
    const fits = (item: Placed) => {
        if (!insideFloor(item.rect)) return false;
        if (item.soft) return !softBlocked.some((zone) => overlaps(zone, item.rect));
        if (blocked.some((zone) => overlaps(zone, item.rect)) || nearGuard(item.rect)) return false;
        const walls = [...wallBoxes, ...kept, ...(safe ? [{ x: safe.x, z: safe.z, halfX: safe.halfX, halfZ: safe.halfZ }] : [])];
        if (walls.some((b) => overlaps(rectAround(b.x, b.z, b.halfX, b.halfZ), grow(item.rect, -0.02)))) return false;
        return !placed.some((other) => !other.soft && overlaps(grow(other.rect, 0.25), item.rect));
    };

    const obstaclesWith = (extra: Placed[]): NavBox[] => [
        ...wallBoxes, ...kept,
        ...(safe ? [{ x: safe.x, z: safe.z, halfX: safe.halfX, halfZ: safe.halfZ }] : []),
        ...[...placed, ...extra].filter((p) => p.prop.collider).map((p) => ({ x: p.prop.x, z: p.prop.z, halfX: p.prop.collider!.halfX, halfZ: p.prop.collider!.halfZ })),
    ];
    const reachable = (extra: Placed[], clearance: number) => {
        const grid = new NavGrid(regions, obstaclesWith(extra), clearance);
        return members.every((m) => {
            const stops = [m.start, ...m.waypoints];
            return stops.every((stop, i) => i === 0 || grid.findPath(stops[i - 1], stop))
                && level.loot.every((l) => grid.findPath(m.start, l));
        });
    };
    // Levels already tighter than the comfortable clearance keep the game's own.
    const clearance = reachable([], PLACE_CLEARANCE) ? PLACE_CLEARANCE : GAME_CLEARANCE;
    const tryPlace = async (parts: Part[], x: number, z: number, deg: number): Promise<boolean> => {
        const items: Placed[] = [];
        for (const part of parts) {
            const [ox, oz] = local(part.dx ?? 0, part.dz ?? 0, deg);
            items.push(await realise(part, x + ox, z + oz, deg + (part.deg ?? 0)));
        }
        // The first part is the anchor; companions that don't fit are just dropped.
        if (!fits(items[0])) return false;
        const accepted = [items[0], ...items.slice(1).filter((item, i) => {
            const ok = fits(item) && !items.slice(0, i + 1).some((prev) => !prev.soft && !item.soft && overlaps(prev.rect, item.rect));
            return ok;
        })];
        if (!reachable(accepted, clearance)) return false;
        placed.push(...accepted);
        return true;
    };
    // Room roles follow the heist: the room you enter gets the first kit (living room, lobby, dock...),
    // the one by the vault the last (cash room, bullion store...), the rest are mixed by level.
    const nearestRoom = (p: LevelPoint) => rooms.reduce((best, room, i) => {
        const dist = Math.hypot(Math.max(room.minX - p.x, 0, p.x - room.maxX), Math.max(room.minZ - p.z, 0, p.z - room.maxZ));
        return dist < best.dist ? { i, dist } : best;
    }, { i: 0, dist: Infinity }).i;
    const entryRoom = nearestRoom(members[0].start);
    const vaultRoom = level.vault ? nearestRoom(level.vault) : -1;
    const kitFor = (x: number, z: number): RoomKit => {
        const index = rooms.findIndex((room) => contains(room, x, z));
        if (index < 0) return theme.rooms[0];
        const room = rooms[index];
        if (Math.min(room.maxX - room.minX, room.maxZ - room.minZ) < SMALL_ROOM) return theme.small;
        if (index === entryRoom) return theme.rooms[0];
        if (index === vaultRoom) return theme.rooms[theme.rooms.length - 1];
        return theme.rooms[(hash(level.id) + index) % theme.rooms.length];
    };
    const uses = new Map<string, number>();
    let previous: WallItem | undefined;
    const pick = (kit: RoomKit): WallItem | undefined => {
        const options = kit.wall.filter((item) => item !== previous && (uses.get(item.parts[0].model) ?? 0) < MAX_PER_MODEL);
        if (!options.length) return undefined;
        const total = options.reduce((sum, item) => sum + (item.weight ?? 1), 0);
        let roll = random() * total;
        return options.find((item) => (roll -= item.weight ?? 1) <= 0) ?? options[0];
    };

    // Centre sets first, so the big pieces get the open floor.
    for (const [index, room] of rooms.entries()) {
        const w = room.maxX - room.minX;
        const d = room.maxZ - room.minZ;
        if (Math.min(w, d) < 8.5) continue;
        const kit = kitFor((room.minX + room.maxX) / 2, (room.minZ + room.maxZ) / 2);
        if (!kit.centre?.length) continue;
        const set = kit.centre[(hash(level.id) + index) % kit.centre.length];
        const spots: [number, number][] = [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3], [0.5, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5]];
        for (const [fx, fz] of spots) {
            if (await tryPlace(set, room.minX + w * fx, room.minZ + d * fz, 0)) break;
        }
    }

    // Wall pieces: walk every axis-aligned wall segment on each side that faces floor.
    const segments = level.walls.flatMap((wall) => {
        const count = wall.points.length - (wall.closed ? 0 : 1);
        return Array.from({ length: count }, (_, i) => [wall.points[i], wall.points[(i + 1) % wall.points.length]] as const);
    }).filter(([a, b]) => Math.abs(a.x - b.x) < 0.01 || Math.abs(a.z - b.z) < 0.01);
    const order = segments.map((s) => ({ s, k: random() })).sort((a, b) => a.k - b.k).map((e) => e.s);
    const half = (style?.thickness ?? 0.6) / 2;
    for (const [a, b] of order) {
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const ux = (b.x - a.x) / len;
        const uz = (b.z - a.z) / len;
        for (const side of [1, -1]) {
            const nx = -uz * side;
            const nz = ux * side;
            const deg = (Math.atan2(nx, nz) * 180) / Math.PI;
            let t = 0.6 + random() * 1.5;
            while (t < len - 0.6 && placed.length < MAX_PROPS) {
                const kit = kitFor(a.x + ux * t + nx * 1.2, a.z + uz * t + nz * 1.2);
                const item = pick(kit);
                if (!item) break;
                const anchor = await realise(item.parts[0], 0, 0, 0);
                const along = anchor.rect.maxX - anchor.rect.minX;
                const depth = anchor.rect.maxZ - anchor.rect.minZ;
                const runEnd = Math.max(along / 2, ...item.parts.map((p) => (p.dx ?? 0) + along / 2));
                const centreT = t + along / 2;
                if (centreT + runEnd - along / 2 > len - 0.4) break;
                const x = a.x + ux * centreT + nx * (half + depth / 2 + 0.05);
                const z = a.z + uz * centreT + nz * (half + depth / 2 + 0.05);
                const [gapMin, gapMax] = kit.gap ?? [0.4, 1.6];
                if (await tryPlace(item.parts, x, z, deg)) {
                    previous = item;
                    uses.set(item.parts[0].model, (uses.get(item.parts[0].model) ?? 0) + 1);
                    t += runEnd + along / 2 + gapMin + random() * (gapMax - gapMin);
                } else {
                    t += 0.5;
                }
            }
        }
    }

    // Final guarantee with the game's own clearance.
    if (!reachable([], GAME_CLEARANCE)) throw new Error(`${level.id}: dressing broke reachability`);
    level.props.push(...placed.map((p) => p.prop));
    return { count: placed.length, clearance };
}

(async () => {
    let total = 0;
    for (const world of worlds.worlds) {
        for (const id of world.levels) {
            if (ONLY.length && !ONLY.includes(id)) continue;
            const file = path.join(LEVELS, `${id}.json`);
            const raw = fs.readFileSync(file, 'utf8');
            const level: LevelData = JSON.parse(raw);
            const { count, clearance } = await dress(level, world.id);
            total += count;
            console.log(`${world.id.padEnd(9)} ${id.padEnd(16)} ${String(count).padStart(3)} props${clearance < PLACE_CLEARANCE ? '  (tight level: game clearance)' : ''}`);
            if (!DRY) {
                const eol = raw.includes('\r\n') ? '\r\n' : '\n';
                fs.writeFileSync(file, `${JSON.stringify(level, null, 2)}\n`.replace(/\n/g, eol));
            }
        }
    }
    console.log(`✅ ${total} props ${DRY ? 'would be ' : ''}placed`);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
