// bandit-showcase-levels.mjs
//
// Writes the Bandit Controller dressing previews (games/bandit-controller/levels/showcase/*.json):
// one small furnished building per world theme, opened from the in-game debug menu ("Showcase")
// to judge prop choice and scale before dressing the real levels. No guards, so props can be
// inspected in peace. Prop sizes are written in METERS and converted with UNITS_PER_METER, sized
// for the chibi characters (a character is ~3.5 units tall). Colliders come from each model's real
// bounds (scripts/bandit-import-decor.mjs must have run first).
//
//   node scripts/bandit-showcase-levels.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = path.join(ROOT, 'games', 'bandit-controller');
const MODELS = path.join(GAME, 'raw-assets', 'models');
const OUT = path.join(GAME, 'levels', 'showcase');
const WORLDS = JSON.parse(fs.readFileSync(path.join(GAME, 'levels', 'worlds.json'), 'utf8')).worlds;

const UNITS_PER_METER = 1.7;
const DOOR_WIDTH = 4.2;
const WALL_HALF = 0.3;
/** Colliders are a touch smaller than the mesh so routes can hug furniture. */
const COLLIDER_SHRINK = 0.9;
/** Floor coverings: drawn as thin decals in game so routes and goal markers stay on top. */
const FLAT_MODELS = /\/(rug-[^/]*|floor-01|landingpad-small)\.glb$/;
const LOOT_MODEL = 'resources/Money_Bills_Stack_Small.gltf';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const boundsCache = new Map();
const round = (value) => Math.round(value * 100) / 100;

/** Native size of a model as ratios of its height: { w, d } (x and z extents / y extent). */
async function ratios(model) {
    if (!boundsCache.has(model)) {
        const raw = model.replace(/^heist\//, 'heist{m}/').replace(/^resources\//, 'resources{m}/');
        const document = await io.read(path.join(MODELS, raw));
        const { min, max } = getBounds(document.getRoot().getDefaultScene());
        const height = Math.max(max[1] - min[1], 1e-4);
        boundsCache.set(model, { w: (max[0] - min[0]) / height, d: (max[2] - min[2]) / height });
    }
    return boundsCache.get(model);
}

/**
 * A row of full-width rooms running from +Z (entrance) to -Z (the player's direction).
 * rooms[i] = { depth, door?: x of the door into the NEXT room, split?: { x, doorZ } (a side wall
 * with a door, splitting the room in two) }.
 */
function building(width, rooms, entryX = 0) {
    const total = rooms.reduce((sum, room) => sum + room.depth, 0);
    const top = total / 2;
    const half = width / 2;
    const rects = [];
    const walls = [];
    const outer = {
        closed: true,
        points: [{ x: -half, z: -top }, { x: half, z: -top }, { x: half, z: top }, { x: -half, z: top }],
        openings: [{ kind: 'door', minX: entryX - DOOR_WIDTH / 2, maxX: entryX + DOOR_WIDTH / 2, minZ: top - WALL_HALF, maxZ: top + WALL_HALF }],
    };
    walls.push(outer);
    const bounds = [];
    let z = top;
    rooms.forEach((room, index) => {
        const near = z;
        const far = z - room.depth;
        bounds.push({ near, far });
        rects.push({ x: 0, z: round((near + far) / 2), width, depth: room.depth });
        if (index < rooms.length - 1) {
            const doorX = room.door ?? 0;
            walls.push({
                closed: false,
                points: [{ x: -half, z: far }, { x: half, z: far }],
                openings: [{ kind: 'door', minX: doorX - DOOR_WIDTH / 2, maxX: doorX + DOOR_WIDTH / 2, minZ: far - WALL_HALF, maxZ: far + WALL_HALF }],
            });
        }
        if (room.split) {
            const doorHalf = (room.split.doorWidth ?? 3.4) / 2;
            walls.push({
                closed: false,
                points: [{ x: room.split.x, z: near }, { x: room.split.x, z: far }],
                openings: [{ kind: 'door', minX: room.split.x - WALL_HALF, maxX: room.split.x + WALL_HALF, minZ: room.split.doorZ - doorHalf, maxZ: room.split.doorZ + doorHalf }],
            });
        }
        z = far;
    });
    return { width, depth: total, top, rects, walls, rooms: bounds };
}

/** Prop sized in meters. opts: { width (m, footprint instead of height), elev (m), solid (default true), reveal } */
async function prop(model, x, z, degrees, meters, opts = {}) {
    const { w, d } = await ratios(model);
    const turned = Math.round(((degrees % 180) + 180) % 180) === 90;
    let height = meters * UNITS_PER_METER;
    const entry = { model, x: round(x), z: round(z), rotationY: round((degrees * Math.PI) / 180), height: round(height), revealAt: opts.reveal ?? 0 };
    if (opts.width) {
        entry.width = round(opts.width * UNITS_PER_METER);
        height = entry.width / Math.max(w, d);
        entry.height = round(height);
    }
    if (opts.elev) {
        entry.elevation = round(opts.elev * UNITS_PER_METER);
    }
    if (FLAT_MODELS.test(model)) {
        entry.flat = true;
    }
    const sizeX = (turned ? d : w) * height;
    const sizeZ = (turned ? w : d) * height;
    entry.collider = opts.solid === false ? null : {
        halfX: round((sizeX / 2) * COLLIDER_SHRINK),
        halfY: round(height / 2 + (entry.elevation ?? 0) / 2),
        halfZ: round((sizeZ / 2) * COLLIDER_SHRINK),
    };
    return entry;
}

const loot = (x, z, amount = 25) => ({ model: LOOT_MODEL, x, z, amount, scale: 1.35, revealAt: 0 });

function stylesFor(worldId) {
    const world = WORLDS.find((entry) => entry.id === worldId);
    return { ...world.styles, door: 'doorStyle1', window: 'windowStyle1' };
}

async function level(id, name, worldId, shell, waypoints, props, lootItems) {
    return {
        id,
        name,
        grid: { cell: 0.5 },
        floor: { width: shell.width, depth: shell.depth, rects: shell.rects },
        start: { x: 0, z: round(shell.top + 3) },
        waypoints,
        entryPath: { x: 0, z: round(shell.top + 3), width: 4, depth: 4 },
        walls: shell.walls,
        props: await Promise.all(props),
        loot: lootItems,
        guards: [],
        styles: stylesFor(worldId),
    };
}

const D = 'heist/decor';
const SHOWCASES = [];

// ── Suburban house (Training Day + Suburban Homes) ────────────────────────────────────────────
{
    // Living room → kitchen/dining → bedroom | bathroom.
    const shell = building(18, [{ depth: 11, door: 5 }, { depth: 11, door: -5 }, { depth: 11, split: { x: 2, doorZ: -9 } }]);
    SHOWCASES.push(level('showcase-house', 'Showcase: House', 'world-8', shell,
        [{ x: 5, z: 8 }, { x: -5, z: -2 }, { x: 5.5, z: -12.5 }],
        [
            // Living room
            prop(`${D}/kaykit/rug-rectangle-stripes-a.glb`, -4.2, 11, 90, 0, { width: 3.9, solid: false }),
            prop(`${D}/cute/couch-08.glb`, -7.7, 11, 90, 1.15),
            prop(`${D}/cute/coffee-table-03.glb`, -4.2, 11, 0, 0.6),
            prop(`${D}/cute/armchair-18.glb`, -4.2, 7.4, 0, 1.2),
            prop(`${D}/cute/armchair-18.glb`, -4.2, 14.6, 180, 1.2),
            prop(`${D}/kaykit/lamp-standing.glb`, -8.1, 15.7, 0, 2.1),
            prop(`${D}/cute/plants-19.glb`, 8, 15.6, 0, 1.6),
            prop(`${D}/cute/plants-15.glb`, -8.1, 6.4, 0, 1.4),
            prop(`${D}/kaykit/shelf-b-large-decorated.glb`, 8.1, 12.4, 270, 1.05),
            prop(`${D}/cute/clock-03.glb`, 8.3, 7.8, 270, 2.4),
            // Kitchen + dining
            prop(`${D}/kaykit/kitchencounter-straight-a-decorated.glb`, -7.8, 4.4, 90, 1.25),
            prop(`${D}/kaykit/kitchencounter-sink.glb`, -7.8, 2.3, 90, 1.25),
            prop(`${D}/kaykit/kitchencounter-straight-a-decorated.glb`, -7.8, 0.2, 90, 1.25),
            prop(`${D}/cute/fridge-01.glb`, -7.9, -2.1, 90, 2.3),
            prop(`${D}/cute/kitchen-table-09.glb`, 4.4, -2.4, 0, 1.0),
            prop(`${D}/kaykit/chair-a-wood.glb`, 3.3, -0.2, 180, 1.2),
            prop(`${D}/kaykit/chair-a-wood.glb`, 5.5, -0.2, 180, 1.2),
            prop(`${D}/kaykit/chair-a-wood.glb`, 3.3, -4.6, 0, 1.2),
            prop(`${D}/kaykit/chair-a-wood.glb`, 5.5, -4.6, 0, 1.2),
            prop(`${D}/cute/plants-15.glb`, 8.1, 4.6, 0, 1.4),
            // Bedroom
            prop(`${D}/kaykit/rug-oval-a.glb`, -5.5, -9.6, 0, 0, { width: 2.8, solid: false }),
            prop(`${D}/cute/bed-02.glb`, -5.5, -13.7, 0, 0, { width: 2.8 }),
            prop(`${D}/cute/nightstand-02.glb`, -8.4, -15.5, 0, 0.75),
            prop(`${D}/cute/nightstand-02.glb`, -2.6, -15.5, 0, 0.75),
            prop(`${D}/cute/closet-01.glb`, 1.1, -14.4, 270, 2.4),
            // Bathroom
            prop(`${D}/cute/bath-03.glb`, 6.7, -15.1, 0, 0, { width: 2.4 }),
            prop(`${D}/cute/toilet-03.glb`, 8.1, -8.2, 270, 1.05),
            prop(`${D}/cute/wash-basin-07.glb`, 3.2, -15.6, 0, 1.25),
        ],
        [loot(-1.6, 12.8), loot(7.6, 2), loot(-0.8, -11, 50), loot(8, -11.6, 50)],
    ));
}

// ── Downtown Bank ─────────────────────────────────────────────────────────────────────────────
{
    // Lobby with a roped queue → teller line → back office | cash vault.
    const shell = building(18, [{ depth: 11, door: 5 }, { depth: 11, door: -5 }, { depth: 11, split: { x: 1, doorZ: -9 } }]);
    const queue = [];
    for (const z of [12.4, 9.6]) {
        for (const x of [0.6, 3.2, 5.8]) {
            queue.push(prop(`${D}/casino/fence-07.glb`, x, z, 0, 1.0));
        }
        queue.push(prop(`${D}/casino/fence-09.glb`, 1.9, z, 0, 0, { width: 1.45, elev: 0.55, solid: false }));
        queue.push(prop(`${D}/casino/fence-09.glb`, 4.5, z, 0, 0, { width: 1.45, elev: 0.55, solid: false }));
    }
    const tellers = [];
    for (const x of [-7, -3.7, 3.7, 7]) {
        tellers.push(prop(`${D}/kaykit/desk-large-decorated.glb`, x, -1, 180, 1.0));
        tellers.push(prop(`${D}/casino/chair-office-01.glb`, x, -3.5, 180, 1.3));
    }
    SHOWCASES.push(level('showcase-bank', 'Showcase: Bank', 'world-1', shell,
        [{ x: 5, z: 7.5 }, { x: 0, z: 0 }, { x: 5, z: -12.5 }],
        [
            // Lobby
            prop(`${D}/kaykit/rug-rectangle-a.glb`, -5.2, 11, 90, 0, { width: 3, solid: false }),
            prop(`${D}/casino/couch-05.glb`, -7.9, 11, 90, 0.9),
            prop(`${D}/casino/armchair-02.glb`, -5.2, 14.3, 180, 0.95),
            prop(`${D}/casino/armchair-02.glb`, -5.2, 7.7, 0, 0.95),
            prop(`${D}/casino/flower-03.glb`, -8, 15.6, 0, 1.3),
            prop(`${D}/casino/flower-03.glb`, 8, 6.5, 0, 1.3),
            prop(`${D}/casino/atm-01.glb`, 8, 15, 270, 1.8),
            prop(`${D}/casino/atm-03.glb`, 8, 11.8, 270, 1.8),
            ...queue,
            // Teller line: a row of desks with staff chairs behind them
            ...tellers,
            prop(`${D}/kaykit/cabinet-medium-decorated.glb`, 6.5, -4.9, 0, 1.0),
            prop(`${D}/casino/flower-03.glb`, -8, 4.6, 0, 1.3),
            prop(`${D}/casino/flower-03.glb`, 8, 4.6, 0, 1.3),
            // Back office
            prop(`${D}/kaykit/desk-large-decorated.glb`, -4.5, -14.9, 0, 1.0),
            prop(`${D}/casino/chair-office-01.glb`, -4.5, -12.4, 180, 1.3),
            prop(`${D}/kaykit/cabinet-medium-decorated.glb`, -8.3, -9.5, 90, 1.0),
            prop(`${D}/casino/flower-03.glb`, 0.2, -15.6, 0, 1.3),
            // Cash vault
            prop(`${D}/casino/safe-box-01.glb`, 7.8, -15.4, 0, 1.4),
            prop(`${D}/casino/safe-box-01.glb`, 5.6, -15.4, 0, 1.4),
            prop(`${D}/kaykit/table-medium-long.glb`, 7.9, -10, 90, 0.8),
            prop(`${D}/casino/cash-machine-01.glb`, 7.9, -8.8, 270, 0.35, { elev: 0.8, solid: false }),
            prop(`${D}/casino/cash-10.glb`, 7.9, -11, 0, 0.25, { elev: 0.8, solid: false }),
        ],
        [loot(-2, 13.5), loot(-7.5, -2.5, 50), loot(-7, -8), loot(3, -14.5, 75)],
    ));
}

// ── Mint Vault ────────────────────────────────────────────────────────────────────────────────
{
    // Loading dock → counting room → gold vault.
    const shell = building(18, [{ depth: 11, door: 5 }, { depth: 11, door: -5 }, { depth: 11 }]);
    const palletGold = (x, z, stack) => [
        prop(`${D}/kaykit/pallet-wood.glb`, x, z, 0, 0, { width: 1.4, solid: true }),
        prop(`${D}/kaykit/${stack}.glb`, x, z, 0, 0.55, { elev: 0.25, solid: false }),
    ];
    SHOWCASES.push(level('showcase-mint', 'Showcase: Mint', 'world-2', shell,
        [{ x: 5, z: 7.5 }, { x: -5, z: -2 }, { x: 3, z: -11 }],
        [
            // Loading dock
            ...palletGold(-6.4, 13.6, 'gold-bars-stack-large'),
            ...palletGold(-6.4, 9.8, 'silver-bars-stack-large'),
            ...palletGold(-2.8, 13.6, 'gold-bars-stack-large'),
            prop(`${D}/kaykit/containers-crate-large.glb`, 7.6, 14.8, 0, 1.0),
            prop(`${D}/kaykit/containers-crate-large.glb`, 7.6, 12.6, 0, 1.0),
            prop(`${D}/kaykit/containers-box-medium.glb`, 5.2, 15.3, 0, 0.5),
            prop(`${D}/kaykit/workbench-decorated.glb`, 8.2, 8.6, 270, 0.95),
            prop(`${D}/kaykit/locker-decorated.glb`, -8.4, 6.8, 90, 1.9),
            // Counting room
            prop(`${D}/kaykit/table-medium-long.glb`, -4.5, 2, 0, 0.8),
            prop(`${D}/kaykit/table-medium-long.glb`, -4.5, -1.6, 0, 0.8),
            prop(`${D}/kaykit/money-bills-stack-large.glb`, -5.6, 2, 0, 0.3, { elev: 0.8, solid: false }),
            prop(`${D}/kaykit/money-bills-stack-large.glb`, -3.4, 2, 0, 0.3, { elev: 0.8, solid: false }),
            prop(`${D}/casino/cash-machine-01.glb`, -5.4, -1.6, 0, 0.35, { elev: 0.8, solid: false }),
            prop(`${D}/kaykit/money-bills-stack-large.glb`, -3.4, -1.6, 0, 0.3, { elev: 0.8, solid: false }),
            prop(`${D}/kaykit/money-pile-large.glb`, 7.2, -3.6, 0, 0.9),
            prop(`${D}/kaykit/pallet-wood-covered-a.glb`, 7.2, 2.4, 0, 0, { width: 1.5 }),
            prop(`${D}/kaykit/locker-decorated.glb`, 8.4, -0.6, 270, 1.9),
            prop(`${D}/kaykit/locker-decorated.glb`, 8.4, 0.6, 270, 1.9),
            // Gold vault
            ...[-7.4, -4.8, -2.2].flatMap((x) => [
                ...palletGold(x, -15.2, 'gold-bars-stack-large'),
                ...palletGold(x, -12.2, x === -4.8 ? 'silver-bars-stack-large' : 'gold-bars-stack-large'),
            ]),
            prop(`${D}/kaykit/money-pile-large.glb`, 7.6, -15.4, 0, 0.9),
            prop(`${D}/casino/safe-box-01.glb`, 8, -11.5, 270, 1.4),
            prop(`${D}/casino/safe-box-01.glb`, 8, -9.2, 270, 1.4),
        ],
        [loot(-1, 9.5), loot(1.5, -1.5, 50), loot(0.4, -15, 75)],
    ));
}

// ── Sunset Museum ─────────────────────────────────────────────────────────────────────────────
{
    // Painting gallery → artifact hall → the big exhibit.
    const shell = building(20, [{ depth: 11, door: 5 }, { depth: 11, door: -5 }, { depth: 12 }]);
    const roped = (x, z, w, d) => {
        const hx = w / 2;
        const hz = d / 2;
        const items = [];
        for (const [px, pz] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) {
            items.push(prop(`${D}/casino/fence-07.glb`, x + px, z + pz, 0, 1.0));
        }
        const ropeX = (w / UNITS_PER_METER) - 0.15;
        const ropeZ = (d / UNITS_PER_METER) - 0.15;
        items.push(prop(`${D}/casino/fence-09.glb`, x, z - hz, 0, 0, { width: ropeX, elev: 0.55, solid: false }));
        items.push(prop(`${D}/casino/fence-09.glb`, x, z + hz, 0, 0, { width: ropeX, elev: 0.55, solid: false }));
        items.push(prop(`${D}/casino/fence-09.glb`, x - hx, z, 90, 0, { width: ropeZ, elev: 0.55, solid: false }));
        items.push(prop(`${D}/casino/fence-09.glb`, x + hx, z, 90, 0, { width: ropeZ, elev: 0.55, solid: false }));
        // The exhibit area itself stays solid so routes go round the ropes.
        items.push(Promise.resolve({ model: `${D}/kaykit/primitive-cube-small.glb`, x, z, rotationY: 0, height: 0.01, revealAt: 0, collider: { halfX: hx, halfY: 0.5, halfZ: hz } }));
        return items;
    };
    const plinth = (x, z, item, meters) => [
        prop(`${D}/kaykit/primitive-cube-small.glb`, x, z, 0, 0.9),
        prop(`${D}/${item}`, x, z, 0, meters, { elev: 0.9, solid: false }),
    ];
    SHOWCASES.push(level('showcase-museum', 'Showcase: Museum', 'world-3', shell,
        [{ x: 5, z: 8 }, { x: -5, z: -2 }, { x: 5.5, z: -12 }],
        [
            // Gallery
            prop(`${D}/kaykit/pictureframe-standing-a.glb`, -9, 13.5, 90, 1.6),
            prop(`${D}/kaykit/pictureframe-standing-b.glb`, -9, 9.5, 90, 1.6),
            prop(`${D}/kaykit/pictureframe-standing-b.glb`, 9, 13.5, 270, 1.6),
            prop(`${D}/kaykit/pictureframe-standing-a.glb`, 9, 9.5, 270, 1.6),
            prop(`${D}/casino/couch-05.glb`, -3.4, 11, 90, 1.1),
            prop(`${D}/casino/column-17.glb`, -9.2, 15.7, 0, 2.6),
            prop(`${D}/casino/column-17.glb`, 9.2, 15.7, 0, 2.6),
            prop(`${D}/casino/column-17.glb`, -9.2, 6.3, 0, 2.6),
            prop(`${D}/casino/column-17.glb`, 9.2, 6.3, 0, 2.6),
            prop(`${D}/cute/plants-19.glb`, 2.8, 15.6, 0, 1.3),
            // Artifact hall
            ...plinth(-7.5, 3.5, 'mixed/idol-a.glb', 0.7),
            ...plinth(-7.5, -0.5, 'mixed/idol-b.glb', 0.7),
            ...plinth(8.4, 3.5, 'mixed/guitar-a.glb', 1.0),
            ...plinth(8.4, -3.6, 'kaykit/gems-chest.glb', 0.6),
            prop(`${D}/kaykit/rug-rectangle-b.glb`, 1.5, -1.2, 90, 0, { width: 3, solid: false }),
            prop(`${D}/kaykit/coffin-decorated.glb`, 1.5, -1.2, 0, 0, { width: 1.9, solid: false }),
            ...roped(1.5, -1.2, 3.6, 5.4),
            // Big exhibit
            prop(`${D}/kaykit/rug-rectangle-b.glb`, -3.5, -12.5, 0, 0, { width: 4, solid: false }),
            prop(`${D}/castle/siege-catapult.glb`, -3.5, -12.5, 90, 1.8, { solid: false }),
            ...roped(-3.5, -12.5, 6.4, 4.4),
            prop(`${D}/kaykit/shrine-candles.glb`, 8.6, -16.5, 0, 0.9),
            prop(`${D}/kaykit/pillar-b.glb`, -9.2, -6.3, 0, 2.4),
            prop(`${D}/kaykit/pillar-b.glb`, 9.2, -6.3, 0, 2.4),
            prop(`${D}/cute/plants-19.glb`, -9, -16.6, 0, 1.3),
        ],
        [loot(-6, 13), loot(5, -4.5, 50), loot(-9, -10.5, 50), loot(2, -16, 75)],
    ));
}

// ── Night Casino ──────────────────────────────────────────────────────────────────────────────
{
    // Entrance lounge + cashier → slot floor → card tables.
    const shell = building(20, [{ depth: 11, door: 5 }, { depth: 12, door: -5 }, { depth: 11 }]);
    const slots = [];
    const models = ['slot-machine-01', 'slot-machine-02'];
    [-8.4, -7.2, -6, -4.8, -3.6, -2.4].forEach((x, index) => {
        slots.push(prop(`${D}/casino/${models[index % 2]}.glb`, x, 1.6, 0, 1.9));
        slots.push(prop(`${D}/casino/chair-06.glb`, x, 3.2, 0, 0.9));
        slots.push(prop(`${D}/casino/${models[(index + 1) % 2]}.glb`, x, 0.4, 180, 1.9));
        slots.push(prop(`${D}/casino/chair-06.glb`, x, -1.2, 180, 0.9));
    });
    [-2.6, -1.4, -0.2, 1, 2.2].forEach((z) => slots.push(prop(`${D}/casino/slot-machine-aquarium-01.glb`, 9.3, z, 270, 1.9)));
    const pokerTable = (x, z) => [
        prop(`${D}/casino/tablecloth-01.glb`, x, z, 0, 0, { width: 1.8 }),
        ...[0, 90, 180, 270].map((degrees) => {
            const angle = (degrees * Math.PI) / 180;
            return prop(`${D}/casino/chair-06.glb`, x + Math.sin(angle) * 2.3, z + Math.cos(angle) * 2.3, degrees + 180, 0.9);
        }),
    ];
    SHOWCASES.push(level('showcase-casino', 'Showcase: Casino', 'world-4', shell,
        [{ x: 5, z: 8 }, { x: 4.5, z: -3.5 }, { x: 5, z: -12.5 }],
        [
            // Entrance lounge + cashier
            prop(`${D}/casino/floor-01.glb`, -4.5, 11.5, 0, 0, { width: 4.5, elev: 0.01, solid: false }),
            prop(`${D}/casino/neon-sign-01.glb`, -4.5, 6.2, 0, 1.3, { elev: 0.4 }),
            prop(`${D}/casino/couch-05.glb`, -4.5, 14.8, 180, 0.9),
            prop(`${D}/casino/armchair-02.glb`, -8.2, 11.5, 90, 0.95),
            prop(`${D}/casino/table-01.glb`, -4.5, 11.5, 0, 0.6),
            prop(`${D}/casino/fruits-01.glb`, -4.5, 11.5, 0, 0.25, { elev: 0.6, solid: false }),
            prop(`${D}/casino/column-17.glb`, -9.3, 16, 0, 2.6),
            prop(`${D}/casino/flower-03.glb`, -9.1, 6.6, 0, 1.3),
            prop(`${D}/casino/table-06.glb`, 7.6, 11.5, 270, 0.95),
            prop(`${D}/casino/cash-machine-01.glb`, 7.6, 12.4, 270, 0.35, { elev: 0.95, solid: false }),
            prop(`${D}/casino/atm-01.glb`, 9.1, 15.4, 270, 1.8),
            // Slot floor
            ...slots,
            // Card tables
            ...pokerTable(-4.5, -11),
            ...pokerTable(1.5, -14),
            prop(`${D}/casino/couch-05.glb`, 8.4, -8.5, 270, 0.9),
            prop(`${D}/casino/flower-03.glb`, 9.1, -16.5, 0, 1.3),
            prop(`${D}/casino/flower-03.glb`, -9.1, -16.5, 0, 1.3),
        ],
        [loot(-1.5, 14), loot(7, -1.5, 50), loot(-8.6, -14.5, 75)],
    ));
}

// ── Fortress ──────────────────────────────────────────────────────────────────────────────────
{
    // Training yard → armory → siege hall.
    const shell = building(18, [{ depth: 11, door: 5 }, { depth: 11, door: -5 }, { depth: 11 }]);
    SHOWCASES.push(level('showcase-fortress', 'Showcase: Fortress', 'world-5', shell,
        [{ x: 5, z: 8 }, { x: -5, z: -2 }, { x: 4, z: -11 }],
        [
            // Training yard
            prop(`${D}/kaykit/target-stand-a-decorated.glb`, -7.8, 14.8, 0, 1.6),
            prop(`${D}/kaykit/target-stand-a-decorated.glb`, -5.4, 14.8, 0, 1.6),
            prop(`${D}/kaykit/haybale.glb`, -7, 10, 0, 0.7),
            prop(`${D}/kaykit/haybale.glb`, -6.6, 8.4, 20, 0.7),
            prop(`${D}/kaykit/barrel-a.glb`, 8.1, 15.6, 0, 0.9),
            prop(`${D}/kaykit/barrel-a.glb`, 7.1, 15.2, 0, 0.9),
            prop(`${D}/kaykit/containers-crate-medium-wood.glb`, 8, 13, 90, 0.6),
            prop(`${D}/kaykit/lantern-standing.glb`, -2.7, 15.9, 0, 1.3),
            prop(`${D}/kaykit/lantern-standing.glb`, 2.7, 15.9, 0, 1.3),
            prop(`${D}/castle/rocks-small.glb`, 8, 7, 0, 0.4),
            // Armory
            prop(`${D}/kaykit/weaponrack-decorated.glb`, -8.4, 3.5, 90, 1.7),
            prop(`${D}/kaykit/weaponrack-decorated.glb`, -8.4, 1, 90, 1.7),
            prop(`${D}/kaykit/weaponrack-decorated.glb`, 8.4, -1, 270, 1.7),
            prop(`${D}/kaykit/weaponrack-decorated.glb`, 8.4, -3.5, 270, 1.7),
            prop(`${D}/kaykit/ammo-box.glb`, -6.2, -1.6, 0, 0.4),
            prop(`${D}/kaykit/ammo-box.glb`, -6.2, -2.6, 15, 0.4),
            prop(`${D}/kaykit/food-barrel-fish.glb`, 8.3, 4.6, 0, 0.9),
            prop(`${D}/kaykit/wood-log-stack.glb`, 2, -4.4, 0, 0.9),
            // Siege hall
            prop(`${D}/castle/siege-ballista.glb`, -5, -9.5, 0, 1.6),
            prop(`${D}/castle/siege-catapult.glb`, -5, -14.5, 0, 2.0),
            prop(`${D}/castle/flag-banner-long.glb`, 2.5, -16, 90, 2.2, { solid: false }),
            prop(`${D}/castle/flag-banner-long.glb`, 7.5, -16, 90, 2.2, { solid: false }),
            prop(`${D}/castle/tree-log.glb`, 8, -7.5, 0, 0.5),
            prop(`${D}/castle/rocks-small.glb`, -8.2, -6.8, 0, 0.4),
        ],
        [loot(-3, 9), loot(-7.5, -4.5, 50), loot(-1, -15.5, 75)],
    ));
}

// ── Neon Lab ──────────────────────────────────────────────────────────────────────────────────
{
    // Offices → workshop → containment.
    const shell = building(18, [{ depth: 11, door: 5 }, { depth: 11, door: -5 }, { depth: 11 }]);
    const desk = (x, z) => [
        prop(`${D}/kaykit/desk-decorated.glb`, x, z, 0, 1.15),
        prop(`${D}/kaykit/chair-desk-a.glb`, x, z + 2.3, 180, 1.35),
    ];
    SHOWCASES.push(level('showcase-lab', 'Showcase: Lab', 'world-6', shell,
        [{ x: 5, z: 8 }, { x: -5, z: -2 }, { x: 4, z: -11 }],
        [
            // Offices
            ...desk(-6.7, 13.6),
            ...desk(-2.3, 13.6),
            ...desk(-6.7, 8.2),
            prop(`${D}/kaykit/locker-decorated.glb`, 8.4, 15.3, 270, 1.9),
            prop(`${D}/kaykit/locker-decorated.glb`, 8.4, 14.1, 270, 1.9),
            prop(`${D}/kaykit/locker-decorated.glb`, 8.4, 12.9, 270, 1.9),
            // Workshop
            prop(`${D}/kaykit/workbench-decorated.glb`, -8.2, 3, 90, 0.95),
            prop(`${D}/kaykit/workbench-decorated.glb`, -8.2, 0, 90, 0.95),
            prop(`${D}/kaykit/table-medium-decorated.glb`, 5.5, -1.5, 0, 0.8),
            prop(`${D}/kaykit/barrel-c.glb`, 8.3, 4.6, 0, 0.9),
            prop(`${D}/kaykit/barrel-c.glb`, 7.2, 4.8, 0, 0.9),
            prop(`${D}/kaykit/fuel-a-barrels.glb`, 8, -4.4, 0, 1.0),
            // Containment
            prop(`${D}/kaykit/gems-pile-large.glb`, -4.5, -12, 0, 0.8),
            prop(`${D}/kaykit/lights.glb`, -7.4, -9.6, 0, 1.6),
            prop(`${D}/kaykit/lights.glb`, -1.6, -9.6, 0, 1.6),
            prop(`${D}/kaykit/lights.glb`, -7.4, -14.4, 0, 1.6),
            prop(`${D}/kaykit/lights.glb`, -1.6, -14.4, 0, 1.6),
            prop(`${D}/kaykit/table-medium-decorated.glb`, 7.8, -8.6, 270, 0.8),
            prop(`${D}/kaykit/gem-large.glb`, 7.8, -8.6, 0, 0.5, { elev: 0.8, solid: false }),
            prop(`${D}/kaykit/water-storage.glb`, 7.5, -14.8, 0, 0.9),
            prop(`${D}/kaykit/containers-a.glb`, 2.2, -15.5, 0, 0.8),
        ],
        [loot(-0.5, 9.5), loot(1.5, 3.5, 50), loot(-4.5, -16, 75)],
    ));
}

// ── Orbital Station ───────────────────────────────────────────────────────────────────────────
{
    // Hangar → hydroponics → cargo hold.
    const shell = building(20, [{ depth: 11, door: 5 }, { depth: 11, door: -5 }, { depth: 11 }]);
    const farms = [];
    for (const x of [-7.6, -5.2]) {
        for (const z of [3, 0.4, -2.2]) {
            farms.push(prop(`${D}/kaykit/space-farm-small.glb`, x, z, 0, 0.6));
        }
    }
    SHOWCASES.push(level('showcase-station', 'Showcase: Station', 'world-7', shell,
        [{ x: 5, z: 8 }, { x: -5, z: -2 }, { x: 4, z: -11 }],
        [
            // Hangar
            prop(`${D}/kaykit/landingpad-small.glb`, -5, 11, 0, 0, { width: 2.6, solid: false }),
            prop(`${D}/kaykit/cargo-a-stacked.glb`, -8.6, 15.3, 0, 1.4),
            prop(`${D}/kaykit/cargo-a-stacked.glb`, -7, 15.3, 0, 1.4),
            prop(`${D}/kaykit/cargodepot-a.glb`, 7.6, 14.4, 0, 1.4),
            prop(`${D}/kaykit/fuel-b-barrels.glb`, 8.2, 8, 0, 1.0),
            prop(`${D}/kaykit/lights.glb`, -1.7, 15.8, 0, 1.6),
            // Hydroponics
            ...farms,
            prop(`${D}/kaykit/water-storage.glb`, 8.2, 3, 0, 0.9),
            prop(`${D}/kaykit/water-storage.glb`, 8.2, -1.6, 0, 0.9),
            prop(`${D}/kaykit/lights.glb`, -2.8, 0.4, 0, 1.6),
            // Cargo hold
            prop(`${D}/kaykit/containers-b.glb`, -7, -15, 0, 0.9),
            prop(`${D}/kaykit/containers-d.glb`, -7, -11.5, 0, 0.9),
            prop(`${D}/kaykit/cargo-b-packed.glb`, -2.6, -15.6, 0, 1.0),
            prop(`${D}/kaykit/locker.glb`, 9.4, -9, 270, 1.9),
            prop(`${D}/kaykit/locker.glb`, 9.4, -10.2, 270, 1.9),
            prop(`${D}/kaykit/solarpanel.glb`, 7, -15.2, 0, 0.9),
        ],
        [loot(-1.5, 9), loot(-3, -3.5, 50), loot(-2.5, -9.5, 75)],
    ));
}

fs.mkdirSync(OUT, { recursive: true });
for (const pending of SHOWCASES) {
    const data = await pending;
    fs.writeFileSync(path.join(OUT, `${data.id}.json`), `${JSON.stringify(data, null, 2)}\n`);
    console.log(`${data.id.padEnd(20)} ${data.props.length} props`);
}
