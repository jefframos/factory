import * as THREE from 'three';
import { BoundlessChunk, CHUNK_SIZE } from './BoundlessChunk';
import { CollectibleManager } from '../systems/CollectibleManager';
import type { PlayerEntity } from '../entities/PlayerEntity';
import type { PerfStats } from '../utils/PerfOverlay';

// How many chunks to keep loaded in each direction from the player's chunk.
const VIEW_RADIUS = 3;
// Max new chunks built per frame — caps the mesh-build spike when returning to
// an unloaded area. Remaining missing chunks catch up over subsequent frames.
const MAX_BUILDS_PER_FRAME = 2;

export class BoundlessChunkManager {
    private scene: THREE.Scene;
    private collectibles: CollectibleManager;
    private chunks = new Map<string, BoundlessChunk>();

    private _buildsThisFrame = 0;
    private _lastBuildMs     = 0;
    private _peakBuildMs     = 0;

    constructor(scene: THREE.Scene, collectibles: CollectibleManager) {
        this.scene = scene;
        this.collectibles = collectibles;
    }

    getStats(): Pick<PerfStats, 'chunksLoaded' | 'chunksBuiltThisFrame' | 'lastBuildMs' | 'peakBuildMs'> {
        return {
            chunksLoaded:        this.chunks.size,
            chunksBuiltThisFrame: this._buildsThisFrame,
            lastBuildMs:         this._lastBuildMs,
            peakBuildMs:         this._peakBuildMs,
        };
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(player: PlayerEntity): void {
        const cx = Math.round(player.position.x / CHUNK_SIZE);
        const cz = Math.round(player.position.z / CHUNK_SIZE);

        this._buildsThisFrame = 0;

        // Load chunks that entered the view radius, capped to avoid frame spikes.
        for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
            for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
                const key = `${cx + dx},${cz + dz}`;
                if (!this.chunks.has(key)) {
                    if (this._buildsThisFrame >= MAX_BUILDS_PER_FRAME) continue;
                    const t0 = performance.now();
                    this.chunks.set(key, new BoundlessChunk(cx + dx, cz + dz, this.scene));
                    this._lastBuildMs = performance.now() - t0;
                    this._peakBuildMs = Math.max(this._peakBuildMs, this._lastBuildMs);
                    this._buildsThisFrame++;
                }
            }
        }

        // Unload chunks that left the view radius.
        for (const [key, chunk] of this.chunks) {
            if (Math.abs(chunk.chunkX - cx) > VIEW_RADIUS || Math.abs(chunk.chunkZ - cz) > VIEW_RADIUS) {
                if (chunk.grid) {
                    const hs = CHUNK_SIZE / 2;
                    this.collectibles.clearInRect(
                        chunk.worldX - hs, chunk.worldX + hs,
                        chunk.worldZ - hs, chunk.worldZ + hs,
                    );
                }
                chunk.destroy(this.scene);
                this.chunks.delete(key);
            }
        }

        // Collision resolution with all loaded islands.
        for (const chunk of this.chunks.values()) {
            chunk.resolveCollisions(player.position, player.collisionRadius);
        }
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /**
     * Returns free cells from all loaded islands whose center is within
     * `worldRadius` of the given point. Used to feed the food spawner.
     */
    getFreeCellsNear(x: number, z: number, worldRadius: number): { x: number; z: number }[] {
        const out: { x: number; z: number }[] = [];
        const r2 = worldRadius * worldRadius;
        const chunkReach = (worldRadius + CHUNK_SIZE) ** 2;

        for (const chunk of this.chunks.values()) {
            if (!chunk.hasIsland || !chunk.grid) continue;
            const dx = chunk.worldX - x;
            const dz = chunk.worldZ - z;
            if (dx * dx + dz * dz > chunkReach) continue;
            for (const cell of chunk.grid.getFreeCells()) {
                const cdx = cell.x - x;
                const cdz = cell.z - z;
                if (cdx * cdx + cdz * cdz <= r2) out.push(cell);
            }
        }
        return out;
    }

    /**
     * Returns true when (worldX, worldZ) is not occupied by a solid obstacle tile.
     * Open water chunks (no island) and unloaded chunks are treated as walkable.
     */
    isWalkable(worldX: number, worldZ: number): boolean {
        const cx = Math.round(worldX / CHUNK_SIZE);
        const cz = Math.round(worldZ / CHUNK_SIZE);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (!chunk?.grid) return true;
        const { col, row } = chunk.grid.worldToCell(worldX, worldZ);
        if (!chunk.grid.inBounds(col, row)) return true;
        return !chunk.grid.isBlocked(col, row);
    }

    destroy(): void {
        for (const chunk of this.chunks.values()) chunk.destroy(this.scene);
        this.chunks.clear();
    }
}
