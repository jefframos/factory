// TileMap.ts
//
// Paints the map's groundLayer (see TileMapConfig.ts) as one InstancedMesh —
// a single draw call for the whole grid regardless of size, each instance a
// flat colored quad positioned at its cell and tinted from map/tiles.json's
// `grounds` lookup for that gid. Purely visual paint on top of
// WorldManager's existing ground plane/physics slab — doesn't touch
// collision. The map's OTHER tilelayer, resourcesLayer, marks where
// gatherable resources spawn — see TileMapConfig.buildResourceSpawnsFromTileMap(),
// consumed by WorldManager, not this class.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import {
    DEFAULT_TILE_MAP_ALIASES,
    FALLBACK_TILE_COLOR,
    findLayer,
    getTilesetFirstGids,
    GROUND_LAYER_NAME,
    iterateLayerCells,
    loadTileDefs,
    loadTiledMap,
    resolveGroundDef,
    tileCellToWorldPosition,
    TILE_PAINT_Y_OFFSET,
    WORLD_UNITS_PER_TILE,
} from './TileMapConfig';

export default class TileMap {
    private mesh?: THREE.InstancedMesh;

    public constructor(
        private readonly threeScene: THREE.Scene,
        private readonly mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
        private readonly tilesAlias: string = DEFAULT_TILE_MAP_ALIASES.tiles,
        private readonly worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
    ) { }

    /** Reads the map + tile defs (already-loaded PIXI assets, see TileMapConfig.ts) and builds the instanced mesh for groundLayer. Call once during scene build. */
    public build(): void {
        const map = loadTiledMap(this.mapAlias);
        const tileDefs = loadTileDefs(this.tilesAlias);

        const layer = findLayer(map, GROUND_LAYER_NAME);
        if (!layer) {
            return;
        }

        const cells = [...iterateLayerCells(layer)];
        if (cells.length === 0) {
            return;
        }

        const { groundFirstGid } = getTilesetFirstGids(map);

        const geometry = new THREE.PlaneGeometry(this.worldUnitsPerTile, this.worldUnitsPerTile);
        geometry.rotateX(-Math.PI / 2);
        const material = new THREE.MeshStandardMaterial({ roughness: 1 });
        // Same shared uBendOrigin/uBendStrength as the ground floor (see BendService.ts) —
        // BendService.applyBend() re-applies instanceMatrix itself, so this curves each
        // painted tile along with the rest of the world with no extra wiring needed here.
        BendService.applyBend(material);

        const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
        mesh.position.y = TILE_PAINT_Y_OFFSET;
        // InstancedMesh's default bounding sphere comes from the geometry alone (one tile,
        // centered at the mesh's local origin) — Three culls the WHOLE mesh against that tiny
        // sphere, so every instance except the one near world origin gets frustum-culled away.
        // One draw call regardless of tile count, so skipping culling entirely costs nothing here.
        mesh.frustumCulled = false;

        const matrix = new THREE.Matrix4();
        const color = new THREE.Color();

        cells.forEach(({ gid, col, row }, instanceIndex) => {
            const { x: worldX, z: worldZ } = tileCellToWorldPosition(col, row, this.worldUnitsPerTile);

            matrix.makeTranslation(worldX, 0, worldZ);
            mesh.setMatrixAt(instanceIndex, matrix);

            const def = resolveGroundDef(gid, tileDefs, groundFirstGid);
            color.set(def?.color ?? FALLBACK_TILE_COLOR);
            mesh.setColorAt(instanceIndex, color);
        });

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
            mesh.instanceColor.needsUpdate = true;
        }

        this.threeScene.add(mesh);
        this.mesh = mesh;
    }

    public destroy(): void {
        if (!this.mesh) {
            return;
        }
        this.threeScene.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh = undefined;
    }
}
