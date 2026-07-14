import * as THREE from "three";
import { TailCube } from "../entities/TailCube";
import { MultiplierCube } from "../entities/MultiplierCube";

/**
 * Spawns and tracks collectible cubes.
 * Automatically keeps multiplier cubes alive according to the configured rules.
 */
export class CollectibleManager {
    private cubes: TailCube[] = [];

    // -------------------------------------------------------
    // Multiplier spawn configuration
    // -------------------------------------------------------

    private multiplierConfig = {
        enabled: true,

        /** First multiplier appears after this many seconds. */
        firstSpawnDelay: 20,

        /** Afterwards, check every X seconds. */
        spawnInterval: 40,

        /** Maximum multiplier cubes alive simultaneously. */
        maxAlive: 1,

        /** Multiplier value (2 = 2x). */
        value: 2,
    };

    private elapsedTime = 0;
    private nextMultiplierSpawn = this.multiplierConfig.firstSpawnDelay;

    // -------------------------------------------------------

    configureMultiplier(config: Partial<typeof this.multiplierConfig>): void {
        Object.assign(this.multiplierConfig, config);
        this.nextMultiplierSpawn = this.multiplierConfig.firstSpawnDelay;
    }

    spawn(scene: THREE.Scene, count: number, range: number): void {
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * range;
            const z = (Math.random() - 0.5) * range;

            const pos = new THREE.Vector3(x, 0, z)

            this.spawnOne(scene, new THREE.Vector3(x, 0, z));
        }
    }

    spawnOne(
        scene: THREE.Scene,
        pos: THREE.Vector3,
        value = 2,
        withPop = true
    ): void {

        if (this.shouldSpawnMultiplier()) {
            this.spawnMultiplier(scene, pos);
            return;

        }

        const cube = new TailCube(value, scene, pos);
        if (withPop) cube.startSpawnPop();
        this.cubes.push(cube);
    }

    spawnMultiplier(
        scene: THREE.Scene,
        pos: THREE.Vector3,
        value = this.multiplierConfig.value,
        withPop = true
    ): void {

        if (
            this.elapsedTime >= this.nextMultiplierSpawn &&
            this.multiplierCount < this.multiplierConfig.maxAlive
        ) {
            // Schedule next check.
            this.nextMultiplierSpawn += this.multiplierConfig.spawnInterval;
        }

        const cube = new MultiplierCube(value, scene, pos);
        if (withPop) cube.startSpawnPop();
        this.cubes.push(cube);
    }

    /**
     * Call this whenever you generate a normal collectible.
     * If it's time for a multiplier and none exist, this collectible
     * becomes a multiplier instead.
     */
    spawnAuto(
        scene: THREE.Scene,
        pos: THREE.Vector3,
        value = 2,
        withPop = true
    ): void {
        if (this.shouldSpawnMultiplier()) {
            this.spawnMultiplier(scene, pos);
        } else {
            this.spawnOne(scene, pos, value, withPop);
        }
    }

    private shouldSpawnMultiplier(): boolean {

        if (!this.multiplierConfig.enabled) return false;

        if (this.elapsedTime < this.nextMultiplierSpawn) return false;

        return this.multiplierCount < this.multiplierConfig.maxAlive;
    }

    get multiplierCount(): number {
        let count = 0;

        for (const cube of this.cubes) {
            if (cube.isMultiplier) count++;
        }

        return count;
    }

    get count(): number {
        return this.cubes.length;
    }

    countInZRange(minZ: number, maxZ: number): number {
        let n = 0;
        for (const c of this.cubes) {
            const z = c.position.z;
            if (z >= minZ && z <= maxZ) n++;
        }
        return n;
    }

    get positions(): THREE.Vector3[] {
        return this.cubes.map(c => c.position);
    }

    getPositionsNear(origin: THREE.Vector3, radius: number): THREE.Vector3[] {
        const r2 = radius * radius;
        const out: THREE.Vector3[] = [];

        for (const c of this.cubes) {
            const dx = c.position.x - origin.x;
            const dz = c.position.z - origin.z;

            if (dx * dx + dz * dz <= r2)
                out.push(c.position);
        }

        return out;
    }

    checkCollision(playerPos: THREE.Vector3, radius: number): TailCube | null {
        for (let i = 0; i < this.cubes.length; i++) {
            if (playerPos.distanceTo(this.cubes[i].position) < radius) {
                return this.cubes.splice(i, 1)[0];
            }
        }

        return null;
    }

    absorbDrop(cubes: TailCube[]): void {
        this.cubes.push(...cubes);
    }

    clearInZRange(minZ: number, maxZ: number): void {
        for (let i = this.cubes.length - 1; i >= 0; i--) {
            const z = this.cubes[i].position.z;

            if (z >= minZ && z <= maxZ) {
                this.cubes[i].destroy();
                this.cubes.splice(i, 1);
            }
        }
    }

    clearInRect(minX: number, maxX: number, minZ: number, maxZ: number): void {
        for (let i = this.cubes.length - 1; i >= 0; i--) {
            const { x, z } = this.cubes[i].position;

            if (
                x >= minX &&
                x <= maxX &&
                z >= minZ &&
                z <= maxZ
            ) {
                this.cubes[i].destroy();
                this.cubes.splice(i, 1);
            }
        }
    }

    update(delta: number): void {
        this.elapsedTime += delta;
        for (const cube of this.cubes) {
            cube.update(delta);
        }
    }

    destroy(): void {
        for (const cube of this.cubes)
            cube.destroy();

        this.cubes = [];
        this.elapsedTime = 0;
        this.nextMultiplierSpawn = this.multiplierConfig.firstSpawnDelay;
    }
}