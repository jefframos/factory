import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomGrid, CELL_FREE, CELL_OBSTACLE } from './RoomGrid';
import { ClusterMeshBuilder } from '../builders/ClusterMeshBuilder';
import { BendService } from '../services/BendService';
import { TextureBuilder } from '../builders/TextureBuilder';
import { TILE_DEFS, type TileConfig } from './MeshConfig';

const DEBUG_MESH = new URLSearchParams(window.location.search).has('debugMesh');

// World units per chunk. Each chunk may contain one island.
export const CHUNK_SIZE = 40;

// Island dimensions — fits comfortably inside a chunk with ~7-unit water margin on each side.
const ISLAND_SIZE = 28;
// Organic CELL_TERRAIN blobs — gives islands their grass/sand look without enclosing walls.
const TERRAIN_SCALE = 0.12;
const TERRAIN_THRESHOLD = 0.65; // ~35% of cells become raised terrain
// Short CELL_OBSTACLE bumps scattered in remaining free space (i.e. only on top of terrain).
const OBS_SCALE = 0.04;
const OBS_THRESHOLD = 0.62;
// Radius (in cells) kept free at the centre of chunk (0,0) for the player spawn.
const SPAWN_CLEAR_RADIUS = 2;
// Chunks within this many chunk-widths of the origin never get an island (except
// chunk (0,0) itself, which always does) — keeps the starting island alone in open
// water instead of noise potentially placing land right up against it.
const SPAWN_ISLAND_CLEAR_RADIUS = 1;
// Distance fade — meshes start fading at FADE_START and are invisible at FADE_END.
const FADE_START = 60;
const FADE_END = 100;

// Seed used for the global island-presence noise field (spatial coherence).
const WORLD_SEED = 42 + Math.random() * 500000;

// ── Deterministic noise ───────────────────────────────────────────────────────
// Identical to the function in LinearArea — value noise in [0, 1].

function valueNoise(x: number, y: number, seed: number): number {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const h = (gx: number, gy: number): number => {
        let n = Math.imul(seed * 1013 ^ gx * 1619 ^ gy * 31337, 0x45d9f3b);
        n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
        return (n >>> 0) / 0xFFFFFFFF;
    };
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ── Tile resolution ───────────────────────────────────────────────────────────

interface ResolvedTile {
    height: number; depthBelow: number; color: number;
    roughness: number; opacity: number; radius: number;
    texture: string | null;
    fadeFrom: number | undefined; fadeTo: number | undefined;
}

function resolveTile(t: TileConfig): ResolvedTile {
    return {
        height: t.height, color: t.color,
        opacity: t.opacity ?? 1.0, roughness: t.roughness ?? 0.9,
        depthBelow: t.depthBelow ?? (t.height >= 2 ? 30 : 0),
        radius: t.radius ?? 0, texture: t.texture ?? null,
        fadeFrom: t.fadeFrom, fadeTo: t.fadeTo,
    };
}

// ── Shared tile materials ──────────────────────────────────────────────────────
// TILE_DEFS only ever has a couple of configs — one material per cellType is built
// once and reused by every chunk forever, instead of a fresh instance per chunk.
// Reusing the exact same material object (not just an equivalent one) is what lets
// the renderer skip re-doing per-material GPU setup on every new chunk.

const tileMaterialCache = new Map<number, THREE.MeshStandardMaterial>();

function getTileMaterial(cellType: number, cfg: ResolvedTile, islandTex: THREE.Texture | null): THREE.MeshStandardMaterial {
    const cached = tileMaterialCache.get(cellType);
    if (cached) return cached;

    const mat = new THREE.MeshStandardMaterial({
        color: islandTex ? 0xffffff : cfg.color,
        map: islandTex ?? undefined,
        roughness: cfg.roughness,
        transparent: cfg.opacity < 1 || cfg.fadeTo !== undefined,
        opacity: cfg.opacity,
    });
    BendService.applyBend(mat);
    BendService.applyDistanceFade(mat, FADE_START, FADE_END);
    if (cfg.fadeTo !== undefined) BendService.applyBottomFade(mat, cfg.fadeFrom ?? 0, cfg.fadeTo);

    tileMaterialCache.set(cellType, mat);
    return mat;
}

/**
 * Disposes and clears every cached tile material — call whenever the active
 * island's texture changes (see BaseDemoScene.spawnFreshWorld), otherwise
 * getTileMaterial() keeps handing out the material built against whichever
 * island was active the first time each cellType was ever built.
 */
export function clearTileMaterialCache(): void {
    for (const mat of tileMaterialCache.values()) mat.dispose();
    tileMaterialCache.clear();
}

// ── BoundlessChunk ────────────────────────────────────────────────────────────

export class BoundlessChunk {
    readonly chunkX: number;
    readonly chunkZ: number;
    /** World-space center X of this chunk. */
    readonly worldX: number;
    /** World-space center Z of this chunk. */
    readonly worldZ: number;
    readonly hasIsland: boolean;
    /** Grid for collision and free-cell queries. Null when hasIsland is false. */
    readonly grid: RoomGrid | null;

    private sceneMeshes: THREE.Mesh[] = [];
    private debugMeshes: THREE.Object3D[] = [];

    constructor(chunkX: number, chunkZ: number, scene: THREE.Scene) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.worldX = chunkX * CHUNK_SIZE;
        this.worldZ = chunkZ * CHUNK_SIZE;

        // Chunk (0,0) always has an island so the player never starts on open water;
        // chunks within SPAWN_ISLAND_CLEAR_RADIUS of it never do, so that island
        // starts out alone in open water instead of butting up against another one.
        const isOrigin = chunkX === 0 && chunkZ === 0;
        const nearOrigin = Math.hypot(chunkX, chunkZ) <= SPAWN_ISLAND_CLEAR_RADIUS;
        const islandPresence = valueNoise(chunkX * 0.65, chunkZ * 0.65, WORLD_SEED);
        this.hasIsland = isOrigin || (!nearOrigin && islandPresence > 0.35);

        if (this.hasIsland) {
            // Per-chunk seed for each noise layer — each island looks different.
            const chunkSeed = Math.abs((chunkX * 73856093) ^ (chunkZ * 19349663)) % 100000;

            this.grid = new RoomGrid(ISLAND_SIZE, ISLAND_SIZE, this.worldX, this.worldZ);

            for (let row = 0; row < ISLAND_SIZE; row++) {
                for (let col = 0; col < ISLAND_SIZE; col++) {
                    // Terrain noise carves the island's silhouette; obstacles only ever
                    // scatter on top of terrain, never floating alone over open water.
                    if (valueNoise(col * TERRAIN_SCALE, row * TERRAIN_SCALE, chunkSeed) < TERRAIN_THRESHOLD) continue;
                    const isObstacle = valueNoise(col * OBS_SCALE, row * OBS_SCALE, chunkSeed) >= OBS_THRESHOLD;
                    this.grid.set(col, row, isObstacle ? CELL_OBSTACLE : CELL_OBSTACLE);
                    //this.grid.set(col, row, isObstacle ? CELL_OBSTACLE : CELL_TERRAIN);
                }
            }

            // Guarantee a walkable spawn area at the centre of the starting chunk.
            if (chunkX === 0 && chunkZ === 0) {
                const mid = Math.floor(ISLAND_SIZE / 2);
                for (let dr = -SPAWN_CLEAR_RADIUS; dr <= SPAWN_CLEAR_RADIUS; dr++) {
                    for (let dc = -SPAWN_CLEAR_RADIUS; dc <= SPAWN_CLEAR_RADIUS; dc++) {
                        this.grid.set(mid + dc, mid + dr, CELL_FREE);
                    }
                }
            }

            this.buildIslandMeshes(scene);
        } else {
            this.grid = null;
        }
    }

    resolveCollisions(playerPos: THREE.Vector3, playerRadius: number): void {
        this.grid?.resolveCollision(playerPos, playerRadius);
    }

    destroy(scene: THREE.Scene): void {
        // Materials are shared across every chunk (see tileMaterialCache) — only the
        // per-chunk geometry is owned by this instance and safe to dispose here.
        for (const m of this.sceneMeshes) {
            scene.remove(m);
            m.geometry.dispose();
        }
        this.sceneMeshes = [];

        for (const m of this.debugMeshes) {
            scene.remove(m);
            if (m instanceof THREE.LineSegments) {
                m.geometry.dispose();
                (m.material as THREE.Material).dispose();
            }
        }
        this.debugMeshes = [];
    }

    // ── Mesh building — mirrors LinearArea.buildGridWallMeshes ────────────────

    private buildIslandMeshes(scene: THREE.Scene): void {
        for (const [key, tileCfg] of Object.entries(TILE_DEFS)) {
            this.buildTileGroup(scene, Number(key), resolveTile(tileCfg));
        }
    }

    private buildTileGroup(scene: THREE.Scene, cellType: number, cfg: ResolvedTile): void {
        const grid = this.grid!;
        const { cols, rows } = grid;
        const visited = new Uint8Array(cols * rows);
        const cs = grid.cellSize;
        const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        const islandTex = cfg.texture === 'island' ? TextureBuilder.island() : null;
        const geometries: THREE.BufferGeometry[] = [];

        for (let startRow = 0; startRow < rows; startRow++) {
            for (let startCol = 0; startCol < cols; startCol++) {
                const si = startRow * cols + startCol;
                if (visited[si] || grid.get(startCol, startRow) !== cellType) continue;

                const queue: [number, number][] = [[startCol, startRow]];
                visited[si] = 1;
                const island: [number, number][] = [];

                while (queue.length > 0) {
                    const [col, row] = queue.shift()!;
                    island.push([col, row]);
                    for (const [dc, dr] of dirs) {
                        const nc = col + dc, nr = row + dr;
                        if (!grid.inBounds(nc, nr)) continue;
                        const ni = nr * cols + nc;
                        if (visited[ni] || grid.get(nc, nr) !== cellType) continue;
                        visited[ni] = 1;
                        queue.push([nc, nr]);
                    }
                }

                const geo = cfg.radius > 0
                    ? ClusterMeshBuilder.roundEdges(island, cs, cfg.height, cfg.depthBelow, grid.originX, grid.originZ, cfg.radius, 3)
                    : ClusterMeshBuilder.buildGeometry(island, cs, cfg.height, cfg.depthBelow, grid.originX, grid.originZ);
                geometries.push(geo);
            }
        }

        if (geometries.length === 0) return;

        // Merge every connected blob of this tile type into one draw call — a chunk
        // can have a dozen+ scattered obstacle clusters, and one mesh/material per
        // cluster multiplies build cost and standing draw calls for no visual benefit.
        let merged: THREE.BufferGeometry;
        if (geometries.length > 1) {
            merged = mergeGeometries(geometries, false);
            for (const g of geometries) g.dispose();
        } else {
            merged = geometries[0];
        }

        const mat = getTileMaterial(cellType, cfg, islandTex);

        const mesh = new THREE.Mesh(merged, mat);
        mesh.frustumCulled = false;
        scene.add(mesh);
        this.sceneMeshes.push(mesh);

        // ?debugMesh — overlay the real triangle edges so sparse/uneven vertex
        // density (the usual cause of UV tiling looking "wrong") is visible
        // directly on the mesh instead of guessed at.
        if (DEBUG_MESH && islandTex) {
            const wire = new THREE.LineSegments(
                new THREE.WireframeGeometry(merged),
                new THREE.LineBasicMaterial({ color: 0x00ff00 }),
            );
            scene.add(wire);
            this.debugMeshes.push(wire);
        }
    }
}
