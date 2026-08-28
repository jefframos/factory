// FarmGrid.ts
//
// A farm plot (see FarmTypes.ts's own doc) is drawn on the Tiled map as one
// rect, but it isn't ONE giant patch — it's an AREA that covers some number
// of the map's own ground tiles, and each of those tiles is its own
// independent croppable cell (its own collider, its own future crop state).
// This file is the pure geometry step in between: turning a plot's raw
// Tiled footprint (width/depth, world units) into the list of individual
// tile cells it actually covers, each sized exactly WORLD_UNITS_PER_TILE —
// the SAME tile size the ground itself uses (TileMapConfig.ts), not some
// per-plot custom size, so a plot's grid always lines up with the tiles
// underneath it.
//
// FarmZone.ts (pre-purchase) and PizzaScene.spawnFarmGrid() (post-purchase,
// one FarmPlotTile per cell — see that file's own doc) both build their own
// per-cell meshes/colliders off this SAME cell list, so the "for sale"
// empty-tile preview and the real purchased grid always agree on layout.

import { WORLD_UNITS_PER_TILE } from './TileMapConfig';

export const FARM_GRID_CELL_SIZE = WORLD_UNITS_PER_TILE;

/** Seconds between each grid cell's own pop-in tween starting — see FarmPlotTile.ts's own doc/PizzaScene.spawnFarmGrid(), the one caller. */
export const FARM_GRID_APPEAR_STAGGER_SEC = 0.05;

export interface FarmGridCell {
    col: number;
    row: number;
    /** Offset from the plot's own center (its Entity's transform.position) — X/Z only, ground level. */
    localX: number;
    localZ: number;
}

/**
 * `floor(footprint / tileSize)` rounded to the nearest whole tile (a plot is always drawn as a
 * whole number of tiles in practice; rounding just tolerates a Tiled rect a few pixels off from
 * an exact multiple), clamped to at least 1x1 — a plot narrower than one tile still gets a
 * single cell rather than zero. Cells are returned row-major, centered so the FULL grid spans
 * exactly `cols * FARM_GRID_CELL_SIZE` by `rows * FARM_GRID_CELL_SIZE`, itself centered on the
 * plot's own local origin (0, 0) — matching how every other zone's own footprint is centered on
 * its entity's transform.position.
 */
export function computeFarmGrid(width: number, depth: number): FarmGridCell[] {
    const cols = Math.max(1, Math.round(width / FARM_GRID_CELL_SIZE));
    const rows = Math.max(1, Math.round(depth / FARM_GRID_CELL_SIZE));

    const gridWidth = cols * FARM_GRID_CELL_SIZE;
    const gridDepth = rows * FARM_GRID_CELL_SIZE;

    const cells: FarmGridCell[] = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            cells.push({
                col,
                row,
                localX: -gridWidth / 2 + FARM_GRID_CELL_SIZE / 2 + col * FARM_GRID_CELL_SIZE,
                localZ: -gridDepth / 2 + FARM_GRID_CELL_SIZE / 2 + row * FARM_GRID_CELL_SIZE,
            });
        }
    }
    return cells;
}
