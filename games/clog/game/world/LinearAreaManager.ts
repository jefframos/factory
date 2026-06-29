import * as THREE from 'three';
import { LinearArea } from './LinearArea';
import { getLinearRoomConfig, computeFoodCount, FOOD_CONFIG } from './LinearConfig';
import type { LinearRoomConfig } from './LinearConfig';
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
    private currentPlayers: PlayerEntity[] = [];

    public onTransition?: (data: LinearTransitionData) => void;

    constructor(scene: THREE.Scene) {
        this.scene       = scene;
        this.currentArea = new LinearArea(getLinearRoomConfig(0), 0, 0, scene);
        this.nextArea    = this.buildArea(1);
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
        this.currentArea.resolveCollisions(player.position, player.collisionRadius, player.value);

        const s = this.currentConfig.size / 2;
        if (player.position.z < this.currentCenterZ - s - TRANSITION_BUFFER) {
            this.transition();
        }
    }

    destroy(): void {
        this.prevArea?.destroy(this.scene);
        this.currentArea.destroy(this.scene);
        this.nextArea.destroy(this.scene);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private centerZFor(roomIdx: number): number {
        let z = 0;
        for (let i = 0; i < roomIdx; i++) {
            z -= getLinearRoomConfig(i).size / 2 + getLinearRoomConfig(i + 1).size / 2;
        }
        return z;
    }

    private buildArea(roomIdx: number): LinearArea {
        return new LinearArea(getLinearRoomConfig(roomIdx), 0, this.centerZFor(roomIdx), this.scene);
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
        this.nextArea       = this.buildArea(this.currentRoomIdx + 1);

        this.onTransition?.({ prevMinZ, prevMaxZ });
    }
}
