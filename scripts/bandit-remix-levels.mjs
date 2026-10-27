// Generates the bandit-controller "remix" levels: mirrored copies of existing levels that fill each
// world up to 10 levels (tutorial world: 5), then rewrites levels/worlds.json and levels/index.json.
//
//   node scripts/bandit-remix-levels.mjs        # write remixes + worlds.json + index.json
//   node scripts/bandit-remix-levels.mjs --dry  # print the plan only
//
// A remix is `source` mirrored across X ('x') or rotated 180 degrees ('xz'). Every coordinate,
// heading, opening and the vault side are transformed, so a solvable source stays solvable
// (patrol timings are untouched). Re-running regenerates the remix files from their sources.
import fs from 'node:fs';
import path from 'node:path';

const LEVELS = path.resolve(import.meta.dirname, '../games/bandit-controller/levels');
const dry = process.argv.includes('--dry');

const r = (source, mirror, name) => ({ remix: true, source, mirror, name });

/** World order, and level order inside each world. Plain strings are existing levels. */
const WORLDS = [
    { id: 'tutorial', name: 'Training Day', tutorial: true, styles: 1, levels: ['tutorial-01', 'tutorial-02', 'tutorial-03', 'tutorial-04', 'tutorial-05'] },
    {
        id: 'world-1', name: 'Downtown Bank', styles: 1, levels: [
            r('tutorial-03', 'x', 'Back Office'), r('tutorial-04', 'x', 'Teller Pair'), 'w1-06', r('tutorial-05', 'x', 'Lobby Guard'),
            r('level-01', 'x', 'Night Deposit'), 'w1-07', r('level-02', 'xz', 'Corner Teller'), r('w2-06', 'x', 'Joint Account'),
            'w1-08', r('w2-07', 'xz', 'Loan Office'),
        ],
    },
    {
        id: 'world-2', name: 'Mint Vault', styles: 2, levels: [
            'level-01', 'level-02', 'level-03', 'level-04', 'w2-05', r('w1-07', 'x', 'Coin Counters'), 'w2-06', 'w2-07',
            r('w1-08', 'x', 'Mint Rooftops'), 'w2-08',
        ],
    },
    {
        id: 'world-3', name: 'Sunset Museum', styles: 3, levels: [
            'w3-01', 'w3-02', 'w3-03', 'w3-04', 'w3-05', 'w3-06', r('w4-02', 'x', "Curator's Walk"), 'w3-07',
            r('w4-01', 'xz', 'Restoration Wing'), 'w3-08',
        ],
    },
    {
        id: 'world-4', name: 'Night Casino', styles: 4, levels: [
            'w4-01', 'w4-02', 'w4-03', 'w4-04', r('w3-05', 'x', 'Card Maze'), 'w4-05', 'w4-06', r('w3-07', 'xz', 'Graveyard Shift'),
            'w4-07', 'w4-08',
        ],
    },
    {
        id: 'world-5', name: 'Fortress', styles: 5, levels: [
            'w5-01', 'w5-02', 'w5-03', r('w4-04', 'x', 'Twin Towers'), 'w5-04', 'w5-05', r('w4-05', 'xz', 'Drill Sergeant'),
            'w5-06', 'w5-07', 'w5-08',
        ],
    },
    {
        id: 'world-6', name: 'Neon Lab', styles: 6, levels: [
            'w6-01', 'w6-02', 'w6-03', 'w6-04', r('w7-01', 'x', 'Clean Room'), 'w6-05', 'w6-06', r('w7-02', 'x', 'Hover Lab'),
            'w6-07', 'w6-08',
        ],
    },
    {
        id: 'world-7', name: 'Orbital Station', styles: 7, levels: [
            'w7-01', 'w7-02', 'w7-03', r('w6-04', 'x', 'Spike Deck'), 'w7-04', 'w7-05', r('w6-07', 'xz', 'Coolant Leak'),
            'w7-06', 'w7-07', 'w7-08',
        ],
    },
    {
        id: 'world-8', name: 'Suburban Homes', styles: 3, levels: [
            'h1-01', r('w5-02', 'x', 'Front Yard'), 'h1-02', r('w5-06', 'xz', 'Basement Run'), r('w6-08', 'x', 'Smart Home'),
            'h1-03', r('w7-05', 'xz', 'Block Party'), r('w7-06', 'x', 'Pool House'), r('w7-07', 'xz', 'Panic Room'),
            r('w7-08', 'x', 'Getaway Garage'),
        ],
    },
];

const round = (value) => Math.round(value * 1000) / 1000 + 0;
const normDeg = (value) => round(((value % 360) + 360) % 360);

function transformer(mirror) {
    const flipZ = mirror === 'xz';
    const px = (p) => ({ ...p, x: round(-p.x), z: round(flipZ ? -p.z : p.z) });
    // Headings are atan2(dx, dz): mirroring X negates them, rotating 180 degrees adds 180.
    const deg = (d) => normDeg(flipZ ? d + 180 : -d);
    const rad = (a) => round(flipZ ? a + Math.PI : -a);
    const box = (o) => ({
        ...o,
        minX: round(-o.maxX), maxX: round(-o.minX),
        minZ: round(flipZ ? -o.maxZ : o.minZ), maxZ: round(flipZ ? -o.minZ : o.maxZ),
    });
    const side = (s) => (s.endsWith('x') || flipZ ? (s[0] === '+' ? '-' : '+') + s[1] : s);
    return { px, deg, rad, box, side };
}

function remix(level, entry, id) {
    const t = transformer(entry.mirror);
    const out = structuredClone(level);
    out.id = id;
    out.name = entry.name;
    delete out.tutorial;
    if (out.floor.rects) out.floor.rects = out.floor.rects.map(t.px);
    out.start = t.px(out.start);
    out.waypoints = out.waypoints.map(t.px);
    if (out.entryPath) out.entryPath = t.px(out.entryPath);
    out.walls = out.walls.map((wall) => ({ ...wall, points: wall.points.map(t.px), openings: wall.openings.map(t.box) }));
    out.props = out.props.map((prop) => ({ ...t.px(prop), rotationY: t.rad(prop.rotationY ?? 0) }));
    out.loot = out.loot.map(t.px);
    if (out.guards) out.guards = out.guards.map((guard) => ({ ...guard, path: guard.path.map(t.px), facing: t.deg(guard.facing ?? 0) }));
    if (out.cameras) out.cameras = out.cameras.map((camera) => ({ ...t.px(camera), facing: t.deg(camera.facing) }));
    if (out.traps) out.traps = out.traps.map(t.px);
    if (out.drones) out.drones = out.drones.map((drone) => ({ ...drone, path: drone.path.map(t.px) }));
    if (out.squad) out.squad = out.squad.map((member) => ({ ...member, start: t.px(member.start), waypoints: member.waypoints.map(t.px) }));
    if (out.sharedGoal) out.sharedGoal = t.px(out.sharedGoal);
    if (out.vault) out.vault = { ...t.px(out.vault), side: t.side(out.vault.side) };
    return out;
}

const read = (id) => JSON.parse(fs.readFileSync(path.join(LEVELS, `${id}.json`), 'utf8'));
const styleSet = (n) => ({ floor: `floorStyle${n}`, wall: `wallStyle${n}`, ground: `groundStyle${n}`, path: `pathStyle${n}` });

const worlds = [];
const seen = new Set();
for (const world of WORLDS) {
    const ids = world.levels.map((entry) => {
        if (typeof entry === 'string') {
            read(entry);
            return entry;
        }
        const id = `rx-${entry.source}`;
        const level = remix(read(entry.source), entry, id);
        if (!dry) fs.writeFileSync(path.join(LEVELS, `${id}.json`), `${JSON.stringify(level, null, 2)}\n`);
        return id;
    });
    for (const id of ids) {
        if (seen.has(id)) throw new Error(`${id} is used twice`);
        seen.add(id);
    }
    const expected = world.tutorial ? 5 : 10;
    if (ids.length !== expected) throw new Error(`${world.id} has ${ids.length} levels, expected ${expected}`);
    worlds.push({ id: world.id, name: world.name, styles: styleSet(world.styles), levels: ids });
    console.log(`${world.name.padEnd(16)} ${ids.join(', ')}`);
}

if (!dry) {
    fs.writeFileSync(path.join(LEVELS, 'worlds.json'), `${JSON.stringify({ worlds }, null, 2)}\n`);
    fs.writeFileSync(path.join(LEVELS, 'index.json'), `${JSON.stringify({ levels: worlds.flatMap((world) => world.levels) }, null, 2)}\n`);
}
console.log(`${worlds.length} worlds, ${seen.size} levels${dry ? ' (dry run)' : ''}`);
