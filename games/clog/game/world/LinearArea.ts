import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { FloorBuilder } from '../builders/FloorBuilder';
import type { AreaConfig } from './AreaConfig';

// ── Constants ────────────────────────────────────────────────────────────────

const SLAB_DEPTH  = 3.5;
const WALL_H      = 3.5;
const WALL_D      = 1.2;
const GATE_W      = 6.0;
const WALL_COLOR  = 0x1e2d3d;
const LOCKED_BG   = '#aa2222';
const LOCKED_BD   = '#ff5555';
const OPEN_BG     = '#22aa55';
const OPEN_BD     = '#55ff99';
const PERM_BG     = '#111111';
const PERM_BD     = '#444444';
// Invisible edge-wall thickness — just enough for pushOut to resolve.
const EDGE_W      = 0.8;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pushOut(
    pos: THREE.Vector3,
    radius: number,
    minX: number, maxX: number,
    minZ: number, maxZ: number,
): void {
    const cx = Math.max(minX, Math.min(pos.x, maxX));
    const cz = Math.max(minZ, Math.min(pos.z, maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 === 0 || d2 >= radius * radius) return;
    const d  = Math.sqrt(d2);
    const push = (radius - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
}

function makeGateTexture(value: number, open: boolean, permanent = false): THREE.CanvasTexture {
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
        ctx.fillStyle = open ? OPEN_BG : LOCKED_BG;
        ctx.fillRect(0, 0, px, px);
        ctx.strokeStyle = open ? OPEN_BD : LOCKED_BD;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, px - 10, px - 10);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 110px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(value), px / 2, px / 2);
    }
    return new THREE.CanvasTexture(canvas);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WallBox { minX: number; maxX: number; minZ: number; maxZ: number; }

interface GateEntry {
    minX: number; maxX: number;
    minZ: number; maxZ: number;
    mesh: THREE.Mesh;
    lockedTex: THREE.CanvasTexture;
    openTex: THREE.CanvasTexture;
    permTex: THREE.CanvasTexture;
    isOpen: boolean;
    permanentlyLocked: boolean;
}

// ── LinearArea ────────────────────────────────────────────────────────────────

/**
 * A single room in the linear layout.
 * - Floor is a thick slab (BoxGeometry) so the edges have visible depth.
 * - Only the North side has a gate; S/E/W edges are open abyss but block the
 *   player via invisible AABB constraints.
 */
export class LinearArea {
    readonly config: AreaConfig;
    readonly centerX: number;
    readonly centerZ: number;

    private solidWalls: WallBox[] = [];
    private gate: GateEntry | null = null;
    private extraMaterials: THREE.Material[] = [];
    private sceneMeshes: THREE.Mesh[] = [];

    constructor(
        config: AreaConfig,
        centerX: number,
        centerZ: number,
        scene: THREE.Scene,
    ) {
        this.config  = config;
        this.centerX = centerX;
        this.centerZ = centerZ;

        const s  = config.size / 2;
        const g  = GATE_W / 2;
        const cx = centerX;
        const cz = centerZ;

        // Slab floor (BoxGeometry — top at y=0, sides visible below)
        this.buildSlab(scene, config.size, cx, cz);

        // Forward (south = -Z = "up on screen") wall flanks + gate.
        // Flanks are nearly transparent so the player can see the next area.
        this.wall(scene, cx - (s + g) / 2, cz - s, s - g, WALL_D, 0.18);
        this.wall(scene, cx + (s + g) / 2, cz - s, s - g, WALL_D, 0.18);

        if (config.gateValue > 0) {
            this.buildGate(scene, cx, cz - s, GATE_W, WALL_D, config.gateValue);
        }

        // Invisible N/E/W abyss edges — no meshes, just AABB pushback.
        // South is open (gate side); north is the "back" abyss wall.
        this.solidWalls.push({ minX: cx - s, maxX: cx + s, minZ: cz + s, maxZ: cz + s + EDGE_W }); // N back
        this.solidWalls.push({ minX: cx + s, maxX: cx + s + EDGE_W, minZ: cz - s, maxZ: cz + s }); // E
        this.solidWalls.push({ minX: cx - s - EDGE_W, maxX: cx - s, minZ: cz - s, maxZ: cz + s }); // W
    }

    resolveCollisions(
        playerPos: THREE.Vector3,
        playerRadius: number,
        playerValue: number,
    ): void {
        for (const w of this.solidWalls) {
            pushOut(playerPos, playerRadius, w.minX, w.maxX, w.minZ, w.maxZ);
        }

        const g = this.gate;
        if (g && !g.permanentlyLocked) {
            const shouldBeOpen = playerValue >= this.config.gateValue;
            if (shouldBeOpen !== g.isOpen) {
                g.isOpen = shouldBeOpen;
                const mat = g.mesh.material as THREE.MeshStandardMaterial;
                mat.map = g.isOpen ? g.openTex : g.lockedTex;
                mat.emissive.set(g.isOpen ? OPEN_BD : LOCKED_BD);
                mat.needsUpdate = true;
            }
            if (!shouldBeOpen) {
                pushOut(playerPos, playerRadius, g.minX, g.maxX, g.minZ, g.maxZ);
            }
        }
    }

    /** Permanently seal the forward (south) gate after the player passes through. */
    lockForwardGate(): void {
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

    destroy(scene: THREE.Scene): void {
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
        this.solidWalls = [];
    }

    // ── Builders ──────────────────────────────────────────────────────────────

    private buildSlab(scene: THREE.Scene, size: number, cx: number, cz: number): void {
        const topMat = new THREE.MeshStandardMaterial({
            map: FloorBuilder.makeGridTexture(size),
            roughness: 0.8,
        });
        const sideMat = new THREE.MeshStandardMaterial({
            color: 0x0d1020,
            roughness: 0.95,
        });
        BendService.applyBend(topMat);
        BendService.applyBend(sideMat);
        this.extraMaterials.push(topMat, sideMat);

        const geo  = new THREE.BoxGeometry(size, SLAB_DEPTH, size, 32, 2, 32);
        // BoxGeometry face group order: +X, -X, +Y (top), -Y (bottom), +Z, -Z
        const mesh = new THREE.Mesh(geo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
        mesh.position.set(cx, -SLAB_DEPTH / 2, cz);
        scene.add(mesh);
        this.sceneMeshes.push(mesh);
    }

    private wall(
        scene: THREE.Scene,
        cx: number, cz: number,
        sizeX: number, sizeZ: number,
        opacity = 1,
    ): void {
        const segX = Math.max(1, Math.round(sizeX / 2));
        const segZ = Math.max(1, Math.round(sizeZ / 2));
        const geo  = new THREE.BoxGeometry(sizeX, WALL_H, sizeZ, segX, 2, segZ);
        const mat  = new THREE.MeshStandardMaterial({
            color: WALL_COLOR,
            roughness: 0.9,
            transparent: opacity < 1,
            opacity,
        });
        BendService.applyBend(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, WALL_H / 2, cz);
        scene.add(mesh);
        this.sceneMeshes.push(mesh);
        this.solidWalls.push({
            minX: cx - sizeX / 2, maxX: cx + sizeX / 2,
            minZ: cz - sizeZ / 2, maxZ: cz + sizeZ / 2,
        });
    }

    private buildGate(
        scene: THREE.Scene,
        cx: number, cz: number,
        sizeX: number, sizeZ: number,
        value: number,
    ): void {
        const lockedTex = makeGateTexture(value, false);
        const openTex   = makeGateTexture(value, true);
        const permTex   = makeGateTexture(value, false, true);

        const segX = Math.max(1, Math.round(sizeX / 2));
        const segZ = Math.max(1, Math.round(sizeZ / 2));
        const geo  = new THREE.BoxGeometry(sizeX, WALL_H, sizeZ, segX, 2, segZ);
        const mat  = new THREE.MeshStandardMaterial({
            map: lockedTex,
            emissive: new THREE.Color(LOCKED_BD),
            emissiveIntensity: 0.2,
            transparent: true,
            opacity: 0.45,
            roughness: 0.5,
        });
        BendService.applyBend(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, WALL_H / 2, cz);
        scene.add(mesh);
        this.sceneMeshes.push(mesh);

        this.gate = {
            minX: cx - sizeX / 2, maxX: cx + sizeX / 2,
            minZ: cz - sizeZ / 2, maxZ: cz + sizeZ / 2,
            mesh, lockedTex, openTex, permTex,
            isOpen: false, permanentlyLocked: false,
        };
    }
}
