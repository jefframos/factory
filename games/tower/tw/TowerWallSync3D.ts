// TowerWallSync3D.ts

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
 * Mirrors the 2D side containment poles (see TowerDeadZoneController's
 * walls — the short bumper rails flush against the base's edges) as
 * matching blocks in the 3D scene — built via PieceBoxBuilder (same
 * beveled-extrude + face-decal look every tower piece uses) from the
 * 'column' static piece (see StaticPieceStorage), sized to the wall's own
 * footprint. Falls back to a plain colored rect if no 'column' piece is
 * configured. The same piece definition is reused for both poles.
 *
 * Walls are rebuilt (destroyed and recreated) every time a new base is
 * placed, so unlike blocks/bases this has to fully rebuild its own meshes
 * each time the underlying wall entity set changes — see sync().
 */
export class TowerWallSync3D {
    private poles: THREE.Mesh[] = [];
    // A snapshot COPY, not the live reference — TowerDeadZoneController
    // mutates the same array in place on every rebuild() (splice to 0 then
    // re-push), so comparing against the live reference would never detect
    // a change; comparing element-by-element against a frozen copy does.
    private trackedWalls: BoxEntity[] = [];
    // The walls themselves are Pool-recycled (see TowerDeadZoneController's
    // createWall/Pool.getElement) — clear()+rebuild() reliably hands back
    // the SAME BoxEntity instances every time (destroy() returns them to
    // Pool, and the next rebuild's getElement() immediately shifts them back
    // out), so trackedWalls never actually changes identity zone-to-zone and
    // the array-comparison above alone would never detect a rebuild is
    // needed. Tracking the height separately catches the case identity
    // comparison can't: same wall objects, different size.
    private trackedWallHeightPx = -1;

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly config: FaceTowerConfig,
        private readonly pixelsPerUnit: number,
        private readonly visualConfig: Tower3DConfig,
        private readonly baseOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    ) { }

    /** `wallHeightPx` is the 2D world-px wall height (see TowerDeadZoneController.rebuild) — converted to world units the same way width already is. */
    public sync(walls: readonly BoxEntity[], wallHeightPx: number = 0): void {
        const changed =
            walls.length !== this.trackedWalls.length ||
            walls.some((wall, i) => wall !== this.trackedWalls[i]) ||
            wallHeightPx !== this.trackedWallHeightPx;

        if (changed) {
            this.rebuild(walls, wallHeightPx);
            this.trackedWallHeightPx = wallHeightPx;
        }

        for (let i = 0; i < walls.length; i++) {
            this.updatePole(this.poles[i], walls[i]);
        }
    }

    private rebuild(walls: readonly BoxEntity[], wallHeightPx: number): void {
        this.clearPoles();

        const piece = getStaticPiece('column');
        const width = this.config.wallWidth / this.pixelsPerUnit;
        const height = wallHeightPx / this.pixelsPerUnit;
        const depth = this.visualConfig.platformDepth;

        // StaticPieceDefinition.faceOffset is authored in 2D design px —
        // converted through pixelsPerUnit here, same as width/height above.
        const faceOffsetPx = piece?.faceOffset ?? { x: 0, y: 0 };
        const faceOffset = { x: faceOffsetPx.x / this.pixelsPerUnit, y: faceOffsetPx.y / this.pixelsPerUnit };

        for (let i = 0; i < walls.length; i++) {
            const pole = PieceBoxBuilder.build(
                piece ? hexStringToNumber(piece.color) : this.visualConfig.poleColor,
                width, height,
                {
                    polygon: piece?.polygon,
                    depth,
                    faceOffset,
                    faceScale: piece?.faceScale,
                    // Same reasoning as TowerBaseSync3D: the pole's physics
                    // stays a plain symmetric BoxEntity regardless of the
                    // piece's own polygon, so the mesh must center on the
                    // plain geometric middle, not the polygon's own centroid.
                    centerOverride: { x: 0.5, y: 0.5 },
                },
            );

            const material = pole.material as THREE.MeshStandardMaterial;
            material.roughness = 0.3;
            material.metalness = 0.2;

            this.scene.add(pole);
            this.poles.push(pole);

            if (piece?.texture) {
                TextureBuilder.load(resolvePieceImagePath(piece.texture))
                    .then(texture => PieceBoxBuilder.setFaceTexture(pole, texture))
                    .catch(() => { /* keep the default shared face if art is missing */ });
            }
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
            PieceBoxBuilder.disposeMesh(pole);
            (pole.material as THREE.Material).dispose();
        }

        this.poles = [];
    }

    public clear(): void {
        this.clearPoles();
        this.trackedWalls = [];
        this.trackedWallHeightPx = -1;
    }

    public destroy(): void {
        this.clear();
    }
}
