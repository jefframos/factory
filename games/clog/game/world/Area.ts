import * as THREE from "three";
import { BendService } from "../services/BendService";
import { FloorBuilder } from "../builders/FloorBuilder";
import type { AreaConfig } from "./AreaConfig";

// ── Constants ────────────────────────────────────────────────────────────────
const WALL_H   = 3.5;
const WALL_D   = 1.2;
const GATE_W   = 6.0;
const WALL_COLOR = 0x1e2d3d;
const LOCKED_BG  = "#aa2222";
const LOCKED_BD  = "#ff5555";
const OPEN_BG    = "#22aa55";
const OPEN_BD    = "#55ff99";
const PERM_BG    = "#111111";
const PERM_BD    = "#444444";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Push a circle (player) out of an axis-aligned box in XZ. */
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
    const d = Math.sqrt(d2);
    const push = (radius - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
}

function makeGateTexture(value: number, open: boolean, permanent = false): THREE.CanvasTexture {
    const px = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d")!;

    if (permanent) {
        ctx.fillStyle = PERM_BG;
        ctx.fillRect(0, 0, px, px);
        ctx.strokeStyle = PERM_BD;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, px - 10, px - 10);
        // Draw an X
        ctx.strokeStyle = "#555555";
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
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 110px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(value), px / 2, px / 2);
    }

    return new THREE.CanvasTexture(canvas);
}

// ── Types ────────────────────────────────────────────────────────────────────

export type CardinalDir = 'N' | 'S' | 'E' | 'W';

interface WallBox { minX: number; maxX: number; minZ: number; maxZ: number; }

interface GateEntry {
    minX: number; maxX: number;
    minZ: number; maxZ: number;
    mesh: THREE.Mesh;
    lockedTex: THREE.CanvasTexture;
    openTex: THREE.CanvasTexture;
    permTex: THREE.CanvasTexture;
    isOpen: boolean;
    direction: CardinalDir;
    permanentlyLocked: boolean;
}

// ── Area class ───────────────────────────────────────────────────────────────

export class Area {
    readonly config: AreaConfig;
    readonly centerX: number;
    readonly centerZ: number;

    private solidWalls: WallBox[] = [];
    private gates: GateEntry[] = [];

    constructor(
        config: AreaConfig,
        centerX: number,
        centerZ: number,
        scene: THREE.Scene,
    ) {
        this.config = config;
        this.centerX = centerX;
        this.centerZ = centerZ;

        const s = config.size / 2;
        const g = GATE_W / 2;
        const cx = centerX;
        const cz = centerZ;

        FloorBuilder.build(scene, config.size, cx, cz);

        // North (z = cz+s)
        this.wall(scene, cx - (s + g) / 2, cz + s, s - g, WALL_D);
        this.wall(scene, cx + (s + g) / 2, cz + s, s - g, WALL_D);
        this.gate(scene, cx, cz + s, GATE_W, WALL_D, config.gateValue, 'N');

        // South (z = cz-s)
        this.wall(scene, cx - (s + g) / 2, cz - s, s - g, WALL_D);
        this.wall(scene, cx + (s + g) / 2, cz - s, s - g, WALL_D);
        this.gate(scene, cx, cz - s, GATE_W, WALL_D, config.gateValue, 'S');

        // East (x = cx+s)
        this.wall(scene, cx + s, cz + (s + g) / 2, WALL_D, s - g);
        this.wall(scene, cx + s, cz - (s + g) / 2, WALL_D, s - g);
        this.gate(scene, cx + s, cz, WALL_D, GATE_W, config.gateValue, 'E');

        // West (x = cx-s)
        this.wall(scene, cx - s, cz + (s + g) / 2, WALL_D, s - g);
        this.wall(scene, cx - s, cz - (s + g) / 2, WALL_D, s - g);
        this.gate(scene, cx - s, cz, WALL_D, GATE_W, config.gateValue, 'W');
    }

    /**
     * Permanently close a gate so it always blocks regardless of player value.
     * Used to seal the entrance after the player advances to the next area.
     */
    lockGate(direction: CardinalDir): void {
        const g = this.gates.find(gate => gate.direction === direction);
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

    resolveCollisions(
        playerPos: THREE.Vector3,
        playerRadius: number,
        playerValue: number,
    ): void {
        for (const w of this.solidWalls) {
            pushOut(playerPos, playerRadius, w.minX, w.maxX, w.minZ, w.maxZ);
        }
        for (const g of this.gates) {
            if (g.permanentlyLocked) {
                pushOut(playerPos, playerRadius, g.minX, g.maxX, g.minZ, g.maxZ);
                continue;
            }
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

    // ── Builders ──────────────────────────────────────────────────────────

    private wall(
        scene: THREE.Scene,
        cx: number, cz: number,
        sizeX: number, sizeZ: number,
    ): void {
        // Subdivide so the radial bend deforms smoothly (~1 vertex per 2 world units).
        const segX = Math.max(1, Math.round(sizeX / 2));
        const segY = 2;
        const segZ = Math.max(1, Math.round(sizeZ / 2));
        const geo = new THREE.BoxGeometry(sizeX, WALL_H, sizeZ, segX, segY, segZ);
        const mat = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.9 });
        BendService.applyBend(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, WALL_H / 2, cz);
        scene.add(mesh);
        this.solidWalls.push({
            minX: cx - sizeX / 2, maxX: cx + sizeX / 2,
            minZ: cz - sizeZ / 2, maxZ: cz + sizeZ / 2,
        });
    }

    private gate(
        scene: THREE.Scene,
        cx: number, cz: number,
        sizeX: number, sizeZ: number,
        value: number,
        direction: CardinalDir,
    ): void {
        const lockedTex = makeGateTexture(value, false);
        const openTex   = makeGateTexture(value, true);
        const permTex   = makeGateTexture(value, false, true);

        const segX = Math.max(1, Math.round(sizeX / 2));
        const segZ = Math.max(1, Math.round(sizeZ / 2));
        const geo = new THREE.BoxGeometry(sizeX, WALL_H, sizeZ, segX, 2, segZ);
        const mat = new THREE.MeshStandardMaterial({
            map: lockedTex,
            emissive: new THREE.Color(LOCKED_BD),
            emissiveIntensity: 0.25,
            transparent: true,
            opacity: 0.88,
            roughness: 0.5,
        });
        BendService.applyBend(mat);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, WALL_H / 2, cz);
        scene.add(mesh);

        this.gates.push({
            minX: cx - sizeX / 2, maxX: cx + sizeX / 2,
            minZ: cz - sizeZ / 2, maxZ: cz + sizeZ / 2,
            mesh, lockedTex, openTex, permTex,
            isOpen: false, direction, permanentlyLocked: false,
        });
    }
}
