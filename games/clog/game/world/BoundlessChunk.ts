import * as THREE from 'three';
import { RoomGrid } from './RoomGrid';
import { ClusterMeshBuilder } from '../builders/ClusterMeshBuilder';
import { BendService } from '../services/BendService';
import { makeIslandTexture } from '../builders/IslandTexture';
import { TILE_DEFS, type TileConfig } from './MeshConfig';

// World units per chunk. Each chunk may contain one island.
export const CHUNK_SIZE = 40;

// Island dimensions — fits comfortably inside a chunk with ~7-unit water margin on each side.
const ISLAND_SIZE = 26;
// Organic tile-1 terrain blobs — gives islands their grass/sand look without enclosing walls.
const TERRAIN_SCALE = 0.12;
const TERRAIN_THRESHOLD = 0.65; // ~35% of cells become raised terrain
// Short tile-2 obstacles scattered in remaining free space.
const OBS_SCALE = 0.09;
const OBS_THRESHOLD = 0.52;
// Radius (in cells) kept free at the centre of chunk (0,0) for the player spawn.
const SPAWN_CLEAR_RADIUS = 3;
// Distance fade — meshes start fading at FADE_START and are invisible at FADE_END.
const FADE_START = 60;
const FADE_END   = 100;

// Seed used for the global island-presence noise field (spatial coherence).
const WORLD_SEED = 42;

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
    private extraTextures: THREE.Texture[] = [];

    constructor(chunkX: number, chunkZ: number, scene: THREE.Scene) {
        this.chunkX = chunkX;
        this.chunkZ = chunkZ;
        this.worldX = chunkX * CHUNK_SIZE;
        this.worldZ = chunkZ * CHUNK_SIZE;

        // Chunk (0,0) always has an island so the player never starts on open water.
        const islandPresence = valueNoise(chunkX * 0.65, chunkZ * 0.65, WORLD_SEED);
        this.hasIsland = (chunkX === 0 && chunkZ === 0) || islandPresence > 0.35;

        if (this.hasIsland) {
            // Per-chunk seed for each noise layer — each island looks different.
            const chunkSeed = Math.abs((chunkX * 73856093) ^ (chunkZ * 19349663)) % 100000;

            this.grid = new RoomGrid(ISLAND_SIZE, ISLAND_SIZE, this.worldX, this.worldZ);

            for (let row = 0; row < ISLAND_SIZE; row++) {
                for (let col = 0; col < ISLAND_SIZE; col++) {
                    if (valueNoise(col * OBS_SCALE, row * OBS_SCALE, chunkSeed) >= OBS_THRESHOLD) {
                        this.grid.set(col, row, 2);
                    }
                }
            }

            // Guarantee a walkable spawn area at the centre of the starting chunk.
            if (chunkX === 0 && chunkZ === 0) {
                const mid = Math.floor(ISLAND_SIZE / 2);
                for (let dr = -SPAWN_CLEAR_RADIUS; dr <= SPAWN_CLEAR_RADIUS; dr++) {
                    for (let dc = -SPAWN_CLEAR_RADIUS; dc <= SPAWN_CLEAR_RADIUS; dc++) {
                        this.grid.set(mid + dc, mid + dr, 0);
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
        for (const m of this.sceneMeshes) {
            scene.remove(m);
            m.geometry.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) (mat as THREE.Material).dispose();
        }
        this.sceneMeshes = [];
        for (const tex of this.extraTextures) tex.dispose();
        this.extraTextures = [];
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

        const islandTex = cfg.texture === 'island' ? makeIslandTexture() : null;
        if (islandTex) this.extraTextures.push(islandTex);

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

                let geo: THREE.BufferGeometry;
                if (cfg.radius > 0) {
                    geo = ClusterMeshBuilder.roundAllEdges(island, cs, cfg.height, cfg.depthBelow, grid.originX, grid.originZ, cfg.radius, 3);
                    if (islandTex) ClusterMeshBuilder.applyIslandAtlasUVs(geo, cfg.height, cfg.depthBelow);
                } else {
                    geo = ClusterMeshBuilder.buildGeometry(island, cs, cfg.height, cfg.depthBelow, grid.originX, grid.originZ);
                }

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

                const mesh = new THREE.Mesh(geo, mat);
                mesh.frustumCulled = false;
                scene.add(mesh);
                this.sceneMeshes.push(mesh);
            }
        }
    }
}
