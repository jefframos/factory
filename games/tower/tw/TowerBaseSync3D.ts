// TowerBaseSync3D.ts

import type { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FaceTowerConfig } from './FaceTowerTypes';
import type { Tower3DConfig } from './Tower3DConfig';

/**
 * Mirrors every 2D base platform (the original floor, plus one per
 * completed zone — see FaceTowerBlockController.addBase()) as a matching
 * panel in the 3D scene, using the same pixelsPerUnit/baseOffset conversion
 * as TowerBlockSync3D — a rounded, semi-transparent slab (see
 * Tower3DConfig.baseBevelRadius/baseOpacity/baseColor) instead of a flat
 * opaque box.
 *
 * Unlike blocks, bases are never removed, so this only ever adds panels —
 * one per base, keyed by the base entity itself since bases have no id.
 */
export class TowerBaseSync3D {
    private readonly panels = new Map<BoxEntity, THREE.Mesh>();
    private readonly material: THREE.MeshStandardMaterial;

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly visualConfig: Tower3DConfig,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) {
        this.material = new THREE.MeshStandardMaterial({
            color: visualConfig.baseColor,
            roughness: 0.35,
            metalness: 0.1,
            transparent: true,
            opacity: visualConfig.baseOpacity,
        });
    }

    public sync(bases: readonly BoxEntity[]): void {
        for (const base of bases) {
            const panel = this.panels.get(base) ?? this.createPanel(base);
            this.updatePanel(panel, base);
        }
    }

    private createPanel(base: BoxEntity): THREE.Mesh {
        const width = this.config.floorWidth / this.pixelsPerUnit;
        const depth = this.visualConfig.platformDepth;
        const height = this.config.floorHeight / this.pixelsPerUnit;

        const radius = Math.min(
            this.visualConfig.baseBevelRadius,
            height * 0.5 - 0.01,
            depth * 0.5 - 0.01,
        );

        const geometry = new RoundedBoxGeometry(width, height, depth, 4, Math.max(0, radius));
        const panel = new THREE.Mesh(geometry, this.material);

        this.scene.add(panel);
        this.panels.set(base, panel);

        return panel;
    }

    private updatePanel(panel: THREE.Mesh, base: BoxEntity): void {
        const body = base.body;

        panel.position.set(
            (body.position.x - this.config.floorX) / this.pixelsPerUnit +
            this.baseOffset.x,

            (this.config.floorY - body.position.y) / this.pixelsPerUnit +
            this.baseOffset.y,

            this.baseOffset.z,
        );
    }

    public clear(): void {
        for (const panel of this.panels.values()) {
            this.scene.remove(panel);
            panel.geometry.dispose();
        }

        this.panels.clear();
    }

    public destroy(): void {
        this.clear();
        this.material.dispose();
    }
}
