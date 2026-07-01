import * as THREE from 'three';
import { LinearArea } from './LinearArea';
import { ROOM_GEOMETRY } from './MeshConfig';
import { createWaterMaterial } from '../builders/WaterMaterial';
import { BendService } from '../services/BendService';
import { FloorBuilder } from '../builders/FloorBuilder';

const DEBUG_GRID = new URLSearchParams(window.location.search).has('debugGrid');
import { getLinearRoomConfig, computeFoodCount, FOOD_CONFIG } from './LinearConfig';
import type { LinearRoomConfig } from './LinearConfig';
import { RoomGrid } from './RoomGrid';
import { PlayerEntity } from '../entities/PlayerEntity';

const TRANSITION_BUFFER = 2.5;

export interface LinearTransitionData {
    /** Z bounds of the room that was just left — scene uses this to clear its food. */
    prevMinZ: number;
    prevMaxZ: number;
}

export class LinearAreaManager {
    private scene: THREE.Scene;
    private currentRoomIdx = 0;
    private currentCenterZ = 0;
    private prevArea: LinearArea | null = null;   // locked, rendered, not updated
    private currentArea: LinearArea;
    private nextArea: LinearArea;
    private pendingNextArea: LinearArea | null = null; // pre-built before transition to avoid frame spike
    private currentPlayers: PlayerEntity[] = [];
    private floorMesh: THREE.Mesh;
    private floorMat: THREE.Material;

    public onTransition?: (data: LinearTransitionData) => void;

    constructor(scene: THREE.Scene) {
        this.scene       = scene;
        this.currentArea = new LinearArea(getLinearRoomConfig(0), 0, 0, scene, 0);
        this.nextArea    = this.buildArea(1);
        this.logGrid(0, this.currentArea.grid.toLogString());
        this.floorMesh = this.buildFloor(scene);
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    get currentRoomIndex(): number        { return this.currentRoomIdx; }
    get currentConfig(): LinearRoomConfig { return getLinearRoomConfig(this.currentRoomIdx); }
    get foodValues(): number[]            { return this.currentConfig.foodValues; }

    /** Food pool including each registered player's min value if it falls below the room minimum. */
    get effectiveFoodValues(): number[] {
        const cfg = this.currentConfig.foodValues;
        if (this.currentPlayers.length === 0) return cfg;
        const cfgMin = Math.min(...cfg);
        const extras: number[] = [];
        for (const p of this.currentPlayers) {
            const mv = p.minTailValue;
            if (mv < cfgMin && !cfg.includes(mv) && !extras.includes(mv)) extras.push(mv);
        }
        return extras.length === 0 ? cfg : [...extras, ...cfg];
    }

    get computedFoodCount(): number        { return computeFoodCount(this.currentConfig.size); }
    get spawnHalfSize(): number           { return this.currentConfig.size / 2 - FOOD_CONFIG.spawnPadding; }
    get spawnCenter(): THREE.Vector2      { return new THREE.Vector2(0, this.currentCenterZ); }
    get nextGateValue(): number           { return getLinearRoomConfig(this.currentRoomIdx + 1).gateValue; }

    get currentGrid(): RoomGrid { return this.currentArea.grid; }
    get nextGrid():    RoomGrid { return this.nextArea.grid; }

    // Next area — always pre-built and visible through the gate
    get nextConfig(): LinearRoomConfig         { return getLinearRoomConfig(this.currentRoomIdx + 1); }
    get nextComputedFoodCount(): number        { return computeFoodCount(this.nextConfig.size); }
    get nextSpawnHalfSize(): number            { return this.nextConfig.size / 2 - FOOD_CONFIG.spawnPadding; }
    get nextSpawnCenter(): THREE.Vector2       { return new THREE.Vector2(0, this.centerZFor(this.currentRoomIdx + 1)); }

    registerPlayer(player: PlayerEntity): void {
        if (!this.currentPlayers.includes(player)) this.currentPlayers.push(player);
    }

    // ── Update ────────────────────────────────────────────────────────────────

    update(player: PlayerEntity): void {
        this.floorMesh.position.x = player.position.x;
        this.floorMesh.position.z = player.position.z;
        this.currentArea.resolveCollisions(player.position, player.collisionRadius, player.value);

        const s = this.currentConfig.size / 2;
        const southEdge = this.currentCenterZ - s;
        if (!this.pendingNextArea && player.position.z - southEdge < 20) {
            this.pendingNextArea = this.buildArea(this.currentRoomIdx + 2);
        }
        if (player.position.z < southEdge - TRANSITION_BUFFER) {
            this.transition();
        }
    }

    destroy(): void {
        this.prevArea?.destroy(this.scene);
        this.currentArea.destroy(this.scene);
        this.nextArea.destroy(this.scene);
        this.pendingNextArea?.destroy(this.scene);
        this.scene.remove(this.floorMesh);
        this.floorMesh.geometry.dispose();
        this.floorMat.dispose();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private centerZFor(roomIdx: number): number {
        let z = 0;
        for (let i = 0; i < roomIdx; i++) {
            z -= getLinearRoomConfig(i).size / 2 + getLinearRoomConfig(i + 1).size / 2;
        }
        return z;
    }

    private logGrid(roomIdx: number, grid: string): void {
        if (!DEBUG_GRID) return;
        console.log(`[Room ${roomIdx}] grid ${this.currentArea.grid.cols}×${this.currentArea.grid.rows}:\n${grid}`);
    }

    private buildFloor(scene: THREE.Scene): THREE.Mesh {
        // Single plane that follows the player each frame.
        // 160 units covers the visible ground; the BendService world-curve
        // drops the edges below the horizon before they reach the screen edge.
        const SIZE = 160;
        const SEGMENTS = 64;
        const { shader: floorShader, opacity, elevation, waterColors, roughness } = ROOM_GEOMETRY.floor;

        let mat: THREE.Material;
        if (floorShader === 'water') {
            mat = createWaterMaterial(opacity, elevation, waterColors);
        } else {
            const stdMat = new THREE.MeshStandardMaterial({
                map: FloorBuilder.makeGridTexture(SIZE),
                roughness,
                transparent: opacity < 1,
                opacity,
            });
            BendService.applyBend(stdMat);
            mat = stdMat;
        }
        this.floorMat = mat;

        const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;

        if (floorShader === 'water') {
            const t0 = performance.now();
            mesh.onBeforeRender = () => {
                (mat as THREE.ShaderMaterial).uniforms.time.value = (performance.now() - t0) / 1000;
            };
        }

        scene.add(mesh);
        return mesh;
    }

    private buildArea(roomIdx: number): LinearArea {
        return new LinearArea(getLinearRoomConfig(roomIdx), 0, this.centerZFor(roomIdx), this.scene, roomIdx);
    }

    private transition(): void {
        const prevSize = getLinearRoomConfig(this.currentRoomIdx).size;
        const prevMinZ = this.currentCenterZ - prevSize / 2;
        const prevMaxZ = this.currentCenterZ + prevSize / 2;

        // Destroy the room that is now two steps behind (player has fully left it)
        this.prevArea?.destroy(this.scene);

        // Lock the gate of the room being left, keep its geometry visible for one more room
        this.currentArea.lockForwardGate();
        this.prevArea = this.currentArea;   // still rendered, no longer updated

        this.currentRoomIdx++;
        this.currentCenterZ = this.centerZFor(this.currentRoomIdx);
        this.currentArea    = this.nextArea;
        this.nextArea       = this.pendingNextArea ?? this.buildArea(this.currentRoomIdx + 1);
        this.pendingNextArea = null;
        this.logGrid(this.currentRoomIdx, this.currentArea.grid.toLogString());

        // Seal the entrance of the room the player just entered so they can't go back.
        this.currentArea.lockEntranceGate();

        this.onTransition?.({ prevMinZ, prevMaxZ });
    }
}
