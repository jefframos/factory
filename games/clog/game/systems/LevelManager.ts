import * as THREE from "three";
import { CollectibleManager } from "./CollectibleManager";
import { FOOD_CONFIG } from "../world/LinearConfig";

export class LevelManager {
    private timer = 0;
    private guaranteeTimer = 0;

    /**
     * Top-up food in the current room to `maxFood` items.
     * Picks spawn positions from `freeCells` (grid-derived, walls and obstacles excluded).
     * `rollValue` decides what value each spawned item gets — callers pass
     * either the shared weighted roll (LinearConfig.rollFoodValue, boundless
     * mode) or a closure over their own curated pool (per-room foodValues,
     * gated mode) — see BoundlessWorld3dScene/LinearWorld3dScene.
     */
    update(
        delta: number,
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        rollValue: () => number,
        freeCells: { x: number; z: number }[],
        zMin: number,
        zMax: number,
        maxFood: number,
    ): void {
        this.timer += delta;
        if (this.timer >= FOOD_CONFIG.spawnInterval) {
            this.timer = 0;
            if (collectibles.countInZRange(zMin, zMax) < maxFood) {
                this.trySpawn(collectibles, scene, playerPos, rollValue, freeCells);
            }
        }

        this.guaranteeTimer += delta;
        if (this.guaranteeTimer >= FOOD_CONFIG.guaranteedCheckInterval) {
            this.guaranteeTimer = 0;
            this.ensureNearbyFood(collectibles, scene, playerPos, rollValue, freeCells);
        }
    }

    /** See FOOD_CONFIG.guaranteedRadius — force-spawns right next to the player (bypassing the timer/maxFood gate above) when they don't have enough food actually reachable, regardless of how much the wider zone's pool has been drawn down by bots. */
    private ensureNearbyFood(
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        rollValue: () => number,
        freeCells: { x: number; z: number }[],
    ): void {
        if (collectibles.getPositionsNear(playerPos, FOOD_CONFIG.guaranteedRadius).length >= FOOD_CONFIG.guaranteedMinCount) return;

        // Past minDistFromPlayer (not literally on top of the player) but
        // within the guarantee ring, so this lands somewhere reachable right
        // now instead of just "somewhere in the zone."
        const minR2 = FOOD_CONFIG.minDistFromPlayer * FOOD_CONFIG.minDistFromPlayer;
        const maxR2 = FOOD_CONFIG.guaranteedRadius * FOOD_CONFIG.guaranteedRadius;
        const nearCells = freeCells.filter(c => {
            const dx = c.x - playerPos.x, dz = c.z - playerPos.z;
            const d2 = dx * dx + dz * dz;
            return d2 >= minR2 && d2 <= maxR2;
        });
        if (nearCells.length === 0) return;

        const cell = nearCells[Math.floor(Math.random() * nearCells.length)];
        collectibles.spawnOne(scene, new THREE.Vector3(cell.x, 0, cell.z), rollValue());
    }

    private trySpawn(
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        rollValue: () => number,
        freeCells: { x: number; z: number }[],
    ): void {
        if (freeCells.length === 0) return;
        const occupied = collectibles.positions;
        const value    = rollValue();

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
