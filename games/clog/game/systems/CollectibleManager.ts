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
    spawnOne(scene: THREE.Scene, pos: THREE.Vector3): void {
        this.cubes.push(new TailCube(2, scene, pos));
    }

    get count(): number {
        return this.cubes.length;
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

    destroy(): void {
        for (const cube of this.cubes) cube.destroy();
        this.cubes = [];
    }
}
