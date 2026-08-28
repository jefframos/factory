// IslandMeshBuilder.ts
//
// Builds 3D island geometry + a water plane FROM the Tiled ground layers TileMap
// already parsed (see TileMap.getGroundCellLayers()) — the games/clog equivalent
// (BoundlessChunk.buildIslandMeshes(), see its own doc) generates its grid
// procedurally from value-noise; this does the same flood-fill-into-blobs ->
// ClusterMeshBuilder -> mergeGeometries pipeline, but the grid comes from
// whatever's hand-painted in Tiled instead.
//
// Runs the SAME per-layer blob-building independently for every matched
// groundLayer-named layer (see TileMapConfig.GROUND_LAYER_NAME/findLayers()) —
// a decorative "groundLayer2" overlay gets the exact same rounded, per-tile-
// height treatment (ISLAND_TILE_DEFS) the base layer does, just as its own
// separate geometry lifted GROUND_LAYER_Y_STEP higher (see build()), rather
// than being flattened into the base layer's own blobs (which would let an
// overlay tile punch a hole in, or reshape the rounded edge of, the base).
//
// One mesh per ground tile NAME PER LAYER (not per connected blob — see
// buildTileGroup()): every blob of e.g. "sand" within one layer merges into a
// single draw call, same reasoning as BoundlessChunk's per-cellType merge.
// "water" (see ISLAND_NON_LAND_TILES in MeshConfig.ts) is never meshed as land
// at all — those cells are simply gaps in the island geometry, and the single
// global water plane built here (sized off the BASE layer only) shows through
// them, exactly like clog's static floor plane sitting under/around every
// chunk's island.
//
// Entirely optional and additive: nothing else in pizza depends on this file.
// TileMap's existing flat-quad ground paint (TileMap.ts's own meshes) keeps
// working whether or not a caller also builds island geometry on top of it —
// call build() from WorldManager.buildGround() (or wherever) when ready to turn
// it on; until then this file just sits unused, same as MeshConfig.ts's
// ISLAND_TILE_DEFS/WaterMaterial.ts/IslandStorage.ts already did before this.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ClusterMeshBuilder } from '../builders/ClusterMeshBuilder';
import { createWaterMaterial } from '../builders/WaterMaterial';
import { BendService } from '../services/BendService';
import TileMap, { GroundCell } from './TileMap';
import { GROUND_LAYER_Y_STEP } from './TileMapConfig';
import {
    ISLAND_DEFAULT_TILE,
    ISLAND_NON_LAND_TILES,
    ISLAND_TILE_DEFS,
    ROOM_GEOMETRY,
    TileConfig,
} from './MeshConfig';
import { deriveWaterTones, parseHexColor } from './IslandStorage';
import ZoneVisibilityManager from './ZoneVisibilityManager';

/** Margin (world units) added around the painted cells' bounding box when sizing the water plane, so the shoreline never runs right up against the plane's own edge. */
const WATER_MARGIN = 20;
/** Map key standing in for "this cell carries no zone at all" — see build()'s zone-partitioning branch. Distinct from any real zone number (which are always >= 0, see TileMapConfig.buildZoneTileCells()'s own doc). */
const NO_ZONE = -1;
/** Fallback water base color (map/tiles.json's "water" ground normally supplies this — see build()) if the map has no water tile at all. */
const FALLBACK_WATER_COLOR = 0x3a8dff;

function resolveTileConfig(name: string): TileConfig {
    return ISLAND_TILE_DEFS[name] ?? ISLAND_DEFAULT_TILE;
}

export default class IslandMeshBuilder {
    private readonly meshes: THREE.Mesh[] = [];
    private waterMesh?: THREE.Mesh;

    public constructor(private readonly threeScene: THREE.Scene) { }

    /**
     * Reads tileMap.getGroundCellLayers() (call after tileMap.build()) and, for EACH matched
     * layer independently, builds one merged mesh per land tile name — lifted
     * `layerIndex * GROUND_LAYER_Y_STEP` above the base, same offset TileMap's own flat paint
     * uses, so a decorative overlay layer's blobs sit visibly above the base layer's rather
     * than z-fighting/merging with them. The water plane is only ever built once, sized and
     * colored off the BASE layer (layerIndex 0) — water is a base-terrain feature, not
     * something an overlay decoration layer should redefine.
     *
     * `zoneVisibility`, when passed (FOG_OF_WAR_CONFIG.style === HideEntities — see
     * WorldManager.buildGround()), further partitions each tile name's cells by zone number
     * BEFORE flood-filling — a merged blob never straddles a zone boundary, since two cells
     * on opposite sides of one couldn't otherwise be shown/hidden independently — and
     * registers each resulting mesh with it so its visibility tracks that zone's reveal
     * state. Left undefined (solution 1 — FogOfWarManager's own opaque boxes handle hiding
     * instead), every land tile name merges into a single mesh same as before this existed.
     */
    public build(tileMap: TileMap, zoneVisibility?: ZoneVisibilityManager): void {
        const layers = tileMap.getGroundCellLayers();
        const worldUnitsPerTile = tileMap.getWorldUnitsPerTile();

        layers.forEach((cells, layerIndex) => {
            if (cells.length === 0) {
                return;
            }

            const byName = new Map<string, GroundCell[]>();
            let waterColorHex: string | undefined;

            for (const cell of cells) {
                if (ISLAND_NON_LAND_TILES.has(cell.def.name)) {
                    waterColorHex ??= cell.def.color;
                    continue;
                }
                let bucket = byName.get(cell.def.name);
                if (!bucket) {
                    bucket = [];
                    byName.set(cell.def.name, bucket);
                }
                bucket.push(cell);
            }

            const layerYOffset = layerIndex * GROUND_LAYER_Y_STEP;
            for (const [name, namedCells] of byName) {
                if (!zoneVisibility) {
                    this.buildTileGroup(name, namedCells, worldUnitsPerTile, layerYOffset);
                    continue;
                }

                const byZone = new Map<number, GroundCell[]>();
                for (const cell of namedCells) {
                    const zoneNumber = zoneVisibility.getZoneForCell(cell.col, cell.row) ?? NO_ZONE;
                    let bucket = byZone.get(zoneNumber);
                    if (!bucket) {
                        bucket = [];
                        byZone.set(zoneNumber, bucket);
                    }
                    bucket.push(cell);
                }
                for (const [zoneNumber, zoneCells] of byZone) {
                    const mesh = this.buildTileGroup(name, zoneCells, worldUnitsPerTile, layerYOffset);
                    if (mesh) {
                        zoneVisibility.registerWithZones(mesh, zoneNumber === NO_ZONE ? [] : [zoneNumber]);
                    }
                }
            }

            if (layerIndex === 0) {
                this.buildWater(cells, worldUnitsPerTile, waterColorHex);
            }
        });
    }

    /** Tears down every mesh this instance built — call from whatever owns build() (e.g. WorldManager.destroy()). */
    public destroy(): void {
        for (const mesh of this.meshes) {
            this.threeScene.remove(mesh);
            mesh.geometry.dispose();
        }
        this.meshes.length = 0;

        if (this.waterMesh) {
            this.threeScene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
            (this.waterMesh.material as THREE.Material).dispose();
            this.waterMesh = undefined;
        }
    }

    /** Flood-fills every connected blob of `name`'s cells, builds each blob's geometry, and merges them all into one mesh — mirrors BoundlessChunk.buildTileGroup(), minus the RoomGrid dependency (a plain col/row Set stands in for it here). `yOffset` lifts the WHOLE merged mesh (on top of each tile's own cfg.height/depthBelow) — see build()'s own doc on why an overlay layer's blobs sit above the base layer's instead of merging into them. Returns the built mesh (undefined if `namedCells` was empty) — see build()'s zone-partitioning branch, the one caller that needs it to register with ZoneVisibilityManager. */
    private buildTileGroup(name: string, namedCells: GroundCell[], worldUnitsPerTile: number, yOffset: number): THREE.Mesh | undefined {
        const cfg = resolveTileConfig(name);
        const cellSet = new Set(namedCells.map(({ col, row }) => `${col},${row}`));
        const byKey = new Map(namedCells.map(c => [`${c.col},${c.row}`, c]));
        const visited = new Set<string>();
        const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const geometries: THREE.BufferGeometry[] = [];

        for (const startKey of cellSet) {
            if (visited.has(startKey)) {
                continue;
            }
            const start = byKey.get(startKey)!;
            const queue: [number, number][] = [[start.col, start.row]];
            visited.add(startKey);
            const blob: [number, number][] = [];

            while (queue.length > 0) {
                const [col, row] = queue.shift()!;
                blob.push([col, row]);
                for (const [dc, dr] of dirs) {
                    const nc = col + dc, nr = row + dr;
                    const nKey = `${nc},${nr}`;
                    if (visited.has(nKey) || !cellSet.has(nKey)) {
                        continue;
                    }
                    visited.add(nKey);
                    queue.push([nc, nr]);
                }
            }

            const geo = cfg.radius && cfg.radius > 0
                ? ClusterMeshBuilder.roundEdges(blob, worldUnitsPerTile, cfg.height, cfg.depthBelow ?? 0, 0, 0, cfg.radius)
                : ClusterMeshBuilder.buildGeometry(blob, worldUnitsPerTile, cfg.height, cfg.depthBelow ?? 0, 0, 0);
            geometries.push(geo);
        }

        if (geometries.length === 0) {
            return undefined;
        }

        let merged: THREE.BufferGeometry;
        if (geometries.length > 1) {
            merged = mergeGeometries(geometries, false);
            for (const g of geometries) {
                g.dispose();
            }
        } else {
            merged = geometries[0];
        }

        // Colors from the tile's own map/tiles.json entry — one registry for tile
        // color (see MeshConfig.ts's own doc), not a second copy here.
        const color = namedCells[0].def.color;
        const material = new THREE.MeshStandardMaterial({
            color,
            roughness: cfg.roughness ?? 0.9,
            transparent: (cfg.opacity ?? 1) < 1 || cfg.fadeTo !== undefined,
            opacity: cfg.opacity ?? 1,
        });
        BendService.applyBend(material);
        if (cfg.fadeTo !== undefined) {
            BendService.applyBottomFade(material, cfg.fadeFrom ?? 0, cfg.fadeTo);
        }

        const mesh = new THREE.Mesh(merged, material);
        mesh.position.y = yOffset;
        mesh.frustumCulled = false;
        this.threeScene.add(mesh);
        this.meshes.push(mesh);
        return mesh;
    }

    /** One big plane under/around every painted cell, sized to the ground layer's actual bounding box rather than a hardcoded world size — an infinite Tiled map has no fixed extent (see TileMapConfig.ts's own doc on why tile coords are never centered), so this is computed from whatever's actually painted. */
    private buildWater(cells: readonly GroundCell[], worldUnitsPerTile: number, waterColorHex: string | undefined): void {
        let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
        for (const { col, row } of cells) {
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
        }

        const width = (maxCol - minCol + 1) * worldUnitsPerTile + WATER_MARGIN * 2;
        const depth = (maxRow - minRow + 1) * worldUnitsPerTile + WATER_MARGIN * 2;
        const centerX = ((minCol + maxCol + 1) / 2) * worldUnitsPerTile;
        const centerZ = ((minRow + maxRow + 1) / 2) * worldUnitsPerTile;

        const baseColor = waterColorHex ? parseHexColor(waterColorHex) : FALLBACK_WATER_COLOR;
        const material = createWaterMaterial(ROOM_GEOMETRY.floor.opacity, ROOM_GEOMETRY.floor.elevation, deriveWaterTones(baseColor));

        const geometry = new THREE.PlaneGeometry(width, depth, 64, 64);
        geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(centerX, 0, centerZ);
        mesh.frustumCulled = false;
        mesh.onBeforeRender = () => {
            material.uniforms.time.value = performance.now() / 1000;
        };

        this.threeScene.add(mesh);
        this.waterMesh = mesh;
    }
}
