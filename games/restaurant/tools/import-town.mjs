// import-town.mjs — node games/restaurant/tools/import-town.mjs [ufo-level] (default: city2)
//
// Brings a UFO town round the restaurant (levels/restaurant.json), for the street now and the delivery mode later: its
// road grid (core/roads: same 15-unit kit), the cars on it, its lawns, sidewalk slabs and ground, its buildings, trees and
// props (each with its footprint, so people walk round it), and its people (wander areas, and walkers on their paths).
//
// Placed so the restaurant sits in one of the town's blocks (ORIGIN: road cell (0, 0)'s middle): the block's own props are
// left out (the restaurant's there), and so is anything within KEEP_CLEAR of the street pieces already placed by hand. A
// hand-placed road tile that a road cell now covers is dropped (the cell lays it). Everything imported is tagged
// `town: "<level>"`, so running it again replaces the last import instead of doubling it. The town's models are copied
// into raw-assets/models/library{m} (run npm run models after).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '..');
const REPO = path.resolve(GAME, '../..');
const SOURCE = process.argv[2] ?? 'city2';
const LEVEL_FILE = path.join(GAME, 'levels/restaurant.json');
const UFO_LEVEL = path.join(REPO, 'games/ufo/levels', `${SOURCE}.json`);
const UFO_MODELS = path.join(REPO, 'games/ufo/raw-assets/models/town{m}/library');
const OUR_MODELS = path.join(GAME, 'raw-assets/models/library{m}');

/** Road cell (0, 0)'s middle: puts the restaurant in the block between road columns 0 and 3, rows 0 and 3. */
const ORIGIN = { x: -25, z: -24.75 };
/** The restaurant's block: nothing of the town's inside it (road edge to road edge). */
const BLOCK = { minX: ORIGIN.x + 7.5, maxX: ORIGIN.x + 45 - 7.5, minZ: ORIGIN.z + 7.5, maxZ: ORIGIN.z + 45 - 7.5 };
/** The town's things this close to a hand-placed street piece are left out. */
const KEEP_CLEAR = 4;
/** The town's ground and slabs sit under the restaurant's own floors. */
const GROUND_Y = -0.03;
const SLAB_Y = -0.015;

const ufo = JSON.parse(fs.readFileSync(UFO_LEVEL, 'utf8'));
const level = JSON.parse(fs.readFileSync(LEVEL_FILE, 'utf8'));
fs.copyFileSync(LEVEL_FILE, `${LEVEL_FILE}.bak`);
const tag = SOURCE;

// A previous import of this town: out first.
const ours = (item) => item?.town !== tag;
level.props = level.props.filter(ours);
level.floors = level.floors.filter(ours);
level.lawns = (level.lawns ?? []).filter(ours);

const move = (x, z) => ({ x: Math.round((x + ORIGIN.x) * 1000) / 1000, z: Math.round((z + ORIGIN.z) * 1000) / 1000 });
const inBlock = ({ x, z }) => x > BLOCK.minX && x < BLOCK.maxX && z > BLOCK.minZ && z < BLOCK.maxZ;
const slug = (model) => model.split('/')[2];
const ourModel = (model) => `library/${slug(model)}/${slug(model)}.glb`;
const isRoadTile = (model) => /city2-road-/.test(model);

// Hand-placed road tiles a road cell now covers: dropped.
const cells = new Set(ufo.roads.cells.map(([i, j]) => `${i},${j}`));
const tile = 15;
level.props = level.props.filter((prop) => {
    if (!isRoadTile(prop.model)) return true;
    const i = Math.round((prop.x - ORIGIN.x) / tile);
    const j = Math.round((prop.z - ORIGIN.z) / tile);
    const covered = cells.has(`${i},${j}`) && Math.abs(prop.x - (ORIGIN.x + i * tile)) < 1 && Math.abs(prop.z - (ORIGIN.z + j * tile)) < 1;
    if (covered) console.log(`dropped a hand-placed road tile at ${prop.x}, ${prop.z} (now a road cell)`);
    return !covered;
});
const handPlaced = level.props.filter((prop) => prop.model.startsWith('library/city2-') || prop.model.startsWith('library/'));
const nearHandPlaced = ({ x, z }) => handPlaced.some((prop) => Math.hypot(prop.x - x, prop.z - z) < KEEP_CLEAR);

// Roads and cars.
level.roads = { origin: ORIGIN, cells: ufo.roads.cells };
level.traffic = { count: ufo.traffic?.cars?.length ?? 8 };

// Ground and sidewalk slabs (as floors, plain), lawns (as lawn polygons).
level.styles.floors.townGround = { name: 'Town ground', colorA: ufo.ground.color, colorB: ufo.ground.color, scale: 4 };
level.styles.floors.townSlab = { name: 'Town pavement', colorA: '#e8e3ef', colorB: '#ded8e6', scale: 2 };
const ground = move(ufo.ground.x, ufo.ground.z);
level.floors.unshift({ ...ground, width: ufo.ground.width, depth: ufo.ground.depth, tileSize: 1, style: 'townGround', elevation: GROUND_Y, town: tag });
let slabs = 0;
let lawns = 0;
for (const pavement of ufo.pavements) {
    const at = move(pavement.x, pavement.z);
    if (pavement.id.startsWith('road')) continue;
    if (pavement.id.startsWith('lawn')) {
        const hw = pavement.width / 2;
        const hd = pavement.depth / 2;
        level.lawns.push({ points: [{ x: at.x - hw, z: at.z - hd }, { x: at.x + hw, z: at.z - hd }, { x: at.x + hw, z: at.z + hd }, { x: at.x - hw, z: at.z + hd }], color: pavement.color, town: tag });
        lawns++;
        continue;
    }
    level.floors.splice(1 + slabs, 0, { ...at, width: pavement.width, depth: pavement.depth, tileSize: 1, style: 'townSlab', elevation: SLAB_Y, town: tag });
    slabs++;
}

// Buildings, trees, props: moved, models renamed to ours, their footprints kept (people walk round them).
let props = 0;
let skipped = 0;
const models = new Set();
for (const prop of ufo.props) {
    const at = move(prop.x, prop.z);
    if (inBlock(at) || nearHandPlaced(at)) {
        skipped++;
        continue;
    }
    const placed = { model: ourModel(prop.model), ...at, rotationY: prop.rotationY ?? 0, town: tag };
    if (prop.height !== undefined) placed.height = prop.height;
    if (prop.elevation !== undefined) placed.elevation = prop.elevation;
    if (prop.collider) placed.collider = prop.collider;
    level.props.push(placed);
    models.add(slug(prop.model));
    props++;
}

// People: wander areas outside the restaurant's block, and walkers on the paths.
const areas = (ufo.people?.areas ?? []).map((area) => ({ ...area, ...move(area.x, area.z), town: tag })).filter((area) => !inBlock(area));
const waypoints = (ufo.people?.waypoints ?? []).map((point) => ({ id: `${tag}-${point.id}`, ...move(point.x, point.z) }));
const links = (ufo.people?.links ?? []).map(([a, b]) => [`${tag}-${a}`, `${tag}-${b}`]);
level.people = { ...(level.people ?? {}), areas: [...(level.people?.areas ?? []).filter(ours), ...areas], paths: { waypoints, links, walkers: ufo.people?.walkers ?? 0 } };

// Their models, copied in.
let copied = 0;
for (const name of models) {
    const to = path.join(OUR_MODELS, name);
    if (fs.existsSync(to)) continue;
    fs.cpSync(path.join(UFO_MODELS, name), to, { recursive: true });
    copied++;
}

fs.writeFileSync(LEVEL_FILE, JSON.stringify(level, null, 2) + '\n');
console.log(`${SOURCE}: ${ufo.roads.cells.length} road cells, ${level.traffic.count} cars, ${props} props (${skipped} left out: the restaurant's block / by hand-placed pieces), ${lawns} lawns, ${slabs} slabs, ${areas.length} people areas, ${waypoints.length} path points (${level.people.paths.walkers} walkers); ${copied} models copied (npm run models next). Backup: levels/restaurant.json.bak`);
