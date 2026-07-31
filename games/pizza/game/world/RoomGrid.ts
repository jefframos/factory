import * as THREE from 'three';

// ── Cell types ────────────────────────────────────────────────────────────────
export const CELL_FREE     = 0;
export const CELL_WALL     = 1;
export const CELL_OBSTACLE = 2;
/** Boundless-mode island base terrain — distinct from CELL_WALL, which is the linear/gated mode's dungeon wall tile. */
export const CELL_TERRAIN  = 3;
/** Any non-negative integer — 0 is free, anything else is blocked. */
export type CellType = number;

// ── Collision helper ──────────────────────────────────────────────────────────
function pushOutCell(
    pos: THREE.Vector3,
    radius: number,
    minX: number, maxX: number,
    minZ: number, maxZ: number,
): void {
    const nearX = Math.max(minX, Math.min(pos.x, maxX));
    const nearZ = Math.max(minZ, Math.min(pos.z, maxZ));
    const dx = pos.x - nearX;
    const dz = pos.z - nearZ;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return;

    if (d2 > 0) {
        const d = Math.sqrt(d2);
        pos.x += dx * (radius - d) / d;
        pos.z += dz * (radius - d) / d;
        return;
    }

    const toLeft  = pos.x - minX;
    const toRight = maxX - pos.x;
    const toBack  = pos.z - minZ;
    const toFront = maxZ - pos.z;
    const min = Math.min(toLeft, toRight, toBack, toFront);
    if      (min === toLeft)  pos.x = minX - radius;
    else if (min === toRight) pos.x = maxX + radius;
    else if (min === toBack)  pos.z = minZ - radius;
    else                      pos.z = maxZ + radius;
}

// ── RoomGrid ──────────────────────────────────────────────────────────────────

/**
 * 2D (XZ) grid for a single room.
 *
 * Row 0   = south edge (gate side — direction the player moves)
 * Row N-1 = north edge (entrance side)
 * Col 0   = west edge,  Col M-1 = east edge
 *
 * Cell value 0 = free (walkable). Any other value = blocked (tile type).
 * Tile rendering properties are defined in TILE_DEFS (LinearConfig).
 */
export class RoomGrid {
    readonly cellSize: number;
    readonly cols: number;
    readonly rows: number;
    readonly originX: number;
    readonly originZ: number;

    private readonly cells: Uint8Array;
    private freeCellsCache: { x: number; z: number }[] | null = null;

    /**
     * @param cols     Number of columns (X axis).
     * @param rows     Number of rows    (Z axis).
     * @param centerX  World X of grid centre.
     * @param centerZ  World Z of grid centre.
     * @param cellSize World-unit size of each cell (default 1).
     */
    constructor(cols: number, rows: number, centerX: number, centerZ: number, cellSize = 1) {
        this.cellSize = cellSize;
        this.cols     = cols;
        this.rows     = rows;
        this.originX  = centerX - (cols * cellSize) / 2;
        this.originZ  = centerZ - (rows * cellSize) / 2;
        this.cells    = new Uint8Array(cols * rows);
    }

    /**
     * Build a grid directly from a string layout.
     * Each character is a decimal tile id: '0' = free, '1' = wall, '2' = obstacle, etc.
     *
     * Example:
     *   RoomGrid.fromPattern([
     *     "111111111",
     *     "100000001",
     *     "100000001",
     *     "111001111",
     *   ], 1, 0, 0)
     */
    static fromPattern(layout: string[], cellSize = 1, centerX = 0, centerZ = 0): RoomGrid {
        const rows = layout.length;
        const cols = layout[0]?.length ?? 0;
        const grid = new RoomGrid(cols, rows, centerX, centerZ, cellSize);
        for (let row = 0; row < rows; row++) {
            const line = layout[row];
            for (let col = 0; col < cols; col++) {
                const v = parseInt(line[col] ?? '0', 10);
                if (!isNaN(v) && v !== 0) grid.set(col, row, v);
            }
        }
        return grid;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private idx(col: number, row: number): number {
        return row * this.cols + col;
    }

    // ── Bounds ────────────────────────────────────────────────────────────────

    inBounds(col: number, row: number): boolean {
        return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
    }

    // ── Cell access ───────────────────────────────────────────────────────────

    get(col: number, row: number): CellType {
        if (!this.inBounds(col, row)) return CELL_WALL;
        return this.cells[this.idx(col, row)];
    }

    set(col: number, row: number, type: CellType): void {
        if (!this.inBounds(col, row)) return;
        this.cells[this.idx(col, row)] = type;
        this.freeCellsCache = null;
    }

    isBlocked(col: number, row: number): boolean {
        return this.get(col, row) !== CELL_FREE;
    }

    // ── World ↔ grid ──────────────────────────────────────────────────────────

    worldToCell(x: number, z: number): { col: number; row: number } {
        return {
            col: Math.floor((x - this.originX) / this.cellSize),
            row: Math.floor((z - this.originZ) / this.cellSize),
        };
    }

    cellCenter(col: number, row: number): { x: number; z: number } {
        return {
            x: this.originX + (col + 0.5) * this.cellSize,
            z: this.originZ + (row + 0.5) * this.cellSize,
        };
    }

    // ── Setup helpers ─────────────────────────────────────────────────────────

    /** Fill `thickness` rows/columns on every edge with CELL_WALL. */
    fillBorderThick(thickness: number): void {
        for (let col = 0; col < this.cols; col++) {
            for (let t = 0; t < thickness; t++) {
                this.set(col, t,                    CELL_WALL);
                this.set(col, this.rows - 1 - t,    CELL_WALL);
            }
        }
        for (let row = thickness; row < this.rows - thickness; row++) {
            for (let t = 0; t < thickness; t++) {
                this.set(t,                    row, CELL_WALL);
                this.set(this.cols - 1 - t,   row, CELL_WALL);
            }
        }
        this.freeCellsCache = null;
    }

    /**
     * Cut a centred gap of `gapWorld` world-units wide through a single border row.
     * Call for each row in the border thickness to punch through a multi-cell wall.
     */
    openRow(row: number, gapWorld: number): void {
        const centerCol = Math.floor(this.cols / 2);
        const halfGap   = Math.round(gapWorld / this.cellSize / 2);
        for (let col = centerCol - halfGap; col < centerCol + halfGap; col++) {
            this.set(col, row, CELL_FREE);
        }
        this.freeCellsCache = null;
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /** All free cells as world-space cell-centre positions. Cached after first call. */
    getFreeCells(): { x: number; z: number }[] {
        if (this.freeCellsCache) return this.freeCellsCache;
        const out: { x: number; z: number }[] = [];
        for (let row = 1; row < this.rows - 1; row++) {
            for (let col = 1; col < this.cols - 1; col++) {
                if (this.get(col, row) === CELL_FREE) {
                    out.push(this.cellCenter(col, row));
                }
            }
        }
        this.freeCellsCache = out;
        return out;
    }

    // ── Debug ─────────────────────────────────────────────────────────────────

    /** Returns the grid as a multi-line string, one row per line. 0=free, 1=wall, 2=obstacle, … */
    toLogString(): string {
        const lines: string[] = [];
        for (let row = 0; row < this.rows; row++) {
            let line = '';
            for (let col = 0; col < this.cols; col++) {
                line += this.get(col, row);
            }
            lines.push(line);
        }
        return lines.join('\n');
    }

    // ── Collision ─────────────────────────────────────────────────────────────

    resolveCollision(pos: THREE.Vector3, radius: number): void {
        const { col: cc, row: cr } = this.worldToCell(pos.x, pos.z);
        const reach = Math.ceil(radius / this.cellSize) + 1;
        for (let row = cr - reach; row <= cr + reach; row++) {
            for (let col = cc - reach; col <= cc + reach; col++) {
                if (!this.inBounds(col, row)) continue;
                if (!this.isBlocked(col, row)) continue;
                pushOutCell(
                    pos, radius,
                    this.originX +  col      * this.cellSize,
                    this.originX + (col + 1) * this.cellSize,
                    this.originZ +  row      * this.cellSize,
                    this.originZ + (row + 1) * this.cellSize,
                );
            }
        }
    }
}
