import * as THREE from "three";
import { TailCube } from "../entities/TailCube";

/**
 * Spawns and tracks collectible cubes in the scene.
 * Returns a cube (removing it from the pool) when the player collides with it.
 */
export class CollectibleManager {
    private cubes: TailCube[] = [];

    spawn(scene: THREE.Scene, count: number, range: number): void {
        for (let i = 0; i < count; i++) {
            const x = (Math.random() - 0.5) * range;
            const z = (Math.random() - 0.5) * range;
            const cube = new TailCube(2, scene, new THREE.Vector3(x, 0, z));
            this.cubes.push(cube);
        }
    }
    spawnOne(scene: THREE.Scene, pos: THREE.Vector3, value = 2, withPop = true): void {
        const cube = new TailCube(value, scene, pos);
        if (withPop) cube.startSpawnPop();
        this.cubes.push(cube);
    }

    get count(): number {
        return this.cubes.length;
    }

    /** Count only collectibles whose Z falls within [minZ, maxZ]. */
    countInZRange(minZ: number, maxZ: number): number {
        let n = 0;
        for (const c of this.cubes) {
            const z = c.position.z;
            if (z >= minZ && z <= maxZ) n++;
        }
        return n;
    }

    /** Live position references — do NOT mutate. */
    get positions(): THREE.Vector3[] {
        return this.cubes.map(c => c.position);
    }
    /**
     * Returns the first collectible within `radius` of `playerPos`,
     * removing it from the managed pool. Returns null if none found.
     */
    checkCollision(playerPos: THREE.Vector3, radius: number): TailCube | null {
        for (let i = 0; i < this.cubes.length; i++) {
            if (playerPos.distanceTo(this.cubes[i].position) < radius) {
                return this.cubes.splice(i, 1)[0];
            }
        }
        return null;
    }

    /** Remove only collectibles whose Z falls within [minZ, maxZ]. */
    clearInZRange(minZ: number, maxZ: number): void {
        for (let i = this.cubes.length - 1; i >= 0; i--) {
            const z = this.cubes[i].position.z;
            if (z >= minZ && z <= maxZ) {
                this.cubes[i].destroy();
                this.cubes.splice(i, 1);
            }
        }
    }

    /** Tick every cube's animations (pop, bounce, shadow). Must be called each frame. */
    update(delta: number): void {
        for (const cube of this.cubes) cube.update(delta);
    }

    destroy(): void {
        for (const cube of this.cubes) cube.destroy();
        this.cubes = [];
    }
}
