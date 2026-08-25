// TileMap.ts
//
// Paints every layer whose name contains "groundLayer" (see TileMapConfig.ts's
// findLayers()/GROUND_LAYER_NAME) as its own InstancedMesh — one draw call per
// matched layer regardless of grid size, each instance a flat colored quad
// positioned at its cell and tinted from map/tiles.json's `grounds` lookup
// for that gid. This is the FLAT fallback paint (see `paintVisible`) — when
// IslandMeshBuilder is turned on instead, it reads getGroundCellLayers() and
// builds each matched layer as its own set of rounded, per-tile-height blob
// meshes, layered the same way (see IslandMeshBuilder.ts). Either way, a
// layer beyond the first (e.g. a "groundLayer2" decorative overlay) is lifted
// GROUND_LAYER_Y_STEP higher than the one before it so it renders on top
// instead of z-fighting/overlapping it. Purely visual paint on top of
// WorldManager's existing ground plane/physics slab — doesn't touch
// collision itself, but build() also keeps the col/row -> TileDef lookup
// around (see `cellDefs`) so isWalkableAt() can answer "what ground tile is
// at this world position, and is it walkable" — and publishes that as the
// query TileWalkability.ts exposes, so PlayerMovementController can block
// movement onto e.g. water without depending on TileMap at all (see that
// file's own doc for why this is a one-way, optional publish). The map's
// OTHER tilelayer, resourcesLayer, marks where gatherable resources spawn —
// see TileMapConfig.buildResourceSpawnsFromTileMap(), consumed by
// WorldManager, not this class.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import {
    DEFAULT_TILE_MAP_ALIASES,
    FALLBACK_TILE_COLOR,
    findLayers,
    getTilesetFirstGids,
    GROUND_LAYER_NAME,
    GROUND_LAYER_Y_STEP,
    isGroundWalkable,
    iterateLayerCells,
    loadTileDefs,
    loadTiledMap,
    resolveGroundDef,
    TileDef,
    tileCellToWorldPosition,
    TILE_PAINT_Y_OFFSET,
    WORLD_UNITS_PER_TILE,
} from './TileMapConfig';
import { clearWalkabilityQuery, setWalkabilityQuery } from './TileWalkability';

/** Key `cellDefs` is stored under — same col/row pair iterateLayerCells() yields. */
function cellKey(col: number, row: number): string {
    return `${col},${row}`;
}

/** One resolved ground cell, as handed out by TileMap.getGroundCellLayers() — see IslandMeshBuilder.ts, the one consumer that needs to iterate every painted cell rather than query a single point. */
export interface GroundCell {
    col: number;
    row: number;
    def: TileDef;
}

export default class TileMap {
    /** One InstancedMesh per matched groundLayer-named layer (see build()) — index order is paint order, which is also Y-offset order (see GROUND_LAYER_Y_STEP). */
    private readonly meshes: THREE.InstancedMesh[] = [];
    /**
     * col/row (see `cellKey`) -> resolved ground def, used ONLY by getGroundDefAt()/
     * isWalkableAt() — i.e. "cell FUNCTIONALITY," not what gets drawn. ALWAYS merged across
     * every matched layer, topmost layer wins per cell — so a non-walkable tile drawn on an
     * overlay layer (e.g. water painted over grass) always takes priority for
     * movement-blocking, independent of how each layer is separately drawn (see
     * `layerCellLists`' own doc). Empty (not built, or the map had no groundLayer) means
     * every query fails open — see isWalkableAt().
     */
    private readonly cellDefs = new Map<string, TileDef>();
    /**
     * Every matched layer's OWN painted cells, kept SEPARATE per layer (index-aligned with
     * paint order — see build()) rather than merged into one combined list. This is what
     * IslandMeshBuilder.getGroundCellLayers() reads to flood-fill EACH layer into its own
     * set of per-tile-name blobs — a decorative overlay layer gets the exact same rounded,
     * per-tile-height treatment the base layer does, just as its own separate geometry
     * lifted GROUND_LAYER_Y_STEP higher, instead of punching a hole in (or reshaping the
     * rounded edge of) the base layer's blob.
     */
    private readonly layerCellLists: GroundCell[][] = [];
    /** Bound once so destroy() can hand the SAME function reference back to clearWalkabilityQuery() for its identity check. */
    private readonly walkabilityQuery = (worldX: number, worldZ: number): boolean => this.isWalkableAt(worldX, worldZ);

    public constructor(
        private readonly threeScene: THREE.Scene,
        private readonly mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
        private readonly tilesAlias: string = DEFAULT_TILE_MAP_ALIASES.tiles,
        private readonly worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
    ) { }

    /**
     * Reads the map + tile defs (already-loaded PIXI assets, see TileMapConfig.ts) and builds
     * one InstancedMesh per layer whose name contains GROUND_LAYER_NAME (see findLayers()) —
     * not just an exact "groundLayer" match, so a map can stack decorative variants
     * ("groundLayer2", "groundLayer_path", ...) on top of the base layer. Each later match (in
     * Tiled's own layer order) sits GROUND_LAYER_Y_STEP higher than the one before it, so a
     * decoration painted on top of the base ground actually renders on top instead of
     * z-fighting with it. Call once during scene build.
     *
     * `cellDefs` (cell FUNCTIONALITY — isWalkableAt()/getGroundDefAt()) is ALWAYS merged
     * across every matched layer, topmost wins per cell — a non-walkable tile drawn on an
     * overlay layer always takes priority for movement, independent of how each layer is
     * separately drawn (see `layerCellLists`' own doc).
     *
     * `paintVisible = false` hides every matched layer's flat-color mesh (not just the
     * base's) — that's what WorldManager passes when IslandMeshBuilder is building 3D island
     * geometry from this same TileMap instead: EVERY layer's flat paint still gets built
     * (cellDefs/layerCellLists/walkability all still populate normally) so switching back to
     * flat paint is a one-line change (see WorldManager.buildGround()), it's just not drawn
     * underneath IslandMeshBuilder's per-layer blob geometry (see IslandMeshBuilder.ts).
     */
    public build(paintVisible = true): void {
        const map = loadTiledMap(this.mapAlias);
        const tileDefs = loadTileDefs(this.tilesAlias);

        const layers = findLayers(map, GROUND_LAYER_NAME);
        if (layers.length === 0) {
            return;
        }

        const { groundFirstGid } = getTilesetFirstGids(map);

        layers.forEach((layer, layerIndex) => {
            const cells = [...iterateLayerCells(layer)];
            // Pushed even when empty so layerCellLists stays index-aligned with `layers` (and
            // so with this.meshes/the Y-offset order) — IslandMeshBuilder relies on that
            // alignment to know which offset each layer's blobs get.
            const layerCells: GroundCell[] = [];
            this.layerCellLists.push(layerCells);
            if (cells.length === 0) {
                return;
            }

            const geometry = new THREE.PlaneGeometry(this.worldUnitsPerTile, this.worldUnitsPerTile);
            geometry.rotateX(-Math.PI / 2);
            const material = new THREE.MeshStandardMaterial({ roughness: 1 });
            // Same shared uBendOrigin/uBendStrength as the ground floor (see BendService.ts) —
            // BendService.applyBend() re-applies instanceMatrix itself, so this curves each
            // painted tile along with the rest of the world with no extra wiring needed here.
            BendService.applyBend(material);

            const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
            mesh.position.y = TILE_PAINT_Y_OFFSET + layerIndex * GROUND_LAYER_Y_STEP;
            // InstancedMesh's default bounding sphere comes from the geometry alone (one tile,
            // centered at the mesh's local origin) — Three culls the WHOLE mesh against that tiny
            // sphere, so every instance except the one near world origin gets frustum-culled away.
            // One draw call regardless of tile count, so skipping culling entirely costs nothing here.
            mesh.frustumCulled = false;

            const matrix = new THREE.Matrix4();
            const color = new THREE.Color();

            cells.forEach(({ gid, col, row }, instanceIndex) => {
                const { x: worldX, z: worldZ } = tileCellToWorldPosition(col, row, this.worldUnitsPerTile);
                const def = resolveGroundDef(gid, tileDefs, groundFirstGid);

                if (def?.transparent) {
                    // Collapses this instance's quad to nothing rather than translating it
                    // into place — see TileDef.transparent's own doc. IslandMeshBuilder never
                    // sees this cell either (skipped below, via layerCells), so no raised
                    // terrain gets built here in that rendering path.
                    matrix.makeScale(0, 0, 0);
                } else {
                    matrix.makeTranslation(worldX, 0, worldZ);
                }
                mesh.setMatrixAt(instanceIndex, matrix);

                color.set(def?.color ?? FALLBACK_TILE_COLOR);
                mesh.setColorAt(instanceIndex, color);

                if (!def) {
                    return;
                }

                this.cellDefs.set(cellKey(col, row), def);
                if (!def.transparent) {
                    layerCells.push({ col, row, def });
                }
            });

            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor) {
                mesh.instanceColor.needsUpdate = true;
            }

            mesh.visible = paintVisible;
            this.threeScene.add(mesh);
            this.meshes.push(mesh);
        });

        setWalkabilityQuery(this.walkabilityQuery);
    }

    /** Inverse of TileMapConfig.tileCellToWorldPosition() — floors the world position down to the ABSOLUTE tile-grid col/row it falls inside. */
    private worldToTileCell(worldX: number, worldZ: number): { col: number; row: number } {
        return {
            col: Math.floor(worldX / this.worldUnitsPerTile),
            row: Math.floor(worldZ / this.worldUnitsPerTile),
        };
    }

    /** The resolved ground def painted at this world position, or undefined if it's outside every painted cell (e.g. off the edge of the map) — see cellDefs' own doc. */
    public getGroundDefAt(worldX: number, worldZ: number): TileDef | undefined {
        const { col, row } = this.worldToTileCell(worldX, worldZ);
        return this.cellDefs.get(cellKey(col, row));
    }

    /** Every matched layer's own painted cells, kept separate per layer (index-aligned with paint/Y-offset order) — see IslandMeshBuilder.ts, which flood-fills EACH layer's cells into its own set of per-tile-name blobs. Empty before build() (or if the map had no groundLayer). */
    public getGroundCellLayers(): readonly (readonly GroundCell[])[] {
        return this.layerCellLists;
    }

    /** World units per tile-grid cell — IslandMeshBuilder needs this to size ClusterMeshBuilder's cells the same as the painted mesh. */
    public getWorldUnitsPerTile(): number {
        return this.worldUnitsPerTile;
    }

    /**
     * Fails OPEN, not closed: a position with no painted ground cell (map not built yet,
     * outside the painted area, or this TileMap never had a groundLayer at all) is walkable
     * — only a cell that's both painted AND listed in NON_WALKABLE_GROUND_TILES blocks
     * movement. That's what keeps this purely additive (see this file's class doc and
     * TileWalkability.ts) instead of accidentally trapping the player anywhere the map
     * doesn't cover.
     */
    public isWalkableAt(worldX: number, worldZ: number): boolean {
        return isGroundWalkable(this.getGroundDefAt(worldX, worldZ));
    }

    public destroy(): void {
        clearWalkabilityQuery(this.walkabilityQuery);
        this.cellDefs.clear();
        this.layerCellLists.length = 0;

        for (const mesh of this.meshes) {
            this.threeScene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        }
        this.meshes.length = 0;
    }
}
