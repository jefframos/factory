import * as THREE from "three";
import { CollectibleManager } from "./CollectibleManager";
import { FOOD_CONFIG } from "../world/LinearConfig";

export class LevelManager {
    private timer = 0;

    /**
     * Top-up food in the current room to `maxFood` items.
     * `maxFood` should come from `LinearAreaManager.computedFoodCount` so it
     * scales with room size according to FOOD_CONFIG density settings.
     */
    update(
        delta: number,
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        foodValues: number[],
        spawnHalfSize: number,
        spawnCenter: THREE.Vector2,
        maxFood: number,
    ): void {
        this.timer += delta;
        if (this.timer < FOOD_CONFIG.spawnInterval) return;
        this.timer = 0;
        // Count only items inside the current room's Z band — not global count,
        // which would include pre-spawned food in the adjacent room.
        const zMin = spawnCenter.y - spawnHalfSize;
        const zMax = spawnCenter.y + spawnHalfSize;
        if (collectibles.countInZRange(zMin, zMax) >= maxFood) return;
        this.trySpawn(collectibles, scene, playerPos, foodValues, spawnHalfSize, spawnCenter);
    }

    private trySpawn(
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        foodValues: number[],
        halfSize: number,
        center: THREE.Vector2,
    ): void {
        const occupied = collectibles.positions;
        const value    = foodValues[Math.floor(Math.random() * foodValues.length)];

        for (let i = 0; i < FOOD_CONFIG.maxPlacementAttempts; i++) {
            const x   = center.x + (Math.random() - 0.5) * 2 * halfSize;
            const z   = center.y + (Math.random() - 0.5) * 2 * halfSize;
            const pos = new THREE.Vector3(x, 0, z);
            if (pos.distanceTo(playerPos) < FOOD_CONFIG.minDistFromPlayer) continue;
            if (occupied.some(p => p.distanceTo(pos) < FOOD_CONFIG.minDistBetweenItems)) continue;
            collectibles.spawnOne(scene, pos, value);
            return;
        }
    }
}
