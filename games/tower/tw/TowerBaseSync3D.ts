// TowerBaseSync3D.ts

import type { BoxEntity } from 'core/phyisics/entities/BoxEntity';
import * as THREE from 'three';
import { PieceBoxBuilder } from '../game/builders/PieceBoxBuilder';
import { TextureBuilder } from '../game/builders/TextureBuilder';
import type { FaceTowerConfig } from './FaceTowerTypes';
import { resolvePieceImagePath } from './PieceStorage';
import { getStaticPiece } from './StaticPieceStorage';
import type { Tower3DConfig } from './Tower3DConfig';

function hexStringToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
}

/**
 * Mirrors every 2D base platform (the original floor, plus one per
 * completed zone — see FaceTowerBlockController.addBase()) as a matching
 * panel in the 3D scene, using the same pixelsPerUnit/baseOffset conversion
 * as TowerBlockSync3D — built via PieceBoxBuilder (same beveled-extrude +
 * face-decal look every tower piece uses) instead of a plain
 * RoundedBoxGeometry, so a panel's shape/color/face art is data-driven.
 *
 * The very FIRST panel (the tower's starting floor) uses the 'base' static
 * piece (see StaticPieceStorage); every panel placed after it (one per
 * completed zone) uses the 'milestone' piece instead. Falls back to a plain
 * colored rect if a role has no piece configured, so an empty
 * static-pieces-config.json doesn't break anything.
 *
 * Unlike blocks, bases are never removed, so this only ever adds panels —
 * one per base, keyed by the base entity itself since bases have no id.
 */
export class TowerBaseSync3D {
    private readonly panels = new Map<BoxEntity, THREE.Mesh>();

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly visualConfig: Tower3DConfig,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) { }

    public sync(bases: readonly BoxEntity[]): void {
        for (const base of bases) {
            const panel = this.panels.get(base) ?? this.createPanel(base);
            this.updatePanel(panel, base);
        }
    }

    private createPanel(base: BoxEntity): THREE.Mesh {
        // The very first panel placed (see FaceTowerBlockController.initialise)
        // is the tower's starting floor — everything after it is a fresh
        // floor dropped in on a completed zone (see FaceTowerGameController.completeTurn).
        const isStartingFloor = this.panels.size === 0;
        const piece = getStaticPiece(isStartingFloor ? 'base' : 'milestone');

        const width = this.config.floorWidth / this.pixelsPerUnit;
        const height = this.config.floorHeight / this.pixelsPerUnit;
        const depth = this.visualConfig.platformDepth;

        // StaticPieceDefinition.faceOffset is authored in 2D design px —
        // converted through pixelsPerUnit here, same as width/height above.
        const faceOffsetPx = piece?.faceOffset ?? { x: 0, y: 0 };
        const faceOffset = { x: faceOffsetPx.x / this.pixelsPerUnit, y: faceOffsetPx.y / this.pixelsPerUnit };

        const panel = PieceBoxBuilder.build(
            piece ? hexStringToNumber(piece.color) : this.visualConfig.baseColor,
            width, height,
            {
                polygon: piece?.polygon,
                depth,
                faceOffset,
                faceScale: piece?.faceScale,
                // The base's PHYSICS stays a plain symmetric BoxEntity no
                // matter what polygon it's drawn with (see
                // FaceTowerBlockController.addBase), so the mesh must center
                // on the plain geometric middle too — not the polygon's own
                // (possibly off-center, e.g. an arch notch) area centroid —
                // or it visibly drifts from where the wall/columns and the
                // 2D collision box assume the floor actually sits.
                centerOverride: { x: 0.5, y: 0.5 },
            },
        );

        const material = panel.material as THREE.MeshStandardMaterial;
        material.roughness = 0.35;
        material.metalness = 0.1;

        this.scene.add(panel);
        this.panels.set(base, panel);

        if (piece?.texture) {
            // TextureBuilder.load caches by path, so repeated milestone
            // panels sharing the same piece resolve this near-instantly
            // after the first load.
            TextureBuilder.load(resolvePieceImagePath(piece.texture))
                .then(texture => PieceBoxBuilder.setFaceTexture(panel, texture))
                .catch(() => { /* keep the default shared face if art is missing */ });
        }

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
            PieceBoxBuilder.disposeMesh(panel);
            (panel.material as THREE.Material).dispose();
        }

        this.panels.clear();
    }

    public destroy(): void {
        this.clear();
    }
}
