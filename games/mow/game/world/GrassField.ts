// GrassField.ts
//
// The vegetation: a grid of CELL-sized cells over every district (ui/mow.json `cell`; the level's sections), each
// holding a grass type and whether it has been cut. Where grass grows: each section's rect (`fill`), with the
// level's grass patches painted over it (a type, `auto`, or `none` to carve it away), never under a collider. Which
// grass (`auto`): one seeded noise over the whole town, read through rings around `grassNoise.centre` — the further
// out, the tougher the mix (like dig's depth zones), so a new section placed further away is harder by itself. Drawn as one small tuft per cell in InstancedMeshes, one per CHUNK x CHUNK cells, so cutting only
// rewrites the touched instances (no geometry rebuilt). The tuft is the library's KayKit grass (TUFT_MODEL, its shape
// only: the colours are the game's), swapped in once loaded; a few crossed blades until then. Uncut tufts stand at
// their type's height and colour; a cut one is gone.
//
// The lawn itself is each district's ground (a plane under its grass), drawn by a cheap shader: a pixel-noise grass
// pattern (speckles and clumps in world space, so it never stretches) over the ground colour, and the cut cells —
// read from a small texture with one texel per cell (cutMap: the type's cut colour, alpha = cut) — as mowed lawn,
// lighter and darker in bands so it shows stripes. The ground brightens when the district is restored.
// Cutting: cutCapsule() takes everything uncut in a capsule (the player's feet out to the tool) the tool's power can handle — at once when power >=
// resistance; one short, it has to be chewed through (SLOW_CUT_SEC of contact: `chewing`, the mower is held back
// meanwhile); further below not at all (`blocked`: a wall until a better mower, with the hint). Cut cells are saved as run-lengths (save() / the constructor's `saved`).
//
// An open district not restored yet slowly grows back (regrow(): REGROW_PER_SEC cut cells, anywhere in it), so
// there's always a little grass to earn from whatever the player bought — slow enough never to stand between the
// player and the district's goal. Restored districts stay mowed.

import * as THREE from 'three';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { MOW, TOWN, DistrictDef, GrassDef, GrassPatch } from '../data/MowConfig';
import { BendService } from '../services/BendService';

const CHUNK = 16;
/** The tuft's shape (KayKit Forest grass). */
const TUFT_MODEL = './mow/models/town/nature/Grass_1_A_Singlesided_Color1.gltf';
/** The ground's grass noise: "pixels" per world unit. */
const GRASS_PIXELS = 12;
/** Width of the mowed stripes, in cells. */
const STRIPE = 4;
/** Cut cells growing back per second in each district still being restored. */
const REGROW_PER_SEC = 0.66;
/** One power short: a cell takes this long to chew through (seconds of contact). */
const SLOW_CUT_SEC = 0.7;

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

/** A tuft: three thin blades crossing at the root, 1 unit tall, about 1 unit across; darker at the root. */
function tuftGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const blades = [
        { angle: 0, lean: 0.12, offset: [0, 0] },
        { angle: Math.PI / 3, lean: -0.1, offset: [0.12, 0.08] },
        { angle: (2 * Math.PI) / 3, lean: 0.08, offset: [-0.1, 0.1] },
    ];
    for (const { angle, lean, offset } of blades) {
        const dx = Math.cos(angle) * 0.22;
        const dz = Math.sin(angle) * 0.22;
        const tipX = offset[0] + Math.cos(angle + Math.PI / 2) * lean;
        const tipZ = offset[1] + Math.sin(angle + Math.PI / 2) * lean;
        positions.push(offset[0] - dx, 0, offset[1] - dz, offset[0] + dx, 0, offset[1] + dz, tipX, 1, tipZ);
        colors.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1, 1, 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}

/**
 * A model's first mesh as a tuft: based at 0, 1 unit tall, 1 unit across its wider side, centred, and darker at the
 * root (vertex colours: the instances tint it).
 */
function asTuft(source: THREE.BufferGeometry): THREE.BufferGeometry {
    const geometry = source.clone();
    for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const across = Math.max(size.x, size.z) || 1;
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    geometry.scale(1 / across, 1 / (size.y || 1), 1 / across);
    const position = geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) colors.fill(0.55 + 0.45 * position.getY(i), i * 3, i * 3 + 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
}

/** Whether (x, z) is inside a patch (turned by its rotationY; `round` = the ellipse in its rect). */
function inPatch(patch: GrassPatch, x: number, z: number): boolean {
    const turn = -(patch.rotationY ?? 0);
    const dx = x - patch.x;
    const dz = z - patch.z;
    const lx = dx * Math.cos(turn) + dz * Math.sin(turn);
    const lz = -dx * Math.sin(turn) + dz * Math.cos(turn);
    const hx = patch.width / 2;
    const hz = patch.depth / 2;
    if (patch.shape === 'round') return (lx / hx) ** 2 + (lz / hz) ** 2 <= 1;
    return Math.abs(lx) <= hx && Math.abs(lz) <= hz;
}

/**
 * The grass type for `auto` cells: the ring around grassNoise.centre the cell is in gives the mix (shares per grass
 * id), the town-wide noise picks within it — the tougher the grass, the higher the noise, so tough grass clumps.
 */
function autoType(x: number, z: number, noise: (x: number, z: number) => number): number {
    const field = TOWN.grassNoise;
    const distance = Math.hypot(x - field.centre.x, z - field.centre.z);
    const ring = field.rings.find((r) => distance <= r.upTo) ?? field.rings[field.rings.length - 1];
    const total = MOW.grass.reduce((sum, g) => sum + (ring.mix[g.id] ?? 0), 0) || 1;
    const n = noise(x * field.scale, z * field.scale);
    let cumulative = 0;
    for (let t = 0; t < MOW.grass.length; t++) {
        cumulative += (ring.mix[MOW.grass[t].id] ?? 0) / total;
        if (n < cumulative) return t;
    }
    return MOW.grass.length - 1;
}

export interface CutResult {
    /** Cells cut this call. */
    cells: number;
    /** Clippings they give. */
    clippings: number;
    /** Grass one power too tough being chewed (not through yet): where and its colour (the chips). */
    chewing?: { at: THREE.Vector3; color: THREE.Color };
    /** The toughest grass met that the tool can't cut at all (for the hint), if any. */
    blocked?: GrassDef;
    /** Where cutting happened (the average of the cut cells), for particles. */
    at?: THREE.Vector3;
    /** The colour of what was cut. */
    color?: THREE.Color;
}

interface Chunk {
    mesh: THREE.InstancedMesh;
}

export class GrassField {
    public readonly cell = MOW.cell;
    private readonly minX: number;
    private readonly minZ: number;
    public readonly width: number;
    public readonly depth: number;
    /** 0 = no grass, else MOW.grass index + 1. */
    private readonly types: Uint8Array;
    private readonly cutFlags: Uint8Array;
    /** District index per cell (-1 = none). */
    private readonly districtOf: Int8Array;
    /** Contact time on underpowered cells (seconds). */
    private readonly damage: Float32Array;
    /** Per cell: its chunk and its instance in it (-1 = no grass). */
    private readonly instanceOf: Int32Array;
    private readonly chunkOf: Int32Array;
    private readonly jitter: Float32Array;
    private readonly chunks: Chunk[] = [];
    /** Resolves once the library tuft is in (or failed: the plain one stays). */
    public readonly ready: Promise<void>;
    private readonly dirty = new Set<number>();
    /** Per district: cells with grass, and how many are cut. */
    public readonly totals: number[];
    public readonly cutCounts: number[];
    /** Per district: its grass cells (regrow() picks from them) and the fraction of a regrowth carried over. */
    private cellsOf: number[][] = [];
    private readonly regrowCarry: number[];
    private readonly grounds: THREE.Mesh[] = [];
    /** One texel per cell: a cut cell's colour (rgb) and whether it's cut (alpha); read by the ground shader. */
    private readonly cutMap: THREE.DataTexture;
    private cutMapDirty = false;
    private readonly group = new THREE.Group();
    private readonly matrix = new THREE.Matrix4();
    private readonly quaternion = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();
    private readonly position = new THREE.Vector3();
    private readonly color = new THREE.Color();
    private readonly uncutColors = MOW.grass.map((g) => new THREE.Color(g.color));
    private readonly cutColors = MOW.grass.map((g) => new THREE.Color(g.cutColor));

    /** `isBlocked`: cells under obstacles (trees, benches, buildings) get no grass. `saved`: cut cells from a save. */
    public constructor(threeScene: THREE.Scene, isBlocked: (x: number, z: number) => boolean, saved?: string) {
        const rects = MOW.districts.map((d) => ({ minX: d.x - d.width / 2, maxX: d.x + d.width / 2, minZ: d.z - d.depth / 2, maxZ: d.z + d.depth / 2 }));
        this.minX = Math.min(...rects.map((r) => r.minX));
        this.minZ = Math.min(...rects.map((r) => r.minZ));
        this.width = Math.ceil((Math.max(...rects.map((r) => r.maxX)) - this.minX) / this.cell);
        this.depth = Math.ceil((Math.max(...rects.map((r) => r.maxZ)) - this.minZ) / this.cell);
        const count = this.width * this.depth;
        this.types = new Uint8Array(count);
        this.cutFlags = new Uint8Array(count);
        this.districtOf = new Int8Array(count).fill(-1);
        this.damage = new Float32Array(count);
        this.instanceOf = new Int32Array(count).fill(-1);
        this.chunkOf = new Int32Array(count).fill(-1);
        this.jitter = new Float32Array(count);
        this.totals = MOW.districts.map(() => 0);
        this.cutCounts = MOW.districts.map(() => 0);
        this.regrowCarry = MOW.districts.map(() => 0);
        this.cutMap = new THREE.DataTexture(new Uint8Array(count * 4), this.width, this.depth, THREE.RGBAFormat);
        this.cutMap.magFilter = THREE.LinearFilter;
        this.cutMap.minFilter = THREE.LinearFilter;
        this.cutMap.colorSpace = THREE.SRGBColorSpace;
        this.generate(isBlocked);
        if (saved) this.load(saved);
        this.buildGrounds();
        this.buildChunks();
        this.ready = this.loadTuft();
        threeScene.add(this.group);
    }

    // ---------------------------------------------------------------- generation

    private generate(isBlocked: (x: number, z: number) => boolean): void {
        const typeNoise = valueNoise(MOW.seed + 17);
        const jitterNoise = valueNoise(MOW.seed + 3);
        MOW.districts.forEach((district, d) => {
            for (let iz = 0; iz < this.depth; iz++) {
                for (let ix = 0; ix < this.width; ix++) {
                    const { x, z } = this.center(ix, iz);
                    if (Math.abs(x - district.x) > district.width / 2 || Math.abs(z - district.z) > district.depth / 2) continue;
                    const i = ix + iz * this.width;
                    if (this.types[i] || isBlocked(x, z)) continue;
                    // The last patch over the cell wins over the section's fill.
                    const patch = TOWN.grassPatches.reduce<GrassPatch | undefined>((found, p) => (inPatch(p, x, z) ? p : found), undefined);
                    const kind = patch ? patch.grass : (district.fill ?? 'auto');
                    if (kind === 'none') continue;
                    const type = kind === 'auto' ? autoType(x, z, typeNoise) : Math.max(0, MOW.grass.findIndex((g) => g.id === kind));
                    this.types[i] = type + 1;
                    this.districtOf[i] = d;
                    this.jitter[i] = jitterNoise(ix * 0.9, iz * 0.9);
                    this.totals[d]++;
                }
            }
        });
    }

    private center(ix: number, iz: number): { x: number; z: number } {
        return { x: this.minX + (ix + 0.5) * this.cell, z: this.minZ + (iz + 0.5) * this.cell };
    }

    /** Each district's ground: a plane under its grass, in its overgrown colour (brightens on restore). */
    private buildGrounds(): void {
        for (const district of MOW.districts) {
            const material = new THREE.MeshStandardMaterial({ color: district.ground, roughness: 1 });
            this.grassShader(material);
            BendService.applyBend(material);
            const geometry = new THREE.PlaneGeometry(district.width, district.depth, Math.ceil(district.width), Math.ceil(district.depth));
            geometry.rotateX(-Math.PI / 2);
            const ground = new THREE.Mesh(geometry, material);
            ground.position.set(district.x, 0.01, district.z);
            this.grounds.push(ground);
            this.group.add(ground);
        }
    }

    /** Swaps every chunk's tuft for the library's grass once it has loaded. */
    private async loadTuft(): Promise<void> {
        try {
            const model = await ModelLoaderManager.instance.loadModel(TUFT_MODEL);
            let source: THREE.BufferGeometry | undefined;
            model.traverse((child) => {
                if (!source && child instanceof THREE.Mesh) source = child.geometry;
            });
            if (!source) return;
            const tuft = asTuft(source);
            for (const chunk of this.chunks) {
                chunk.mesh.geometry = tuft;
                chunk.mesh.computeBoundingSphere();
            }
        } catch (error) {
            console.warn('[GrassField] the grass model did not load; keeping the plain tufts', error);
        }
    }

    /** The ground's look (see the file's header): pixel-noise grass, and the mowed cells from cutMap. */
    private grassShader(material: THREE.MeshStandardMaterial): void {
        const uniforms = {
            uCutMap: { value: this.cutMap },
            uGridMin: { value: new THREE.Vector2(this.minX, this.minZ) },
            uGridSize: { value: new THREE.Vector2(this.width * this.cell, this.depth * this.cell) },
            uGrassPixels: { value: GRASS_PIXELS },
        };
        material.customProgramCacheKey = () => 'mow-grass-ground';
        material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec2 vGrassXZ;')
                .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrassXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', `#include <common>
                    varying vec2 vGrassXZ;
                    uniform sampler2D uCutMap;
                    uniform vec2 uGridMin;
                    uniform vec2 uGridSize;
                    uniform float uGrassPixels;
                    float grassHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
                .replace('#include <color_fragment>', `#include <color_fragment>
                    vec2 grassPixel = floor(vGrassXZ * uGrassPixels);
                    float grain = grassHash(grassPixel);
                    float blade = step(0.88, grassHash(grassPixel + 31.7));
                    float clump = grassHash(floor(vGrassXZ * 1.3));
                    float shade = (0.86 + grain * 0.16 + blade * 0.16) * (0.94 + clump * 0.1);
                    vec4 mowed = texture2D(uCutMap, (vGrassXZ - uGridMin) / uGridSize);
                    diffuseColor.rgb = mix(diffuseColor.rgb, mowed.rgb, mowed.a) * shade;`);
        };
    }

    private buildChunks(): void {
        const geometry = tuftGeometry();
        const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
        BendService.applyBend(material);
        const perX = Math.ceil(this.width / CHUNK);
        const perZ = Math.ceil(this.depth / CHUNK);
        for (let cz = 0; cz < perZ; cz++) {
            for (let cx = 0; cx < perX; cx++) {
                const cells: number[] = [];
                for (let iz = cz * CHUNK; iz < Math.min(this.depth, (cz + 1) * CHUNK); iz++) {
                    for (let ix = cx * CHUNK; ix < Math.min(this.width, (cx + 1) * CHUNK); ix++) {
                        if (this.types[ix + iz * this.width]) cells.push(ix + iz * this.width);
                    }
                }
                if (!cells.length) continue;
                const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
                const chunk = this.chunks.length;
                this.chunks.push({ mesh });
                cells.forEach((i, n) => {
                    this.instanceOf[i] = n;
                    this.chunkOf[i] = chunk;
                    this.writeInstance(i);
                });
                mesh.instanceMatrix.needsUpdate = true;
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                mesh.computeBoundingSphere();
                this.group.add(mesh);
            }
        }
    }

    /** Places one cell's tuft: standing in its colour, or a stub in its cut colour (striped). */
    private writeInstance(i: number): void {
        const chunk = this.chunks[this.chunkOf[i]];
        const n = this.instanceOf[i];
        const type = this.types[i] - 1;
        const grass = MOW.grass[type];
        const ix = i % this.width;
        const iz = Math.floor(i / this.width);
        const { x, z } = this.center(ix, iz);
        const j = this.jitter[i];
        const cut = this.cutFlags[i] === 1;
        this.position.set(x + (j - 0.5) * this.cell * 0.4, 0.02, z + (0.5 - j) * this.cell * 0.4);
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), j * Math.PI * 2);
        const spread = this.cell * (1.35 + j * 0.3);
        // A cut tuft is gone: the ground shows the mowed lawn there (cutMap).
        if (cut) this.scale.set(0, 0, 0);
        else this.scale.set(spread, grass.height * (0.85 + j * 0.3), spread);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        chunk.mesh.setMatrixAt(n, this.matrix);
        this.color.copy(this.uncutColors[type]).multiplyScalar(0.88 + j * 0.24);
        chunk.mesh.setColorAt(n, this.color);
        this.dirty.add(this.chunkOf[i]);
        this.writeCutTexel(i, type, ix, cut);
    }

    /** A cell's texel in cutMap: its cut colour in the stripe's shade, alpha = cut. */
    private writeCutTexel(i: number, type: number, ix: number, cut: boolean): void {
        const data = this.cutMap.image.data as Uint8Array;
        this.color.copy(this.cutColors[type]).multiplyScalar(Math.floor(ix / STRIPE) % 2 === 0 ? 1.06 : 0.88);
        // The texture is sRGB: write the colour's sRGB bytes.
        const srgb = this.color.clone().convertLinearToSRGB();
        data[i * 4] = Math.min(255, Math.round(srgb.r * 255));
        data[i * 4 + 1] = Math.min(255, Math.round(srgb.g * 255));
        data[i * 4 + 2] = Math.min(255, Math.round(srgb.b * 255));
        data[i * 4 + 3] = cut ? 255 : 0;
        this.cutMapDirty = true;
    }

    // ---------------------------------------------------------------- cutting

    /**
     * Cuts what `power` can handle within `radius` of the segment a -> b (a capsule: the player's feet out to the
     * tool, so nothing is left trapped between them): stronger-or-equal grass at once, one step tougher over
     * SLOW_CUT_SEC of contact (`delta` is this step's), tougher still not at all. `canCut(district)` says whether a
     * district is open (a locked one isn't cut).
     */
    public cutCapsule(ax: number, az: number, bx: number, bz: number, radius: number, power: number, delta: number,
        canCut: (district: number) => boolean): CutResult {
        const result: CutResult = { cells: 0, clippings: 0 };
        const r2 = radius * radius;
        const minIx = Math.max(0, Math.floor((Math.min(ax, bx) - radius - this.minX) / this.cell));
        const maxIx = Math.min(this.width - 1, Math.floor((Math.max(ax, bx) + radius - this.minX) / this.cell));
        const minIz = Math.max(0, Math.floor((Math.min(az, bz) - radius - this.minZ) / this.cell));
        const maxIz = Math.min(this.depth - 1, Math.floor((Math.max(az, bz) + radius - this.minZ) / this.cell));
        const abx = bx - ax;
        const abz = bz - az;
        const length2 = abx * abx + abz * abz;
        /** Squared distance from (x, z) to the segment. */
        const distance2 = (x: number, z: number) => {
            const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * abx + (z - az) * abz) / length2)) : 0;
            const dx = x - (ax + abx * t);
            const dz = z - (az + abz * t);
            return dx * dx + dz * dz;
        };
        let sumX = 0;
        let sumZ = 0;
        let lastType = -1;
        for (let iz = minIz; iz <= maxIz; iz++) {
            for (let ix = minIx; ix <= maxIx; ix++) {
                const i = ix + iz * this.width;
                if (!this.types[i] || this.cutFlags[i]) continue;
                const { x, z } = this.center(ix, iz);
                if (distance2(x, z) > r2) continue;
                const d = this.districtOf[i];
                if (d < 0 || !canCut(d)) continue;
                const grass = MOW.grass[this.types[i] - 1];
                const short = grass.resistance - power;
                if (short > 1) {
                    if (!result.blocked || grass.resistance > result.blocked.resistance) result.blocked = grass;
                    continue;
                }
                if (short === 1) {
                    this.damage[i] += delta;
                    if (this.damage[i] < SLOW_CUT_SEC) {
                        result.chewing ??= { at: new THREE.Vector3(x, 0.4, z), color: this.uncutColors[this.types[i] - 1].clone() };
                        continue;
                    }
                }
                this.cutFlags[i] = 1;
                this.cutCounts[d]++;
                this.writeInstance(i);
                result.cells++;
                result.clippings += grass.value;
                sumX += x;
                sumZ += z;
                lastType = this.types[i] - 1;
            }
        }
        if (result.cells > 0) {
            result.at = new THREE.Vector3(sumX / result.cells, 0.3, sumZ / result.cells);
            result.color = this.uncutColors[lastType].clone();
        }
        return result;
    }

    /**
     * Grows back cut grass in the districts still being restored (`growing(d)`): REGROW_PER_SEC cells each, picked at
     * random so it comes back here and there.
     */
    public regrow(delta: number, growing: (district: number) => boolean): void {
        if (!this.cellsOf.length) {
            this.cellsOf = MOW.districts.map(() => []);
            for (let i = 0; i < this.types.length; i++) if (this.types[i] && this.districtOf[i] >= 0) this.cellsOf[this.districtOf[i]].push(i);
        }
        MOW.districts.forEach((_, d) => {
            const cells = this.cellsOf[d];
            if (!growing(d) || !this.cutCounts[d] || !cells.length) return;
            this.regrowCarry[d] += REGROW_PER_SEC * delta;
            // Random picks over all the district's cells: a pick on uncut grass is a miss, so scale up to hit cut ones.
            const share = this.cutCounts[d] / cells.length;
            while (this.regrowCarry[d] >= 1) {
                this.regrowCarry[d] -= 1;
                for (let attempt = 0; attempt < Math.ceil(4 / share); attempt++) {
                    const i = cells[Math.floor(Math.random() * cells.length)];
                    if (!this.cutFlags[i]) continue;
                    this.cutFlags[i] = 0;
                    this.damage[i] = 0;
                    this.cutCounts[d]--;
                    this.writeInstance(i);
                    break;
                }
            }
        });
    }

    /** A district's restored share (0..1). */
    public progress(district: number): number {
        return this.totals[district] ? this.cutCounts[district] / this.totals[district] : 1;
    }

    /** Cuts every cell left in a district (its completion clears the stragglers); returns how many. */
    public cutAll(district: number): number {
        let count = 0;
        for (let i = 0; i < this.types.length; i++) {
            if (this.districtOf[i] !== district || !this.types[i] || this.cutFlags[i]) continue;
            this.cutFlags[i] = 1;
            this.cutCounts[district]++;
            this.writeInstance(i);
            count++;
        }
        return count;
    }

    /** The ground of a district in its restored colour. */
    public setRestored(district: number): void {
        const ground = this.grounds[district];
        (ground.material as THREE.MeshStandardMaterial).color.set(MOW.districts[district].restoredGround);
    }

    /** Uncut cells of a district left, as points (for showing the last patches), at most `max`. */
    public remaining(district: number, max: number): THREE.Vector3[] {
        const out: THREE.Vector3[] = [];
        for (let i = 0; i < this.types.length && out.length < max; i++) {
            if (this.districtOf[i] !== district || !this.types[i] || this.cutFlags[i]) continue;
            const { x, z } = this.center(i % this.width, Math.floor(i / this.width));
            out.push(new THREE.Vector3(x, 0, z));
        }
        return out;
    }

    /** Uploads the chunks changed since the last call; call once per frame. */
    public update(): void {
        if (this.cutMapDirty) {
            this.cutMap.needsUpdate = true;
            this.cutMapDirty = false;
        }
        for (const chunk of this.dirty) {
            const mesh = this.chunks[chunk].mesh;
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        this.dirty.clear();
    }

    // ---------------------------------------------------------------- save

    /** Cut cells as a compact string: the grid size, then run-lengths of the cut flags. */
    public save(): string {
        const runs: number[] = [];
        let current = 0;
        let run = 0;
        for (const flag of this.cutFlags) {
            if (flag === current) run++;
            else {
                runs.push(run);
                current = flag;
                run = 1;
            }
        }
        runs.push(run);
        return `${this.width}x${this.depth}:${runs.join('.')}`;
    }

    private load(save: string): void {
        const [size, runs] = save.split(':');
        if (size !== `${this.width}x${this.depth}` || runs === undefined) return;
        let index = 0;
        let flag = 0;
        for (const part of runs.split('.')) {
            const run = Number(part) || 0;
            if (flag) {
                for (let i = index; i < Math.min(this.cutFlags.length, index + run); i++) {
                    if (!this.types[i]) continue;
                    this.cutFlags[i] = 1;
                    this.cutCounts[this.districtOf[i]]++;
                }
            }
            index += run;
            flag = 1 - flag;
        }
    }

    public get districts(): readonly DistrictDef[] {
        return MOW.districts;
    }

    public destroy(): void {
        this.group.removeFromParent();
        for (const chunk of this.chunks) chunk.mesh.dispose();
    }
}
