// TowerBlockSync3D.ts

import * as THREE from 'three';
import type { FaceTowerBlock, FaceTowerConfig } from './FaceTowerTypes';

/**
 * Mirrors every live 2D physics block as a matching cube in the 3D scene.
 * `pixelsPerUnit` design pixels become 1 THREE unit — at the default 80,
 * an 80x80 2D block becomes a 1x1x1 cube.
 *
 * Position mapping: 2D X and height-climbed-above-the-original-floor map
 * onto 3D X and Y (up) — the 2D game has no depth axis, so Z is fixed at 0.
 * Purely visual; the 2D Matter.js world stays the source of truth.
 */
export class TowerBlockSync3D {
    private readonly cubes = new Map<number, THREE.Mesh>();
    private readonly material: THREE.MeshStandardMaterial;

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) {
        this.material = new THREE.MeshStandardMaterial({
            color: 0xf2c14e,
            roughness: 0.7,
        });
    }

    public sync(blocks: readonly FaceTowerBlock[]): void {
        const seen = new Set<number>();

        for (const block of blocks) {
            seen.add(block.id);

            const cube = this.cubes.get(block.id) ?? this.createCube(block);
            this.updateCube(cube, block);
        }

        for (const [id, cube] of this.cubes) {
            if (!seen.has(id)) {
                this.removeCube(id, cube);
            }
        }
    }

    private createCube(block: FaceTowerBlock): THREE.Mesh {
        const width = this.config.blockWidth / this.pixelsPerUnit;
        const height = this.config.blockHeight / this.pixelsPerUnit;

        const geometry = new THREE.BoxGeometry(width, height, width);
        const cube = new THREE.Mesh(geometry, this.material);

        this.scene.add(cube);
        this.cubes.set(block.id, cube);

        return cube;
    }

    private updateCube(cube: THREE.Mesh, block: FaceTowerBlock): void {
        const body = block.entity.body;

        cube.position.set(
            (body.position.x - this.config.floorX) / this.pixelsPerUnit +
            this.baseOffset.x,

            (this.config.floorY - body.position.y) / this.pixelsPerUnit +
            this.baseOffset.y,

            this.baseOffset.z,
        );

        // 2D rotation is around the screen-facing axis; the closest 3D
        // analogue for a side-on toppling block is rotation about Z.
        cube.rotation.z = -body.angle;
    }

    private removeCube(id: number, cube: THREE.Mesh): void {
        this.scene.remove(cube);
        cube.geometry.dispose();
        this.cubes.delete(id);
    }

    public clear(): void {
        for (const [id, cube] of this.cubes) {
            this.removeCube(id, cube);
        }
    }

    public destroy(): void {
        this.clear();
        this.material.dispose();
    }
}
