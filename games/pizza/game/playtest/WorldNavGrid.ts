// WorldNavGrid.ts
//
// The playtest bot's walkability grid over the WHOLE map — the same StoreNavGrid (A*, string
// pulling, snap-to-walkable) every store builds over its own room, just sized to the ground tile
// map. Blocked: tiles the player can't walk on (TileWalkability — water, locked zones), cells with
// no ground at all, and every static solid physics body (walls, shelves, buildings, fences) grown
// by the player's radius — the same filter Store.rebuildNavGrid() uses for clients.
//
// Rebuilt lazily: only when the physics world changed (something solid spawned/despawned) or a
// zone was revealed since the last build, and at most every REBUILD_MIN_SEC of game time.

import * as THREE from 'three';
import StoreNavGrid, { NavBounds } from '../store/nav/StoreNavGrid';
import type World from '../ecs/World';
import type TileMap from '../world/TileMap';
import { Layers } from '../physics/PhysicsConstants';
import { isWalkable } from '../world/TileWalkability';
import FarmPlotTile from '../world/FarmPlotTile';
import { FARM_GRID_CELL_SIZE } from '../world/FarmGrid';

/** Extra A* cost per nav cell on a farm field — see findPath(). */
const FARM_CELL_COST = 6;

const CELL_SIZE = 0.5;
/** Player half-width 0.4 + slack, so string-pulled paths don't scrape wall ends and door frames (0.45 was too tight — the bot snagged on doorways). Doorways are 2+ units wide, so this still fits through. */
const PLAYER_RADIUS = 0.6;
const REBUILD_MIN_SEC = 2;
/** Same as Store.ts's NAV_BODY_* filter — ignores the ground slab, overhead things and floor decals. */
const BODY_MAX_BOTTOM = 1.8;
const BODY_MIN_TOP = 0.05;
const BODY_MAX_SIZE = 200;

export default class WorldNavGrid {
    private grid?: StoreNavGrid;
    private builtPhysicsVersion = -1;
    private builtRevealKey = '';
    private sinceBuildSec = Infinity;
    private bounds?: NavBounds;

    public constructor(
        private readonly world: World,
        private readonly tileMap: TileMap,
        /** Changes whenever a zone is revealed — e.g. the revealed zone numbers joined. */
        private readonly getRevealKey: () => string,
    ) { }

    public update(delta: number): void {
        this.sinceBuildSec += delta;
        if (this.sinceBuildSec < REBUILD_MIN_SEC && this.grid) {
            return;
        }
        const version = this.world.physics.version;
        const revealKey = this.getRevealKey();
        if (this.grid && version === this.builtPhysicsVersion && revealKey === this.builtRevealKey) {
            return;
        }
        this.rebuild();
        this.builtPhysicsVersion = version;
        this.builtRevealKey = revealKey;
        this.sinceBuildSec = 0;
    }

    /** Rebuilds right away, regardless of the throttle — e.g. when a path just failed. */
    public rebuildNow(): void {
        this.rebuild();
        this.builtPhysicsVersion = this.world.physics.version;
        this.builtRevealKey = this.getRevealKey();
        this.sinceBuildSec = 0;
    }

    public getGrid(): StoreNavGrid | undefined {
        return this.grid;
    }

    /**
     * Waypoints from `from` to `to` (written into `out`) — false when there's no way there.
     *
     * With `avoidFields`, farm fields cost extra (FARM_CELL_COST) and smoothing never cuts across
     * one: stepping on a ripe cell harvests it on the spot, so a route over a field fills the crate
     * with things nobody asked for. Only the field the trip starts or ends on is exempt (that's the
     * one being harvested). The mask is grown by the player's half-width — the player picks up a
     * cell as soon as its body overlaps it, not when its center does.
     */
    public findPath(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3[], avoidFields = true): boolean {
        if (!this.grid) {
            this.update(0);
        }
        const grid = this.grid;
        if (!grid) {
            return false;
        }
        this.refreshFarmMask(grid);
        const mask = this.farmMask;
        if (!avoidFields || !mask) {
            return grid.findPath(from, to, out);
        }
        const exempt = new Set([this.fieldAt(from.x, from.z), this.fieldAt(to.x, to.z)]);
        const onAvoidedField = (x: number, z: number): boolean => {
            const index = grid.cellAt(x, z);
            const field = index === -1 ? 0 : mask[index];
            return field !== 0 && !exempt.has(field);
        };
        return grid.findPath(from, to, out, (x, z) => (onAvoidedField(x, z) ? FARM_CELL_COST : 0), onAvoidedField);
    }

    /** The field (farm plot) under (x, z) as a nonzero number, 0 when none — see refreshFarmMask(). */
    private fieldAt(x: number, z: number): number {
        const index = this.grid?.cellAt(x, z) ?? -1;
        return index === -1 ? 0 : this.farmMask?.[index] ?? 0;
    }

    /** Nav cell -> 1 + index of the farm plot whose cells cover it (grown by PLAYER_RADIUS), 0 = none. */
    private farmMask?: Uint16Array;
    private farmMaskTileCount = -1;
    private farmMaskGrid?: StoreNavGrid;

    /** Rebuilt when farm cells appear/disappear or the grid itself is rebuilt. */
    private refreshFarmMask(grid: StoreNavGrid): void {
        const tiles = FarmPlotTile.getAll();
        if (this.farmMaskGrid === grid && this.farmMaskTileCount === tiles.size) {
            return;
        }
        this.farmMaskGrid = grid;
        this.farmMaskTileCount = tiles.size;
        const mask = new Uint16Array(grid.cellCount);
        const fieldIds = new Map<string, number>();
        const reach = FARM_GRID_CELL_SIZE / 2 + PLAYER_RADIUS;
        for (const tile of tiles) {
            const field = fieldIds.get(tile.farmId) ?? fieldIds.size + 1;
            fieldIds.set(tile.farmId, field);
            const { x, z } = tile.transform.position;
            for (let cz = z - reach; cz <= z + reach; cz += grid.cellSize) {
                for (let cx = x - reach; cx <= x + reach; cx += grid.cellSize) {
                    const index = grid.cellAt(cx, cz);
                    if (index !== -1 && mask[index] === 0) {
                        mask[index] = field;
                    }
                }
            }
        }
        this.farmMask = mask;
    }

    public isWalkableAt(x: number, z: number): boolean {
        return this.grid?.isWalkableAt(x, z) ?? true;
    }

    private computeBounds(): NavBounds | undefined {
        const unit = this.tileMap.getWorldUnitsPerTile();
        let minCol = Infinity;
        let minRow = Infinity;
        let maxCol = -Infinity;
        let maxRow = -Infinity;
        for (const layer of this.tileMap.getGroundCellLayers()) {
            for (const cell of layer) {
                minCol = Math.min(minCol, cell.col);
                minRow = Math.min(minRow, cell.row);
                maxCol = Math.max(maxCol, cell.col);
                maxRow = Math.max(maxRow, cell.row);
            }
        }
        if (!Number.isFinite(minCol)) {
            return undefined;
        }
        return { minX: minCol * unit, minZ: minRow * unit, maxX: (maxCol + 1) * unit, maxZ: (maxRow + 1) * unit };
    }

    private rebuild(): void {
        this.bounds ??= this.computeBounds();
        const bounds = this.bounds;
        if (!bounds) {
            return;
        }
        const grid = new StoreNavGrid(bounds, CELL_SIZE);
        const min = new THREE.Vector3();
        const max = new THREE.Vector3();
        this.world.physics.forEachBody(body => {
            if (!body.isStatic || body.isTrigger || (body.layer & Layers.Player) !== 0) {
                return;
            }
            body.getMin(min);
            body.getMax(max);
            if (max.y < BODY_MIN_TOP || min.y > BODY_MAX_BOTTOM || max.x - min.x > BODY_MAX_SIZE || max.z - min.z > BODY_MAX_SIZE) {
                return;
            }
            grid.blockRect({ minX: min.x, minZ: min.z, maxX: max.x, maxZ: max.z }, PLAYER_RADIUS);
        });
        grid.blockWhere((x, z) => this.tileMap.getGroundDefAt(x, z) === undefined || !isWalkable(x, z));
        this.grid = grid;
    }
}
