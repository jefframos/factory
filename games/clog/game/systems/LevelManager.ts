import * as THREE from "three";
import { CollectibleManager } from "./CollectibleManager";

const MAX_FOOD = 20;
const SPAWN_INTERVAL = 3.5;   // seconds between spawn attempts
const MIN_DIST_FOOD = 2.5;   // min distance between food items
const MIN_DIST_PLAYER = 7;     // don't spawn too close to the player
const SPAWN_RANGE = 24;    // half-width of the spawn area
const MAX_SPAWN_ATTEMPTS = 30;    // how many random tries before giving up

export class LevelManager {
    private timer = 0;

    update(
        delta: number,
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
    ): void {
        this.timer += delta;
        if (this.timer < SPAWN_INTERVAL) return;
        this.timer = 0;

        if (collectibles.count >= MAX_FOOD) return;

        this.trySpawn(collectibles, scene, playerPos);
    }

    private trySpawn(
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
    ): void {
        const occupied = collectibles.positions;

        for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
            const x = (Math.random() - 0.5) * SPAWN_RANGE;
            const z = (Math.random() - 0.5) * SPAWN_RANGE;
            const pos = new THREE.Vector3(x, 0, z);

            // Too close to player?
            if (pos.distanceTo(playerPos) < MIN_DIST_PLAYER) continue;

            // Overlaps an existing collectible?
            if (occupied.some(p => p.distanceTo(pos) < MIN_DIST_FOOD)) continue;

            collectibles.spawnOne(scene, pos);
            return;
        }
        // All attempts failed — floor is too crowded, skip this tick
    }
}
