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
        moveDir: THREE.Vector3 | null = null,
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
            this.ensureNearbyFood(collectibles, scene, playerPos, rollValue, freeCells, moveDir);
        }
    }

    /**
     * See FOOD_CONFIG.guaranteedRadius — force-spawns right next to the
     * player (bypassing the timer/maxFood gate above) when they don't have
     * enough food actually reachable, regardless of how much the wider
     * zone's pool has been drawn down by bots.
     * @param moveDir Player's current movement direction (unit vector, or
     * null while stationary). A player holding a straight line moves fast
     * enough that "somewhere within guaranteedRadius" is no guarantee it's
     * somewhere they'll actually see — half the ring is already behind them.
     * When present, candidates are narrowed to a forward cone (see
     * FOOD_CONFIG.guaranteedAheadDot) first, falling back to the full ring
     * if that cone is empty (e.g. just started moving into a corner) — same
     * "biased pool, else the full pool" shape used elsewhere for spawn
     * picking (see BotController/BoundlessWorld3dScene).
     */
    private ensureNearbyFood(
        collectibles: CollectibleManager,
        scene: THREE.Scene,
        playerPos: THREE.Vector3,
        rollValue: () => number,
        freeCells: { x: number; z: number }[],
        moveDir: THREE.Vector3 | null,
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

        let pool = nearCells;
        if (moveDir && moveDir.lengthSq() > 0.0001) {
            const ahead = nearCells.filter(c => {
                const dx = c.x - playerPos.x, dz = c.z - playerPos.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                return (dx * moveDir.x + dz * moveDir.z) / d > FOOD_CONFIG.guaranteedAheadDot;
            });
            if (ahead.length > 0) pool = ahead;
        }

        const cell = pool[Math.floor(Math.random() * pool.length)];
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
