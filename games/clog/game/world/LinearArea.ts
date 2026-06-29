import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { FloorBuilder } from '../builders/FloorBuilder';
import { colorForValue } from '../builders/CubeBuilder';
import { ROOM_GEOMETRY, GATE_MATERIAL_CONFIG } from './LinearConfig';
import type { AreaConfig } from './AreaConfig';

const GATE_W = 6.0;
const LOCKED_BG = GATE_MATERIAL_CONFIG.lockedColor;
const LOCKED_BD = GATE_MATERIAL_CONFIG.lockedBorder;
const PERM_BG = '#111111';
const PERM_BD = '#444444';

function pushOut(
    pos: THREE.Vector3,
    radius: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
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
        ctx.moveTo(60, 60);
        ctx.lineTo(px - 60, px - 60);
        ctx.moveTo(px - 60, 60);
        ctx.lineTo(60, px - 60);
        ctx.stroke();
    } else {
        ctx.fillStyle = open ? openColor : LOCKED_BG;
        ctx.fillRect(0, 0, px, px);

        ctx.strokeStyle = open ? 'rgba(255,255,255,0.6)' : LOCKED_BD;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, px - 10, px - 10);

        const text = String(value);
        const fontSize =
            text.length <= 2 ? 110 :
                text.length <= 3 ? 88 :
                    text.length <= 4 ? 68 :
                        52;

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

interface WallBox {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

interface GateEntry {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    mesh: THREE.Mesh;
    lockedTex: THREE.CanvasTexture;
    openTex: THREE.CanvasTexture;
    permTex: THREE.CanvasTexture;
    openColor: string;
    isOpen: boolean;
    permanentlyLocked: boolean;
}

export class LinearArea {
    public readonly config: AreaConfig;
    public readonly centerX: number;
    public readonly centerZ: number;

    private solidWalls: WallBox[] = [];
    private gate: GateEntry | null = null;
    private extraMaterials: THREE.Material[] = [];
    private sceneMeshes: THREE.Mesh[] = [];

    public constructor(
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

        const minX = cx - s;
        const maxX = cx + s;
        const minZ = cz - s;
        const maxZ = cz + s;

        this.buildSlab(scene, config.size, cx, cz);

        const dw = ROOM_GEOMETRY.dividerWalls;
        const sw = ROOM_GEOMETRY.sideWalls;

        /**
         * South/front divider walls.
         *
         * These sit outside the room at the south edge.
         * They leave a gate opening in the middle.
         */
        this.wallFromBounds(
            scene,
            minX,
            cx - g,
            minZ - dw.thickness,
            minZ,
            dw,
        );

        this.wallFromBounds(
            scene,
            cx + g,
            maxX,
            minZ - dw.thickness,
            minZ,
            dw,
        );

        if (config.gateValue > 0) {
            this.buildGateFromBounds(
                scene,
                cx - g,
                cx + g,
                minZ - dw.thickness,
                minZ,
                config.gateValue,
            );
        }

        // E/W side walls — extend in Z to fill both the south corner (where they meet the
        // dividers) and the north overhang, so the void is never visible on either end.
        this.wallFromBounds(scene, minX - sw.thickness, minX, minZ - dw.thickness, maxZ + sw.thickness, sw);
        this.wallFromBounds(scene, maxX, maxX + sw.thickness, minZ - dw.thickness, maxZ + sw.thickness, sw);

        // Invisible north edge — collision only, no mesh.
        this.solidWalls.push({ minX, maxX, minZ: maxZ, maxZ: maxZ + 1 });

        for (const m of this.sceneMeshes) {
            m.frustumCulled = false;
        }
    }

    public resolveCollisions(
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
                mat.emissive.set(g.isOpen ? g.openColor : LOCKED_BD);
                mat.needsUpdate = true;
            }

            if (!shouldBeOpen) {
                pushOut(playerPos, playerRadius, g.minX, g.maxX, g.minZ, g.maxZ);
            }
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

    public destroy(scene: THREE.Scene): void {
        for (const m of this.sceneMeshes) {
            scene.remove(m);
            m.geometry.dispose();

            const mats = Array.isArray(m.material) ? m.material : [m.material];

            for (const mat of mats) {
                mat.dispose();
            }
        }

        this.sceneMeshes = [];

        for (const mat of this.extraMaterials) {
            mat.dispose();
        }

        this.extraMaterials = [];

        if (this.gate) {
            this.gate.lockedTex.dispose();
            this.gate.openTex.dispose();
            this.gate.permTex.dispose();
            this.gate = null;
        }

        this.solidWalls = [];
    }

    private buildSlab(
        scene: THREE.Scene,
        size: number,
        cx: number,
        cz: number,
    ): void {
        const { depth, sideColor, roughness } = ROOM_GEOMETRY.base;

        const topMat = new THREE.MeshStandardMaterial({
            map: FloorBuilder.makeGridTexture(size),
            roughness: 0.8,
        });

        const sideMat = new THREE.MeshStandardMaterial({
            color: sideColor,
            roughness,
        });

        BendService.applyBend(topMat);
        BendService.applyBend(sideMat);

        this.extraMaterials.push(topMat, sideMat);

        const geo = new THREE.BoxGeometry(size, depth, size, 32, 2, 32);

        const mesh = new THREE.Mesh(geo, [
            sideMat,
            sideMat,
            topMat,
            sideMat,
            sideMat,
            sideMat,
        ]);

        mesh.position.set(cx, -depth / 2, cz);

        scene.add(mesh);
        this.sceneMeshes.push(mesh);
    }

    private wallFromBounds(
        scene: THREE.Scene,
        minX: number,
        maxX: number,
        minZ: number,
        maxZ: number,
        cfg: typeof ROOM_GEOMETRY.sideWalls,
    ): void {
        const sizeX = maxX - minX;
        const sizeZ = maxZ - minZ;
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;

        this.wall(scene, cx, cz, sizeX, sizeZ, cfg);

        this.solidWalls.push({
            minX,
            maxX,
            minZ,
            maxZ,
        });
    }

    private wall(
        scene: THREE.Scene,
        cx: number,
        cz: number,
        sizeX: number,
        sizeZ: number,
        cfg: typeof ROOM_GEOMETRY.sideWalls,
    ): void {
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

        mesh.position.set(cx, (cfg.height - cfg.depthBelow) / 2, cz);

        scene.add(mesh);
        this.sceneMeshes.push(mesh);
    }

    private buildGateFromBounds(
        scene: THREE.Scene,
        minX: number,
        maxX: number,
        minZ: number,
        maxZ: number,
        value: number,
    ): void {
        const sizeX = maxX - minX;
        const sizeZ = maxZ - minZ;
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;

        this.buildGate(scene, cx, cz, sizeX, sizeZ, value);

        if (this.gate) {
            this.gate.minX = minX;
            this.gate.maxX = maxX;
            this.gate.minZ = minZ;
            this.gate.maxZ = maxZ;
        }
    }

    private buildGate(
        scene: THREE.Scene,
        cx: number,
        cz: number,
        sizeX: number,
        sizeZ: number,
        value: number,
    ): void {
        const openColor = colorForValue(value);

        const lockedTex = makeGateTexture(value, false);
        const openTex = makeGateTexture(value, true, false, openColor);
        const permTex = makeGateTexture(value, false, true);

        const segX = Math.max(1, Math.round(sizeX / 2));
        const segZ = Math.max(1, Math.round(sizeZ / 2));

        const wallH = ROOM_GEOMETRY.dividerWalls.height;

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

        scene.add(mesh);
        this.sceneMeshes.push(mesh);

        this.gate = {
            minX: cx - sizeX / 2,
            maxX: cx + sizeX / 2,
            minZ: cz - sizeZ / 2,
            maxZ: cz + sizeZ / 2,
            mesh,
            lockedTex,
            openTex,
            permTex,
            openColor,
            isOpen: false,
            permanentlyLocked: false,
        };
    }
}