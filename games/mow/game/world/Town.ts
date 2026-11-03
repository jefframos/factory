// Town.ts
//
// The town around the grass, built from levels/town.json (edited in the editor: npm run editor): the ground, the
// pavements (plaza, road, park paths: no grass), the props (library models: KayKit City Builder Bits and
// Forest trees, fitted to their height like dig's hub props), the sections' separators (a fence all round each locked
// section, with a sign) and the stations — as many as the level places of each kind, each a pad with its model
// behind it and a floating icon: ATMs (money: standing on one sells the bag and opens the shop) and wardrobes (Dig's
// closet, a heart: opens the wardrobe; a bouncing "!" while something new is affordable: setWardrobeAttention()). A
// station can belong to a section (`section`): it pops in when that section opens, so there's always one close to the
// grass being mowed.
//
// Models load in the background (`ready`); the boxes they block come from the level, so walking and the grass (which
// needs to know what's covered) never wait on them. Props marked `fade` (trees, buildings) dither out while they
// stand between the camera and the player: BendService's occlusion fade.
//
// It answers the two questions the rest asks of the layout: whether a point is walkable (anywhere on the island inside its fence, off
// the obstacles, out of the locked sections: TileWalkability) and whether a grass cell sits under
// something (no grass there: GrassField). Restoring a section opens the next one (unlock()) and plants flowers in it
// (bloom()).

import * as THREE from 'three';
import gsap from 'gsap';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { CITY, MOW, TOWN, AtmLook, AtmSpot, DeckDef, DistrictDef, TownProp } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { BendService, OcclusionFadeConfig, STRUCTURE_OCCLUSION_FADE } from '../services/BendService';
import { createWaterMaterial } from '../builders/WaterMaterial';
import { CanvasArt } from '../ui/CanvasArt';
import { setWalkabilityQuery, clearWalkabilityQuery } from './TileWalkability';
import { ShorePoint, bounds, containsPoint, edgeDistance, insetPolygon, inwardNormals, shoreOutline } from './Shore';

/** An axis-aligned box on the ground (centre, half sizes). */
export interface Box {
    x: number;
    z: number;
    halfX: number;
    halfZ: number;
}

const MODEL_BASE = './mow/models/';
/** The player's footprint radius for walking. */
const BODY_RADIUS = 0.35;
/** Kept off the island's perimeter fence (its posts and rails), beyond the fence's inset. */
const ISLAND_FENCE_CLEARANCE = 0.2;
/** ATM pads: radius (standing inside uses it). */
export const PAD_RADIUS = 1.4;
/**
 * Ground layers, far enough apart that nothing z-fights once the world bends: the town's ground, then the sections'
 * grass ground (GrassField, 0.01), then each pavement a step above the last (paths over the park, road over the town).
 * Road tiles (props) sit on their own `elevation` above every road slab (level roads come first in the list), so the
 * slabs under them never show through.
 */
const GROUND_Y = -0.05;
/** The sections' grass ground (GrassField). */
const GRASS_Y = 0.01;
const PAVEMENT_Y = 0.02;
const PAVEMENT_STEP = 0.012;
/** Props this close to the player's start (world units) load first; the rest after (the constructor). */
const NEAR_LOAD = 24;
/** topAt()'s cache cell (world units). */
const TOP_CELL = 0.1;
const topRay = new THREE.Raycaster();
const topFrom = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
/** Station pads: just over the top pavement (each pavement sits a step above the one before). */
const PAD_Y = PAVEMENT_Y + TOWN.pavements.length * PAVEMENT_STEP + 0.03;
/** The island's wooden deck: just over the town's ground, under the sections' grass and the pavements. */
const DECK_Y = GROUND_Y + 0.03;
/** One deck plank's width; the plank texture holds PLANKS of them. */
const PLANK = 0.42;
const PLANKS = 4;
/** Flat things are cut into pieces this small (world units) so they curve with the bend instead of cutting through it. */
const BEND_SEGMENT = 0.5;
/** Models flatter than this (the road tiles) get cut up like that. */
const FLAT_HEIGHT = 0.3;
/** A restored section's flower clumps: how big (a clump's height is about half this, in world units): low, just a dash of colour. */
const FLOWER_SIZE = 0.55;
/** The kinds of flower, alternating over a section's spots: their head and the petals' colours (one per clump). */
interface FlowerKind {
    head: 'daisy' | 'tulip';
    colours: string[];
}
const FLOWER_KINDS: FlowerKind[] = [
    { head: 'daisy', colours: ['#ffffff', '#ff9cc4', '#b994ff', '#ffe04a'] },
    { head: 'tulip', colours: ['#ff4f5e', '#ff9a3c', '#ff6fb0', '#ffd23f', '#c36bff'] },
];
/** One clump: three stems (x, z, height). */
const CLUMP = [
    { x: 0, z: 0, h: 0.5 },
    { x: 0.13, z: 0.06, h: 0.38 },
    { x: -0.06, z: 0.12, h: 0.43 },
];

/**
 * A kind's clump, part by part (stems and leaves; petals, coloured per clump: no `colour`; a daisy's middle), each
 * part one geometry for all three flowers. Low poly, flat shaded.
 */
const flowerParts = (() => {
    const cache = new Map<string, { geometry: THREE.BufferGeometry; colour?: string }[]>();
    const at = (geometry: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, turnY = 0, tiltZ = 0) =>
        geometry.scale(sx, sy, sz).rotateZ(tiltZ).rotateY(turnY).translate(x, y, z);
    return (kind: FlowerKind) => {
        const cached = cache.get(kind.head);
        if (cached) return cached;
        const green: THREE.BufferGeometry[] = [];
        const petals: THREE.BufferGeometry[] = [];
        const middles: THREE.BufferGeometry[] = [];
        CLUMP.forEach(({ x, z, h }, n) => {
            green.push(at(new THREE.CylinderGeometry(0.014, 0.02, h, 4), x, h / 2, z));
            // A leaf on each stem, low, each turned another way.
            green.push(at(new THREE.SphereGeometry(1, 5, 2), x, h * 0.3, z, 0.1, 0.018, 0.04, n * 2.1, 0.5));
            if (kind.head === 'daisy') {
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    petals.push(at(new THREE.SphereGeometry(1, 5, 3), x + Math.cos(a) * 0.065, h, z - Math.sin(a) * 0.065, 0.065, 0.016, 0.034, a, 0.25));
                }
                middles.push(at(new THREE.SphereGeometry(0.04, 6, 4), x, h + 0.01, z, 1, 0.6, 1));
            } else {
                // A cup of three pointed petals round a closed bud.
                petals.push(at(new THREE.CylinderGeometry(0.06, 0.035, 0.1, 6), x, h + 0.04, z));
                for (let i = 0; i < 3; i++) {
                    const a = (i / 3) * Math.PI * 2 + n;
                    petals.push(at(new THREE.ConeGeometry(0.035, 0.07, 4), x + Math.cos(a) * 0.04, h + 0.12, z - Math.sin(a) * 0.04));
                }
            }
        });
        const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => g.toNonIndexed()))!;
        const parts: { geometry: THREE.BufferGeometry; colour?: string }[] = [
            { geometry: merge(green), colour: '#4f9a3a' },
            { geometry: merge(petals) },
        ];
        if (middles.length) parts.push({ geometry: merge(middles), colour: '#f5a524' });
        cache.set(kind.head, parts);
        return parts;
    };
})();
/** Trees and buildings: the whole model dithers out while the camera->player line runs through it. */
const FADE: OcclusionFadeConfig = { ...STRUCTURE_OCCLUSION_FADE, radius: 0.4 };

/** The bouncing "!" (the pizza game's alert icon, UI atlas), like Dig's stations'. */
function alertTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    CanvasArt.drawIcon(canvas.getContext('2d')!, 'Icon_Exclamation', 64, 64, 118);
    return CanvasArt.texture(canvas);
}

/** Deck planks (side by side along u, each running the length of v): shades, grain, a gap, nails at both ends. */
function plankTexture(color: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const g = canvas.getContext('2d')!;
    const width = canvas.width / PLANKS;
    const shades = [0, -0.05, 0.035, -0.02];
    for (let i = 0; i < PLANKS; i++) {
        const left = i * width;
        g.fillStyle = `#${new THREE.Color(color).offsetHSL(0, 0, shades[i % shades.length]).getHexString()}`;
        g.fillRect(left, 0, width, canvas.height);
        g.strokeStyle = 'rgba(70, 40, 18, 0.2)';
        g.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
            const x = left + 12 + k * ((width - 24) / 2) + (((i * 7 + k * 5) % 5) - 2);
            g.beginPath();
            g.moveTo(x, 0);
            g.bezierCurveTo(x + 4, 40, x - 4, 88, x + 1, canvas.height);
            g.stroke();
        }
        g.fillStyle = 'rgba(45, 35, 30, 0.6)';
        for (const y of [12, canvas.height - 12]) {
            for (const x of [left + width * 0.3, left + width * 0.7]) {
                g.beginPath();
                g.arc(x, y, 2.2, 0, Math.PI * 2);
                g.fill();
            }
        }
        g.fillStyle = 'rgba(40, 22, 10, 0.8)';
        g.fillRect(left, 0, 3, canvas.height);
    }
    const texture = CanvasArt.texture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
}

/** World units one repeat of the stone / paving / asphalt textures covers. */
const STONE_TILE = 1.6;
const PAVING_TILE = 2;
/** The open ground's cobbles: 6 across one repeat. */
const GROUND_TILE = 4;

/** A seeded 0..1 random (the same texture every run). */
function seeded(seed: number): () => number {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
}

/** A near-white grey: the textures are tinted by their material's colour, so they only shade it a little. */
const grey = (level: number, alpha = 1) => `rgba(${Math.round(level * 255)}, ${Math.round(level * 255)}, ${Math.round(level * 255)}, ${alpha})`;

/** Light speckles and darker flecks all over (low contrast grain). */
function speckle(g: CanvasRenderingContext2D, size: number, random: () => number, count: number): void {
    for (let i = 0; i < count; i++) {
        g.fillStyle = random() < 0.5 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.06)';
        const r = 0.6 + random() * 1.6;
        g.fillRect(random() * size, random() * size, r, r);
    }
}

function tiledTexture(draw: (g: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    draw(canvas.getContext('2d')!, 256);
    const texture = CanvasArt.texture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
}

/** The island's sides: staggered stone blocks, each a slightly different shade, thin mortar lines. */
const stoneTexture = (() => {
    let texture: THREE.CanvasTexture | null = null;
    return () => texture ??= tiledTexture((g, size) => {
        const random = seeded(7);
        const rows = 4;
        const h = size / rows;
        g.fillStyle = grey(0.8);
        g.fillRect(0, 0, size, size);
        for (let r = 0; r < rows; r++) {
            const w = size / 2;
            for (let c = -1; c < 3; c++) {
                const x = c * w + (r % 2) * (w / 2);
                g.fillStyle = grey(0.88 + random() * 0.1);
                g.beginPath();
                g.roundRect(x + 2, r * h + 2, w - 4, h - 4, 5);
                g.fill();
            }
        }
        speckle(g, size, random, 900);
    });
})();

/** The island's open ground: loose cobbles of mixed sizes (rounded, faint gaps), low contrast. */
const groundTexture = (() => {
    let texture: THREE.CanvasTexture | null = null;
    return () => texture ??= tiledTexture((g, size) => {
        const random = seeded(31);
        g.fillStyle = grey(0.84);
        g.fillRect(0, 0, size, size);
        const cells = 6;
        const step = size / cells;
        for (let r = 0; r < cells; r++) {
            for (let c = 0; c < cells; c++) {
                const w = step * (0.72 + random() * 0.2);
                const h = step * (0.72 + random() * 0.2);
                const x = c * step + (step - w) / 2 + (random() - 0.5) * step * 0.12;
                const y = r * step + (step - h) / 2 + (random() - 0.5) * step * 0.12;
                g.fillStyle = grey(0.9 + random() * 0.09);
                // Drawn at every wrap offset, so a cobble crossing the edge continues on the other side.
                for (const dx of [-size, 0, size]) {
                    for (const dy of [-size, 0, size]) {
                        g.beginPath();
                        g.roundRect(x + dx, y + dy, w, h, Math.min(w, h) * 0.4);
                        g.fill();
                    }
                }
            }
        }
        speckle(g, size, random, 1200);
    });
})();

/** The plaza and paths: square paving slabs (faint seams, each a slightly different shade). */
const pavingTexture = (() => {
    let texture: THREE.CanvasTexture | null = null;
    return () => texture ??= tiledTexture((g, size) => {
        const random = seeded(11);
        const slabs = 4;
        const s = size / slabs;
        g.fillStyle = grey(0.86);
        g.fillRect(0, 0, size, size);
        for (let r = 0; r < slabs; r++) {
            for (let c = 0; c < slabs; c++) {
                g.fillStyle = grey(0.94 + random() * 0.06);
                g.fillRect(c * s + 1.5, r * s + 1.5, s - 3, s - 3);
            }
        }
        speckle(g, size, random, 700);
    });
})();

/** The roads' tarmac: grain only. */
const asphaltTexture = (() => {
    let texture: THREE.CanvasTexture | null = null;
    return () => texture ??= tiledTexture((g, size) => {
        const random = seeded(23);
        g.fillStyle = grey(0.95);
        g.fillRect(0, 0, size, size);
        speckle(g, size, random, 2500);
    });
})();

/** The kinds of station the level places (each with its own look and spots in levels/town.json). */
export type StationKind = 'atm' | 'wardrobe';
const STATION_KINDS: StationKind[] = ['atm', 'wardrobe'];
const stationLook = (kind: StationKind): AtmLook => (kind === 'atm' ? TOWN.atm : TOWN.wardrobe);
const stationSpots = (kind: StationKind): AtmSpot[] => (kind === 'atm' ? TOWN.atms : TOWN.wardrobes ?? []);

/** The box a station blocks (its model, `back` behind the pad). */
function stationBox(spot: AtmSpot, look: AtmLook): Box {
    const turn = spot.rotationY ?? 0;
    const sideways = Math.abs(Math.sin(turn)) > 0.5;
    return {
        x: spot.x - Math.sin(turn) * look.back,
        z: spot.z - Math.cos(turn) * look.back,
        halfX: sideways ? look.collider.halfZ : look.collider.halfX,
        halfZ: sideways ? look.collider.halfX : look.collider.halfZ,
    };
}

/**
 * Splits a geometry's triangles (each on its longest edge, again and again) until no edge is longer than `max` at
 * `scale`, so a big flat model curves with the world bend (the shader moves vertices only). Every attribute is
 * interpolated along.
 */
function subdivide(source: THREE.BufferGeometry, max: number, scale: THREE.Vector3): THREE.BufferGeometry {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    const names = Object.keys(geometry.attributes);
    const attributes = names.map((name) => geometry.getAttribute(name) as THREE.BufferAttribute);
    // One vertex = every attribute's values, flattened.
    type Vertex = number[][];
    const read = (i: number): Vertex => attributes.map((a) => Array.from({ length: a.itemSize }, (_, k) => a.array[i * a.itemSize + k]));
    const mid = (a: Vertex, b: Vertex): Vertex => a.map((values, n) => values.map((v, k) => (v + b[n][k]) / 2));
    const position = names.indexOf('position');
    const length = (a: Vertex, b: Vertex) => Math.hypot(
        (a[position][0] - b[position][0]) * scale.x, (a[position][1] - b[position][1]) * scale.y, (a[position][2] - b[position][2]) * scale.z);
    const out: Vertex[] = [];
    const stack: Vertex[][] = [];
    for (let i = 0; i < geometry.getAttribute('position').count; i += 3) stack.push([read(i), read(i + 1), read(i + 2)]);
    while (stack.length) {
        const [a, b, c] = stack.pop()!;
        const edges = [length(a, b), length(b, c), length(c, a)];
        const longest = edges.indexOf(Math.max(...edges));
        if (edges[longest] <= max) {
            out.push(a, b, c);
            continue;
        }
        // Rotate so the longest edge is a-b, then split it at m.
        const [p, q, r] = longest === 0 ? [a, b, c] : longest === 1 ? [b, c, a] : [c, a, b];
        const m = mid(p, q);
        stack.push([p, m, r], [m, q, r]);
    }
    const result = new THREE.BufferGeometry();
    names.forEach((name, n) => {
        const size = attributes[n].itemSize;
        const array = new Float32Array(out.length * size);
        out.forEach((vertex, i) => array.set(vertex[n], i * size));
        result.setAttribute(name, new THREE.BufferAttribute(array, size, attributes[n].normalized));
    });
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
}

/** How far inside a pen's fence the player's footprint stops. */
const PEN_CLEARANCE = 0.15;

/**
 * A white fence all round a rect (two rails per side, posts every ~1.5 units), its rails cut along their length so
 * they curve with the world bend.
 */
function fenceAround(rect: { x: number; z: number; width: number; depth: number }, white: THREE.Material, post: THREE.BufferGeometry): THREE.Group {
    const fence = new THREE.Group();
    const hx = rect.width / 2;
    const hz = rect.depth / 2;
    const sides: [number, number, number, boolean][] = [
        [rect.x, rect.z - hz, rect.width, true], [rect.x, rect.z + hz, rect.width, true],
        [rect.x - hx, rect.z, rect.depth, false], [rect.x + hx, rect.z, rect.depth, false],
    ];
    const spots: [number, number][] = [];
    for (const [x, z, length, alongX] of sides) {
        // Cut along their length so they curve with the bend (a single long box stays straight through it).
        const segments = Math.max(1, Math.ceil(length / BEND_SEGMENT));
        for (const y of [0.45, 0.95]) {
            const rail = new THREE.Mesh(alongX
                ? new THREE.BoxGeometry(length, 0.12, 0.08, segments, 1, 1)
                : new THREE.BoxGeometry(0.08, 0.12, length, 1, 1, segments), white);
            rail.position.set(x, y, z);
            fence.add(rail);
        }
        const count = Math.max(1, Math.round(length / 1.5));
        for (let i = 0; i <= count; i++) {
            const t = -length / 2 + (length * i) / count;
            spots.push(alongX ? [x + t, z] : [x, z + t]);
        }
    }
    const posts = new THREE.InstancedMesh(post, white, spots.length);
    const matrix = new THREE.Matrix4();
    spots.forEach(([x, z], i) => posts.setMatrixAt(i, matrix.makeTranslation(x, 0.6, z)));
    posts.computeBoundingSphere();
    fence.add(posts);
    return fence;
}

/** Whether (x, z) lies on a side of a section's pen (within half a unit). */
function onPenSide(x: number, z: number): boolean {
    return MOW.districts.some(({ pen }) => !!pen && (
        (Math.abs(Math.abs(z - pen.z) - pen.depth / 2) < 0.5 && Math.abs(x - pen.x) <= pen.width / 2)
        || (Math.abs(Math.abs(x - pen.x) - pen.width / 2) < 0.5 && Math.abs(z - pen.z) <= pen.depth / 2)));
}

/** A padlock plaque saying `text`, floating over (x, z). */
function fenceSign(text: string, x: number, z: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const g = canvas.getContext('2d')!;
    CanvasArt.plaque(g, 6, 6, 372, 84, 20);
    CanvasArt.drawIcon(g, 'Icon_Lock02', 48, 48, 52);
    CanvasArt.text(g, text, 220, 50, 30, '#ffe27a', 290);
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: CanvasArt.texture(canvas), depthWrite: false }));
    sign.scale.set(4.2, 1.05, 1);
    sign.position.set(x, 2.1, z);
    return sign;
}

export class Town {
    private readonly group = new THREE.Group();
    /** The sea round the island (buildIsland()). */
    private sea?: THREE.Mesh;
    /** What the props block (fixed). */
    private readonly propBoxes: Box[] = [];
    /** Flat props laid on the ground (road tiles): their footprint, top (for surfaceAt()) and model (for topAt()). */
    private readonly floors: { minX: number; maxX: number; minZ: number; maxZ: number; top: number; object: THREE.Object3D }[] = [];
    /** topAt()'s answers by TOP_CELL cell (the floors never move). */
    private readonly tops = new Map<string, number>();
    /** Each station's box, by kind (no grass under any of them; blocking once it's there). */
    private readonly boxes: Record<StationKind, Box[]> = {
        atm: stationSpots('atm').map((spot) => stationBox(spot, stationLook('atm'))),
        wardrobe: stationSpots('wardrobe').map((spot) => stationBox(spot, stationLook('wardrobe'))),
    };
    /** Per section: its pen (DistrictDef.pen) still stands (the player is kept inside it), and its fence. */
    private readonly penned: boolean[];
    private readonly pens: (THREE.Group | undefined)[] = [];
    /** Each section's separator (index = section) and its box while it stands. */
    private readonly separators: (THREE.Group | undefined)[] = [];
    private readonly separatorBoxes: (Box | undefined)[] = [];
    private readonly open: boolean[];
    private readonly groups: Record<StationKind, THREE.Group[]> = { atm: [], wardrobe: [] };
    /** Each wardrobe's "!" (setWardrobeAttention()). */
    private readonly wardrobeAlerts: THREE.Sprite[] = [];
    /** Labels to draw again once the town is up (their atlas icons can come out blank while booting). */
    private readonly redraws: (() => void)[] = [];
    private readonly walkability = (x: number, z: number) => this.isWalkable(x, z);
    /** The island's outline (Shore.ts). */
    private readonly shore = shoreOutline();
    private readonly loads: Promise<unknown>[] = [];
    private destroyed = false;
    /** The player's footprint radius for walking (wider on the tractor). */
    public bodyRadius = BODY_RADIUS;
    /** Obstacles that move (the cars: Traffic.blockers()), only for walking: the guide's route ignores them. */
    public movingBlockers?: () => readonly Box[];
    /** Resolves once every model has loaded (or failed: the town still plays without one). */
    public readonly ready: Promise<void>;
    /** Resolves once the models near the player's start (NEAR_LOAD) and the stations are in: enough to play. */
    public readonly readyNear: Promise<void>;

    /**
     * `open(d)`: whether section d is unlocked from the start (its predecessor restored); `restored(d)`: whether it's
     * restored (its pen, if any, is gone then).
     */
    public constructor(threeScene: THREE.Scene, open: (district: number) => boolean, restored: (district: number) => boolean = () => false) {
        this.open = MOW.districts.map((_, d) => open(d));
        this.penned = MOW.districts.map((district, d) => !!district.pen && !restored(d));
        this.buildGround();
        // Every prop's collider now (the grass and the walking need them from the start), its model by distance from
        // where the player starts: the near ones (and the stations) first — all the loading screen waits for
        // (readyNear) — the rest once they're in, so they don't compete for the download.
        for (const prop of TOWN.props) {
            if (prop.collider) this.propBoxes.push({ x: prop.x, z: prop.z, halfX: prop.collider.halfX, halfZ: prop.collider.halfZ });
        }
        const away = (prop: TownProp) => Math.hypot(prop.x - TOWN.start.x, prop.z - TOWN.start.z);
        const props = [...TOWN.props].sort((a, b) => away(a) - away(b));
        props.filter((prop) => away(prop) <= NEAR_LOAD).forEach((prop) => this.placeProp(prop));
        for (const kind of STATION_KINDS) stationSpots(kind).forEach((spot) => this.buildStation(kind, spot));
        this.buildSeparators();
        this.buildPens();
        threeScene.add(this.group);
        setWalkabilityQuery(this.walkability);
        this.readyNear = Promise.all(this.loads).then(() => undefined);
        this.ready = this.readyNear.then(() => {
            if (this.destroyed) return undefined;
            props.filter((prop) => away(prop) > NEAR_LOAD).forEach((prop) => this.placeProp(prop));
            return Promise.all(this.loads).then(() => undefined);
        });
        void this.ready.then(() => window.setTimeout(() => {
            if (!this.destroyed) this.redraws.forEach((redraw) => redraw());
        }, 300));
    }

    private material(color: number | string, map: THREE.Texture | null = null): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, map, roughness: 0.85 });
        BendService.applyBend(material);
        return material;
    }

    /** A flat slab on the ground, subdivided so it follows the world bend (`map` repeating every `tile` units). */
    private slab(x: number, z: number, width: number, depth: number, color: number | string, y: number, map: THREE.Texture | null = null, tile = 1): void {
        const geometry = new THREE.PlaneGeometry(width, depth, Math.ceil(width / BEND_SEGMENT), Math.ceil(depth / BEND_SEGMENT));
        if (map) {
            const uv = geometry.getAttribute('uv');
            for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / tile, (uv.getY(i) * depth) / tile);
        }
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, this.material(color, map));
        mesh.position.set(x, y, z);
        this.group.add(mesh);
    }

    private buildGround(): void {
        const deck = TOWN.island?.deck;
        // Ground cells inside the shore; with a deck they stop half way under it (its planks hide their steps).
        this.groundCells(deck ? insetPolygon(this.shore, deck.width / 2) : this.shore, TOWN.ground.color);
        TOWN.pavements.forEach((p, i) => {
            const road = p.id.startsWith('road');
            this.slab(p.x, p.z, p.width, p.depth, p.color, PAVEMENT_Y + i * PAVEMENT_STEP,
                road ? asphaltTexture() : pavingTexture(), road ? STONE_TILE : PAVING_TILE);
        });
        this.buildIsland();
    }

    /** The town's ground: BEND_SEGMENT cells over the shore's bounds, the ones whose middle is inside `area`. */
    private groundCells(area: readonly ShorePoint[], color: string): void {
        const { minX, maxX, minZ, maxZ } = bounds(this.shore);
        const cols = Math.ceil((maxX - minX) / BEND_SEGMENT);
        const rows = Math.ceil((maxZ - minZ) / BEND_SEGMENT);
        const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
        const normals = new Float32Array(positions.length);
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                const i = (r * (cols + 1) + c) * 3;
                positions.set([minX + c * BEND_SEGMENT, GROUND_Y, minZ + r * BEND_SEGMENT], i);
                normals[i + 1] = 1;
            }
        }
        const index: number[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!containsPoint(area, minX + (c + 0.5) * BEND_SEGMENT, minZ + (r + 0.5) * BEND_SEGMENT)) continue;
                const a = r * (cols + 1) + c;
                index.push(a, a + cols + 1, a + 1, a + cols + 1, a + cols + 2, a + 1);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        // World-aligned UVs: the cobbles run on seamlessly whatever the island's shape.
        const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
        for (let i = 0; i < uvs.length / 2; i++) uvs.set([positions[i * 3] / GROUND_TILE, positions[i * 3 + 2] / GROUND_TILE], i * 2);
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(index);
        this.group.add(new THREE.Mesh(geometry, this.material(color, groundTexture())));
    }

    /**
     * A box from a to b on the ground (`extend` past both ends), cut along its length so it curves with the bend.
     * With `tile`, its texture runs along the length and up the height, repeating every `tile` units.
     */
    private beam(a: ShorePoint, b: ShorePoint, y: number, height: number, thickness: number, material: THREE.Material, extend = 0, tile = 0): void {
        const length = Math.hypot(b.x - a.x, b.z - a.z) + extend * 2;
        const geometry = new THREE.BoxGeometry(length, height, thickness, Math.max(1, Math.ceil(length / BEND_SEGMENT)), 1, 1);
        if (tile) {
            // Offset by the world position along the edge and the height, so neighbouring walls' blocks line up.
            const start = a.x * (b.x - a.x) + a.z * (b.z - a.z);
            const along = start / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z)) + length / 2 - extend;
            const position = geometry.getAttribute('position');
            const uv = geometry.getAttribute('uv');
            for (let i = 0; i < uv.count; i++) uv.setXY(i, (position.getX(i) + along) / tile, (position.getY(i) + y) / tile);
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
        mesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
        this.group.add(mesh);
    }

    /** Points every ~`spacing` round a closed polygon, evenly spaced along its whole length. */
    private static alongEdges(points: readonly ShorePoint[], spacing: number): ShorePoint[] {
        // Round the whole loop at one spacing (a rounded corner's short edges don't each get a post).
        const lengths = points.map((p, i) => {
            const q = points[(i + 1) % points.length];
            return Math.hypot(q.x - p.x, q.z - p.z);
        });
        const total = lengths.reduce((sum, length) => sum + length, 0);
        const count = Math.max(3, Math.round(total / spacing));
        const step = total / count;
        const out: ShorePoint[] = [];
        let edge = 0;
        let start = 0;
        for (let k = 0; k < count; k++) {
            const at = k * step;
            while (edge < points.length - 1 && at > start + lengths[edge]) start += lengths[edge++];
            const p = points[edge];
            const q = points[(edge + 1) % points.length];
            const t = lengths[edge] > 0 ? (at - start) / lengths[edge] : 0;
            out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
        }
        return out;
    }

    /**
     * The ground as an island (TOWN.island, shaped by its outline): the wooden deck round the shore, the sides down
     * into the sea (and the deck's pilings), the sea round it, the fence on its edge.
     */
    private buildIsland(): void {
        const island = TOWN.island;
        if (!island) return;
        const shore = this.shore;
        const normals = inwardNormals(shore);
        const deck = island.deck;
        const top = deck ? DECK_Y : GROUND_Y;
        if (deck) this.buildDeck(deck);

        // The sides: a wall under each edge (just inside it), long enough to close the corners.
        const T = 0.2;
        const side = this.material(island.sideColor, stoneTexture());
        shore.forEach((p, i) => {
            const q = shore[(i + 1) % shore.length];
            const n = normals[i];
            const inward = (point: ShorePoint) => ({ x: point.x + (n.x * T) / 2, z: point.z + (n.z * T) / 2 });
            this.beam(inward(p), inward(q), top - island.sideDepth / 2, island.sideDepth, T, side, T, STONE_TILE);
        });

        const { minX, maxX, minZ, maxZ } = bounds(shore);
        const seaWidth = maxX - minX + island.margin * 2;
        const seaDepth = maxZ - minZ + island.margin * 2;
        const geometry = new THREE.PlaneGeometry(seaWidth, seaDepth, BendService.segmentsForSpan(seaWidth), BendService.segmentsForSpan(seaDepth));
        geometry.rotateX(-Math.PI / 2);
        const material = createWaterMaterial(island.water, -island.waterLevel);
        const sea = new THREE.Mesh(geometry, material);
        this.sea = sea;
        sea.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
        sea.frustumCulled = false;
        sea.renderOrder = -1;
        sea.onBeforeRender = () => {
            material.uniforms.time.value = performance.now() / 1000;
        };
        this.group.add(sea);

        const fence = island.fence;
        if (!fence) return;
        const line = insetPolygon(shore, fence.inset);
        const kerb = fence.kerbColor ? 0.28 : 0;
        const rail = this.material(fence.color);
        const kerbMaterial = fence.kerbColor ? this.material(fence.kerbColor) : null;
        // Two rails on posts (on a kerb, if it has one), edge by edge.
        line.forEach((p, i) => {
            const q = line[(i + 1) % line.length];
            if (kerbMaterial) this.beam(p, q, top + kerb / 2, kerb, 0.4, kerbMaterial, 0.2);
            this.beam(p, q, top + fence.height, 0.08, 0.1, rail, 0.05);
            this.beam(p, q, top + kerb + (fence.height - kerb) * 0.45, 0.06, 0.08, rail, 0.04);
        });
        const posts = Town.alongEdges(line, fence.spacing);
        const postHeight = fence.height - kerb + 0.04;
        const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, postHeight, 0.14), rail, posts.length);
        const matrix = new THREE.Matrix4();
        posts.forEach((p, i) => postMesh.setMatrixAt(i, matrix.makeTranslation(p.x, top + kerb + postHeight / 2, p.z)));
        postMesh.computeBoundingSphere();
        this.group.add(postMesh);
    }

    /**
     * The wooden deck: a band `deck.width` in from the shore, planks laid across it (the texture runs along each edge),
     * a trim board on its edge and pilings down into the sea.
     */
    private buildDeck(deck: DeckDef): void {
        const outer = this.shore;
        const inner = insetPolygon(outer, deck.width);
        const positions: number[] = [];
        const uvs: number[] = [];
        const index: number[] = [];
        // Keeps every triangle facing up, whichever way the outline runs.
        const triangle = (a: number, b: number, c: number) => {
            const ex = positions[b * 3] - positions[a * 3];
            const ez = positions[b * 3 + 2] - positions[a * 3 + 2];
            const fx = positions[c * 3] - positions[a * 3];
            const fz = positions[c * 3 + 2] - positions[a * 3 + 2];
            if (ez * fx - ex * fz >= 0) index.push(a, b, c);
            else index.push(a, c, b);
        };
        const across = Math.max(1, Math.ceil(deck.width / BEND_SEGMENT));
        outer.forEach((p, i) => {
            const j = (i + 1) % outer.length;
            const q = outer[j];
            const length = Math.hypot(q.x - p.x, q.z - p.z);
            const along = Math.max(1, Math.ceil(length / BEND_SEGMENT));
            const base = positions.length / 3;
            for (let a = 0; a <= along; a++) {
                const t = a / along;
                const ox = p.x + (q.x - p.x) * t;
                const oz = p.z + (q.z - p.z) * t;
                const ix = inner[i].x + (inner[j].x - inner[i].x) * t;
                const iz = inner[i].z + (inner[j].z - inner[i].z) * t;
                for (let b = 0; b <= across; b++) {
                    const s = b / across;
                    positions.push(ox + (ix - ox) * s, DECK_Y, oz + (iz - oz) * s);
                    uvs.push((t * length) / (PLANK * PLANKS), s);
                }
            }
            for (let a = 0; a < along; a++) {
                for (let b = 0; b < across; b++) {
                    const v = base + a * (across + 1) + b;
                    triangle(v, v + 1, v + across + 2);
                    triangle(v, v + across + 2, v + across + 1);
                }
            }
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        const planks = new THREE.MeshStandardMaterial({ map: plankTexture(deck.color), roughness: 0.9 });
        BendService.applyBend(planks);
        this.group.add(new THREE.Mesh(geometry, planks));

        // The trim board along the shore, and the pilings just outside it.
        const wood = this.material(deck.pilingColor);
        const normals = inwardNormals(outer);
        outer.forEach((p, i) => {
            const q = outer[(i + 1) % outer.length];
            const n = normals[i];
            const shift = (point: ShorePoint) => ({ x: point.x + n.x * 0.1, z: point.z + n.z * 0.1 });
            this.beam(shift(p), shift(q), DECK_Y + 0.03, 0.14, 0.2, wood, 0.1);
        });
        const bottom = GROUND_Y - (TOWN.island?.sideDepth ?? 1.6) - 0.3;
        const pilingTop = DECK_Y + 0.16;
        const piles = Town.alongEdges(insetPolygon(outer, -0.16), deck.pilingSpacing);
        const pileMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.2, pilingTop - bottom, 8), wood, piles.length);
        const matrix = new THREE.Matrix4();
        piles.forEach((p, i) => pileMesh.setMatrixAt(i, matrix.makeTranslation(p.x, (pilingTop + bottom) / 2, p.z)));
        pileMesh.computeBoundingSphere();
        this.group.add(pileMesh);
    }

    /** A prop's model, loaded and placed (its collider is registered up front, in the constructor). */
    private placeProp(prop: TownProp): void {
        this.loads.push(this.loadModel(prop.model, prop.height, prop.fade, prop.stretch).then((object) => {
            if (!object) return;
            object.rotation.y = prop.rotationY;
            this.settle(object, prop.x, prop.elevation ?? 0, prop.z);
            this.group.add(object);
            if (prop.height < FLAT_HEIGHT) {
                // Its top where it's walked on (the middle: a road tile's kerbs stand higher than the asphalt).
                object.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(object);
                const ray = new THREE.Raycaster(new THREE.Vector3(prop.x, box.max.y + 1, prop.z), new THREE.Vector3(0, -1, 0));
                const top = ray.intersectObject(object, true)[0]?.point.y ?? box.max.y;
                this.floors.push({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, top, object });
                this.tops.clear();
            }
        }));
    }

    /**
     * Loads a model fitted to `height` (own materials, bent with the world; `fade`: the occlusion fade, measured while
     * it's still untransformed). Not placed yet: settle() does that once it's turned.
     */
    private async loadModel(model: string, height: number, fade?: boolean, stretch?: { x: number; z: number }): Promise<THREE.Object3D | undefined> {
        try {
            const object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${model}`);
            if (this.destroyed) return undefined;
            object.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
                (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => BendService.applyBend(m));
            });
            if (fade) BendService.applyOcclusionFadeToObject(object, FADE);
            object.updateMatrixWorld(true);
            const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
            if (size.y > 1e-4) object.scale.multiplyScalar(height / size.y);
            if (stretch) object.scale.multiply(new THREE.Vector3(stretch.x, 1, stretch.z));
            if (height < FLAT_HEIGHT) {
                object.updateMatrixWorld(true);
                object.traverse((child) => {
                    if (child instanceof THREE.Mesh) child.geometry = subdivide(child.geometry, BEND_SEGMENT, child.getWorldScale(new THREE.Vector3()));
                });
            }
            return object;
        } catch (error) {
            console.warn(`[Town] could not load ${model}`, error);
            return undefined;
        }
    }

    /** Puts a (turned) model's base at `y`, centred on x/z as modelled. */
    private settle(object: THREE.Object3D, x: number, y: number, z: number): void {
        object.position.set(0, 0, 0);
        object.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(object);
        object.position.set(x, y - bounds.min.y, z);
    }

    // ---------------------------------------------------------------- stations (ATMs, wardrobes)

    /**
     * Whether a station is there: its sales are made (`appearsAfterSales`: the first wardrobe waits for the tutorial's
     * second sale) and it has no section, or its section is open.
     */
    private shown(kind: StationKind, i: number): boolean {
        const spot = stationSpots(kind)[i];
        if ((spot.appearsAfterSales ?? 0) > MowProgress.timesSold) return false;
        // The first ATM: in the tutorial not in the yard (its bag fills there on purpose: the first purchases), in the
        // park when it's full; in a city played from scratch, as soon as the bag's full.
        const firstArea = MowProgress.isRestored(MOW.districts[0].id) || !CITY.keepGear;
        if (spot.appearsWhenFull && MowProgress.timesSold === 0 && !(MowProgress.full && firstArea)) return false;
        const section = spot.section;
        if (!section) return true;
        const d = MOW.districts.findIndex((district) => district.id === section);
        return d < 0 || this.open[d];
    }

    /** A station, in its own frame (pad at the origin, the model `back` behind it on -Z, the label above the model). */
    private buildStation(kind: StationKind, spot: AtmSpot): void {
        const look = stationLook(kind);
        const group = new THREE.Group();
        // A disc in rings (so it curves with the bend), over the top pavement layer, never fighting it for depth.
        const padMaterial = this.material(look.color);
        padMaterial.transparent = true;
        padMaterial.opacity = 0.55;
        padMaterial.depthWrite = false;
        padMaterial.polygonOffset = true;
        padMaterial.polygonOffsetFactor = -2;
        padMaterial.polygonOffsetUnits = -2;
        const pad = new THREE.Mesh(new THREE.RingGeometry(0, PAD_RADIUS, 32, Math.ceil(PAD_RADIUS / BEND_SEGMENT)), padMaterial);
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = PAD_Y;
        pad.renderOrder = 1;
        group.add(pad);
        this.loads.push(this.loadModel(look.model, look.height).then((object) => {
            if (!object) return;
            this.settle(object, 0, 0, -look.back);
            group.add(object);
        }));
        const canvas = document.createElement('canvas');
        // Just the icon on its plaque (money, a heart): no words to translate.
        canvas.width = 128;
        canvas.height = 128;
        const g = canvas.getContext('2d')!;
        const draw = () => {
            g.clearRect(0, 0, canvas.width, canvas.height);
            CanvasArt.plaque(g, 6, 6, 116, 116, 24);
            CanvasArt.drawIcon(g, look.icon, 64, 64, 88);
        };
        draw();
        const texture = CanvasArt.texture(canvas);
        // Drawn while the game is still booting, the icon can come out blank: drawn again once the town is up.
        this.redraws.push(() => {
            CanvasArt.forgetIcon(look.icon);
            draw();
            texture.needsUpdate = true;
        });
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
        label.scale.set(1.3, 1.3, 1);
        label.position.set(0, look.label, -look.back);
        group.add(label);
        if (kind === 'wardrobe') {
            // The "!" over the label, bobbing (shown by setWardrobeAttention()).
            const alert = new THREE.Sprite(new THREE.SpriteMaterial({ map: alertTexture(), depthWrite: false }));
            alert.scale.set(0.9, 0.9, 1);
            alert.position.set(0.75, look.label + 0.6, -look.back);
            alert.visible = false;
            gsap.to(alert.position, { y: alert.position.y + 0.3, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
            group.add(alert);
            this.wardrobeAlerts.push(alert);
        }
        group.position.set(spot.x, 0, spot.z);
        group.rotation.y = spot.rotationY ?? 0;
        group.visible = this.shown(kind, this.groups[kind].length);
        this.groups[kind].push(group);
        this.group.add(group);
    }

    /** The station of a kind whose pad is under (x, z), or -1. */
    private stationAt(kind: StationKind, x: number, z: number): number {
        return stationSpots(kind).findIndex((spot, i) => this.shown(kind, i) && Math.hypot(x - spot.x, z - spot.z) <= PAD_RADIUS);
    }

    /** The ATM whose pad is under (x, z), or -1. */
    public atmAt(x: number, z: number): number {
        return this.stationAt('atm', x, z);
    }

    /** The wardrobe whose pad is under (x, z), or -1. */
    public wardrobeAt(x: number, z: number): number {
        return this.stationAt('wardrobe', x, z);
    }

    /** The nearest wardrobe's pad that's there, or null (none yet). */
    public nearestWardrobe(from: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 | null {
        let best = Infinity;
        stationSpots('wardrobe').forEach((spot, i) => {
            const distance = Math.hypot(from.x - spot.x, from.z - spot.z);
            if (this.shown('wardrobe', i) && distance < best) {
                best = distance;
                out.set(spot.x, 0, spot.z);
            }
        });
        return best < Infinity ? out : null;
    }

    /** The wardrobes' "!": something new in it is affordable (and the player isn't in it). */
    public setWardrobeAttention(on: boolean): void {
        for (const alert of this.wardrobeAlerts) alert.visible = on;
    }

    /** The nearest ATM's pad that's there (where the arrows lead). */
    public nearestAtm(from: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 | null {
        let best = Infinity;
        TOWN.atms.forEach((spot, i) => {
            const distance = Math.hypot(from.x - spot.x, from.z - spot.z);
            if (this.shown('atm', i) && distance < best) {
                best = distance;
                out.set(spot.x, 0, spot.z);
            }
        });
        // None out yet (the first one waits for a full bag): nowhere to lead.
        return best < Infinity ? out : null;
    }

    /** Where an ATM's model stands (the clippings are tossed into it). */
    public atmModelAt(i: number, out = new THREE.Vector3()): THREE.Vector3 {
        const box = this.boxes.atm[i];
        return out.set(box.x, TOWN.atm.height * 0.6, box.z);
    }

    /** Stations whose time has come pop in (a section just opened; a sale made: the first wardrobe). */
    public revealStations(): void {
        for (const kind of STATION_KINDS) this.groups[kind].forEach((group, i) => {
            if (group.visible || !this.shown(kind, i)) return;
            group.visible = true;
            group.scale.setScalar(0.01);
            gsap.to(group.scale, { x: 1, y: 1, z: 1, duration: 0.6, delay: 0.4, ease: 'back.out(2)' });
        });
    }

    // ---------------------------------------------------------------- separators

    /**
     * A fence all round each locked section (the island is free to roam, its locked sections aren't), with a sign on
     * its separator line (the side facing the section before it).
     */
    private buildSeparators(): void {
        const white = this.material(0xffffff);
        const post = new THREE.BoxGeometry(0.2, 1.2, 0.2);
        MOW.districts.forEach((district, d) => {
            const line = district.separator;
            if (!line || d === 0) return;
            const fence = fenceAround(district, white, post);
            // No sign where it's a pen's side (the first area's fence: a plaque there only distracts a beginner).
            if (!onPenSide(line.x, line.z)) fence.add(fenceSign(`RESTORE THE ${MOW.districts[d - 1].name.toUpperCase()}`, line.x, line.z));
            fence.visible = !this.open[d];
            this.group.add(fence);
            this.separators[d] = fence;
            const sideways = Math.abs(Math.sin(line.rotationY ?? 0)) > 0.5;
            const half = line.width / 2;
            this.separatorBoxes[d] = { x: line.x, z: line.z, halfX: sideways ? 0.25 : half, halfZ: sideways ? half : 0.25 };
        });
    }

    /**
     * Each pen (DistrictDef.pen) still standing: the white fence all round its rect, no signs (it's the very start of
     * the game: nothing to read). The player can't leave it (standable()) until releasePen().
     */
    private buildPens(): void {
        const white = this.material(0xffffff);
        const post = new THREE.BoxGeometry(0.2, 1.2, 0.2);
        MOW.districts.forEach((district, d) => {
            const pen = district.pen;
            if (!pen || !this.penned[d]) return;
            const fence = fenceAround(pen, white, post);
            this.group.add(fence);
            this.pens[d] = fence;
        });
    }

    /** A section restored: its pen (if any) sinks away and the player is free to go. */
    public releasePen(district: number): void {
        if (!this.penned[district]) return;
        this.penned[district] = false;
        const fence = this.pens[district];
        if (fence) gsap.to(fence.position, { y: -1.6, duration: 0.9, ease: 'power2.in', onComplete: () => void (fence.visible = false) });
    }

    /** Opens a section: its fence sinks away (walkable now) and its ATMs pop in. */
    public unlock(district: number): void {
        this.open[district] = true;
        const fence = this.separators[district];
        if (fence) {
            gsap.to(fence.position, { y: -1.6, duration: 0.9, ease: 'power2.in', onComplete: () => void (fence.visible = false) });
        }
        this.revealStations();
    }

    public isOpen(district: number): boolean {
        return this.open[district];
    }

    /** Where to look at a section from (its centre, on the ground). */
    public sectionCentre(district: DistrictDef, out = new THREE.Vector3()): THREE.Vector3 {
        return out.set(district.x, 0, district.z);
    }

    // ---------------------------------------------------------------- flowers

    /**
     * Flowers across a restored section (`points`: where, cut cells): a clump of daisies or tulips on each (FLOWER_KINDS,
     * at the top of this file), each clump turned, sized and coloured a little differently, instanced (one draw per
     * kind and part). With `grow`, they spring up in a wave from the section's middle.
     */
    public bloom(points: THREE.Vector3[], grow = false): void {
        if (!points.length) return;
        const centre = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(points.length);
        const reach = Math.max(1, ...points.map((p) => Math.hypot(p.x - centre.x, p.z - centre.z)));
        const up = new THREE.Vector3(0, 1, 0);
        const parts: { mesh: THREE.InstancedMesh; spots: { at: THREE.Vector3; turn: THREE.Quaternion; size: number; delay: number }[] }[] = [];
        FLOWER_KINDS.forEach((kind, k) => {
            const spots = points.filter((_, i) => i % FLOWER_KINDS.length === k).map((p) => {
                const random = Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1;
                return {
                    at: new THREE.Vector3(p.x, 0, p.z),
                    turn: new THREE.Quaternion().setFromAxisAngle(up, random * Math.PI * 2),
                    size: FLOWER_SIZE * (0.8 + random * 0.45),
                    delay: (Math.hypot(p.x - centre.x, p.z - centre.z) / reach) * 0.9 + random * 0.2,
                    colour: new THREE.Color(kind.colours[Math.floor(random * 97) % kind.colours.length]),
                };
            });
            if (!spots.length) return;
            for (const part of flowerParts(kind)) {
                const material = this.material(part.colour ?? '#ffffff');
                material.flatShading = true;
                const mesh = new THREE.InstancedMesh(part.geometry, material, spots.length);
                if (!part.colour) spots.forEach((spot, i) => mesh.setColorAt(i, spot.colour));
                mesh.frustumCulled = false;
                this.group.add(mesh);
                parts.push({ mesh, spots });
            }
        });
        const matrix = new THREE.Matrix4();
        const scale = new THREE.Vector3();
        const place = (time: number) => {
            for (const { mesh, spots } of parts) {
                spots.forEach((spot, i) => {
                    const t = Math.min(1, Math.max(0, (time - spot.delay) / 0.45));
                    // Ease out with a little overshoot (back.out).
                    const grown = t >= 1 ? 1 : 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
                    const size = spot.size * Math.max(0.001, grown);
                    mesh.setMatrixAt(i, matrix.compose(spot.at, spot.turn, scale.set(size, size, size)));
                });
                mesh.instanceMatrix.needsUpdate = true;
            }
        };
        if (!grow) {
            place(Infinity);
            return;
        }
        place(0);
        const clock = { time: 0 };
        gsap.to(clock, { time: 1.6, duration: 1.6, ease: 'none', onUpdate: () => {
            if (!this.destroyed) place(clock.time);
        } });
    }

    // ---------------------------------------------------------------- layout queries

    /**
     * The ground at (x, z): its height (the top pavement or road tile over it, else the grass) and what it is (for
     * footsteps): `pavement`, `deck` (the island's wooden band), or `grass`.
     */
    public surfaceAt(x: number, z: number): { y: number; kind: 'pavement' | 'deck' | 'grass' } {
        let y = -Infinity;
        TOWN.pavements.forEach((p, i) => {
            if (Math.abs(x - p.x) <= p.width / 2 && Math.abs(z - p.z) <= p.depth / 2) y = Math.max(y, PAVEMENT_Y + i * PAVEMENT_STEP);
        });
        for (const f of this.floors) {
            if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ) y = Math.max(y, f.top);
        }
        if (y > -Infinity) return { y, kind: 'pavement' };
        const deck = TOWN.island?.deck;
        if (deck && containsPoint(this.shore, x, z) && edgeDistance(this.shore, x, z) < deck.width) return { y: DECK_Y, kind: 'deck' };
        return { y: GRASS_Y, kind: 'grass' };
    }

    /**
     * The top of whatever is drawn at (x, z): surfaceAt()'s height, or a road tile's own surface there (its raised
     * kerbs and sidewalks too, where surfaceAt() keeps to the asphalt's height), for things laid on the ground (the
     * guide's arrows). Cached by TOP_CELL cell.
     */
    public topAt(x: number, z: number): number {
        const key = `${Math.round(x / TOP_CELL)},${Math.round(z / TOP_CELL)}`;
        const cached = this.tops.get(key);
        if (cached !== undefined) return cached;
        let y = this.surfaceAt(x, z).y;
        for (const f of this.floors) {
            if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
            topRay.set(topFrom.set(x, f.top + 5, z), DOWN);
            const hit = topRay.intersectObject(f.object, true)[0];
            if (hit) y = Math.max(y, hit.point.y);
        }
        this.tops.set(key, y);
        return y;
    }
    /** No grass under pavements, props or ATMs. */
    public isBlocked(x: number, z: number): boolean {
        const pad = 0.25;
        const under = (b: Box) => Math.abs(x - b.x) <= b.halfX + pad && Math.abs(z - b.z) <= b.halfZ + pad;
        return TOWN.pavements.some((p) => Math.abs(x - p.x) <= p.width / 2 + pad && Math.abs(z - p.z) <= p.depth / 2 + pad)
            || this.propBoxes.some(under) || STATION_KINDS.some((kind) => this.boxes[kind].some(under));
    }

    /** Obstacles to walk around (for the guide's route): props, the ATMs that are there, closed fences. */
    public get blockers(): readonly Box[] {
        return [
            ...this.propBoxes,
            ...STATION_KINDS.flatMap((kind) => this.boxes[kind].filter((_, i) => this.shown(kind, i))),
            ...this.separatorBoxes.filter((b, d): b is Box => !!b && !this.open[d]),
        ];
    }

    /**
     * Where the player can't stand, ignoring obstacles (the guide's route finder grows those itself): off the island
     * or into a locked section, as things are now.
     */
    public unstandable(): (x: number, z: number) => boolean {
        const r = this.bodyRadius;
        const locked = this.lockedRects();
        return (x, z) => !this.standable(x, z, r, locked);
    }

    /** Free to roam: the whole island inside its fence, off obstacles, out of the locked sections. */
    private isWalkable(x: number, z: number): boolean {
        const r = this.bodyRadius;
        if (!this.standable(x, z, r, this.lockedRects())) return false;
        const hits = (b: Box) => Math.abs(x - b.x) <= b.halfX + r && Math.abs(z - b.z) <= b.halfZ + r;
        return !this.blockers.some(hits) && !(this.movingBlockers?.() ?? []).some(hits);
    }

    /** The locked sections, as [x, z, halfX, halfZ]. */
    private lockedRects(): (readonly [number, number, number, number])[] {
        return MOW.districts.filter((_, i) => !this.open[i]).map((d) => [d.x, d.z, d.width / 2, d.depth / 2] as const);
    }

    /**
     * A footprint `r` round (x, z) inside the island's fence (the shore without one), off the locked rects, and inside
     * every pen still standing.
     */
    private standable(x: number, z: number, r: number, locked: readonly (readonly [number, number, number, number])[]): boolean {
        const edge = (TOWN.island?.fence?.inset ?? 0) + ISLAND_FENCE_CLEARANCE;
        if (!containsPoint(this.shore, x, z) || edgeDistance(this.shore, x, z) < edge + r) return false;
        for (let d = 0; d < this.penned.length; d++) {
            const pen = MOW.districts[d].pen;
            if (!this.penned[d] || !pen) continue;
            if (Math.abs(x - pen.x) > pen.width / 2 - PEN_CLEARANCE - r || Math.abs(z - pen.z) > pen.depth / 2 - PEN_CLEARANCE - r) return false;
        }
        return !locked.some(([lx, lz, hx, hz]) => Math.abs(x - lx) < hx + r && Math.abs(z - lz) < hz + r);
    }

    /**
     * For the map snapshots (TownSnapshotScene): every station shown, no sea, no labels or "!" (the miniature is the
     * town itself, floating on nothing).
     */
    public prepareSnapshot(): void {
        for (const kind of STATION_KINDS) this.groups[kind].forEach((group) => {
            gsap.killTweensOf(group.scale);
            group.visible = true;
            group.scale.setScalar(1);
        });
        if (this.sea) this.sea.visible = false;
        this.group.traverse((child) => {
            if (child instanceof THREE.Sprite) child.visible = false;
        });
    }

    public destroy(): void {
        this.destroyed = true;
        this.pens.forEach((fence) => fence && gsap.killTweensOf(fence.position));
        clearWalkabilityQuery(this.walkability);
        for (const kind of STATION_KINDS) this.groups[kind].forEach((group) => gsap.killTweensOf(group.scale));
        this.wardrobeAlerts.forEach((alert) => gsap.killTweensOf(alert.position));
        this.separators.forEach((fence) => fence && gsap.killTweensOf(fence.position));
        this.group.removeFromParent();
    }
}
