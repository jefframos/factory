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
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { MOW, TOWN, AtmLook, AtmSpot, DeckDef, DistrictDef, TownProp } from '../data/MowConfig';
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
const PAVEMENT_Y = 0.02;
const PAVEMENT_STEP = 0.012;
/** The island's wooden deck: just over the town's ground, under the sections' grass and the pavements. */
const DECK_Y = GROUND_Y + 0.03;
/** One deck plank's width; the plank texture holds PLANKS of them. */
const PLANK = 0.42;
const PLANKS = 4;
/** Flat things are cut into pieces this small (world units) so they curve with the bend instead of cutting through it. */
const BEND_SEGMENT = 0.5;
/** Models flatter than this (the road tiles) get cut up like that. */
const FLAT_HEIGHT = 0.3;
/** A restored section's flowers (KayKit Mixed Bag), and how tall they stand. */
const FLOWER_MODELS = ['town/nature/flax_flower_A.gltf', 'town/nature/flax_flower_B.gltf'];
const FLOWER_HEIGHT = 0.85;
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

export class Town {
    private readonly group = new THREE.Group();
    /** What the props block (fixed). */
    private readonly propBoxes: Box[] = [];
    /** Each station's box, by kind (no grass under any of them; blocking once it's there). */
    private readonly boxes: Record<StationKind, Box[]> = {
        atm: stationSpots('atm').map((spot) => stationBox(spot, stationLook('atm'))),
        wardrobe: stationSpots('wardrobe').map((spot) => stationBox(spot, stationLook('wardrobe'))),
    };
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
    /** Resolves once every model has loaded (or failed: the town still plays without one). */
    public readonly ready: Promise<void>;

    /** `open(d)`: whether section d is unlocked from the start (its predecessor restored). */
    public constructor(threeScene: THREE.Scene, open: (district: number) => boolean) {
        this.open = MOW.districts.map((_, d) => open(d));
        this.buildGround();
        TOWN.props.forEach((prop) => this.placeProp(prop));
        for (const kind of STATION_KINDS) stationSpots(kind).forEach((spot) => this.buildStation(kind, spot));
        this.buildSeparators();
        threeScene.add(this.group);
        setWalkabilityQuery(this.walkability);
        this.ready = Promise.all(this.loads).then(() => undefined);
        void this.ready.then(() => window.setTimeout(() => {
            if (!this.destroyed) this.redraws.forEach((redraw) => redraw());
        }, 300));
    }

    private material(color: number | string): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
        BendService.applyBend(material);
        return material;
    }

    /** A flat slab on the ground, subdivided so it follows the world bend. */
    private slab(x: number, z: number, width: number, depth: number, color: number | string, y: number): void {
        const geometry = new THREE.PlaneGeometry(width, depth, Math.ceil(width / BEND_SEGMENT), Math.ceil(depth / BEND_SEGMENT));
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, this.material(color));
        mesh.position.set(x, y, z);
        this.group.add(mesh);
    }

    private buildGround(): void {
        const deck = TOWN.island?.deck;
        // Ground cells inside the shore; with a deck they stop half way under it (its planks hide their steps).
        this.groundCells(deck ? insetPolygon(this.shore, deck.width / 2) : this.shore, TOWN.ground.color);
        TOWN.pavements.forEach((p, i) => this.slab(p.x, p.z, p.width, p.depth, p.color, PAVEMENT_Y + i * PAVEMENT_STEP));
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
        geometry.setIndex(index);
        this.group.add(new THREE.Mesh(geometry, this.material(color)));
    }

    /** A box from a to b on the ground (`extend` past both ends), cut along its length so it curves with the bend. */
    private beam(a: ShorePoint, b: ShorePoint, y: number, height: number, thickness: number, material: THREE.Material, extend = 0): void {
        const length = Math.hypot(b.x - a.x, b.z - a.z) + extend * 2;
        const geometry = new THREE.BoxGeometry(length, height, thickness, Math.max(1, Math.ceil(length / BEND_SEGMENT)), 1, 1);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
        mesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
        this.group.add(mesh);
    }

    /** Points every ~`spacing` along a closed polygon's edges (each corner included). */
    private static alongEdges(points: readonly ShorePoint[], spacing: number): ShorePoint[] {
        const out: ShorePoint[] = [];
        points.forEach((p, i) => {
            const q = points[(i + 1) % points.length];
            const count = Math.max(1, Math.round(Math.hypot(q.x - p.x, q.z - p.z) / spacing));
            for (let k = 0; k < count; k++) out.push({ x: p.x + ((q.x - p.x) * k) / count, z: p.z + ((q.z - p.z) * k) / count });
        });
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
        const side = this.material(island.sideColor);
        shore.forEach((p, i) => {
            const q = shore[(i + 1) % shore.length];
            const n = normals[i];
            const inward = (point: ShorePoint) => ({ x: point.x + (n.x * T) / 2, z: point.z + (n.z * T) / 2 });
            this.beam(inward(p), inward(q), top - island.sideDepth / 2, island.sideDepth, T, side, T);
        });

        const { minX, maxX, minZ, maxZ } = bounds(shore);
        const seaWidth = maxX - minX + island.margin * 2;
        const seaDepth = maxZ - minZ + island.margin * 2;
        const geometry = new THREE.PlaneGeometry(seaWidth, seaDepth, BendService.segmentsForSpan(seaWidth), BendService.segmentsForSpan(seaDepth));
        geometry.rotateX(-Math.PI / 2);
        const material = createWaterMaterial(island.water, -island.waterLevel);
        const sea = new THREE.Mesh(geometry, material);
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

    private placeProp(prop: TownProp): void {
        if (prop.collider) this.propBoxes.push({ x: prop.x, z: prop.z, halfX: prop.collider.halfX, halfZ: prop.collider.halfZ });
        this.loads.push(this.loadModel(prop.model, prop.height, prop.fade, prop.stretch).then((object) => {
            if (!object) return;
            object.rotation.y = prop.rotationY;
            this.settle(object, prop.x, prop.elevation ?? 0, prop.z);
            this.group.add(object);
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
        const section = spot.section;
        if (!section) return true;
        const d = MOW.districts.findIndex((district) => district.id === section);
        return d < 0 || this.open[d];
    }

    /** A station, in its own frame (pad at the origin, the model `back` behind it on -Z, the label above the model). */
    private buildStation(kind: StationKind, spot: AtmSpot): void {
        const look = stationLook(kind);
        const group = new THREE.Group();
        const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD_RADIUS, 32), this.material(look.color));
        pad.rotation.x = -Math.PI / 2;
        pad.position.y = 0.1;
        (pad.material as THREE.MeshStandardMaterial).transparent = true;
        (pad.material as THREE.MeshStandardMaterial).opacity = 0.55;
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
    public nearestAtm(from: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
        let best = Infinity;
        TOWN.atms.forEach((spot, i) => {
            const distance = Math.hypot(from.x - spot.x, from.z - spot.z);
            if (this.shown('atm', i) && distance < best) {
                best = distance;
                out.set(spot.x, 0, spot.z);
            }
        });
        return out;
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
            const fence = new THREE.Group();
            const hx = district.width / 2;
            const hz = district.depth / 2;
            const sides: [number, number, number, boolean][] = [
                [district.x, district.z - hz, district.width, true], [district.x, district.z + hz, district.width, true],
                [district.x - hx, district.z, district.depth, false], [district.x + hx, district.z, district.depth, false],
            ];
            const spots: [number, number][] = [];
            for (const [x, z, length, alongX] of sides) {
                for (const y of [0.45, 0.95]) {
                    const rail = new THREE.Mesh(new THREE.BoxGeometry(alongX ? length : 0.08, 0.12, alongX ? 0.08 : length), white);
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
            const canvas = document.createElement('canvas');
            canvas.width = 384;
            canvas.height = 96;
            const g = canvas.getContext('2d')!;
            CanvasArt.plaque(g, 6, 6, 372, 84, 20);
            CanvasArt.drawIcon(g, 'Icon_Lock02', 48, 48, 52);
            CanvasArt.text(g, `RESTORE THE ${MOW.districts[d - 1].name.toUpperCase()}`, 220, 50, 30, '#ffe27a', 290);
            const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: CanvasArt.texture(canvas), depthWrite: false }));
            sign.scale.set(4.2, 1.05, 1);
            sign.position.set(line.x, 2.1, line.z);
            fence.add(sign);
            fence.visible = !this.open[d];
            this.group.add(fence);
            this.separators[d] = fence;
            const sideways = Math.abs(Math.sin(line.rotationY ?? 0)) > 0.5;
            const half = line.width / 2;
            this.separatorBoxes[d] = { x: line.x, z: line.z, halfX: sideways ? 0.25 : half, halfZ: sideways ? half : 0.25 };
        });
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
     * Flowers across a restored section (`points`: where, cut cells): the library's flax flowers, alternating between
     * its two kinds, each turned and sized a little differently, instanced (one draw per kind and part).
     */
    public bloom(points: THREE.Vector3[]): void {
        FLOWER_MODELS.forEach((model, kind) => {
            const spots = points.filter((_, i) => i % FLOWER_MODELS.length === kind);
            if (!spots.length) return;
            this.loads.push(this.loadModel(model, 1).then((object) => {
                if (!object || this.destroyed) return;
                object.updateMatrixWorld(true);
                const matrix = new THREE.Matrix4();
                const placed = new THREE.Matrix4();
                const turn = new THREE.Quaternion();
                const up = new THREE.Vector3(0, 1, 0);
                object.traverse((child) => {
                    if (!(child instanceof THREE.Mesh)) return;
                    const mesh = new THREE.InstancedMesh(child.geometry, child.material, spots.length);
                    spots.forEach((p, i) => {
                        const random = Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233)) % 1;
                        const size = FLOWER_HEIGHT * (0.75 + random * 0.5);
                        placed.compose(new THREE.Vector3(p.x, 0, p.z), turn.setFromAxisAngle(up, random * Math.PI * 2), new THREE.Vector3(size, size, size));
                        mesh.setMatrixAt(i, matrix.multiplyMatrices(placed, child.matrixWorld));
                    });
                    mesh.computeBoundingSphere();
                    this.group.add(mesh);
                });
            }));
        });
    }

    // ---------------------------------------------------------------- layout queries

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
        return !this.blockers.some((b) => Math.abs(x - b.x) <= b.halfX + r && Math.abs(z - b.z) <= b.halfZ + r);
    }

    /** The locked sections, as [x, z, halfX, halfZ]. */
    private lockedRects(): (readonly [number, number, number, number])[] {
        return MOW.districts.filter((_, i) => !this.open[i]).map((d) => [d.x, d.z, d.width / 2, d.depth / 2] as const);
    }

    /** A footprint `r` round (x, z) inside the island's fence (the shore without one) and off the locked rects. */
    private standable(x: number, z: number, r: number, locked: readonly (readonly [number, number, number, number])[]): boolean {
        const edge = (TOWN.island?.fence?.inset ?? 0) + ISLAND_FENCE_CLEARANCE;
        if (!containsPoint(this.shore, x, z) || edgeDistance(this.shore, x, z) < edge + r) return false;
        return !locked.some(([lx, lz, hx, hz]) => Math.abs(x - lx) < hx + r && Math.abs(z - lz) < hz + r);
    }

    public destroy(): void {
        this.destroyed = true;
        clearWalkabilityQuery(this.walkability);
        for (const kind of STATION_KINDS) this.groups[kind].forEach((group) => gsap.killTweensOf(group.scale));
        this.wardrobeAlerts.forEach((alert) => gsap.killTweensOf(alert.position));
        this.separators.forEach((fence) => fence && gsap.killTweensOf(fence.position));
        this.group.removeFromParent();
    }
}
