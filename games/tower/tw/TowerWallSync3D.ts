// TowerWallSync3D.ts

import type { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FaceTowerConfig } from './FaceTowerTypes';
import type { Tower3DConfig } from './Tower3DConfig';

/**
 * Mirrors the 2D side containment poles (see TowerDeadZoneController's
 * walls — the short bumper rails flush against the base's edges) as
 * matching rounded blocks in the 3D scene — same rounded-slab look as
 * TowerBaseSync3D's platform (bevel/depth/opacity from Tower3DConfig), just
 * sized to the wall's own footprint and in poleColor/poleOpacity.
 *
 * Walls are rebuilt (destroyed and recreated) every time a new base is
 * placed, so unlike blocks/bases this has to fully rebuild its own meshes
 * each time the underlying wall entity set changes — see sync().
 */
export class TowerWallSync3D {
    private poles: THREE.Mesh[] = [];
    private readonly material: THREE.MeshStandardMaterial;
    // A snapshot COPY, not the live reference — TowerDeadZoneController
    // mutates the same array in place on every rebuild() (splice to 0 then
    // re-push), so comparing against the live reference would never detect
    // a change; comparing element-by-element against a frozen copy does.
    private trackedWalls: BoxEntity[] = [];

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly visualConfig: Tower3DConfig,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) {
        this.material = new THREE.MeshStandardMaterial({
            color: visualConfig.poleColor,
            roughness: 0.3,
            metalness: 0.2,
            transparent: true,
            opacity: visualConfig.poleOpacity,
        });
    }

    public sync(walls: readonly BoxEntity[]): void {
        const changed =
            walls.length !== this.trackedWalls.length ||
            walls.some((wall, i) => wall !== this.trackedWalls[i]);

        if (changed) {
            this.rebuild(walls);
        }

        for (let i = 0; i < walls.length; i++) {
            this.updatePole(this.poles[i], walls[i]);
        }
    }

    private rebuild(walls: readonly BoxEntity[]): void {
        this.clearPoles();

        const width = this.config.wallWidth / this.pixelsPerUnit;
        const height = this.config.wallHeight / this.pixelsPerUnit;
        const depth = this.visualConfig.platformDepth;

        const bevel = Math.min(
            this.visualConfig.baseBevelRadius,
            width * 0.5 - 0.01,
            height * 0.5 - 0.01,
            depth * 0.5 - 0.01,
        );

        for (let i = 0; i < walls.length; i++) {
            const geometry = new RoundedBoxGeometry(width, height, depth, 4, Math.max(0, bevel));
            const pole = new THREE.Mesh(geometry, this.material);

            this.scene.add(pole);
            this.poles.push(pole);
        }

        this.trackedWalls = [...walls];
    }

    private updatePole(pole: THREE.Mesh, wall: BoxEntity): void {
        const body = wall.body;

        pole.position.set(
            (body.position.x - this.config.floorX) / this.pixelsPerUnit +
            this.baseOffset.x,

            (this.config.floorY - body.position.y) / this.pixelsPerUnit +
            this.baseOffset.y,

            this.baseOffset.z,
        );
    }

    private clearPoles(): void {
        for (const pole of this.poles) {
            this.scene.remove(pole);
            pole.geometry.dispose();
        }

        this.poles = [];
    }

    public clear(): void {
        this.clearPoles();
        this.trackedWalls = [];
    }

    public destroy(): void {
        this.clear();
        this.material.dispose();
    }
}
