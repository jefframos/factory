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
import { subdivideObject } from './Subdivide';
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
}

const GROUND_Y = -0.05;
const PAVEMENT_Y = 0.02;
const PAVEMENT_STEP = 0.012;
const PAVEMENT_STACK = 0.06;
/** Only things this tall can hide the saucer. */
const FADE_MIN_HEIGHT = 3;
const FADE_OPACITY = 0.25;
const FADE_SPEED = 8;
/** Kept this far inside the shore: the saucer's middle stays over the island. */
const SHORE_MARGIN = 1;
const GROUND_TILE = 4;
/** The ground's cells (world units): small, as it's cut by the shore in steps of this. */
const GROUND_CELL = 0.5;
const PAVING_TILE = 2;
const ROAD_TILE = 1.6;

const seeded = (seed: number) => {
    let s = seed;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
};

/** A near-white repeating texture (its material's colour tints it): `drawn`, then fine grain. */
function tiled(seed: number, grain: number, drawn?: (g: CanvasRenderingContext2D, size: number, random: () => number) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d')!;
    const random = seeded(seed);
    g.fillStyle = '#efefef';
    g.fillRect(0, 0, 256, 256);
    drawn?.(g, 256, random);
    for (let i = 0; i < grain; i++) {
        g.fillStyle = random() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
        const r = 0.6 + random() * 1.6;
        g.fillRect(random() * 256, random() * 256, r, r);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
}

const pavingSlabs = (g: CanvasRenderingContext2D, size: number, random: () => number) => {
    const s = size / 4;
    g.fillStyle = '#dbdbdb';
    g.fillRect(0, 0, size, size);
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            const level = Math.round(240 + random() * 15);
            g.fillStyle = `rgb(${level},${level},${level})`;
            g.fillRect(c * s + 1.5, r * s + 1.5, s - 3, s - 3);
        }
    }
};

export class UfoTown {
    private readonly group = new THREE.Group();
    private readonly shore: Point[];
    /** Where the saucer's middle may go. */
    private readonly flightArea: Point[];
    private readonly textures: THREE.Texture[] = [];
    private readonly ownMaterials: THREE.Material[] = [];
    private readonly ownGeometries: THREE.BufferGeometry[] = [];
    private readonly ray = new THREE.Ray();
    private readonly hit = new THREE.Vector3();
    private destroyed = false;
    /** Everything still there to eat (shrinks as it's eaten; grows as models load). */
    public readonly items: Item[] = [];
    /** Every prop's blocker from the start (a model still loading already blocks), until it's eaten. */
    public readonly blockers: Blocker[] = [];
    public readonly ready: Promise<void>;
    /** Everything in the town that can go off screen; the scene updates it each frame. */
    public readonly culler = new BendCuller();

    public constructor(threeScene: THREE.Scene, private readonly level: Level) {
        this.shore = shoreOutline(level);
        this.flightArea = insetPolygon(this.shore, SHORE_MARGIN);
        this.buildGround();
        this.buildIsland();
        for (const cube of level.colliders ?? []) {
            if (cube.solid) this.blockers.push({ x: cube.x, z: cube.z, halfX: cube.width / 2, halfZ: cube.depth / 2, height: cube.height ?? SOLID_CUBE_HEIGHT });
        }
        const loads = level.props.map((prop) => this.placeProp(prop));
        threeScene.add(this.group);
        this.ready = Promise.all(loads).then(() => undefined);
    }

    public isOverIsland(x: number, z: number): boolean {
        return containsPoint(this.flightArea, x, z);
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
        const cols = Math.ceil((Math.max(...xs) - minX) / GROUND_CELL);
        const rows = Math.ceil((Math.max(...zs) - minZ) / GROUND_CELL);
        const count = (cols + 1) * (rows + 1);
        const positions = new Float32Array(count * 3);
        const normals = new Float32Array(count * 3);
        const uvs = new Float32Array(count * 2);
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) {
                const i = r * (cols + 1) + c;
                const x = minX + c * GROUND_CELL;
                const z = minZ + r * GROUND_CELL;
                positions.set([x, GROUND_Y, z], i * 3);
                normals[i * 3 + 1] = 1;
                uvs.set([x / GROUND_TILE, z / GROUND_TILE], i * 2);
            }
        }
        const index: number[] = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!containsPoint(area, minX + (c + 0.5) * GROUND_CELL, minZ + (r + 0.5) * GROUND_CELL)) continue;
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
        const cobbles = this.texture(tiled(31, 1200));
        const deck = this.level.island?.deck;
        this.groundCells(deck ? insetPolygon(this.shore, deck.width / 2) : this.shore, this.material(ground.color, cobbles));
        const paving = this.texture(tiled(11, 700, pavingSlabs));
        const asphalt = this.texture(tiled(23, 2500));
        const lawn = this.texture(tiled(41, 3000));
        const step = Math.min(PAVEMENT_STEP, PAVEMENT_STACK / Math.max(1, pavements.length));
        pavements.forEach((pavement, i) => this.slab(pavement, PAVEMENT_Y + i * step, paving, asphalt, lawn));
    }

    private slab(pavement: Pavement, y: number, paving: THREE.Texture, asphalt: THREE.Texture, lawn: THREE.Texture): void {
        const road = pavement.id.startsWith('road');
        const isLawn = pavement.id.startsWith('lawn');
        const map = road ? asphalt : isLawn ? lawn : paving;
        const tile = road ? ROAD_TILE : PAVING_TILE;
        const geometry = this.geometry(new THREE.PlaneGeometry(pavement.width, pavement.depth, bendSegments(pavement.width), bendSegments(pavement.depth)));
        const uv = geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * pavement.width) / tile, (uv.getY(i) * pavement.depth) / tile);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, this.material(pavement.color, map));
        mesh.position.set(pavement.x, y, pavement.z);
        this.group.add(mesh);
        this.culler.addStatic(mesh);
    }

    /** A box from a to b, `y` its middle, cut along its length so it curves with the bend. */
    private beam(a: Point, b: Point, y: number, height: number, thickness: number, material: THREE.Material): void {
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const mesh = new THREE.Mesh(this.geometry(new THREE.BoxGeometry(length + thickness, height, thickness, bendSegments(length + thickness))), material);
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
        if (deck) {
            // The deck's boards as a ring round the ground (drawn just above it, the ground showing inside it).
            const inner = insetPolygon(shore, deck.width);
            const board = this.material(deck.color);
            shore.forEach((p, i) => {
                const j = (i + 1) % shore.length;
                const a = { x: (p.x + inner[i].x) / 2, z: (p.z + inner[i].z) / 2 };
                const b = { x: (shore[j].x + inner[j].x) / 2, z: (shore[j].z + inner[j].z) / 2 };
                this.beam(a, b, GROUND_Y + 0.02, 0.05, deck.width, board);
            });
        }
        const normals = inwardNormals(shore);
        const side = this.material(island.sideColor);
        shore.forEach((p, i) => {
            const q = shore[(i + 1) % shore.length];
            const n = normals[i];
            const inward = (point: Point) => ({ x: point.x + n.x * 0.1, z: point.z + n.z * 0.1 });
            this.beam(inward(p), inward(q), GROUND_Y - island.sideDepth / 2, island.sideDepth, 0.2, side);
        });

        const xs = shore.map((p) => p.x);
        const zs = shore.map((p) => p.z);
        const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
        // Far enough that the bend takes its edges below the horizon, even from as high as the camera ends up.
        const margin = Math.max(island.margin, 400);
        const sea = createWater(island.water, maxX - minX + margin * 2, maxZ - minZ + margin * 2);
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
            this.beam(p, q, GROUND_Y + fence.height, 0.08, 0.1, rail);
            this.beam(p, q, GROUND_Y + fence.height * 0.45, 0.06, 0.08, rail);
        });
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
        if (flat) subdivideObject(object);
        bendObject(object);
        this.group.add(object);
        this.culler.addStatic(object);
        if (flat) return;
        const bounds = new THREE.Box3().setFromObject(object);
        const footprint = bounds.getSize(new THREE.Vector3());
        this.items.push({
            object, x: prop.x, z: prop.z,
            radius: Math.max(footprint.x, footprint.z) / 2,
            height: prop.height,
            value: UfoTown.valueOf(footprint.x * footprint.y * footprint.z),
            blocker, bounds, opacity: 1,
        });
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
    public take(item: Item): void {
        item.gone = true;
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
        this.group.removeFromParent();
        this.ownGeometries.forEach((geometry) => geometry.dispose());
        this.ownMaterials.forEach((material) => material.dispose());
        this.textures.forEach((texture) => texture.dispose());
        for (const item of this.items) item.materials?.forEach((material) => material.dispose());
    }
}
