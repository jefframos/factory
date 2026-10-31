// VoxelTerrain.ts
//
// The rock around the hub: a grid of chunky blocks (1 x blockHeight x 1 units) that fills everything
// outside the hub's floor, closed off by an undiggable bedrock wall — round, its line wobbling with noise (big bends
// and small bumps, ui/dig.json terrain.edge) so the mine never ends in a perfect circle (or the grid's square). Each material is
// drawn with its own KayKit Block Bits model (dirt, stone, stone-with-copper/silver/gold...), crystals
// get gems poking out of their top (ui/dig.json `block` / `decor`). The mine is laid out in zones —
// rings around the hub with wobbly edges (ui/dig.json `zones`), each with its own base rock (whose
// minPower gates the zone behind a tool tier), patches and ore veins from seeded noise — and exactly one
// block per gallery find hides it (`finds`), at a seeded spot inside its zone; it shows poking out of its
// block once that's on a tunnel edge, and is gone for good once dug. Cash chests hide the same way (`chests`: a few
// per zone, ui/dig.json chests.cash; a power chest is put in a cell while playing: placeChest()), and ore
// inside seeded rich-vein patches (`rich`, ui/dig.json richOre) grows bigger, more numerous nuggets and gems.
//
// Drawing: every 16x16 chunk is ONE merged mesh (all blocks share the Block Bits texture), plus one for
// its decor. Blocks on a tunnel edge are drawn whole; buried blocks only add their top face — all the
// camera ever sees of them — which keeps the big mine cheap. Removing a block rebuilds its chunk (and
// the neighbour chunk when it sits on a border). Chunks outside the view are culled.
//
// Collision goes through pizza's walkability hook (TileWalkability), which PlayerMovementController
// already checks per axis, so the miner slides along rock faces. The footprint grows while the miner rides the
// tractor (setBody()); mounted in a tunnel too narrow for it, the walking footprint still lets them drive out.

import * as THREE from 'three';
import { DIG, ChestKind, FindDef, MaterialDef, MineTheme, ZoneDef, materialOf, materialValue } from '../data/DigConfig';
import { hubRects } from '../data/HubData';
import { setWalkabilityQuery, clearWalkabilityQuery } from './TileWalkability';
import { BlockModels, DecorModel, MeshData } from './BlockModels';

export const AIR = 0;
/** Grid value of the undiggable outer ring (not a DIG.materials entry). */
export const BEDROCK = 255;
const CHUNK = 16;
/** The miner's footprint radius for collision against blocks. */
const BODY_RADIUS = 0.32;
/** Extra culling radius around a chunk: the world bend pulls far chunks down, so their real bounds drift. */
const CULL_MARGIN = 8;
/** Pickups (nuggets, gems) are about this big. */
const PICKUP_SIZE = 0.42;
const DECOR_SIZE = 0.55;
/** Finds stick this share of their height out of the block top. */
const FIND_SHOWING = 0.65;
/** Fewest blocks between two buried finds (rerolled up to 32 times to keep it). */
const FIND_SPACING = 8;
/** Fewest blocks between two buried chests (or a chest and a find). */
const CHEST_SPACING = 5;
/** Grid values of `chests`. */
export const CHEST_KINDS: ChestKind[] = ['power', 'cash'];

/** Seeded 2D value noise in [0, 1). */
function valueNoise(seed: number): (x: number, z: number) => number {
    const hash = (x: number, z: number) => {
        let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2147483647);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const smooth = (t: number) => t * t * (3 - 2 * t);
    return (x, z) => {
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const fx = smooth(x - x0);
        const fz = smooth(z - z0);
        const a = hash(x0, z0) + (hash(x0 + 1, z0) - hash(x0, z0)) * fx;
        const b = hash(x0, z0 + 1) + (hash(x0 + 1, z0 + 1) - hash(x0, z0 + 1)) * fx;
        return a + (b - a) * fz;
    };
}

/** Growable typed arrays for one merged mesh. */
class MeshBuilder {
    private positions: number[] = [];
    private normals: number[] = [];
    private uvs: number[] = [];
    private colors: number[] = [];
    private indices: number[] = [];

    /** Appends `data` moved by (x, y, z), optionally turned around Y and tilted, shaded by `shade` (and coloured by `tint`). */
    public add(data: MeshData, x: number, y: number, z: number, shade: number, transform?: THREE.Matrix4, tint?: THREE.Color): void {
        const base = this.positions.length / 3;
        const p = new THREE.Vector3();
        const n = new THREE.Vector3();
        const normalMatrix = transform ? new THREE.Matrix3().getNormalMatrix(transform) : undefined;
        for (let i = 0; i < data.positions.length; i += 3) {
            p.set(data.positions[i], data.positions[i + 1], data.positions[i + 2]);
            n.set(data.normals[i], data.normals[i + 1], data.normals[i + 2]);
            if (transform) {
                p.applyMatrix4(transform);
                n.applyMatrix3(normalMatrix!).normalize();
            }
            this.positions.push(p.x + x, p.y + y, p.z + z);
            this.normals.push(n.x, n.y, n.z);
            if (tint) this.colors.push(shade * tint.r, shade * tint.g, shade * tint.b);
            else this.colors.push(shade, shade, shade);
        }
        for (let i = 0; i < data.uvs.length; i++) {
            this.uvs.push(data.uvs[i]);
        }
        for (let i = 0; i < data.indices.length; i++) {
            this.indices.push(data.indices[i] + base);
        }
    }

    public get empty(): boolean {
        return this.indices.length === 0;
    }

    public build(): THREE.BufferGeometry {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
        geometry.setIndex(this.indices);
        return geometry;
    }
}

interface ChunkMeshes {
    blocks?: THREE.Mesh;
    /** One per decor model (they come from different texture sets). */
    decor: THREE.Mesh[];
}

/** A zone with its material ids resolved to grid values. */
interface ZoneCells {
    def: ZoneDef;
    fill: number;
    patches: { value: number; chance: number }[];
    ores: { value: number; chance: number }[];
}

export class VoxelTerrain {
    public readonly radius: number;
    public readonly blockHeight: number;
    /** Cells per side; cell (ix, iz) covers world [ix - radius, +1) x [iz - radius, +1). */
    public readonly size: number;
    /** 0 = air, 1.. = DIG.materials index + 1, BEDROCK = the outer ring. */
    public readonly cells: Uint8Array;
    /** Cells dug away by the player (for saving), as opposed to air that was always there (the hub). */
    public readonly dug: Uint8Array;
    /** Zone index of every cell. */
    public readonly zones: Uint8Array;
    /** 0 = nothing, 1.. = DIG.finds index + 1 (only meaningful while the cell is solid). */
    public readonly finds: Uint8Array;
    /** 0 = nothing, 1.. = CHEST_KINDS index + 1 (only meaningful while the cell is solid). */
    public readonly chests: Uint8Array;
    /** 1 = an ore block in a rich vein (bigger decor, more drops). */
    public readonly rich: Uint8Array;
    /** Bumped on every dug block (the debug map redraws when it changes). */
    public changed = 0;
    private readonly zoneNoise: (x: number, z: number) => number;
    /** Resolves once the block models have loaded and the mine is drawn. */
    public readonly ready: Promise<void>;
    private readonly jitter: Float32Array;
    private readonly chunks = new Map<number, ChunkMeshes>();
    private readonly dirty = new Set<number>();
    private readonly group = new THREE.Group();
    private readonly models = new BlockModels();
    private loaded = false;
    private readonly walkability = (x: number, z: number) => this.isWalkable(x, z);
    /** The miner's footprint radius against the rock right now, and where they are (setBody()). */
    private bodyRadius = BODY_RADIUS;
    private readonly bodyAt = new THREE.Vector3();
    /** Per grid value: the material's `tint` over its block model (obsidian = the dark stone), or the mine theme's. */
    private readonly tints: (THREE.Color | undefined)[];
    /** The bedrock's tint (terrain.bedrockTint): the mine's end, blackish. */
    private readonly bedrockTint = DIG.terrain.bedrockTint ? new THREE.Color(DIG.terrain.bedrockTint) : undefined;
    /** Per grid value: the material's `decorTint` over its decor (the amethyst's purple gems). */
    private readonly decorTints: (THREE.Color | undefined)[] = [undefined, ...DIG.materials.map((m) => (m.decorTint ? new THREE.Color(m.decorTint) : undefined))];

    /** `seed`: the layout (each new mine has its own: DigProgress.mineSeed). */
    public constructor(threeScene: THREE.Scene, dugSave?: string, private readonly seed = DIG.terrain.seed, theme?: MineTheme) {
        this.zoneNoise = valueNoise(seed + 31);
        this.tints = [undefined, ...DIG.materials.map((m) => {
            const tint = theme?.tints?.[m.id] ?? m.tint;
            return tint ? new THREE.Color(tint) : undefined;
        })];
        this.radius = DIG.terrain.radius;
        this.blockHeight = DIG.terrain.blockHeight;
        this.size = this.radius * 2;
        this.cells = new Uint8Array(this.size * this.size);
        this.dug = new Uint8Array(this.size * this.size);
        this.jitter = new Float32Array(this.size * this.size);
        this.zones = new Uint8Array(this.size * this.size);
        this.finds = new Uint8Array(this.size * this.size);
        this.chests = new Uint8Array(this.size * this.size);
        this.rich = new Uint8Array(this.size * this.size);
        this.generate();
        if (dugSave) {
            this.loadDug(dugSave);
        }
        threeScene.add(this.group);
        setWalkabilityQuery(this.walkability);
        this.ready = this.loadModels().then(() => {
            this.loaded = true;
            const perSide = Math.ceil(this.size / CHUNK);
            for (let chunk = 0; chunk < perSide * perSide; chunk++) {
                this.rebuildChunk(chunk);
            }
        });
    }

    private async loadModels(): Promise<void> {
        await Promise.all([
            this.models.loadBlock(DIG.terrain.bedrockBlock, this.blockHeight),
            ...DIG.materials.map((m) => this.models.loadBlock(m.block, this.blockHeight)),
            ...DIG.materials.filter((m) => m.decor).map((m) => this.models.loadDecor(m.decor!, DECOR_SIZE)),
            ...DIG.materials.map((m) => this.models.loadPickup(m.pickup, PICKUP_SIZE)),
            ...DIG.finds.map((find) => this.models.loadDecor(find.model, find.size)),
            ...DIG.finds.map((find) => this.models.loadPickup(find.model, find.size)),
            ...CHEST_KINDS.map((kind) => this.models.loadDecor(DIG.chests[kind].model, DIG.chests[kind].size)),
            ...CHEST_KINDS.map((kind) => this.models.loadPickup(DIG.chests[kind].model, DIG.chests[kind].size)),
        ]);
    }

    /** A fresh copy of a material's pickup model, in its decorTint if it has one (undefined until the models have loaded). */
    public pickupModel(material: MaterialDef): THREE.Object3D | undefined {
        const model = this.models.pickups.get(material.pickup)?.clone(true);
        if (model && material.decorTint) {
            const tint = new THREE.Color(material.decorTint);
            model.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                const own = (child.material as THREE.MeshStandardMaterial).clone();
                own.color.multiply(tint);
                child.material = own;
            });
        }
        return model;
    }

    /** A fresh copy of a find's model (undefined until the models have loaded). */
    public findModel(find: FindDef): THREE.Object3D | undefined {
        return this.models.pickups.get(find.model)?.clone(true);
    }

    /** A fresh copy of a chest's model, in its tint (undefined until the models have loaded). */
    public chestModel(kind: ChestKind): THREE.Object3D | undefined {
        const def = DIG.chests[kind];
        const model = this.models.pickups.get(def.model)?.clone(true);
        if (model && def.tint) {
            const tint = new THREE.Color(def.tint);
            model.traverse((child) => {
                if (!(child instanceof THREE.Mesh)) return;
                const own = (child.material as THREE.MeshStandardMaterial).clone();
                own.color.multiply(tint);
                child.material = own;
            });
        }
        return model;
    }

    // ---------------------------------------------------------------- generation

    private generate(): void {
        const seed = this.seed;
        const patchNoise = DIG.materials.map((_, i) => valueNoise(seed + 53 * (i + 1)));
        const oreNoise = DIG.materials.map((_, i) => valueNoise(seed + 101 * (i + 1)));
        const jitterNoise = valueNoise(seed + 7);
        const richNoise = valueNoise(seed + 613);
        const richOre = DIG.richOre;
        // The edge: big slow bends plus finer bumps, both seeded, so each mine ends in its own shape.
        const edge = DIG.terrain.edge;
        const bendNoise = valueNoise(seed + 211);
        const bumpNoise = valueNoise(seed + 389);
        const beyondEdge = (x: number, z: number) => Math.hypot(x, z)
            + (bendNoise(x * 0.06, z * 0.06) - 0.5) * 2 * edge.wobble
            + (bumpNoise(x * 0.3, z * 0.3) - 0.5) * 2 * edge.roughness > edge.radius;

        const zones: ZoneCells[] = DIG.zones.map((def) => ({
            def,
            fill: materialValue(def.fill),
            patches: def.patches.map((p) => ({ value: materialValue(p.id), chance: p.chance })),
            ores: def.ores.map((o) => ({ value: materialValue(o.id), chance: o.chance })),
        }));
        const rects = hubRects();
        const inHub = (x: number, z: number) => rects.some((r) => Math.abs(x - r.x) < r.width / 2 + 0.5 && Math.abs(z - r.z) < r.depth / 2 + 0.5);
        for (let iz = 0; iz < this.size; iz++) {
            for (let ix = 0; ix < this.size; ix++) {
                const index = ix + iz * this.size;
                const x = ix - this.radius + 0.5;
                const z = iz - this.radius + 0.5;
                this.jitter[index] = (jitterNoise(ix * 0.9, iz * 0.9) - 0.5) * 0.16;
                const zoneIndex = this.zoneIndexAt(x, z);
                this.zones[index] = zoneIndex;
                if (ix === 0 || iz === 0 || ix === this.size - 1 || iz === this.size - 1 || beyondEdge(x, z)) {
                    this.cells[index] = BEDROCK;
                    continue;
                }
                if (inHub(x, z)) {
                    this.cells[index] = AIR;
                    continue;
                }
                const zone = zones[zoneIndex];
                let material = zone.fill;
                for (const patch of zone.patches) {
                    if (patchNoise[patch.value - 1](x * 0.16, z * 0.16) > 1 - patch.chance) material = patch.value;
                }
                for (const ore of zone.ores) {
                    if (oreNoise[ore.value - 1](x * 0.42, z * 0.42) > 1 - ore.chance * 2.2) material = ore.value;
                }
                this.cells[index] = material;
                if (materialOf(material)?.ore && richNoise(x * richOre.scale, z * richOre.scale) >= richOre.threshold) this.rich[index] = 1;
            }
        }
        this.buryFinds(seed);
        this.buryChests(seed);
    }

    /**
     * chests.cash.perZone cash chests per zone, each in a seeded block of its zone with rock all round (like the
     * finds), kept CHEST_SPACING from every find and chest. (Power chests aren't buried: PowerChestSpawner.)
     */
    private buryChests(seed: number): void {
        const roll = valueNoise(seed + 1409);
        const solid = (index: number) => this.cells[index] !== AIR && this.cells[index] !== BEDROCK;
        const placed: number[] = [];
        this.finds.forEach((find, index) => {
            if (find) placed.push(index);
        });
        const cash = CHEST_KINDS.indexOf('cash') + 1;
        let dice = 0;
        DIG.zones.forEach((_, zone) => {
            const spots: number[] = [];
            for (let iz = 1; iz < this.size - 1; iz++) {
                for (let ix = 1; ix < this.size - 1; ix++) {
                    const index = ix + iz * this.size;
                    if (this.zones[index] !== zone || !solid(index) || this.finds[index]) continue;
                    const inside = [index - 1, index + 1, index - this.size, index + this.size].every((n) => solid(n) && this.zones[n] === zone);
                    if (inside) spots.push(index);
                }
            }
            const pick = () => spots[Math.floor(roll(dice++, 0) * spots.length)];
            for (let n = 0; spots.length && n < (DIG.chests.cash.perZone[zone] ?? 0); n++) {
                let spot = pick();
                for (let attempt = 1; attempt < 32 && (this.chests[spot] || placed.some((p) => this.cellDistance(p, spot) < CHEST_SPACING)); attempt++) spot = pick();
                if (this.chests[spot]) continue;
                this.chests[spot] = cash;
                placed.push(spot);
            }
        });
    }

    /**
     * One block per gallery find: a seeded pick among its zone's diggable blocks whose four neighbours are
     * rock of the same zone too, so no find starts exposed on the hub floor or straddles a zone border.
     * Rerolls (a few times) a spot closer than FIND_SPACING to a find already placed, so they spread out.
     */
    private buryFinds(seed: number): void {
        // Value noise at whole coordinates is a plain per-cell hash: one dice roll per find.
        const roll = valueNoise(seed + 977);
        const solid = (index: number) => this.cells[index] !== AIR && this.cells[index] !== BEDROCK;
        const placed: number[] = [];
        DIG.finds.forEach((find, findIndex) => {
            const spots: number[] = [];
            for (let iz = 1; iz < this.size - 1; iz++) {
                for (let ix = 1; ix < this.size - 1; ix++) {
                    const index = ix + iz * this.size;
                    if (this.zones[index] !== find.zone || !solid(index) || this.finds[index]) continue;
                    const inside = [index - 1, index + 1, index - this.size, index + this.size]
                        .every((n) => solid(n) && this.zones[n] === find.zone);
                    if (inside) spots.push(index);
                }
            }
            if (!spots.length) return;
            let spot = spots[Math.floor(roll(findIndex, 0) * spots.length)];
            for (let attempt = 1; attempt < 32 && placed.some((p) => this.cellDistance(p, spot) < FIND_SPACING); attempt++) {
                spot = spots[Math.floor(roll(findIndex, attempt) * spots.length)];
            }
            this.finds[spot] = findIndex + 1;
            placed.push(spot);
        });
    }

    private cellDistance(a: number, b: number): number {
        return Math.hypot((a % this.size) - (b % this.size), Math.floor(a / this.size) - Math.floor(b / this.size));
    }

    /** Zone index at a world point: by distance from the hub, the edges wobbling with noise. */
    public zoneIndexAt(x: number, z: number): number {
        const wobble = (this.zoneNoise(x * 0.08, z * 0.08) - 0.5) * 2 * DIG.terrain.zoneWobble;
        const distance = Math.hypot(x, z) + wobble;
        let zone = 0;
        DIG.zones.forEach((def, i) => {
            if (distance >= def.from) zone = i;
        });
        return zone;
    }

    // ---------------------------------------------------------------- queries

    public index(ix: number, iz: number): number {
        return ix + iz * this.size;
    }

    public cellOf(x: number, z: number): [number, number] {
        return [Math.floor(x + this.radius), Math.floor(z + this.radius)];
    }

    /** World centre of a cell (on the floor). */
    public cellCenter(ix: number, iz: number, out = new THREE.Vector3()): THREE.Vector3 {
        return out.set(ix - this.radius + 0.5, 0, iz - this.radius + 0.5);
    }

    public cellValue(ix: number, iz: number): number {
        if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) return BEDROCK;
        return this.cells[this.index(ix, iz)];
    }

    public isSolid(x: number, z: number): boolean {
        const [ix, iz] = this.cellOf(x, z);
        return this.cellValue(ix, iz) !== AIR;
    }

    public material(ix: number, iz: number): MaterialDef | undefined {
        return materialOf(this.cellValue(ix, iz));
    }

    /** Takes a find's buried copy out of the rock (it was handed out somewhere else: the forced first find). */
    public unbury(find: FindDef): void {
        const value = DIG.finds.indexOf(find) + 1;
        const index = this.finds.indexOf(value);
        if (index < 0) return;
        this.finds[index] = 0;
        this.dirty.add(Math.floor((index % this.size) / CHUNK) + Math.floor(Math.floor(index / this.size) / CHUNK) * Math.ceil(this.size / CHUNK));
        this.changed++;
    }

    /** The find hidden in a solid cell, if any. */
    public findAt(ix: number, iz: number): FindDef | undefined {
        if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size || this.cellValue(ix, iz) === AIR) return undefined;
        const find = this.finds[this.index(ix, iz)];
        return find ? DIG.finds[find - 1] : undefined;
    }

    /** The chest hidden in a solid cell, if any. */
    public chestAt(ix: number, iz: number): ChestKind | undefined {
        if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size || this.cellValue(ix, iz) === AIR) return undefined;
        const chest = this.chests[this.index(ix, iz)];
        return chest ? CHEST_KINDS[chest - 1] : undefined;
    }

    /** Hides a chest in a solid cell (a power chest fading in: PowerChestSpawner draws it); false if it can't go there. */
    public placeChest(ix: number, iz: number, kind: ChestKind): boolean {
        const value = this.cellValue(ix, iz);
        if (value === AIR || value === BEDROCK || this.findAt(ix, iz) || this.chestAt(ix, iz)) return false;
        this.chests[this.index(ix, iz)] = CHEST_KINDS.indexOf(kind) + 1;
        this.changed++;
        return true;
    }

    /** Takes a chest back out of its cell (one left undug fading away). */
    public clearChest(ix: number, iz: number): void {
        if (!this.chestAt(ix, iz)) return;
        this.chests[this.index(ix, iz)] = 0;
        this.changed++;
    }

    /** Whether a cell is ore in a rich vein (it drops more). */
    public isRich(ix: number, iz: number): boolean {
        return ix >= 0 && iz >= 0 && ix < this.size && iz < this.size && this.rich[this.index(ix, iz)] === 1;
    }

    /** Where the miner is and how wide they are against the rock (wider on the tractor); call before movement each step. */
    public setBody(x: number, z: number, radius = BODY_RADIUS): void {
        this.bodyAt.set(x, 0, z);
        this.bodyRadius = radius;
    }

    private fits(x: number, z: number, r: number): boolean {
        return !this.isSolid(x - r, z - r) && !this.isSolid(x + r, z - r) && !this.isSolid(x - r, z + r) && !this.isSolid(x + r, z + r);
    }

    private isWalkable(x: number, z: number): boolean {
        if (this.fits(x, z, this.bodyRadius)) return true;
        // Wider than walking (the tractor) and already squeezed where it stands (mounted in a narrow tunnel): the
        // walking footprint, so it can drive (and dig) its way out instead of being stuck.
        return this.bodyRadius > BODY_RADIUS && !this.fits(this.bodyAt.x, this.bodyAt.z, this.bodyRadius) && this.fits(x, z, BODY_RADIUS);
    }

    // ---------------------------------------------------------------- editing

    /** Removes a diggable block; returns its material, or undefined if there was nothing to dig. */
    public remove(ix: number, iz: number): MaterialDef | undefined {
        const value = this.cellValue(ix, iz);
        const material = materialOf(value);
        if (value === AIR || value === BEDROCK || !material) return undefined;
        const index = this.index(ix, iz);
        this.cells[index] = AIR;
        this.dug[index] = 1;
        this.finds[index] = 0;
        this.chests[index] = 0;
        this.changed++;
        // Its neighbours become tunnel edges, and they may sit in the next chunk over.
        for (const [nx, nz] of [[ix, iz], [ix + 1, iz], [ix - 1, iz], [ix, iz + 1], [ix, iz - 1]]) {
            if (nx >= 0 && nz >= 0 && nx < this.size && nz < this.size) {
                this.dirty.add(Math.floor(nx / CHUNK) + Math.floor(nz / CHUNK) * Math.ceil(this.size / CHUNK));
            }
        }
        return material;
    }

    /** Rebuilds the chunks changed since the last call; call once per frame. */
    public update(): void {
        if (!this.loaded) return;
        for (const chunk of this.dirty) {
            this.rebuildChunk(chunk);
        }
        this.dirty.clear();
    }

    // ---------------------------------------------------------------- drawing

    /** A buried block has rock (or the map edge) on all four sides. */
    private isBuried(ix: number, iz: number): boolean {
        return this.cellValue(ix + 1, iz) !== AIR && this.cellValue(ix - 1, iz) !== AIR
            && this.cellValue(ix, iz + 1) !== AIR && this.cellValue(ix, iz - 1) !== AIR;
    }

    private rebuildChunk(chunkIndex: number): void {
        const perSide = Math.ceil(this.size / CHUNK);
        const cx = chunkIndex % perSide;
        const cz = Math.floor(chunkIndex / perSide);
        const blocks = new MeshBuilder();
        const decor = new Map<DecorModel, MeshBuilder>();
        const addDecor = (model: DecorModel, x: number, y: number, z: number, transform: THREE.Matrix4, tint?: THREE.Color) => {
            let builder = decor.get(model);
            if (!builder) {
                builder = new MeshBuilder();
                decor.set(model, builder);
            }
            builder.add(model.data, x, y, z, 1.15, transform, tint);
        };
        const tilt = new THREE.Matrix4();
        const grow = new THREE.Matrix4();
        const richOre = DIG.richOre;
        for (let iz = cz * CHUNK; iz < Math.min(this.size, (cz + 1) * CHUNK); iz++) {
            for (let ix = cx * CHUNK; ix < Math.min(this.size, (cx + 1) * CHUNK); ix++) {
                const index = this.index(ix, iz);
                const value = this.cells[index];
                if (value === AIR) continue;
                const material = materialOf(value);
                const model = this.models.blocks.get(value === BEDROCK ? DIG.terrain.bedrockBlock : material!.block);
                if (!model) continue;
                const x = ix - this.radius + 0.5;
                const z = iz - this.radius + 0.5;
                const buried = this.isBuried(ix, iz);
                blocks.add(buried ? model.top : model.full, x, 0, z, 1 + this.jitter[index], undefined, value === BEDROCK ? this.bedrockTint : this.tints[value]);
                // A find shows once its block is on a tunnel edge: half sunk into the top, at a slant.
                const find = this.finds[index] ? DIG.finds[this.finds[index] - 1] : undefined;
                const findModel = find && !buried ? this.models.decors.get(find.model) : undefined;
                if (find && findModel) {
                    tilt.makeRotationFromEuler(new THREE.Euler(0.25, (index % 8) * 0.8, -0.2));
                    addDecor(findModel, x, this.blockHeight - find.size * (1 - FIND_SHOWING), z, tilt);
                    continue;
                }
                // A cash chest likewise, in its tint (a power chest is drawn by PowerChestSpawner, fading in and out).
                const chest = this.chests[index] && CHEST_KINDS[this.chests[index] - 1] === 'cash' ? DIG.chests.cash : undefined;
                const chestModel = chest && !buried ? this.models.decors.get(chest.model) : undefined;
                if (chest && chestModel) {
                    tilt.makeRotationFromEuler(new THREE.Euler(0.2, (index % 8) * 0.8, -0.15));
                    addDecor(chestModel, x, this.blockHeight - chest.size * (1 - FIND_SHOWING), z, tilt, chest.tint ? new THREE.Color(chest.tint) : undefined);
                    continue;
                }
                const decorData = material?.decor ? this.models.decors.get(material.decor) : undefined;
                if (decorData) {
                    // Two or three gems poking out of the top at seeded spots and tilts, sized by the material (the
                    // better the ore, the bigger); a rich vein's are bigger still, and more.
                    const rich = this.rich[index] === 1;
                    const count = rich ? richOre.decorCount : 2 + (index % 2);
                    const size = (material!.decorScale ?? 1) * (rich ? richOre.decorScale : 1);
                    for (let k = 0; k < count; k++) {
                        const seed = (index * 7 + k * 13) % 97;
                        const ox = ((seed % 10) / 10 - 0.45) * 0.55;
                        const oz = (((seed * 3) % 10) / 10 - 0.45) * 0.55;
                        tilt.makeRotationFromEuler(new THREE.Euler(((seed % 5) - 2) * 0.18, seed * 0.7, ((seed % 7) - 3) * 0.15));
                        if (size !== 1) tilt.multiply(grow.makeScale(size, size, size));
                        addDecor(decorData, x + ox, this.blockHeight - 0.12 * size, z + oz, tilt, this.decorTints[value]);
                    }
                }
            }
        }
        const existing = this.chunks.get(chunkIndex);
        const center = new THREE.Vector3((cx + 0.5) * CHUNK - this.radius, this.blockHeight / 2, (cz + 0.5) * CHUNK - this.radius);
        const sphere = new THREE.Sphere(center, CHUNK * Math.SQRT1_2 + CULL_MARGIN);
        const swap = (previous: THREE.Mesh | undefined, builder: MeshBuilder, material: THREE.Material | undefined): THREE.Mesh | undefined => {
            if (previous) {
                previous.geometry.dispose();
                this.group.remove(previous);
            }
            if (builder.empty || !material) return undefined;
            const geometry = builder.build();
            geometry.boundingSphere = sphere;
            const mesh = new THREE.Mesh(geometry, material);
            this.group.add(mesh);
            return mesh;
        };
        for (const mesh of existing?.decor ?? []) {
            swap(mesh, new MeshBuilder(), undefined);
        }
        this.chunks.set(chunkIndex, {
            blocks: swap(existing?.blocks, blocks, this.models.blockMaterial),
            decor: [...decor].map(([model, builder]) => swap(undefined, builder, model.material)).filter((mesh): mesh is THREE.Mesh => !!mesh),
        });
    }

    // ---------------------------------------------------------------- save

    /** Dug cells as a compact string: the grid size, then run-lengths of the dug flags. */
    public saveDug(): string {
        const runs: number[] = [];
        let current = 0;
        let run = 0;
        for (const flag of this.dug) {
            if (flag === current) {
                run++;
            } else {
                runs.push(run);
                current = flag;
                run = 1;
            }
        }
        runs.push(run);
        return `${this.size}:${runs.join('.')}`;
    }

    private loadDug(save: string): void {
        // Tunnels saved for a different map size would land in the wrong places: start fresh instead.
        const [size, runs] = save.split(':');
        if (Number(size) !== this.size || runs === undefined) {
            return;
        }
        let index = 0;
        let flag = 0;
        for (const part of runs.split('.')) {
            const run = Number(part) || 0;
            if (flag) {
                for (let i = index; i < Math.min(this.dug.length, index + run); i++) {
                    if (this.cells[i] !== BEDROCK) {
                        this.cells[i] = AIR;
                        this.dug[i] = 1;
                    }
                }
            }
            index += run;
            flag = 1 - flag;
        }
    }

    public destroy(): void {
        clearWalkabilityQuery(this.walkability);
        for (const meshes of this.chunks.values()) {
            meshes.blocks?.geometry.dispose();
            meshes.decor.forEach((mesh) => mesh.geometry.dispose());
        }
        this.group.removeFromParent();
    }
}
