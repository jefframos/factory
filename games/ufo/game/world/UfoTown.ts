// UfoTown.ts
//
// The level as a world to eat: the island (ground, pavements, sides, fence, sea), and its props as Items. An item is
// eaten when its middle is under the saucer, it fits under it (radius) and the saucer flies above it (height); a prop
// with a collider that's taller than the saucer flies blocks it. Flat props (road tiles) are only ground.
//
// Tall things standing between the camera and the saucer fade out (fadeBlocking()).

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { FLAT_HEIGHT, Level, MODEL_BASE, Pavement, Point, Prop, SOLID_CUBE_HEIGHT, UFO } from '../data/UfoConfig';
import { BendCuller, applyBend, bendObject, bendSegments } from '../services/Bend';
import { containsPoint, insetPolygon, inwardNormals, shoreOutline } from './Shore';
import { subdivideObject, subdivideOwn } from './Subdivide';
import { createWater } from './Water';

/** An axis-aligned box on the ground that blocks a saucer flying lower than `height`. */
export interface Blocker extends Point {
    halfX: number;
    halfZ: number;
    height: number;
}

export interface Item extends Point {
    object: THREE.Object3D;
    /** Its footprint's reach from its middle: the saucer's radius has to cover it. */
    radius: number;
    height: number;
    /** What eating it grows the saucer by (its volume, UFO.valuePower). */
    value: number;
    blocker?: Blocker;
    /** Its bounds (for fading it), and its materials once it has been made fadeable. */
    bounds: THREE.Box3;
    materials?: THREE.Material[];
    opacity: number;
    /** Eaten, or being eaten. */
    gone?: boolean;
    /** Eating this finishes the level (Level.goal). */
    goal?: boolean;
    /** Its shadow on the ground: goes with it. */
    shadow?: THREE.Mesh;
    /** What it was placed from: it can be put back. */
    prop?: Prop;
    /** A rival off screen pretended to eat it: rivals leave it alone till then (seconds, performance.now()). */
    sparedUntil?: number;
}

const GROUND_Y = -0.05;
const PAVEMENT_Y = 0.02;
const PAVEMENT_STEP = 0.012;
const PAVEMENT_STACK = 0.06;
/** Only things this tall can hide the saucer. */
const FADE_MIN_HEIGHT = 3;
const FADE_OPACITY = 0.25;
const FADE_SPEED = 8;
/** What counts as on the island: this far inside the shore. */
const SHORE_MARGIN = 1;
/** World units one repeat of a texture covers. The open ground has 6 cobbles across one. */
const STONE_TILE = 1.6;
const GROUND_TILE = 6;
/** The things' shadows: from how tall, up to how long (their height, up to this), the sun's way (per unit of height), their look; over the road tiles. */
const SHADOW = { minHeight: 2, maxHeight: 20, x: 0.42, z: 0.34, color: 0x3a2f5c, opacity: 0.2, y: 0.24 };
/** The ground's cells (world units): small, as it's cut by the shore in steps of this; bigger on a big island, in at most this many a side. */
const GROUND_CELL = 0.5;
const GROUND_CELLS_MAX = 250;
const PAVING_TILE = 2;

/** Over the road tiles' own colours. */
const ROAD_TINT = 0xd6cce6;
/** One deck plank's width; the plank texture holds PLANKS of them. */
const PLANK = 0.42;
const PLANKS = 4;
/** The deck's pieces (world units), and its posts' look when a level doesn't say. */
const DECK_SEGMENT = 0.5;
const DECK_Y = GROUND_Y + 0.03;
const DECK_DEFAULTS = { pilingColor: '#6b4a30', pilingSpacing: 2.6 };

const seeded = (seed: number) => {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
};

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

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function tiledTexture(draw: (g: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    draw(canvas.getContext('2d')!, 256);
    const texture = canvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
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
    const texture = canvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
}

/** The island's sides: staggered stone blocks, each a slightly different shade, thin mortar lines. */
const stoneTexture = () => tiledTexture((g, size) => {
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

/** The open ground: big flat slabs, thin soft seams, hardly any difference between them. */
const softTileTexture = () => tiledTexture((g, size) => {
    const random = seeded(31);
    g.fillStyle = grey(0.9);
    g.fillRect(0, 0, size, size);
    const tiles = 2;
    const s = size / tiles;
    for (let r = 0; r < tiles; r++) {
        for (let c = 0; c < tiles; c++) {
            g.fillStyle = grey(0.975 + random() * 0.025);
            g.fillRect(c * s + 1.5, r * s + 1.5, s - 3, s - 3);
        }
    }
});

/** The plazas and paths: square paving slabs (faint seams, each a slightly different shade). */
const pavingTexture = () => tiledTexture((g, size) => {
    const random = seeded(11);
    const slabs = 3;
    const s = size / slabs;
    g.fillStyle = grey(0.86);
    g.fillRect(0, 0, size, size);
    for (let r = 0; r < slabs; r++) {
        for (let c = 0; c < slabs; c++) {
            g.fillStyle = grey(0.97 + random() * 0.03);
            g.fillRect(c * s + 1.5, r * s + 1.5, s - 3, s - 3);
        }
    }
});

/** Grain only: tarmac. */
const grainTexture = (seed: number, count: number) => tiledTexture((g, size) => {
    const random = seeded(seed);
    g.fillStyle = grey(0.95);
    g.fillRect(0, 0, size, size);
    speckle(g, size, random, count);
});

/** The lawns' grass: "pixels" per world unit (the mow game's). */
const GRASS_PIXELS = 12;

/**
 * A lawn's look (the mow game's, without its mowing): pixel-noise grass over the material's colour, worked out from the
 * world position, so it never stretches and carries on from one lawn to the next.
 */
function grassMaterial(color: string): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    material.customProgramCacheKey = () => 'ufo-grass';
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uGrassPixels = { value: GRASS_PIXELS };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vGrassXZ;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrassXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec2 vGrassXZ;
                uniform float uGrassPixels;
                float grassHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                vec2 grassPixel = floor(vGrassXZ * uGrassPixels);
                float grain = grassHash(grassPixel);
                float blade = step(0.965, grassHash(grassPixel + 31.7));
                // Soft patches of lighter and darker lawn, and only a fleck of grain.
                vec2 g = vGrassXZ * 0.16;
                float patches = 0.5 + 0.25 * (sin(g.x * 1.7 + sin(g.y * 1.3) * 1.6) + sin(g.y * 2.1 + sin(g.x * 1.1) * 1.8));
                diffuseColor.rgb *= (0.93 + patches * 0.13) * (0.985 + grain * 0.03 + blade * 0.09);`);
    };
    return material;
}

export class UfoTown {
    private readonly group = new THREE.Group();
    private readonly shore: Point[];
    private readonly landArea: Point[];
    /** Where the saucer's middle may go: the island and a way out over the water (UFO.waterMargin). */
    private readonly flightLimit: Point[];
    private readonly textures: THREE.Texture[] = [];
    private readonly ownMaterials: THREE.Material[] = [];
    private shadowMaterial: THREE.MeshBasicMaterial | null = null;
    private readonly ownGeometries: THREE.BufferGeometry[] = [];
    private readonly ray = new THREE.Ray();
    private readonly hit = new THREE.Vector3();
    private destroyed = false;
    private seaFree: (() => void) | null = null;
    private sea: THREE.Mesh | null = null;
    /** Everything still there to eat (shrinks as it's eaten; grows as models load). */
    public readonly items: Item[] = [];
    /** Every prop's blocker from the start (a model still loading already blocks), until it's eaten. */
    public readonly blockers: Blocker[] = [];
    public readonly ready: Promise<void>;
    /** Everything in the town that can go off screen; the scene updates it each frame. */
    public readonly culler = new BendCuller();
    /** The level's goal, once its model's in. */
    public goalItem: Item | null = null;

    public constructor(threeScene: THREE.Scene, private readonly level: Level) {
        this.shore = shoreOutline(level);
        this.landArea = insetPolygon(this.shore, SHORE_MARGIN);
        this.flightLimit = insetPolygon(this.shore, -UFO.waterMargin);
        this.buildGround();
        this.buildIsland();
        for (const cube of level.colliders ?? []) {
            if (cube.solid) this.blockers.push({ x: cube.x, z: cube.z, halfX: cube.width / 2, halfZ: cube.depth / 2, height: cube.height ?? SOLID_CUBE_HEIGHT });
        }
        const loads = level.props.map((prop) => this.placeProp(prop));
        threeScene.add(this.group);
        this.ready = Promise.all(loads).then(() => undefined);
    }

    /** The sea, made its own thing beside the rest of the town (which setVisible() then shows or hides without it). */
    public separateSea(): THREE.Mesh | null {
        if (this.sea && this.sea.parent === this.group) this.group.parent?.add(this.sea);
        return this.sea;
    }

    public setVisible(on: boolean): void {
        this.group.visible = on;
    }

    /** How far the island reaches. */
    public bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
        const xs = this.shore.map((p) => p.x);
        const zs = this.shore.map((p) => p.z);
        return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    }

    public isOverIsland(x: number, z: number): boolean {
        return containsPoint(this.landArea, x, z);
    }

    /**
     * Somewhere on the island to appear: clear of anything tall for a small saucer, and at least `apart` from each of
     * `others`, or as near to that as a fair few tries find.
     */
    public findOpenSpot(others: readonly { x: number; y: number }[], apart: number): THREE.Vector2 {
        const { ground } = this.level;
        const spot = new THREE.Vector2(this.level.start.x, this.level.start.z);
        let best = -1;
        for (let i = 0; i < 80; i++) {
            const x = ground.x + (Math.random() - 0.5) * ground.width;
            const z = ground.z + (Math.random() - 0.5) * ground.depth;
            if (!this.isOverIsland(x, z)) continue;
            if (this.blockers.some((box) => Math.abs(x - box.x) <= box.halfX + 1.5 && Math.abs(z - box.z) <= box.halfZ + 1.5)) continue;
            const nearest = others.reduce((least, other) => Math.min(least, Math.hypot(other.x - x, other.y - z)), Infinity);
            if (nearest <= best) continue;
            best = nearest;
            spot.set(x, z);
            if (nearest >= apart) break;
        }
        return spot;
    }

    public canFlyTo(x: number, z: number): boolean {
        return containsPoint(this.flightLimit, x, z);
    }

    /** How far out over the water (x, z) is, 0 over land, with `toShore` set to the way back (a unit vector). */
    public overWater(x: number, z: number, toShore: THREE.Vector2): number {
        if (containsPoint(this.shore, x, z)) return 0;
        let best = Infinity;
        this.shore.forEach((a, i) => {
            const b = this.shore[(i + 1) % this.shore.length];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
            const nearX = a.x + dx * t - x;
            const nearZ = a.z + dz * t - z;
            const distance = Math.hypot(nearX, nearZ);
            if (distance >= best) return;
            best = distance;
            toShore.set(nearX / (distance || 1), nearZ / (distance || 1));
        });
        return best;
    }

    // ---------------------------------------------------------------- the island

    private material(color: string | number, map: THREE.Texture | null = null): THREE.MeshStandardMaterial {
        const material = new THREE.MeshStandardMaterial({ color, map, roughness: 0.85 });
        applyBend(material);
        this.ownMaterials.push(material);
        return material;
    }

    private texture(texture: THREE.CanvasTexture): THREE.CanvasTexture {
        this.textures.push(texture);
        return texture;
    }

    private geometry<T extends THREE.BufferGeometry>(geometry: T): T {
        this.ownGeometries.push(geometry);
        return geometry;
    }

    /**
     * The ground: a grid over the shore's bounds, keeping the cells whose middle is inside `area` (with a deck, half way
     * under it: its boards hide the steps). The texture repeats in world space, whatever the island's shape.
     */
    private groundCells(area: readonly Point[], material: THREE.Material): void {
        const xs = this.shore.map((p) => p.x);
        const zs = this.shore.map((p) => p.z);
        const minX = Math.min(...xs);
        const minZ = Math.min(...zs);
        const cell = Math.max(GROUND_CELL, Math.max(Math.max(...xs) - minX, Math.max(...zs) - minZ) / GROUND_CELLS_MAX);
        const cols = Math.ceil((Math.max(...xs) - minX) / cell);
        const rows = Math.ceil((Math.max(...zs) - minZ) / cell);
        const count = (cols + 1) * (rows + 1);
        const positions = new Float32Array(count * 3);
        const normals = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                const i = r * (cols + 1) + c;
                const x = minX + c * cell;
                const z = minZ + r * cell;
                positions.set([x, GROUND_Y, z], i * 3);
                normals[i * 3 + 1] = 1;
                uvs.set([x / GROUND_TILE, z / GROUND_TILE], i * 2);
            }
        }
        const index: number[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!containsPoint(area, minX + (c + 0.5) * cell, minZ + (r + 0.5) * cell)) continue;
                const a = r * (cols + 1) + c;
                index.push(a, a + cols + 1, a + 1, a + cols + 1, a + cols + 2, a + 1);
            }
        }
        const geometry = this.geometry(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(index);
        // (Under the whole view nearly always: drawn without a test.)
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    private buildGround(): void {
        const { ground, pavements } = this.level;
        const cobbles = this.texture(softTileTexture());
        const deck = this.level.island?.deck;
        this.groundCells(deck ? insetPolygon(this.shore, deck.width / 2) : this.shore, this.material(ground.color, cobbles));
        const paving = this.texture(pavingTexture());
        const asphalt = this.texture(grainTexture(23, 2500));
        const step = Math.min(PAVEMENT_STEP, PAVEMENT_STACK / Math.max(1, pavements.length));
        pavements.forEach((pavement, i) => this.slab(pavement, PAVEMENT_Y + i * step, paving, asphalt));
    }

    private slab(pavement: Pavement, y: number, paving: THREE.Texture, asphalt: THREE.Texture): void {
        const road = pavement.id.startsWith('road');
        const isLawn = pavement.id.startsWith('lawn');
        const map = road ? asphalt : paving;
        const tile = road ? STONE_TILE : PAVING_TILE;
        const geometry = this.geometry(new THREE.PlaneGeometry(pavement.width, pavement.depth, bendSegments(pavement.width), bendSegments(pavement.depth)));
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * pavement.width) / tile, (uv.getY(i) * pavement.depth) / tile);
        geometry.rotateX(-Math.PI / 2);
        let material: THREE.Material;
        if (isLawn) {
            material = grassMaterial(pavement.color);
            applyBend(material);
            this.ownMaterials.push(material);
        } else {
            material = this.material(pavement.color, map);
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(pavement.x, y, pavement.z);
        this.group.add(mesh);
        this.culler.addStatic(mesh);
    }

    /**
     * A box from a to b, `y` its middle, cut along its length so it curves with the bend. With `tile`, its texture runs
     * along the length and up the height, repeating every `tile` units, lined up with its neighbours' by world position.
     */
    private beam(a: Point, b: Point, y: number, height: number, thickness: number, material: THREE.Material, tile = 0): void {
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const geometry = this.geometry(new THREE.BoxGeometry(length + thickness, height, thickness, bendSegments(length + thickness)));
        if (tile) {
            const along = (a.x * (b.x - a.x) + a.z * (b.z - a.z)) / Math.max(length, 1e-6) + length / 2;
            const position = geometry.getAttribute('position');
            const uv = geometry.getAttribute('uv');
            for (let i = 0; i < uv.count; i++) uv.setXY(i, (position.getX(i) + along) / tile, (position.getY(i) + y) / tile);
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
        mesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
        this.group.add(mesh);
        this.culler.addStatic(mesh);
    }

    private buildIsland(): void {
        const island = this.level.island;
        if (!island) return;
        const shore = this.shore;
        const deck = island.deck;
        const top = deck ? DECK_Y : GROUND_Y;
        if (deck) this.buildDeck(deck, island.sideDepth);
        const normals = inwardNormals(shore);
        const side = this.material(island.sideColor, this.texture(stoneTexture()));
        shore.forEach((p, i) => {
            const q = shore[(i + 1) % shore.length];
            const n = normals[i];
            const inward = (point: Point) => ({ x: point.x + n.x * 0.1, z: point.z + n.z * 0.1 });
            this.beam(inward(p), inward(q), top - island.sideDepth / 2, island.sideDepth, 0.2, side, STONE_TILE);
        });

        const xs = shore.map((p) => p.x);
        const zs = shore.map((p) => p.z);
        const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
        // Far enough that the bend takes its edges below the horizon, even from as high as the camera ends up.
        const margin = Math.max(island.margin, 400);
        const sea = createWater(island.water, maxX - minX + margin * 2, maxZ - minZ + margin * 2, shore, (minX + maxX) / 2, (minZ + maxZ) / 2);
        this.seaFree = sea.userData.free as () => void;
        this.sea = sea;
        sea.position.set((minX + maxX) / 2, -island.waterLevel, (minZ + maxZ) / 2);
        sea.renderOrder = -1;
        sea.frustumCulled = false;
        this.ownGeometries.push(sea.geometry);
        this.ownMaterials.push(sea.material as THREE.Material);
        this.group.add(sea);

        const fence = island.fence;
        if (!fence) return;
        const line = insetPolygon(shore, fence.inset);
        const rail = this.material(fence.color);
        line.forEach((p, i) => {
            const q = line[(i + 1) % line.length];
            this.beam(p, q, top + fence.height, 0.08, 0.1, rail);
            this.beam(p, q, top + fence.height * 0.45, 0.06, 0.08, rail);
        });
        const postHeight = fence.height + 0.04;
        this.instances(UfoTown.alongEdges(line, fence.spacing), new THREE.BoxGeometry(0.14, postHeight, 0.14), rail, top + postHeight / 2);
    }

    /** Copies of a shape at each point, its middle at `y`. */
    private instances(points: readonly Point[], geometry: THREE.BufferGeometry, material: THREE.Material, y: number): void {
        this.geometry(geometry);
        const mesh = new THREE.InstancedMesh(geometry, material, points.length);
        const matrix = new THREE.Matrix4();
        points.forEach((p, i) => mesh.setMatrixAt(i, matrix.makeTranslation(p.x, y, p.z)));
        // All round the island: drawn without a test.
        mesh.frustumCulled = false;
        this.group.add(mesh);
    }

    /** Points every ~`spacing` round a closed polygon, evenly spaced along its whole length. */
    private static alongEdges(points: readonly Point[], spacing: number): Point[] {
        const lengths = points.map((p, i) => {
            const q = points[(i + 1) % points.length];
            return Math.hypot(q.x - p.x, q.z - p.z);
        });
        const total = lengths.reduce((sum, length) => sum + length, 0);
        const count = Math.max(3, Math.round(total / spacing));
        const out: Point[] = [];
        let edge = 0;
        let start = 0;
        for (let k = 0; k < count; k++) {
            const at = (k * total) / count;
            while (edge < points.length - 1 && at > start + lengths[edge]) start += lengths[edge++];
            const p = points[edge];
            const q = points[(edge + 1) % points.length];
            const t = lengths[edge] > 0 ? (at - start) / lengths[edge] : 0;
            out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
        }
        return out;
    }

    /**
     * The wooden deck round the shore: planks laid across it (the texture runs along each edge), a trim board on its edge
     * and pilings down into the sea.
     */
    private buildDeck(deck: NonNullable<NonNullable<Level['island']>['deck']>, sideDepth: number): void {
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
        const across = Math.max(1, Math.ceil(deck.width / DECK_SEGMENT));
        outer.forEach((p, i) => {
            const j = (i + 1) % outer.length;
            const q = outer[j];
            const length = Math.hypot(q.x - p.x, q.z - p.z);
            const along = Math.max(1, Math.ceil(length / DECK_SEGMENT));
            const base = positions.length / 3;
            for (let a = 0; a <= along; a++) {
                const t = a / along;
                const ox = p.x + (q.x - p.x) * t;
                const oz = p.z + (q.z - p.z) * t;
                const ix = inner[i].x + (inner[j].x - inner[i].x) * t;
                const iz = inner[i].z + (inner[j].z - inner[i].z) * t;
                for (let b = 0; b <= across; b++) {
                    const k = b / across;
                    positions.push(ox + (ix - ox) * k, DECK_Y, oz + (iz - oz) * k);
                    uvs.push((t * length) / (PLANK * PLANKS), k);
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
        const geometry = this.geometry(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        const planks = this.material(0xffffff, this.texture(plankTexture(deck.color)));
        planks.roughness = 0.9;
        const mesh = new THREE.Mesh(geometry, planks);
        mesh.frustumCulled = false;
        this.group.add(mesh);

        // The trim board along the shore, and the pilings just outside it.
        const wood = this.material(deck.pilingColor ?? DECK_DEFAULTS.pilingColor);
        const normals = inwardNormals(outer);
        outer.forEach((p, i) => {
            const q = outer[(i + 1) % outer.length];
            const n = normals[i];
            const shift = (point: Point) => ({ x: point.x + n.x * 0.1, z: point.z + n.z * 0.1 });
            this.beam(shift(p), shift(q), DECK_Y + 0.03, 0.14, 0.2, wood);
        });
        // A spacing of 0: none (the home screen's miniature).
        const spacing = deck.pilingSpacing ?? DECK_DEFAULTS.pilingSpacing;
        if (spacing <= 0) return;
        const bottom = GROUND_Y - sideDepth - 0.3;
        const pilingTop = DECK_Y + 0.16;
        this.instances(UfoTown.alongEdges(insetPolygon(outer, -0.16), spacing),
            new THREE.CylinderGeometry(0.17, 0.2, pilingTop - bottom, 8), wood, (pilingTop + bottom) / 2);
    }

    // ---------------------------------------------------------------- props

    private async placeProp(prop: Prop): Promise<void> {
        const flat = prop.height < FLAT_HEIGHT;
        const blocker: Blocker | undefined = !flat && prop.collider
            ? { x: prop.x, z: prop.z, halfX: prop.collider.halfX, halfZ: prop.collider.halfZ, height: prop.height }
            : undefined;
        if (blocker) this.blockers.push(blocker);
        let object: THREE.Object3D;
        try {
            object = await ModelLoaderManager.instance.loadModel(`${MODEL_BASE}${prop.model}`);
        } catch (error) {
            console.warn(`[UfoTown] could not load ${prop.model}`, error);
            return;
        }
        if (this.destroyed) return;
        // Fitted to its height and turned, its base on the ground.
        object.updateMatrixWorld(true);
        const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
        if (size.y > 1e-4) object.scale.multiplyScalar(prop.height / size.y);
        if (prop.stretch) object.scale.multiply(new THREE.Vector3(prop.stretch.x, 1, prop.stretch.z));
        object.rotation.y = prop.rotationY;
        object.position.set(0, 0, 0);
        object.updateMatrixWorld(true);
        const base = new THREE.Box3().setFromObject(object).min.y;
        object.position.set(prop.x, (prop.elevation ?? 0) - base, prop.z);
        object.updateMatrixWorld(true);
        if (flat) {
            subdivideObject(object);
            // Road tiles in the ground's soft colours.
            object.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                for (const material of [child.material].flat()) (material as THREE.MeshStandardMaterial).color?.setHex(ROAD_TINT);
            });
        }
        bendObject(object);
        this.group.add(object);
        this.culler.addStatic(object);
        if (flat) return;
        const bounds = new THREE.Box3().setFromObject(object);
        const footprint = bounds.getSize(new THREE.Vector3());
        const goal = this.level.goal?.model === prop.model && !this.goalItem ? this.level.goal : null;
        const item: Item = {
            object, x: prop.x, z: prop.z,
            radius: goal ? goal.radius : Math.max(footprint.x, footprint.z) / 2,
            height: prop.height,
            value: UfoTown.valueOf(footprint.x * footprint.y * footprint.z),
            blocker, bounds, opacity: 1,
            goal: Boolean(goal),
            prop,
        };
        if (goal) this.goalItem = item;
        this.addShadow(item);
        this.items.push(item);
    }

    /** A long flat shadow from a thing's foot, away from the sun: the sharp shape that sits it on the ground. */
    private addShadow(item: Item): void {
        if (item.height < SHADOW.minHeight) return;
        const { min, max } = item.bounds;
        const reach = Math.min(item.height, SHADOW.maxHeight);
        const sx = reach * SHADOW.x;
        const sz = reach * SHADOW.z;
        // The outline of the footprint swept along the sun's way.
        const corners = [[min.x, min.z], [max.x, min.z], [max.x + sx, min.z + sz], [max.x + sx, max.z + sz], [min.x + sx, max.z + sz], [min.x, max.z]];
        const middleX = corners.reduce((sum, c) => sum + c[0], 0) / corners.length;
        const middleZ = corners.reduce((sum, c) => sum + c[1], 0) / corners.length;
        const positions: number[] = [];
        corners.forEach(([x, z], i) => {
            const [nx, nz] = corners[(i + 1) % corners.length];
            positions.push(middleX, 0, middleZ, nx, 0, nz, x, 0, z);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        this.shadowMaterial ??= this.makeShadowMaterial();
        const mesh = new THREE.Mesh(geometry, this.shadowMaterial);
        mesh.position.y = SHADOW.y;
        mesh.renderOrder = 1;
        this.group.add(mesh);
        subdivideOwn(mesh);
        this.culler.addStatic(mesh);
        item.shadow = mesh;
    }

    private makeShadowMaterial(): THREE.MeshBasicMaterial {
        const material = new THREE.MeshBasicMaterial({ color: SHADOW.color, transparent: true, opacity: SHADOW.opacity, depthWrite: false });
        applyBend(material);
        this.ownMaterials.push(material);
        return material;
    }

    /** A thing's growth value from its volume. */
    public static valueOf(volume: number): number {
        return Math.pow(Math.max(volume, 0.01), UFO.valuePower);
    }

    /** A moving thing to eat (a car): it isn't in the level's props. */
    public addItem(item: Item): void {
        this.items.push(item);
    }

    /** Off the list and no longer blocking, its model left for the caller to animate away. */
    /** A thing that was eaten, back where it was. */
    public restore(prop: Prop): Promise<void> {
        return this.placeProp(prop);
    }

    public take(item: Item): void {
        item.gone = true;
        if (item.shadow) {
            this.culler.remove(item.shadow);
            item.shadow.removeFromParent();
            item.shadow.geometry.dispose();
        }
        this.items.splice(this.items.indexOf(item), 1);
        this.culler.remove(item.object);
        if (item.blocker) this.blockers.splice(this.blockers.indexOf(item.blocker), 1);
    }

    /** Puts a thing's own materials on it (its clones share them with every other copy of the model): it can fade alone. */
    private fadeable(item: Item): THREE.Material[] {
        if (item.materials) return item.materials;
        const materials: THREE.Material[] = [];
        item.object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            // (A clone loses the bend: bent again, reusing the same compiled shader.)
            child.material = Array.isArray(child.material) ? child.material.map((m) => m.clone()) : child.material.clone();
            bendObject(child);
            materials.push(...[child.material].flat());
        });
        return (item.materials = materials);
    }

    /** Whatever tall stands between the camera and the saucer fades out, and comes back once it's clear. */
    public fadeBlocking(camera: THREE.Vector3, ufo: THREE.Vector3, delta: number): void {
        const distance = camera.distanceTo(ufo);
        this.ray.origin.copy(camera);
        this.ray.direction.copy(ufo).sub(camera).normalize();
        for (const item of this.items) {
            if (item.height < FADE_MIN_HEIGHT) continue;
            const crossed = this.ray.intersectBox(item.bounds, this.hit);
            const blocking = !!crossed && camera.distanceTo(crossed) < distance;
            const goal = blocking ? FADE_OPACITY : 1;
            if (item.opacity === goal) continue;
            item.opacity += (goal - item.opacity) * Math.min(1, delta * FADE_SPEED);
            if (Math.abs(item.opacity - goal) < 0.01) item.opacity = goal;
            for (const material of this.fadeable(item)) {
                material.transparent = item.opacity < 1;
                material.opacity = item.opacity;
            }
        }
    }

    public destroy(): void {
        this.destroyed = true;
        this.seaFree?.();
        this.group.removeFromParent();
        this.ownGeometries.forEach((geometry) => geometry.dispose());
        this.ownMaterials.forEach((material) => material.dispose());
        this.textures.forEach((texture) => texture.dispose());
        for (const item of this.items) item.materials?.forEach((material) => material.dispose());
    }
}
