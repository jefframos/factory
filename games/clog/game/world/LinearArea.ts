import * as THREE from 'three';
import { ClusterMeshBuilder } from '../builders/ClusterMeshBuilder';
import { BendService } from '../services/BendService';
import { FloorBuilder } from '../builders/FloorBuilder';
import { colorForValue } from '../builders/CubeBuilder';
import { ROOM_GEOMETRY, GATE_MATERIAL_CONFIG, TILE_DEFS, type TileConfig, type ObstacleConfig } from './LinearConfig';
import { RoomGrid, CELL_WALL } from './RoomGrid';
import type { AreaConfig } from './AreaConfig';

const GATE_W = 6.0;
const BORDER = 2;    // auto-generated border thickness in grid cells
const DEBUG_MESH = new URLSearchParams(window.location.search).has('debugMesh');

const LOCKED_BG = GATE_MATERIAL_CONFIG.lockedColor;
const LOCKED_BD = GATE_MATERIAL_CONFIG.lockedBorder;
const PERM_BG = '#111111';
const PERM_BD = '#444444';

// ── Seeded value noise ────────────────────────────────────────────────────────
// Smooth, deterministic, output in [0, 1]. Used for obstacle placement.

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
// Fills in optional TileConfig defaults so renderers always get concrete values.

interface ResolvedTile {
    height: number;
    depthBelow: number;
    color: number;
    roughness: number;
    opacity: number;
    radius: number;
}

function resolveTile(t: TileConfig): ResolvedTile {
    return {
        height: t.height,
        color: t.color,
        opacity: t.opacity ?? 1.0,
        roughness: t.roughness ?? 0.9,
        depthBelow: t.depthBelow ?? (t.height >= 2 ? 30 : 0),
        radius: t.radius ?? 0,
    };
}

// ── Gate / entrance helpers ───────────────────────────────────────────────────

function pushOut(
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
    const toLeft = pos.x - minX;
    const toRight = maxX - pos.x;
    const toBack = pos.z - minZ;
    const toFront = maxZ - pos.z;
    const min = Math.min(toLeft, toRight, toBack, toFront);
    if (min === toLeft) pos.x = minX - radius;
    else if (min === toRight) pos.x = maxX + radius;
    else if (min === toBack) pos.z = minZ - radius;
    else pos.z = maxZ + radius;
}

function makeGateTexture(
    value: number,
    open: boolean,
    permanent = false,
    openColor = '#22aa55',
): THREE.CanvasTexture {
    const px = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d')!;

    if (permanent) {
        ctx.fillStyle = PERM_BG;
        ctx.fillRect(0, 0, px, px);
        ctx.strokeStyle = PERM_BD;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, px - 10, px - 10);
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.moveTo(60, 60); ctx.lineTo(px - 60, px - 60);
        ctx.moveTo(px - 60, 60); ctx.lineTo(60, px - 60);
        ctx.stroke();
    } else {
        ctx.fillStyle = open ? openColor : LOCKED_BG;
        ctx.fillRect(0, 0, px, px);
        ctx.strokeStyle = open ? 'rgba(255,255,255,0.6)' : LOCKED_BD;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, px - 10, px - 10);
        const text = String(value);
        const fontSize = text.length <= 2 ? 110 : text.length <= 3 ? 88 : text.length <= 4 ? 68 : 52;
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.lineWidth = 18;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, px / 2, px / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, px / 2, px / 2);
    }
    return new THREE.CanvasTexture(canvas);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GateEntry {
    minX: number; maxX: number;
    minZ: number; maxZ: number;
    mesh: THREE.Mesh;
    lockedTex: THREE.CanvasTexture;
    openTex: THREE.CanvasTexture;
    permTex: THREE.CanvasTexture;
    openColor: string;
    isOpen: boolean;
    permanentlyLocked: boolean;
}

interface EntranceEntry {
    minX: number; maxX: number;
    minZ: number; maxZ: number;
    isLocked: boolean;
}

// ── LinearArea ────────────────────────────────────────────────────────────────

export class LinearArea {
    public readonly config: AreaConfig;
    public readonly centerX: number;
    public readonly centerZ: number;
    public readonly grid: RoomGrid;

    private scene: THREE.Scene;
    private gate: GateEntry | null = null;
    private entranceGate: EntranceEntry | null = null;
    private extraMaterials: THREE.Material[] = [];
    private sceneMeshes: THREE.Mesh[] = [];

    /**
     * @param roomIndex  0 = first room (solid back wall, no entrance).
     *                   >0 = has an entrance gap in the back wall matching GATE_W.
     */
    public constructor(
        config: AreaConfig,
        centerX: number,
        centerZ: number,
        scene: THREE.Scene,
        roomIndex = 0,
    ) {
        this.config = config;
        this.centerX = centerX;
        this.centerZ = centerZ;
        this.scene = scene;

        const g = GATE_W / 2;
        const cx = centerX;
        const cz = centerZ;

        // ── Grid ─────────────────────────────────────────────────────────────
        if (config.layout) {
            // Layout fully defines the grid — parse tile ids from the string array.
            this.grid = RoomGrid.fromPattern(config.layout, 1, cx, cz);
        } else {
            // Auto-generate: square grid with thick border and centred gate gap.
            const side = config.size;
            this.grid = new RoomGrid(side, side, cx, cz);
            this.grid.fillBorderThick(BORDER);
            for (let t = 0; t < BORDER; t++) this.grid.openRow(t, GATE_W);
            if (roomIndex > 0) {
                for (let t = 0; t < BORDER; t++) this.grid.openRow(this.grid.rows - 1 - t, GATE_W);
            }
            const obsCfg: ObstacleConfig = config.obstacles ?? { tileId: 2, scale: 0.05, threshold: 0.9, seed: roomIndex };
            if (obsCfg) this.placeObstacles(obsCfg);
        }

        const cs = this.grid.cellSize;
        const minZ = this.grid.originZ;
        const maxZ = this.grid.originZ + this.grid.rows * cs;

        // ── Slab ─────────────────────────────────────────────────────────────
        this.buildSlab(scene, config.size, cx, cz);

        // ── Wall meshes — one greedy-merge pass per tile type in TILE_DEFS ───
        for (const [key, tileCfg] of Object.entries(TILE_DEFS)) {
            this.buildGridWallMeshes(scene, Number(key), resolveTile(tileCfg));
        }

        // ── South gate — spans the full border thickness ──────────────────────
        if (config.gateValue > 0) {
            this.buildGate(scene, cx - g, cx + g, minZ, minZ + BORDER * cs, config.gateValue);
        }

        // ── Entrance gate (rooms 1+) ──────────────────────────────────────────
        if (roomIndex > 0) {
            this.buildEntranceGate(scene, cx - g, cx + g, maxZ - BORDER * cs, maxZ);
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    public resolveCollisions(
        playerPos: THREE.Vector3,
        playerRadius: number,
        playerValue: number,
    ): void {
        this.grid.resolveCollision(playerPos, playerRadius);

        const g = this.gate;
        if (g && !g.permanentlyLocked) {
            const shouldBeOpen = playerValue >= this.config.gateValue;
            if (shouldBeOpen !== g.isOpen) {
                g.isOpen = shouldBeOpen;
                const mat = g.mesh.material as THREE.MeshStandardMaterial;
                mat.map = g.isOpen ? g.openTex : g.lockedTex;
                mat.emissive.set(g.isOpen ? g.openColor : LOCKED_BD);
                mat.needsUpdate = true;
            }
            if (!shouldBeOpen) {
                pushOut(playerPos, playerRadius, g.minX, g.maxX, g.minZ, g.maxZ);
            }
        }

        const eg = this.entranceGate;
        if (eg?.isLocked) {
            pushOut(playerPos, playerRadius, eg.minX, eg.maxX, eg.minZ, eg.maxZ);
        }
    }

    public lockForwardGate(): void {
        const g = this.gate;
        if (!g || g.permanentlyLocked) return;
        g.permanentlyLocked = true;
        g.isOpen = false;
        const mat = g.mesh.material as THREE.MeshStandardMaterial;
        mat.map = g.permTex;
        mat.emissive.set(0x000000);
        mat.emissiveIntensity = 0;
        mat.opacity = 0.95;
        mat.needsUpdate = true;
    }

    public lockEntranceGate(): void {
        if (!this.entranceGate || this.entranceGate.isLocked) return;
        this.entranceGate.isLocked = true;
        const { minX, maxX, minZ, maxZ } = this.entranceGate;
        // Seal the gap with a wall mesh matching tile type 1.
        this.wallMesh(this.scene, minX, maxX, minZ, maxZ, resolveTile(TILE_DEFS[CELL_WALL] ?? TILE_DEFS[1]));
    }

    public destroy(scene: THREE.Scene): void {
        for (const m of this.sceneMeshes) {
            scene.remove(m);
            m.geometry.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) (mat as THREE.Material).dispose();
        }
        this.sceneMeshes = [];

        for (const mat of this.extraMaterials) mat.dispose();
        this.extraMaterials = [];

        if (this.gate) {
            this.gate.lockedTex.dispose();
            this.gate.openTex.dispose();
            this.gate.permTex.dispose();
            this.gate = null;
        }
    }

    // ── Builders ──────────────────────────────────────────────────────────────

    private buildSlab(scene: THREE.Scene, size: number, cx: number, cz: number): void {
        const { depth, sideColor, roughness } = ROOM_GEOMETRY.base;
        const topMat = new THREE.MeshStandardMaterial({ map: FloorBuilder.makeGridTexture(size), roughness: 0.8 });
        const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness });
        BendService.applyBend(topMat);
        BendService.applyBend(sideMat);
        this.extraMaterials.push(topMat, sideMat);

        const geo = new THREE.BoxGeometry(size, depth, size, 32, 2, 32);
        const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
        mesh.position.set(cx, -depth / 2, cz);
        mesh.frustumCulled = false;
        scene.add(mesh);
        this.sceneMeshes.push(mesh);
    }

    private wallMesh(
        scene: THREE.Scene,
        minX: number, maxX: number,
        minZ: number, maxZ: number,
        cfg: ResolvedTile,
    ): void {
        const sizeX = maxX - minX;
        const sizeZ = maxZ - minZ;
        if (sizeX <= 0 || sizeZ <= 0) return;

        const totalH = cfg.height + cfg.depthBelow;
        const segX = Math.max(1, Math.round(sizeX / 2));
        const segZ = Math.max(1, Math.round(sizeZ / 2));
        const geo = new THREE.BoxGeometry(sizeX, totalH, sizeZ, segX, 2, segZ);
        const mat = new THREE.MeshStandardMaterial({
            color: cfg.color,
            roughness: cfg.roughness,
            transparent: cfg.opacity < 1,
            opacity: cfg.opacity,
        });
        BendService.applyBend(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
            (minX + maxX) / 2,
            (cfg.height - cfg.depthBelow) / 2,
            (minZ + maxZ) / 2,
        );
        mesh.frustumCulled = false;
        scene.add(mesh);
        this.sceneMeshes.push(mesh);
    }

    /** Greedy-merge all cells of `cellType` into as few rectangular meshes as possible. */
    private buildGridWallMeshes(scene: THREE.Scene, cellType: number, cfg: ResolvedTile): void {
        const { cols, rows } = this.grid;
        const visited = new Uint8Array(cols * rows);

        if (cfg.radius > 0) {
            // Flood-fill path: BFS to find each connected island, then build one
            // voxel mesh per island via ClusterMeshBuilder (outer faces only,
            // quarter-cylinder bevels at convex outer edges).
            const cs = this.grid.cellSize;
            const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            let islandIdx = 0;

            for (let startRow = 0; startRow < rows; startRow++) {
                for (let startCol = 0; startCol < cols; startCol++) {
                    const si = startRow * cols + startCol;
                    if (visited[si] || this.grid.get(startCol, startRow) !== cellType) continue;

                    // BFS to collect the connected island
                    const queue: [number, number][] = [[startCol, startRow]];
                    visited[si] = 1;
                    const island: [number, number][] = [];

                    while (queue.length > 0) {
                        const [col, row] = queue.shift()!;
                        island.push([col, row]);
                        for (const [dc, dr] of dirs) {
                            const nc = col + dc, nr = row + dr;
                            if (!this.grid.inBounds(nc, nr)) continue;
                            const ni = nr * cols + nc;
                            if (visited[ni] || this.grid.get(nc, nr) !== cellType) continue;
                            visited[ni] = 1;
                            queue.push([nc, nr]);
                        }
                    }

                    if (DEBUG_MESH) {
                        const minC = Math.min(...island.map(([c]) => c));
                        const maxC = Math.max(...island.map(([c]) => c));
                        const minR = Math.min(...island.map(([, r]) => r));
                        const maxR2 = Math.max(...island.map(([, r]) => r));
                        const w = maxC - minC + 1, h = maxR2 - minR + 1;
                        const cells = Array.from({ length: h }, () => Array<string>(w).fill('.'));
                        for (const [c, r] of island) cells[r - minR][c - minC] = String(cellType);
                        const ascii = cells.map(row => '  ' + row.join('')).join('\n');
                        console.log(`[debugMesh tile=${cellType}] island #${islandIdx} — ${island.length} cells, cols ${minC}–${maxC}, rows ${minR}–${maxR2}\n${ascii}`);
                        islandIdx++;
                    }

                    const geo = ClusterMeshBuilder.roundAllEdges(
                        island,
                        cs,
                        cfg.height,
                        cfg.depthBelow,
                        this.grid.originX,
                        this.grid.originZ,
                        cfg.radius,
                        3,
                    );

                    const mat = new THREE.MeshStandardMaterial({
                        color: cfg.color,
                        roughness: cfg.roughness,
                        transparent: cfg.opacity < 1,
                        opacity: cfg.opacity,
                    });
                    BendService.applyBend(mat);
                    const mesh = new THREE.Mesh(geo, mat);
                    mesh.frustumCulled = false;
                    scene.add(mesh);
                    this.sceneMeshes.push(mesh);
                }
            }
            return;
        }

        // Greedy-merge path (radius === 0, used for walls with BendService tessellation)
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const i = row * cols + col;
                if (visited[i] || this.grid.get(col, row) !== cellType) continue;

                let endCol = col + 1;
                while (endCol < cols && this.grid.get(endCol, row) === cellType && !visited[row * cols + endCol]) {
                    endCol++;
                }

                let endRow = row + 1;
                while (endRow < rows) {
                    let ok = true;
                    for (let c = col; c < endCol; c++) {
                        if (this.grid.get(c, endRow) !== cellType || visited[endRow * cols + c]) { ok = false; break; }
                    }
                    if (!ok) break;
                    endRow++;
                }

                for (let r = row; r < endRow; r++) {
                    for (let c = col; c < endCol; c++) visited[r * cols + c] = 1;
                }

                const cs = this.grid.cellSize;
                this.wallMesh(
                    scene,
                    this.grid.originX + col * cs,
                    this.grid.originX + endCol * cs,
                    this.grid.originZ + row * cs,
                    this.grid.originZ + endRow * cs,
                    cfg,
                );
            }
        }
    }

    /**
     * Fill cells with cfg.tileId wherever seeded value noise exceeds cfg.threshold.
     * Adjacent cells that both pass form connected blobs organically — no stamps,
     * no fixed shapes.  Blob size is controlled by scale; sparsity by threshold.
     */
    private placeObstacles(cfg: ObstacleConfig): void {
        for (let row = BORDER; row < this.grid.rows - BORDER; row++) {
            for (let col = BORDER; col < this.grid.cols - BORDER; col++) {
                if (this.grid.isBlocked(col, row)) continue;
                if (valueNoise(col * cfg.scale, row * cfg.scale, cfg.seed) >= cfg.threshold) {
                    this.grid.set(col, row, cfg.tileId);
                }
            }
        }
    }

    private buildEntranceGate(
        scene: THREE.Scene,
        minX: number, maxX: number,
        minZ: number, maxZ: number,
    ): void {
        this.entranceGate = { minX, maxX, minZ, maxZ, isLocked: false };
        void scene;
    }

    private buildGate(
        scene: THREE.Scene,
        minX: number, maxX: number,
        minZ: number, maxZ: number,
        value: number,
    ): void {
        const sizeX = maxX - minX;
        const sizeZ = maxZ - minZ;
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;

        const openColor = colorForValue(value);
        const lockedTex = makeGateTexture(value, false);
        const openTex = makeGateTexture(value, true, false, openColor);
        const permTex = makeGateTexture(value, false, true);

        const wallH = ROOM_GEOMETRY.walls.height;
        const segX = Math.max(1, Math.round(sizeX / 2));
        const segZ = Math.max(1, Math.round(sizeZ / 2));
        const geo = new THREE.BoxGeometry(sizeX, wallH, sizeZ, segX, 2, segZ);
        const mat = new THREE.MeshStandardMaterial({
            map: lockedTex,
            emissive: new THREE.Color(LOCKED_BD),
            emissiveIntensity: GATE_MATERIAL_CONFIG.emissiveIntensity,
            transparent: true,
            opacity: GATE_MATERIAL_CONFIG.opacity,
            roughness: GATE_MATERIAL_CONFIG.roughness,
        });
        BendService.applyBend(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, wallH / 2, cz);
        mesh.frustumCulled = false;
        scene.add(mesh);
        this.sceneMeshes.push(mesh);

        this.gate = {
            minX, maxX, minZ, maxZ,
            mesh, lockedTex, openTex, permTex, openColor,
            isOpen: false, permanentlyLocked: false,
        };
    }
}
