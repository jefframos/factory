import * as THREE from "three";
import { CollectibleManager } from "./CollectibleManager";

const MAX_FOOD        = 20;
const SPAWN_INTERVAL  = 3.5;
const MIN_DIST_FOOD   = 2.5;
const MIN_DIST_PLAYER = 7;
const MAX_ATTEMPTS    = 30;

export class LevelManager {
    private timer = 0;

    update(
        delta: number,
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        foodValues: number[],
        spawnHalfSize: number,
        spawnCenter: THREE.Vector2,
    ): void {
        this.timer += delta;
        if (this.timer < SPAWN_INTERVAL) return;
        this.timer = 0;
        if (collectibles.count >= MAX_FOOD) return;
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
        const value = foodValues[Math.floor(Math.random() * foodValues.length)];

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const x = center.x + (Math.random() - 0.5) * 2 * halfSize;
            const z = center.y + (Math.random() - 0.5) * 2 * halfSize;
            const pos = new THREE.Vector3(x, 0, z);
            if (pos.distanceTo(playerPos) < MIN_DIST_PLAYER) continue;
            if (occupied.some(p => p.distanceTo(pos) < MIN_DIST_FOOD)) continue;
            collectibles.spawnOne(scene, pos, value);
            return;
        }
    }
}
