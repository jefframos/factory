import * as THREE from "three";
import { CollectibleManager } from "./CollectibleManager";
import { FOOD_CONFIG } from "../world/LinearConfig";

export class LevelManager {
    private timer = 0;

    /**
     * Top-up food in the current room to `maxFood` items.
     * Picks spawn positions from `freeCells` (grid-derived, walls and obstacles excluded).
     */
    update(
        delta: number,
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        foodValues: number[],
        freeCells: { x: number; z: number }[],
        zMin: number,
        zMax: number,
        maxFood: number,
    ): void {
        this.timer += delta;
        if (this.timer < FOOD_CONFIG.spawnInterval) return;
        this.timer = 0;
        if (collectibles.countInZRange(zMin, zMax) >= maxFood) return;
        this.trySpawn(collectibles, scene, playerPos, foodValues, freeCells);
    }

    private trySpawn(
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        foodValues: number[],
        freeCells: { x: number; z: number }[],
    ): void {
        if (freeCells.length === 0) return;
        const occupied = collectibles.positions;
        const value    = foodValues[Math.floor(Math.random() * foodValues.length)];

        for (let i = 0; i < FOOD_CONFIG.maxPlacementAttempts; i++) {
            const cell = freeCells[Math.floor(Math.random() * freeCells.length)];
            const pos  = new THREE.Vector3(cell.x, 0, cell.z);
            if (pos.distanceTo(playerPos) < FOOD_CONFIG.minDistFromPlayer) continue;
            if (occupied.some(p => p.distanceTo(pos) < FOOD_CONFIG.minDistBetweenItems)) continue;
            collectibles.spawnOne(scene, pos, value);
            return;
        }
    }
}
