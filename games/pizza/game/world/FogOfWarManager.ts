// FogOfWarManager.ts
//
// Owns the fog-of-war mesh — one InstancedMesh, one BOX per LAND ground cell (see build()'s
// own doc). Water is exempt from the fog system entirely, not tied to any zone — matching
// how "zones" is painted in Tiled: it only ever marks actual zone areas on land, so a water
// cell (or the open sea beyond the painted island, which has no groundLayer cell at all) has
// nothing to look up and is simply never given a fog box in the first place, rather than
// being built fogged and needing an explicit exemption. A LAND cell with no zone painted on
// it at all still has nowhere to belong, so it's built once and never revealed — the rest of
// the island stays permanently fogged until a real zone claims it. A cell that DOES carry a
// zone number (see TileMapConfig.buildZoneTileCells()) can be revealed later via
// revealZone(), which collapses that zone's own instances to zero scale (same trick
// TileMap.ts uses for a `transparent` ground tile).

import * as THREE from 'three';
import { createFogOfWarMaterial } from '../services/FogOfWarMaterial';
import { buildZoneTileCells, DEFAULT_TILE_MAP_ALIASES, tileCellToWorldPosition, WORLD_UNITS_PER_TILE, ZoneCell } from './TileMapConfig';
import { ISLAND_NON_LAND_TILES } from './MeshConfig';
import TileMap from './TileMap';

/** Fog box height (world units) — tall enough to read as a volume blocking the view, not a flat sheet. */
const FOG_BOX_HEIGHT = 3;
/** Box's own vertical center — base sits at world Y=0 same as the ground, top reaches FOG_BOX_HEIGHT. */
const FOG_Y_OFFSET = FOG_BOX_HEIGHT / 2;

function cellKey(col: number, row: number): string {
    return `${col},${row}`;
}

export default class FogOfWarManager {
    private readonly zoneCells: Map<number, ZoneCell[]>;
    private readonly revealedZones = new Set<number>();
    /** zoneNumber -> the instance indices (into `mesh`) that zone's cells occupy — index-aligned with the flattened cell order build() lays out. Cells with no zone at all are built but never added here, so they can never be revealed. */
    private readonly zoneInstanceIndices = new Map<number, number[]>();
    private mesh?: THREE.InstancedMesh;
    private material?: THREE.ShaderMaterial;

    public constructor(
        private readonly threeScene: THREE.Scene,
        private readonly worldUnitsPerTile: number = WORLD_UNITS_PER_TILE,
        mapAlias: string = DEFAULT_TILE_MAP_ALIASES.map,
    ) {
        this.zoneCells = buildZoneTileCells(mapAlias);
    }

    /**
     * Builds one fog box per LAND cell across every one of `tileMap`'s ground layers — a cell
     * is land if AT LEAST ONE layer paints something other than an ISLAND_NON_LAND_TILES name
     * on it (water) there; a cell that's water in every layer that touches it (or isn't
     * painted at all) never gets a box, so open sea is simply never part of the fog system.
     * A land cell that also carries a zone number (see TileMapConfig.buildZoneTileCells()) is
     * tracked so revealZone() can later collapse it; a land cell with no zone at all is built
     * once here and then permanently unreachable — nothing ever un-fogs it. Call once during
     * scene build, after tileMap.build() (this reads its already-parsed ground cells).
     */
    public build(tileMap: TileMap): void {
        const cellIsLand = new Map<string, boolean>();
        for (const layerCells of tileMap.getGroundCellLayers()) {
            for (const { col, row, def } of layerCells) {
                const key = cellKey(col, row);
                const landHere = !ISLAND_NON_LAND_TILES.has(def.name);
                cellIsLand.set(key, (cellIsLand.get(key) ?? false) || landHere);
            }
        }
        const landCellKeys = [...cellIsLand].filter(([, isLand]) => isLand).map(([key]) => key);
        if (landCellKeys.length === 0) {
            return;
        }

        const cellToZone = new Map<string, number>();
        for (const [zoneNumber, cells] of this.zoneCells) {
            for (const { col, row } of cells) {
                cellToZone.set(cellKey(col, row), zoneNumber);
            }
        }

        const geometry = new THREE.BoxGeometry(this.worldUnitsPerTile, FOG_BOX_HEIGHT, this.worldUnitsPerTile);
        this.material = createFogOfWarMaterial();

        const mesh = new THREE.InstancedMesh(geometry, this.material, landCellKeys.length);
        // Same reasoning as TileMap.ts's own ground mesh — InstancedMesh's default bounding
        // sphere comes from one instance near the origin, which would frustum-cull away every
        // other cell's fog box. One draw call regardless of cell count, so this costs nothing.
        mesh.frustumCulled = false;

        const matrix = new THREE.Matrix4();
        let instanceIndex = 0;
        for (const key of landCellKeys) {
            const [col, row] = key.split(',').map(Number);
            const { x, z } = tileCellToWorldPosition(col, row, this.worldUnitsPerTile);
            matrix.makeTranslation(x, FOG_Y_OFFSET, z);
            mesh.setMatrixAt(instanceIndex, matrix);

            const zoneNumber = cellToZone.get(key);
            if (zoneNumber !== undefined) {
                let indices = this.zoneInstanceIndices.get(zoneNumber);
                if (!indices) {
                    indices = [];
                    this.zoneInstanceIndices.set(zoneNumber, indices);
                }
                indices.push(instanceIndex);
            }

            instanceIndex++;
        }

        mesh.instanceMatrix.needsUpdate = true;
        this.threeScene.add(mesh);
        this.mesh = mesh;
    }

    /**
     * Marks every tile cell belonging to `zoneNumber` (0-based, see buildZoneTileCells()'s
     * own doc — "zone1" is zoneNumber 0) as revealed by collapsing its instances to zero scale
     * — same trick TileMap.ts uses for a `transparent` ground tile. No-op if that zone has no
     * painted cells (typo, or build() found no "zones" layer at all).
     */
    public revealZone(zoneNumber: number): void {
        if (this.revealedZones.has(zoneNumber) || !this.mesh) {
            return;
        }
        const indices = this.zoneInstanceIndices.get(zoneNumber);
        if (!indices) {
            return;
        }

        const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0);
        for (const index of indices) {
            this.mesh.setMatrixAt(index, zeroScale);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        this.revealedZones.add(zoneNumber);
    }

    public isZoneRevealed(zoneNumber: number): boolean {
        return this.revealedZones.has(zoneNumber);
    }

    /** Advances the cloud pattern's scroll — call every frame with the scene's delta seconds. */
    public update(delta: number): void {
        if (this.material) {
            this.material.uniforms.uTime.value += delta;
        }
    }

    public destroy(): void {
        if (this.mesh) {
            this.threeScene.remove(this.mesh);
            this.mesh.geometry.dispose();
        }
        this.material?.dispose();
    }
}
